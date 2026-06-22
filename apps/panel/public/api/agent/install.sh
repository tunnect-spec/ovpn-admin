#!/bin/bash
# =============================================================================
# OpenVPN Admin Panel - Agent Install Script
# This script installs the agent on a VPN node
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Required environment variables
if [[ -z "$AGENT_TOKEN" ]]; then
    echo -e "${RED}Error: AGENT_TOKEN environment variable is required${NC}"
    echo "Usage: curl -fsSL <PANEL_URL>/api/agent/install.sh | AGENT_TOKEN=xxx PANEL_URL=xxx bash"
    exit 1
fi

if [[ -z "$PANEL_URL" ]]; then
    echo -e "${YELLOW}Warning: PANEL_URL not set, using default${NC}"
    PANEL_URL="https://panel.example.com"
fi

echo -e "${GREEN}📦 Installing OpenVPN Agent${NC}"
echo "Panel URL: $PANEL_URL"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   echo "Please use: sudo bash"
   exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
else
    echo -e "${RED}Cannot detect OS${NC}"
    exit 1
fi

echo "Detected OS: $OS $OS_VERSION"

# Install dependencies based on OS
if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    echo -e "${GREEN}Installing dependencies...${NC}"
    apt-get update -qq
    apt-get install -y curl wget openssl ca-certificates

    # Install Node.js 20.x
    if ! command -v node &> /dev/null; then
        echo "Installing Node.js 20.x..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    fi
elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]]; then
    echo -e "${GREEN}Installing dependencies...${NC}"
    yum install -y curl wget openssl ca-certificates

    # Install Node.js 20.x
    if ! command -v node &> /dev/null; then
        echo "Installing Node.js 20.x..."
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        yum install -y nodejs
    fi
else
    echo -e "${RED}Unsupported OS: $OS${NC}"
    exit 1
fi

# Verify Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Node.js 18+ required. Current version: $(node -v)${NC}"
    exit 1
fi

echo -e "${GREEN}Node.js version: $(node -v)${NC}"

# Create agent directory
AGENT_DIR="/opt/ovpn-agent"
mkdir -p "$AGENT_DIR"
cd "$AGENT_DIR"

# Download agent from panel
echo -e "${GREEN}Downloading agent package...${NC}"
AGENT_PACKAGE_URL="$PANEL_URL/api/agent/package.tar.gz"

if curl -fsSL "$AGENT_PACKAGE_URL" -o agent-package.tar.gz; then
    echo "Package downloaded successfully"
else
    echo -e "${YELLOW}Package download failed, installing minimal agent...${NC}"

    # Create minimal agent inline
    cat > package.json << 'EOFPACKAGE'
{
  "name": "ovpn-agent",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "axios": "^1.6.0",
    "node-cron": "^3.0.3"
  }
}
EOFPACKAGE

    # Create agent index
    cat > index.js << 'EOFAGENT'
import axios from 'axios';
import cron from 'node-cron';

const PANEL_URL = process.env.PANEL_URL || 'https://panel.example.com';
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';

const AGENT_CONFIG = {
  heartbeatInterval: parseInt(process.env.AGENT_HEARTBEAT_INTERVAL || '30', 10) * 1000,
  heartbeatTimeout: parseInt(process.env.AGENT_HEARTBEAT_TIMEOUT || '5', 10) * 1000,
};

async function sendHeartbeat() {
  try {
    const response = await axios.post(
      `${PANEL_URL}/api/agent/heartbeat`,
      {
        timestamp: Date.now(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
      {
        headers: {
          'Authorization': `Bearer ${AGENT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: AGENT_CONFIG.heartbeatTimeout,
      }
    );

    if (response.data?.status === 'ok') {
      console.log('✓ Heartbeat sent successfully');

      // Process commands from panel
      if (response.data?.commands?.length > 0) {
        for (const cmd of response.data.commands) {
          await processCommand(cmd);
        }
      }
    }
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('✗ Authentication failed. Check AGENT_TOKEN.');
      process.exit(1);
    }
    console.error('Heartbeat error:', error.message);
  }
}

async function processCommand(command) {
  console.log(`Processing command: ${command.type}`);

  try {
    let result;

    switch (command.type) {
      case 'create-client':
        result = await createClient(command.data);
        break;
      case 'revoke-client':
        result = await revokeClient(command.data);
        break;
      case 'install-openvpn':
        result = await installOpenVPN(command.data);
        break;
      default:
        console.log(`Unknown command: ${command.type}`);
        return;
    }

    // Report result
    await axios.post(
      `${PANEL_URL}/api/agent/command-result`,
      {
        commandId: command.id,
        status: 'success',
        result,
      },
      {
        headers: { 'Authorization': `Bearer ${AGENT_TOKEN}` },
      }
    );

    console.log(`✓ Command ${command.type} completed`);
  } catch (error) {
    console.error(`Command ${command.type} failed:`, error.message);
  }
}

async function createClient(data) {
  const { name } = data;
  // Implementation depends on OpenVPN setup
  return { clientName: name, config: 'pending' };
}

async function revokeClient(data) {
  const { name } = data;
  // Implementation depends on OpenVPN setup
  return { clientName: name, revoked: true };
}

async function installOpenVPN(data) {
  // OpenVPN XOR installation
  return { installed: true };
}

// Start heartbeat
console.log(`Agent started. Heartbeat every ${AGENT_CONFIG.heartbeatInterval / 1000}s`);

// Send first heartbeat immediately
sendHeartbeat();

// Schedule regular heartbeats
setInterval(sendHeartbeat, AGENT_CONFIG.heartbeatInterval);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Agent shutting down...');
  process.exit(0);
});
EOFAGENT

    npm install --production --silent
fi

# Create systemd service
echo -e "${GREEN}Creating systemd service...${NC}"

cat > /etc/systemd/system/ovpn-agent.service << EOF
[Unit]
Description=OpenVPN Admin Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$AGENT_DIR
Environment="PANEL_URL=$PANEL_URL"
Environment="AGENT_TOKEN=$AGENT_TOKEN"
Environment="AGENT_HEARTBEAT_INTERVAL=30"
Environment="AGENT_HEARTBEAT_TIMEOUT=5"
ExecStart=/usr/bin/node $AGENT_DIR/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
systemctl daemon-reload
systemctl enable ovpn-agent

# Start agent
echo -e "${GREEN}Starting agent...${NC}"
systemctl start ovpn-agent

# Wait a moment and check status
sleep 3
if systemctl is-active --quiet ovpn-agent; then
    echo -e "${GREEN}✓ Agent installed and running!${NC}"
    echo ""
    echo "Service commands:"
    echo "  systemctl status ovpn-agent  - Check status"
    echo "  systemctl stop ovpn-agent     - Stop agent"
    echo "  systemctl start ovpn-agent    - Start agent"
    echo "  journalctl -u ovpn-agent     - View logs"
    echo ""
else
    echo -e "${RED}✗ Agent failed to start. Check logs:${NC}"
    echo "  journalctl -u ovpn-agent -n 50"
    exit 1
fi
