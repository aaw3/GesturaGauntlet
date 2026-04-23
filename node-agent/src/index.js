const { NodeAgent } = require('./ws/NodeAgent');

async function main() {
  const centralApiUrl = process.env.CENTRAL_API_URL || process.env.CENTRAL_URL || 'http://localhost:3001';
  const centralWsUrl = process.env.CENTRAL_WS_URL || centralApiUrl;
  const nodeId = process.env.NODE_ID || 'pi-edge-1';

  const agent = new NodeAgent({
    centralApiUrl,
    centralWsUrl,
    node: {
      id: nodeId,
      name: process.env.NODE_NAME || nodeId,
      token: process.env.NODE_TOKEN,
      interfaces: process.env.NODE_LAN_URL
        ? [{ kind: 'lan', url: process.env.NODE_LAN_URL, priority: 10 }]
        : [],
      metadata: { role: 'edge' },
    },
    managerAttachPort: Number(process.env.NODE_AGENT_PORT || 3201),
    managerToken: process.env.MANAGER_TOKEN,
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
