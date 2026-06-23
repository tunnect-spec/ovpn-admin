import { readFileSync } from 'fs';
import dotenv from 'dotenv';

// Single source of truth for the agent version. Used for the User-Agent header
// and version logging across the codebase.
export const VERSION = '3.1.0';

// Load .env file if exists (for development)
dotenv.config();

// Read API token from file (production - set by install script)
let apiToken = '';

try {
  apiToken = readFileSync('/opt/ovpn-agent/.api_token', 'utf-8').trim();
} catch (err) {
  // Fall back to environment variable (development)
  apiToken = process.env.AGENT_TOKEN || '';
}

if (!apiToken) {
  console.error('API token not found!');
  console.error('Expected at /opt/ovpn-agent/.api_token or AGENT_TOKEN env var');
  process.exit(1);
}

export const config = {
  PANEL_URL: process.env.PANEL_URL || 'https://panel.example.com',
  AGENT_TOKEN: apiToken,
  HEARTBEAT_INTERVAL: parseInt(process.env.AGENT_HEARTBEAT_INTERVAL || '30', 10),
  HEARTBEAT_TIMEOUT: parseInt(process.env.AGENT_HEARTBEAT_TIMEOUT || '10', 10),
} as const;
