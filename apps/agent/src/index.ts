import dns from 'dns';
import { Agent } from './agent';
import { config, VERSION } from './config';

// Many VPS hosts are dual-stack but have broken/unrouted IPv6 egress. Node's
// default DNS ordering can hand back an AAAA (IPv6) address first, and without
// Happy Eyeballs the connection fails outright ("network error") even though
// IPv4 works fine. Prefer IPv4 and enable Happy Eyeballs so the agent connects
// to the panel regardless of the host's IPv6 state.
dns.setDefaultResultOrder('ipv4first');
const netModule = require('net');
if (typeof netModule.setDefaultAutoSelectFamily === 'function') {
  netModule.setDefaultAutoSelectFamily(true);
}

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log(`║              OpenVPN XOR Agent v${VERSION}                        ║`);
  console.log('║                                                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Panel:    ${config.PANEL_URL}`);
  console.log(`Interval: ${config.HEARTBEAT_INTERVAL}s`);
  console.log('');

  const agent = new Agent({
    panelUrl: config.PANEL_URL,
    token: config.AGENT_TOKEN,
    heartbeatInterval: config.HEARTBEAT_INTERVAL,
  });

  await agent.start();
  console.log('Agent started successfully!');

  // Graceful shutdown
  process.on('SIGTERM', () => agent.stop());
  process.on('SIGINT', () => agent.stop());
}

main().catch((err) => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
