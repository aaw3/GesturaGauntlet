const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'gestura_session';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 12);

class AuthService {
  constructor() {
    this.username = process.env.DASHBOARD_USERNAME || 'admin';
    this.passwordHash = process.env.DASHBOARD_PASSWORD_HASH || '';
    this.sessionSecret = process.env.SESSION_SECRET || '';
  }

  login(username, password) {
    if (!this.validateCredentials(username, password)) {
      throw new Error('Invalid username or password');
    }

    return this.createSessionToken({
      sub: username,
      iat: Date.now(),
      exp: Date.now() + SESSION_TTL_MS,
    });
  }

    validateConfig() {
    const errors = [];

    if (!this.sessionSecret) errors.push('SESSION_SECRET is required');
    if (!this.passwordHash) {
      errors.push('DASHBOARD_PASSWORD_HASH is required');
    }

    return errors;
  }

  validateCredentials(username, password) {
    if (username !== this.username) return false;
    if (!this.passwordHash) return false;

    return this.verifyPassword(password, this.passwordHash);
  }

  verifyPassword(password, stored) {
    // expected format: scrypt$<saltHex>$<hashHex>
    const [algorithm, saltHex, expectedHashHex] = String(stored).split('$');
    if (algorithm !== 'scrypt' || !saltHex || !expectedHashHex) return false;

    const derived = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expectedHashHex.length / 2);
    const expected = Buffer.from(expectedHashHex, 'hex');

    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }

  createSessionToken(payload) {
    if (!this.sessionSecret) {
      throw new Error('SESSION_SECRET is not configured');
    }

    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = this.signValue(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  verifySessionToken(token) {
    if (!token || !this.sessionSecret) return null;

    const [encodedPayload, signature] = String(token).split('.');
    if (!encodedPayload || !signature) return null;

    const expectedSignature = this.signValue(encodedPayload);
    if (!timingSafeEqualString(signature, expectedSignature)) return null;

    try {
      const payload = JSON.parse(base64UrlDecode(encodedPayload));
      if (!payload?.sub || !payload?.exp || payload.exp < Date.now()) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  setSessionCookie(res, token) {
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
  }

  clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }

  extractSessionToken(req) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length).trim();
    }

    const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (cookieToken) return cookieToken;

    return null;
  }

  requireDashboardAuth() {
    return (req, res, next) => {
      const token = this.extractSessionToken(req);
      const session = this.verifySessionToken(token);

      if (!session) {
        return res.status(401).json({
          ok: false,
          error: 'Unauthorized',
        });
      }

      req.session = session;
      next();
    };
  }

  requireDashboardOrPicoToken() {
    return (req, res, next) => {
      const token = this.extractSessionToken(req);
      const session = this.verifySessionToken(token);

      if (session) {
        req.session = session;
        return next();
      }

      if (this.hasValidPicoTokenRequest(req)) {
        req.session = { sub: 'pico', kind: 'device' };
        return next();
      }

      return res.status(401).json({
        ok: false,
        error: 'Unauthorized',
      });
    };
  }

  authenticateDashboardSocket(socket, next) {
    try {
      const cookieHeader = socket.handshake.headers.cookie || '';
      const token =
        parseCookie(cookieHeader)[SESSION_COOKIE_NAME] ||
        extractBearerFromHandshake(socket.handshake.auth?.token);

      const session = this.verifySessionToken(token);
      if (!session) {
        return next(new Error('Unauthorized'));
      }

      socket.data.session = session;
      return next();
    } catch {
      return next(new Error('Unauthorized'));
    }
  }

  authenticateDashboardUpgrade(req) {
    const cookieHeader = req.headers.cookie || '';
    const token =
      parseCookie(cookieHeader)[SESSION_COOKIE_NAME] ||
      extractBearerFromHandshake(req.headers?.authorization);

    return this.verifySessionToken(token);
  }

  hasValidPicoTokenRequest(req, searchParams = null) {
    const expectedPicoToken =
      process.env.PICO_API_TOKEN ||
      process.env.PICO_SHARED_TOKEN ||
      process.env.GLOVE_API_TOKEN;
    if (!expectedPicoToken) return false;

    const providedToken =
      req.headers['x-pico-token'] ||
      extractBearerFromHandshake(req.headers?.authorization) ||
      req.query?.api_key ||
      req.query?.token ||
      searchParams?.get?.('api_key') ||
      searchParams?.get?.('token');

    return typeof providedToken === 'string' && timingSafeEqualString(providedToken, expectedPicoToken);
  }

  signValue(value) {
    return crypto.createHmac('sha256', this.sessionSecret).update(value).digest('base64url');
  }
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function timingSafeEqualString(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseCookie(cookieHeader) {
  return String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index === -1) return acc;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function extractBearerFromHandshake(token) {
  if (!token) return null;
  if (typeof token !== 'string') return null;
  if (token.startsWith('Bearer ')) return token.slice('Bearer '.length).trim();
  return token;
}

module.exports = { AuthService };
