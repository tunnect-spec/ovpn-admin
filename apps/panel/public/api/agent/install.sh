#!/bin/bash
# =============================================================================
# OpenVPN Admin Panel - Agent Install Script
# This script installs the agent on a VPN node
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Required environment variables
if [[ -z "$AGENT_TOKEN" ]]; then
    echo -e "${RED}Error: AGENT_TOKEN environment variable is required${NC}"
    echo "Usage: curl -fsSL <PANEL_URL>/api/agent/install.sh | AGENT_TOKEN=xxx PANEL_URL=xxx bash"
    exit 1
fi

if [[ -z "$PANEL_URL" ]]; then
    echo -e "${RED}Error: PANEL_URL environment variable is required${NC}"
    echo "Usage: curl -fsSL <PANEL_URL>/api/agent/install.sh | AGENT_TOKEN=xxx PANEL_URL=xxx bash"
    exit 1
fi

echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   OpenVPN Admin Panel - Agent Install    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Panel URL:${NC} $PANEL_URL"
echo -e "${BLUE}Agent Token:${NC} ${AGENT_TOKEN:0:8}..."
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}✗ This script must be run as root${NC}"
   echo "Please use: sudo bash"
   exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
else
    echo -e "${RED}✗ Cannot detect OS${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/5] Detected OS:${NC} $OS $OS_VERSION"

# Install dependencies
echo -e "${YELLOW}[2/5] Installing dependencies...${NC}"

if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq 2>/dev/null
    apt-get install -y curl wget ca-certificates 2>/dev/null

    # Install Node.js 20.x
    if ! command -v node &> /dev/null || [ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]; then
        echo "  Installing Node.js 20.x..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
        apt-get install -y nodejs 2>/dev/null
    fi
elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]] || [[ "$OS" == "rocky" ]] || [[ "$OS" == "almalinux" ]]; then
    yum install -y curl wget ca-certificates 2>/dev/null

    if ! command -v node &> /dev/null || [ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]; then
        echo "  Installing Node.js 20.x..."
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        yum install -y nodejs
    fi
else
    echo -e "${RED}✗ Unsupported OS: $OS${NC}"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}  ✓ Node.js $NODE_VERSION installed${NC}"

# Create agent directory
AGENT_DIR="/opt/ovpn-agent"
echo -e "${YELLOW}[3/5] Creating agent in $AGENT_DIR...${NC}"

rm -rf "$AGENT_DIR"
mkdir -p "$AGENT_DIR"
cd "$AGENT_DIR"

# Create package.json
cat > package.json << 'EOFPACKAGE'
{
  "name": "ovpn-agent",
  "version": "1.0.0",
  "type": "module",
  "description": "OpenVPN Admin Panel Agent",
  "dependencies": {
    "axios": "^1.6.5"
  }
}
EOFPACKAGE

# Create agent index.js
cat > index.js << 'EOFAGENT'
import axios from 'axios';

const PANEL_URL = process.env.PANEL_URL;
const AGENT_TOKEN = process.env.AGENT_TOKEN;

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 10000; // 10 seconds

let heartbeatCount = 0;
let successCount = 0;
let lastError = null;

