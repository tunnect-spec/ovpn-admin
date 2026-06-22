#!/bin/bash
# =============================================================================
# OpenVPN Admin Panel - Agent Install Script
# Version: 2.0.0 - Production Ready
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
AGENT_VERSION="2.0.0"
AGENT_DIR="/opt/ovpn-agent"
REPO_URL="https://github.com/tunnect-spec/ovpn-admin"

# Banner
echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║        OpenVPN Admin Panel - Agent Installation              ║"
echo "║                        Version ${AGENT_VERSION}                          ║"
echo "║                                                              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Parse environment variables
AGENT_TOKEN="${AGENT_TOKEN}"
PANEL_URL="${PANEL_URL}"

# Validate required variables
if [[ -z "$AGENT_TOKEN" ]]; then
    echo -e "${RED}✗ Error: AGENT_TOKEN is required${NC}"
    echo ""
    echo "Usage:"
    echo "  curl -fsSL <PANEL_URL>/api/agent/install.sh | \\"
    echo "    AGENT_TOKEN=<token> PANEL_URL=<url> bash"
    echo ""
    exit 1
fi

if [[ -z "$PANEL_URL" ]]; then
    echo -e "${RED}✗ Error: PANEL_URL is required${NC}"
    echo ""
    echo "Usage:"
    echo "  curl -fsSL <PANEL_URL>/api/agent/install.sh | \\"
    echo "    AGENT_TOKEN=<token> PANEL_URL=<url> bash"
    echo ""
    exit 1
fi

# Display configuration
echo -e "${BLUE}Configuration:${NC}"
echo -e "  Panel URL: ${GREEN}${PANEL_URL}${NC}"
echo -e "  Agent Token: ${GREEN}${AGENT_TOKEN:0:12}...${NC}"
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}✗ This script must be run as root${NC}"
   echo "  Use: sudo bash"
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

echo -e "${YELLOW}[1/6] Detected OS: ${OS} ${OS_VERSION}${NC}"

# Install dependencies
echo -e "${YELLOW}[2/6] Installing dependencies...${NC}"

if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq 2>/dev/null || true

    # Install required packages
    apt-get install -y curl wget ca-certificates gnupg lsb-release 2>/dev/null || {
        echo -e "${RED}✗ Failed to install dependencies${NC}"
        exit 1
    }

    # Install Node.js 20.x
    if ! command -v node &> /dev/null || [ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]; then
        echo "  Installing Node.js 20.x..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
        apt-get install -y nodejs 2>/dev/null
    fi
elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]] || [[ "$OS" == "rocky" ]] || [[ "$OS" == "almalinux" ]]; then
    yum install -y curl wget ca-certificates gnupg 2>/dev/null || {
        echo -e "${RED}✗ Failed to install dependencies${NC}"
        exit 1
    }

    if ! command -v node &> /dev/null || [ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]; then
        echo "  Installing Node.js 20.x..."
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        yum install -y nodejs
    fi
else
    echo -e "${RED}✗ Unsupported OS: $OS${NC}"
    exit 1
fi

# Verify Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js installation failed${NC}"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "  ${GREEN}✓ Node.js ${NODE_VERSION} installed${NC}"

# Create agent directory
echo -e "${YELLOW}[3/6] Setting up agent directory...${NC}"

# Clean old installation
if [ -d "$AGENT_DIR" ]; then
    echo "  Removing old installation..."
    systemctl stop ovpn-agent 2>/dev/null || true
    rm -rf "$AGENT_DIR"
fi

mkdir -p "$AGENT_DIR"
cd "$AGENT_DIR"

