const { NodeAgent } = require('./ws/NodeAgent');
require('dotenv').config();

const DEBUG = process.argv.includes('--debug') || process.env.DEBUG === '1';

function debug(...args) {
  if (DEBUG) console.log('[NodeAgent][debug]', ...args);
}

function nodeInterfacesFromEnv() {
  const interfaces = [];
  const lanUrls = parseUrlList(process.env.NODE_LAN_URLS || process.env.NODE_LAN_URL || process.env.NODE_LAN_WSS_URL || process.env.NODE_LAN_WS_URL);
  const publicUrls = parseUrlList(process.env.NODE_PUBLIC_URLS || process.env.NODE_PUBLIC_URL);
  const lanBasePriority = Number(process.env.NODE_LAN_PRIORITY || 10);
  lanUrls.forEach((url, index) => {
    const urls = endpointUrls({
      url,
      actionHttpUrl: process.env.NODE_LAN_ACTION_HTTP_URL,
      configHttpUrl: process.env.NODE_LAN_CONFIG_HTTP_URL,
      gloveWsUrl: process.env.NODE_LAN_GLOVE_WS_URL,
    });
    interfaces.push({
      kind: 'lan',
      url: urls.gloveWsUrl || url,
      ...urls,
      priority: lanBasePriority + index,
    });
  });
  const maxLanPriority = interfaces.reduce((max, item) => Math.max(max, item.priority), lanBasePriority);
  const publicBasePriority = Math.max(Number(process.env.NODE_PUBLIC_PRIORITY || 50), maxLanPriority + 1);
  publicUrls.forEach((url, index) => {
    const urls = endpointUrls({
      url,
      actionHttpUrl: process.env.NODE_PUBLIC_ACTION_HTTP_URL,
      configHttpUrl: process.env.NODE_PUBLIC_CONFIG_HTTP_URL,
      gloveWsUrl: process.env.NODE_PUBLIC_GLOVE_WS_URL,
    });
    interfaces.push({
      kind: 'public',
      url: urls.gloveWsUrl || url,
      ...urls,
      priority: publicBasePriority + index,
    });
  });
  return interfaces;
}

function endpointUrls({ url, gloveWsUrl, actionHttpUrl, configHttpUrl }) {
  const baseUrl = String(url || gloveWsUrl || configHttpUrl || actionHttpUrl || '');
  const wsUrl = gloveWsUrl || (baseUrl.startsWith('ws://') || baseUrl.startsWith('wss://') ? baseUrl : httpToWs(baseUrl));
  const httpBase = wsToHttp(configHttpUrl || actionHttpUrl || baseUrl).replace(/\/glove$/, '').replace(/\/$/, '');
  return {
    gloveWsUrl: wsUrl || '',
    actionHttpUrl: actionHttpUrl || (httpBase ? `${httpBase}/api/gloves/:gloveId/actions/:deviceId/:capabilityId` : ''),
    configHttpUrl: configHttpUrl || (httpBase ? `${httpBase}/api/gloves/:gloveId/config` : ''),
  };
}

function wsToHttp(url) {
  const text = String(url || '');
  if (text.startsWith('wss://')) return `https://${text.slice('wss://'.length)}`;
  if (text.startsWith('ws://')) return `http://${text.slice('ws://'.length)}`;
  return text;
}

function httpToWs(url) {
  const text = String(url || '');
  if (text.startsWith('https://')) return `wss://${text.slice('https://'.length)}`;
  if (text.startsWith('http://')) return `ws://${text.slice('http://'.length)}`;
  return text;
}

function parseUrlList(value) {
  return String(value || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

async function main() {
  const centralApiUrl = process.env.CENTRAL_API_URL || process.env.CENTRAL_URL || 'http://localhost:3001';
  const centralWsUrl = process.env.CENTRAL_WS_URL || centralApiUrl;
  const nodeId = process.env.NODE_ID || 'pi-edge-1';
  const nodeToken = process.env.NODE_TOKEN || process.env.NODE_SHARED_TOKEN;
  const managerToken = process.env.MANAGER_SHARED_TOKEN || process.env.MANAGER_TOKEN;
  const managerTokenMap = process.env.MANAGER_TOKEN_MAP;

  if (!nodeToken) {
    throw new Error('NODE_TOKEN or NODE_SHARED_TOKEN is required');
  }
  if (!managerToken && !managerTokenMap) {
    throw new Error('MANAGER_SHARED_TOKEN, MANAGER_TOKEN, or MANAGER_TOKEN_MAP is required');
  }

  debug('startup config', {
    nodeId,
    centralWsUrl,
    managerAttachPort: Number(process.env.NODE_AGENT_PORT || 3201),
    hasNodeToken: Boolean(nodeToken),
    hasManagerToken: Boolean(managerToken),
    hasManagerTokenMap: Boolean(managerTokenMap),
  });

  const agent = new NodeAgent({
    centralApiUrl,
    centralWsUrl,
    node: {
      id: nodeId,
      name: process.env.NODE_NAME || nodeId,
      token: nodeToken,
      interfaces: nodeInterfacesFromEnv(),
      metadata: { role: 'edge' },
    },
    managerAttachPort: Number(process.env.NODE_AGENT_PORT || 3201),
    managerToken,
    managerTokenMap,
  });

  await agent.start();
  console.log(`[NodeAgent] ${nodeId} connected to ${centralWsUrl}; waiting for websocket manager attachments`);
}

if (require.main === module) {
  void main().catch((err) => {
    console.error(`[NodeAgent] ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { NodeAgent };
