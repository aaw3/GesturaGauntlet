const ENV_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export const DEFAULT_BACKEND_URL =
  ENV_BACKEND_URL || "http://localhost:3001";

export async function fetchBackend(path: string, init: RequestInit = {}) {
  const isAbsolute = /^https?:\/\//.test(path);
  const url = isAbsolute ? path : `${DEFAULT_BACKEND_URL}${path}`;

  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
    },
  });
}