# Create package.json
cat > package.json << 'EOFPKG'
{
  "name": "ovpn-agent",
  "version": "2.0.0",
  "description": "OpenVPN Admin Panel Agent",
  "type": "module",
  "main": "index.js",
  "dependencies": {
    "axios": "^1.6.5"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOFPKG

# Create the agent index.js
cat > index.js << 'EOFINDEX'
import axios from 'axios';

// Configuration from environment
const CONFIG = {
  PANEL_URL: process.env.PANEL_URL,
  AGENT_TOKEN: process.env.AGENT_TOKEN,
  HEARTBEAT_INTERVAL: parseInt(process.env.AGENT_HEARTBEAT_INTERVAL || '30', 10) * 1000,
  HEARTBEAT_TIMEOUT: parseInt(process.env.AGENT_HEARTBEAT_TIMEOUT || '10', 10) * 1000,
};

// Agent state
let heartbeatCount = 0;
let successCount = 0;
let lastError = null;
let isRegistered = false;

/**
 * Send heartbeat to panel
 */
async function sendHeartbeat() {
  heartbeatCount++;
  const startTime = Date.now();

  try {
    const response = await axios.post(
      `${CONFIG.PANEL_URL}/api/agent/heartbeat`,
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
        agentVersion: '2.0.0',
        heartbeatCount,
        successCount,
      },
      {
        headers: {
          'Authorization': `Bearer ${CONFIG.AGENT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: CONFIG.HEARTBEAT_TIMEOUT,
      }
    );

    successCount++;
    lastError = null;
    const duration = Date.now() - startTime;
    isRegistered = true;

    console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ✓ Heartbeat #${heartbeatCount} (${duration}ms)`);

    // Check for pending jobs
    if (response.data?.pendingJobs?.length > 0) {
      console.log(`  → ${response.data.pendingJobs.length} pending job(s)`);
      for (const job of response.data.pendingJobs) {
        console.log(`     - ${job.type} (id: ${job.id})`);
        // Jobs will be processed when OpenVPN is installed
      }
    }

    return true;
  } catch (error) {
    if (error.response) {
      if (error.response.status === 401) {
        console.error('✗ Authentication failed - AGENT_TOKEN is invalid');
        console.error('  To fix: Re-register the node from the panel');
        process.exit(1);
      }
      if (error.response.status === 404) {
        console.error('✗ Node not found on panel');
        console.error('  To fix: Re-register the node from the panel');
        process.exit(1);
      }
      lastError = `HTTP ${error.response.status}`;
    } else if (error.request) {
      lastError = 'Network unreachable';
    } else {
      lastError = error.message;
    }

    console.error(`✗ Heartbeat failed: ${lastError}`);
    return false;
  }
}

/**
 * Start the agent
 */
async function start() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║              OpenVPN Admin Panel Agent v2.0.0               ║');
  console.log('║                                                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Panel:       ${CONFIG.PANEL_URL}`);
  console.log(`Interval:    ${CONFIG.HEARTBEAT_INTERVAL / 1000}s`);
  console.log(`Node.js:     ${process.version}`);
  console.log(`Platform:    ${process.platform} ${process.arch}`);
  console.log('');

  // Test connection
  console.log('Testing connection to panel...');
  const firstBeat = await sendHeartbeat();

  if (!firstBeat) {
    console.error('');
    console.error('✗ Failed to connect to panel');
    console.error('');
    console.error('Troubleshooting:');
    console.error('  1. Check PANEL_URL is correct');
    console.error('  2. Verify AGENT_TOKEN is valid');
    console.error('  3. Test network: curl -v ' + CONFIG.PANEL_URL);
    console.error('  4. Check panel is running');
    console.error('');
    process.exit(1);
  }

  console.log('');
  console.log('✓ Agent registered successfully!');
  console.log('✓ Starting heartbeat loop...');
  console.log('');

  // Start heartbeat interval
  setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL);
}

/**
 * Handle shutdown
 */
function shutdown() {
  console.log('');
  console.log('Agent shutting down gracefully...');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start
start().catch(err => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
EOFINDEX

# Install dependencies
echo -e "${YELLOW}[4/6] Installing dependencies...${NC}"

npm install --production --no-audit --no-fund 2>&1 | while IFS= read -r line; do
    if [[ "$line" =~ "added" ]]; then
        echo "  $line"
    fi
done

echo -e "  ${GREEN}✓ Dependencies installed${NC}"

# Create systemd service
echo -e "${YELLOW}[5/6] Creating systemd service...${NC}"

cat > /etc/systemd/system/ovpn-agent.service << EOF
[Unit]
Description=OpenVPN Admin Panel Agent
Documentation=https://github.com/tunnect-spec/ovpn-admin
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${AGENT_DIR}
Environment="NODE_ENV=production"
Environment="PANEL_URL=${PANEL_URL}"
Environment="AGENT_TOKEN=${AGENT_TOKEN}"
Environment="AGENT_HEARTBEAT_INTERVAL=30"
Environment="AGENT_HEARTBEAT_TIMEOUT=10"
ExecStart=/usr/bin/node ${AGENT_DIR}/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ovpn-agent

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${AGENT_DIR}

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
systemctl daemon-reload
systemctl enable ovpn-agent 2>/dev/null

# Stop any existing agent
systemctl stop ovpn-agent 2>/dev/null || true

# Start agent
echo -e "${YELLOW}[6/6] Starting agent...${NC}"
systemctl start ovpn-agent

# Wait and check status
sleep 3

# Verify service is running
if systemctl is-active --quiet ovpn-agent; then
    echo -e "  ${GREEN}✓ Service started successfully${NC}"
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║              ✓ Agent Installed Successfully!              ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}Service Management:${NC}"
    echo "  systemctl status ovpn-agent    - Check status"
    echo "  systemctl stop ovpn-agent      - Stop agent"
    echo "  systemctl start ovpn-agent     - Start agent"
    echo "  systemctl restart ovpn-agent   - Restart agent"
    echo ""
    echo -e "${CYAN}View Logs:${NC}"
    echo "  journalctl -u ovpn-agent -n 50     - Last 50 lines"
    echo "  journalctl -u ovpn-agent -f        - Follow logs"
    echo ""

    # Show recent logs
    echo -e "${CYAN}Recent Agent Logs:${NC}"
    journalctl -u ovpn-agent -n 5 --no-pager
    echo ""
else
    echo -e "  ${RED}✗ Service failed to start${NC}"
    echo ""
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║              ✗ Agent Installation Failed                  ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Debug Information:${NC}"
    echo ""
    echo "Service status:"
    systemctl status ovpn-agent --no-pager || true
    echo ""
    echo "Service logs:"
    journalctl -u ovpn-agent -n 20 --no-pager || true
    echo ""
    echo "Node version:"
    node --version
    echo ""
    echo "NPM version:"
    npm --version
    echo ""
    exit 1
fi
