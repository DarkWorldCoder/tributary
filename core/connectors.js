'use strict';
const { connectionConfig } = require('./direct');
const { redact } = require('./mcp');

function report({ gateways, agents, mcp, warnings = [] }) {
  const connections = gateways.map((gateway) => {
    const issues = [];
    if (gateway.direct) { try { connectionConfig(gateway); } catch (e) { issues.push(e.message); } }
    else if (!agents.some((a) => a.available && (a.gateways || []).includes(gateway.protocol))) issues.push('No installed assistant currently supports this model gateway.');
    // No raw URL, credential or environment value is returned by diagnostics.
    return { id: gateway.id, name: gateway.name, kind: gateway.direct ? 'Text assistant' : 'Model gateway', status: issues.length ? 'needs-attention' : 'configured', issues,
      capabilities: gateway.direct ? ['Text responses', 'Provided material only'] : ['Capabilities depend on the selected coding assistant'] };
  });
  const tools = mcp.map((server) => ({ name: server.name, agent: server.agent, scope: server.scope, transport: server.transport,
    status: server.enabled ? 'configured' : 'disabled', target: redact(server.target),
    capabilities: ['Tools provided through this assistant’s MCP client'], tested: false }));
  return { checkedAt: Date.now(), connections, tools, warnings, note: 'Configuration checks only. No tool was called, no server command was launched and no provider request was sent. Direct text assistants cannot use MCP tools.' };
}
module.exports = { report };