async function sendHeartbeat() {
  heartbeatCount++;
  const startTime = Date.now();

  try {
    const response = await axios.post(
      `${PANEL_URL}/api/agent/heartbeat`,
      {
        timestamp: startTime,
        uptime: Math.floor(process.uptime()),
        memory: {
          rss: process.memoryUsage().rss,
          heapTotal: process.memoryUsage().heapTotal,
          heapUsed: process.memoryUsage().heapUsed,
        },
        platform: process.platform,
        nodeVersion: process.version,
        heartbeatCount,
        successCount,
      },
      {
        headers: {
          'Authorization': `Bearer ${AGENT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: HEARTBEAT_TIMEOUT,
      }
    );

    successCount++;
    lastError = null;
    const duration = Date.now() - startTime;

    console.log(`✓ Heartbeat #${heartbeatCount} (${duration}ms) - Status: OK`);

    if (response.data?.pendingJobs?.length > 0) {
      console.log(`  → ${response.data.pendingJobs.length} pending job(s)`);
      for (const job of response.data.pendingJobs) {
        console.log(`     - ${job.type} (id: ${job.id})`);
      }
    }

    return true;
  } catch (error) {
    if (error.response) {
      if (error.response.status === 401) {
        console.error('✗ Authentication failed - AGENT_TOKEN is invalid');
        console.error('  Please re-register the node from the panel');
        process.exit(1);
      }
      if (error.response.status === 404) {
        console.error('✗ Node not found on panel');
        console.error('  Please re-register the node from the panel');
        process.exit(1);
      }
      lastError = `HTTP ${error.response.status}`;
    } else if (error.request) {
      lastError = 'Network unreachable';
    } else {
      lastError = error.message;
    }

    console.error(`✗ Heartbeat #${heartbeatCount} failed: ${lastError}`);
    return false;
  }
}

async function start() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     OpenVPN Admin Panel Agent v1.0.0     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`Panel:    ${PANEL_URL}`);
  console.log(`Interval: ${HEARTBEAT_INTERVAL / 1000}s`);
  console.log('');

  // Send initial heartbeat to verify connection
  console.log('Testing connection to panel...');
  const firstBeat = await sendHeartbeat();

  if (!firstBeat) {
    console.error('');
    console.error('✗ Initial heartbeat failed');
    console.error('');
    console.error('Troubleshooting:');
    console.error('  1. Check PANEL_URL is correct');
    console.error('  2. Verify AGENT_TOKEN is valid');
    console.error('  3. Ensure network connectivity to panel');
    console.error('  4. Check panel is running');
    console.error('');
    process.exit(1);
  }

  console.log('');
  console.log('✓ Agent registered successfully!');
  console.log('✓ Starting heartbeat loop...');
  console.log('');

  // Start heartbeat interval
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
}

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('');
  console.log('Agent shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('');
  console.log('Agent shutting down...');
  process.exit(0);
});

// Start the agent
start().catch(err => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
EOFAGENT

# Install dependencies
echo -e "${YELLOW}[4/5] Installing dependencies...${NC}"
npm install --production --silent --no-audit --no-fund 2>/dev/null

echo -e "${GREEN}  ✓ Dependencies installed${NC}"

# Create systemd service
echo -e "${YELLOW}[5/5] Creating systemd service...${NC}"

cat > /etc/systemd/system/ovpn-agent.service << EOF
[Unit]
Description=OpenVPN Admin Panel Agent
Documentation=https://github.com/tunnect-spec/ovpn-admin
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$AGENT_DIR
Environment="NODE_ENV=production"
Environment="PANEL_URL=$PANEL_URL"
Environment="AGENT_TOKEN=$AGENT_TOKEN"
ExecStart=/usr/bin/node $AGENT_DIR/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ovpn-agent

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
systemctl daemon-reload
systemctl enable ovpn-agent 2>/dev/null

# Stop any existing agent
systemctl stop ovpn-agent 2>/dev/null || true

# Start agent
systemctl start ovpn-agent

# Wait and check status
sleep 3

if systemctl is-active --quiet ovpn-agent; then
    echo -e "${GREEN}  ✓ Service created and enabled${NC}"
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         ✓ Agent Installed Successfully!     ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}Service Commands:${NC}"
    echo "  systemctl status ovpn-agent   - Check status"
    echo "  journalctl -u ovpn-agent      - View logs"
    echo "  journalctl -u ovpn-agent -f  - Follow logs"
    echo ""
else
    echo -e "${RED}╔══════════════════════════════════════════╗${NC}"
    echo -e "${RED}║         ✗ Agent Failed to Start          ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo "Check logs: journalctl -u ovpn-agent -n 50"
    echo ""
    exit 1
fi
