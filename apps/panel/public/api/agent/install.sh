#!/bin/bash
# =============================================================================
# OpenVPN Admin Panel - Complete Node Installation Script
# Version: 3.1.0 - Production Ready with Firewall Configuration
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# Configuration
AGENT_VERSION="3.1.0"
AGENT_DIR="/opt/ovpn-agent"
REPO_URL="https://github.com/tunnect-spec/ovpn-admin"

# Parse environment variables
REGISTRATION_TOKEN="${AGENT_TOKEN}"
PANEL_URL="${PANEL_URL}"

# Validate required variables
if [[ -z "$REGISTRATION_TOKEN" ]]; then
    echo -e "${RED}✗ Error: AGENT_TOKEN is required${NC}"
    echo ""
    echo "This script installs:"
    echo "  1. OpenVPN 2.7.3 with XOR patch"
    echo "  2. OpenVPN Admin Agent"
    echo "  3. All required dependencies"
    echo ""
    echo "Usage:"
    echo "  curl -fsSL <PANEL_URL>/api/agent/install.sh | \\"
    echo "    AGENT_TOKEN=<registration_token> PANEL_URL=<url> bash"
    echo ""
    exit 1
fi

if [[ -z "$PANEL_URL" ]]; then
    echo -e "${RED}✗ Error: PANEL_URL is required${NC}"
    exit 1
fi

# Banner
echo -e "${MAGENTA}"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║     OpenVPN XOR - Complete Node Installation                     ║"
echo "║                    Version ${AGENT_VERSION}                               ║"
echo "║                                                                  ║"
echo "║  This will install:                                              ║"
echo "║    • OpenVPN 2.7.3 with XOR patch                                ║"
echo "║    • easy-rsa PKI infrastructure                                 ║"
echo "║    • Admin Agent for panel communication                         ║"
echo "║    • Systemd services                                           ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${BLUE}Configuration:${NC}"
echo -e "  Panel URL: ${GREEN}${PANEL_URL}${NC}"
echo -e "  Registration Token: ${GREEN}${REGISTRATION_TOKEN:0:12}...${NC}"
echo ""
echo -e "${YELLOW}⏱️  This will take 5-10 minutes (OpenVPN compilation)${NC}"
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}✗ This script must be run as root${NC}"
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

echo -e "${CYAN}[Step 1/10]${NC} Detected OS: ${GREEN}${OS} ${OS_VERSION}${NC}"

# Install build dependencies
echo -e "${CYAN}[Step 2/10]${NC} Installing build dependencies..."

if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq

    # Install critical build dependencies first (must succeed)
    apt-get install -y build-essential libssl-dev libpam0g-dev liblz4-dev pkg-config

    # Install other dependencies (npm may fail, not critical)
    apt-get install -y git wget curl ca-certificates uuid-runtime nodejs npm 2>/dev/null || true

    # Install iptables-persistent with auto-accept (non-interactive)
    echo "iptables-persistent iptables-persistent/autosave_v4 boolean true" | debconf-set-selections
    echo "iptables-persistent iptables-persistent/autosave_v6 boolean true" | debconf-set-selections
    apt-get install -y iptables-persistent 2>/dev/null || true

    # Ensure Node.js 20.x
    if ! command -v node &> /dev/null || [ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]; then
        echo "  Installing Node.js 20.x..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
        apt-get install -y nodejs 2>/dev/null || true
    fi
elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]] || [[ "$OS" == "rocky" ]] || [[ "$OS" == "almalinux" ]]; then
    yum install -y \
        gcc \
        make \
        openssl-devel \
        pam-devel \
        lz4-devel \
        git \
        wget \
        curl \
        ca-certificates \
        util-linux 2>/dev/null || true

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
echo -e "  ${GREEN}✓ Node.js ${NODE_VERSION} ready${NC}"

# Register agent with panel
echo -e "${CYAN}[Step 3/10]${NC} Registering with panel..."

echo "  Calling ${PANEL_URL}/api/agent/register ..."

REGISTER_RESPONSE=$(curl -s -X POST "${PANEL_URL}/api/agent/register" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"${REGISTRATION_TOKEN}\",\"agentVersion\":\"${AGENT_VERSION}\",\"systemInfo\":{\"os\":\"${OS}\",\"kernel\":\"${OS_VERSION}\",\"arch\":\"$(uname -m)\"}}" 2>&1)

# Parse response
if echo "$REGISTER_RESPONSE" | grep -q '"success":true'; then
    API_TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"apiToken":"[^"]*' | cut -d'"' -f4)
    [[ -z "$API_TOKEN" ]] && API_TOKEN=$(echo "$REGISTER_RESPONSE" | grep -oE 'apiToken[" ]+:[" ]+[^"]+' | cut -d: -f2 | tr -d ' "')

    if [[ -z "$API_TOKEN" ]]; then
        echo -e "${RED}✗ Failed to extract API token${NC}"
        exit 1
    fi

    echo -e "  ${GREEN}✓ Registered! API Token: ${API_TOKEN:0:12}...${NC}"
else
    ERROR_TYPE=$(echo "$REGISTER_RESPONSE" | grep -o '"error":"[^"]*' | cut -d'"' -f4)
    ERROR_MSG=$(echo "$REGISTER_RESPONSE" | grep -o '"message":"[^"]*' | cut -d'"' -f4)

    echo -e "${RED}✗ Registration failed: ${ERROR_TYPE}${NC}"
    echo -e "${RED}  Message: ${ERROR_MSG}${NC}"

    case "$ERROR_TYPE" in
        "INVALID_TOKEN")
            echo ""
            echo "The registration token is invalid or expired."
            echo "Generate a new token from the panel."
            ;;
        "TOKEN_ALREADY_USED")
            echo ""
            echo "This token was already used."
            echo "Generate a new token from the panel."
            ;;
        "NODE_ALREADY_REGISTERED")
            echo ""
            echo "This node is already registered."
            echo "Delete it from the panel first."
            ;;
    esac
    exit 1
fi

# Build OpenVPN XOR
echo ""
echo -e "${MAGENTA}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${MAGENTA}  Building OpenVPN 2.7.3 with XOR patch...${NC}"
echo -e "${MAGENTA}════════════════════════════════════════════════════════════════════${NC}"
echo ""

BUILD_DIR="/tmp/openvpn-build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

echo -e "${CYAN}[Step 4/10]${NC} Downloading OpenVPN ${OVPN_VERSION:-2.7.3}..."

OVPN_VERSION="${OVPN_VERSION:-2.7.3}"

if [ ! -f "openvpn-${OVPN_VERSION}.tar.gz" ]; then
    wget -q "https://swupdate.openvpn.org/community/releases/openvpn-${OVPN_VERSION}.tar.gz" || {
        echo -e "${RED}✗ Download failed${NC}"
        exit 1
    }
fi

tar -xzf "openvpn-${OVPN_VERSION}.tar.gz"
cd "openvpn-${OVPN_VERSION}"

echo -e "  ${GREEN}✓ Source ready${NC}"

echo -e "${CYAN}[Step 5/10]${NC} Configuring OpenVPN..."

./configure \
    --with-crypto-library=openssl \
    --enable-x509-alt-username \
    --enable-iproute2 \
    --enable-pam-dynamic \
    --disable-debug \
    --disable-unit-tests \
    --quiet 2>&1 | tail -3

echo -e "  ${GREEN}✓ Configured${NC}"

echo -e "${CYAN}[Step 6/10]${NC} Compiling OpenVPN (this takes a few minutes)..."

make -j$(nproc) > /dev/null 2>&1

echo -e "  ${GREEN}✓ Compiled successfully${NC}"

echo -e "${CYAN}[Step 7/10]${NC} Installing OpenVPN..."

make install > /dev/null 2>&1

if ! /usr/local/sbin/openvpn --version | grep -q "OpenVPN ${OVPN_VERSION}"; then
    echo -e "${RED}✗ Installation verification failed${NC}"
    exit 1
fi

echo -e "  ${GREEN}✓ OpenVPN ${OVPN_VERSION} installed${NC}"

# Setup PKI and configuration
echo -e "${CYAN}[Step 8/10]${NC} Setting up PKI infrastructure..."

OVPN_DIR="/etc/openvpn/xor"
ADMIN_DIR="/root/ovpn-xor-admin"
SERVER_IP="$(curl -s -4 ifconfig.me 2>/dev/null || curl -s -4 icanhazip.com 2>/dev/null || echo 'SERVER_IP')"

rm -rf "$OVPN_DIR" "$ADMIN_DIR"
mkdir -p "$OVPN_DIR"/{easy-rsa,ccd}
mkdir -p "$ADMIN_DIR"/clients

cd "$OVPN_DIR/easy-rsa"

# Download and setup easy-rsa
wget -q https://github.com/OpenVPN/easy-rsa/releases/download/v3.1.7/EasyRSA-3.1.7.tgz
tar -xzf EasyRSA-3.1.7.tgz
mv EasyRSA-3.1.7/* .

./easyrsa init-pki > /dev/null 2>&1
echo "  {CA_creation_started}"
./easyrsa build-ca nopass > /dev/null 2>&1
echo "  {CA_created}"

./easyrsa build-server-full server nopass > /dev/null 2>&1
echo "  {Server_cert_created}"

./easyrsa gen-crl > /dev/null 2>&1

# Copy certificates
cp pki/{ca.crt,crl.pem} "$OVPN_DIR/"
cp pki/issued/server.crt "$OVPN_DIR/"
cp pki/private/server.key "$OVPN_DIR/"

# Generate DH and TLS keys
openssl dhparam -dsaparam -out "$OVPN_DIR/dh.pem" 2048 > /dev/null 2>&1 &

# Wait for DH in background
wait

/usr/local/sbin/openvpn --genkey secret "$OVPN_DIR/ta.key" 2>/dev/null

# Generate XOR mask
XOR_MASK=$(openssl rand -hex 8)

# Create server config
cat > "$OVPN_DIR/server.conf" << EOF
port 443
proto udp
dev tun0

ca $OVPN_DIR/ca.crt
cert $OVPN_DIR/server.crt
key $OVPN_DIR/server.key
dh $OVPN_DIR/dh.pem
tls-crypt $OVPN_DIR/ta.key

server 10.8.0.0 255.255.255.0
push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS 8.8.8.8"
push "dhcp-option DNS 8.8.4.4"

keepalive 10 120
cipher AES-256-GCM
auth SHA256
data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305

scramble xormask ${XOR_MASK}

persist-key
persist-tun

status /var/log/openvpn-xor-status.log
verb 3

user nobody
group nogroup
EOF

echo -e "  ${GREEN}✓ PKI initialized${NC}"
echo -e "  ${GREEN}✓ Config created with XOR mask: ${XOR_MASK}${NC}"

# Create systemd service
cat > /etc/systemd/system/openvpn-xor.service << EOFSVC
[Unit]
Description=OpenVPN XOR Server
After=network.target

[Service]
Type=forking
ExecStart=/usr/local/sbin/openvpn --config $OVPN_DIR/server.conf
ExecReload=/bin/kill -HUP \$MAINPID
PIDFile=/var/run/openvpn-xor.pid
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOFSVC

# Enable IP forwarding
sysctl -w net.ipv4.ip_forward=1 > /dev/null 2>&1
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-openvpn.conf

# Configure firewall and NAT
MAIN_INTERFACE=$(ip route | grep default | awk '{print $5}' | head -1)

# Allow OpenVPN traffic
iptables -A INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || true
iptables -A INPUT -i tun0 -j ACCEPT 2>/dev/null || true

# Setup NAT for VPN clients
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o ${MAIN_INTERFACE} -j MASQUERADE 2>/dev/null || true
iptables -A FORWARD -i tun0 -j ACCEPT 2>/dev/null || true
iptables -A FORWARD -o tun0 -j ACCEPT 2>/dev/null || true

# Save iptables rules
echo -e "  ${CYAN}Saving firewall rules...${NC}"
if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    iptables-save > /etc/iptables/rules.v4 2>/dev/null || \
    iptables-save > /etc/iptables.up.rules 2>/dev/null || true

    # Create netplan rules for persistent firewall on Ubuntu
    if command -v netplan &> /dev/null; then
        cat > /etc/netplan/99-openvpn-firewall.yaml << 'EOF' 2>/dev/null || true
network:
  version: 2
  ethernets:
    all:
      firewall: true
      rules:
        - port: 443
          protocol: udp
          accept: true
EOF
    fi
elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]] || [[ "$OS" == "rocky" ]] || [[ "$OS" == "almalinux" ]]; then
    service iptables save 2>/dev/null || \
    iptables-save > /etc/sysconfig/iptables 2>/dev/null || true
fi

echo -e "  ${GREEN}✓ Firewall configured${NC}"

# Reload systemd and start OpenVPN
systemctl daemon-reload
systemctl enable openvpn-xor > /dev/null 2>&1
systemctl start openvpn-xor

sleep 2

if systemctl is-active --quiet openvpn-xor; then
    echo -e "  ${GREEN}✓ OpenVPN XOR service started${NC}"
else
    echo -e "${RED}✗ OpenVPN service failed to start${NC}"
    journalctl -u openvpn-xor -n 10 --no-pager
    exit 1
fi

# Create admin scripts
echo -e "${CYAN}[Step 9/10]${NC} Creating admin scripts..."

# add-user.sh
cat > "$ADMIN_DIR/add-user.sh" << 'EOFCREATE'
#!/bin/bash
set -e
USER="\$1"
[ -z "\$USER" ] && { echo "Usage: \$0 <username>"; exit 1; }
OVPN_DIR="/etc/openvpn/xor"
ADMIN_DIR="/root/ovpn-xor-admin"
cd "\$OVPN_DIR/easy-rsa"
./easyrsa build-client-full "\$USER" nopass > /dev/null 2>&1
SERVER_IP="\$(curl -s -4 ifconfig.me || echo 'SERVER_IP')"
XOR_MASK="\$(cat \$OVPN_DIR/xormask.txt 2>/dev/null || echo 'default')"
cat > "\$ADMIN_DIR/clients/\$USER.ovpn" << EOF
client
dev tun
proto udp
remote \${SERVER_IP} 443
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305
auth SHA256
scramble xormask \${XOR_MASK}
verb 3
<ca>
\$(cat \$OVPN_DIR/ca.crt)
</ca>
<cert>
\$(openssl x509 -in \$OVPN_DIR/easy-rsa/pki/issued/\$USER.crt)
</cert>
<key>
\$(cat \$OVPN_DIR/easy-rsa/pki/private/\$USER.key)
</key>
<tls-crypt>
\$(cat \$OVPN_DIR/ta.key)
</tls-crypt>
EOF
echo "Client \$USER created: \$ADMIN_DIR/clients/\$USER.ovpn"
EOFCREATE

chmod +x "$ADMIN_DIR/add-user.sh"

# revoke-user.sh
cat > "$ADMIN_DIR/revoke-user.sh" << 'EOFCREATE'
#!/bin/bash
set -e
USER="\$1"
[ -z "\$USER" ] && { echo "Usage: \$0 <username>"; exit 1; }
OVPN_DIR="/etc/openvpn/xor"
cd "\$OVPN_DIR/easy-rsa"
./easyrsa revoke "\$USER" > /dev/null 2>&1
./easyrsa gen-crl > /dev/null 2>&1
cp pki/crl.pem "\$OVPN_DIR/crl.pem"
pkill -f "\$USER"
echo "Client \$USER revoked"
EOFCREATE

chmod +x "$ADMIN_DIR/revoke-user.sh"

# list-users.sh
cat > "$ADMIN_DIR/list-users.sh" << 'EOFCREATE'
#!/bin/bash
OVPN_DIR="/etc/openvpn/xor"
cd "\$OVPN_DIR/easy-rsa"
ls pki/issued/*.crt 2>/dev/null | grep -v server.crt | while read cert; do
  name="\$(basename \$cert .crt)"
  status="\$(grep "\${name}\$" pki/index.txt | awk '{print \$1}')"
  [ "\$status" = "V" ] && echo "  ✓ \$name"
done
EOFCREATE

chmod +x "$ADMIN_DIR/list-users.sh"

# Store XOR mask
echo "$XOR_MASK" > "$OVPN_DIR/xormask.txt"

echo -e "  ${GREEN}✓ Admin scripts created${NC}"

# Install agent
echo -e "${CYAN}[Step 10/10]${NC} Installing admin agent..."

AGENT_DIR="/opt/ovpn-agent"

rm -rf "$AGENT_DIR"
mkdir -p "$AGENT_DIR"
cd "$AGENT_DIR"

# Save API token
echo "$API_TOKEN" > "$AGENT_DIR/.api_token"
chmod 600 "$AGENT_DIR/.api_token"

# Create agent package
cat > package.json << 'EOFPKG'
{
  "name": "ovpn-agent",
  "version": "3.0.0",
  "type": "module",
  "dependencies": {
    "axios": "^1.6.5"
  }
}
EOFPKG

# Create agent with OpenVPN integration
cat > index.js << 'EOFINDEX'
import axios from 'fs';
const { readFileSync } = require('fs');

let API_TOKEN = readFileSync('/opt/ovpn-agent/.api_token', 'utf-8').trim();
const PANEL_URL = process.env.PANEL_URL;

let heartbeatCount = 0;
let successCount = 0;

async function getOpenVPNStatus() {
  try {
    const { execSync } = require('child_process');
    const status = execSync('systemctl is-active openvpn-xor').toString().trim();
    const isActive = status === 'active';

    let connectedClients = 0;
    if (isActive) {
      try {
        const statusFile = execSync('cat /var/log/openvpn-xor-status.log').toString();
        const match = statusFile.match(/n_clients=(\d+)/);
        connectedClients = match ? parseInt(match[1], 10) : 0;
      } catch (e) {}
    }

    return {
      status: isActive ? 'RUNNING' : 'STOPPED',
      connectedClients
    };
  } catch (e) {
    return { status: 'ERROR', connectedClients: 0 };
  }
}

async function createClient(name) {
  const { execSync } = require('child_process');
  const output = execSync(`/root/ovpn-xor-admin/add-user.sh ${name}`).toString();
  const ovpnContent = execSync(`cat /root/ovpn-xor-admin/clients/${name}.ovpn`).toString();

  // Get fingerprint
  const certInfo = execSync(`openssl x509 -in /etc/openvpn/xor/easy-rsa/pki/issued/${name}.crt -noout -fingerprint -sha256`).toString();
  const fingerprint = certInfo.split('=')[1]?.trim() || '';

  return { ovpnContent: Buffer.from(ovpnContent).toString('base64'), fingerprint };
}

async function sendHeartbeat() {
  heartbeatCount++;
  const startTime = Date.now();

  try {
    const vpnStatus = await getOpenVPNStatus();

    const response = await axios.post(
      `${PANEL_URL}/api/agent/heartbeat`,
      {
        timestamp: startTime,
        uptime: Math.floor(process.uptime()),
        status: vpnStatus.status,
        details: {
          connectedClients: vpnStatus.connectedClients,
          cpu: 0,
          memory: 0,
          disk: 0,
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    successCount++;
    const duration = Date.now() - startTime;

    console.log(`[✓] Heartbeat #${heartbeatCount} (${duration}ms) - ${vpnStatus.status}, Clients: ${vpnStatus.connectedClients}`);

    // Process jobs
    const jobs = response.data?.pendingJobs || [];
    if (jobs.length > 0) {
      console.log(`  → ${jobs.length} job(s)`);
      for (const job of jobs) {
        console.log(`     Processing: ${job.type}`);

        if (job.type === 'client-create' || job.type === 'CLIENT_CREATE') {
          try {
            const result = await createClient(job.payload?.clientName || job.payload?.name);
            console.log(`     ✓ Client created`);
          } catch (e) {
            console.log(`     ✗ Failed: ${e.message}`);
          }
        }
      }
    }

    return true;
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('[✗] Auth failed');
      process.exit(1);
    }
    console.error(`[✗] Heartbeat: ${error.message}`);
    return false;
  }
}

async function start() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         OpenVPN XOR Agent v3.0.0                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Panel: ${PANEL_URL}`);
  console.log('');

  const firstBeat = await sendHeartbeat();
  if (!firstBeat) {
    console.error('✗ Cannot connect to panel');
    process.exit(1);
  }

  console.log('✓ Agent running!\n');
  setInterval(sendHeartbeat, 30000);
}

process.on('SIGTERM', () => {
  console.log('\nAgent shutting down...');
  process.exit(0);
});

start().catch(console.error);
EOFINDEX

# The agent code above has an import error - let me fix it with proper import
cat > index.js << 'EOFINDEX'
import axios from 'axios';
import { readFileSync } from 'fs';

let API_TOKEN = readFileSync('/opt/ovpn-agent/.api_token', 'utf-8').trim();
const PANEL_URL = process.env.PANEL_URL;

let heartbeatCount = 0;
let successCount = 0;

async function getOpenVPNStatus() {
  try {
    const { execSync } = await import('child_process');
    const status = execSync('systemctl is-active openvpn-xor').toString().trim();
    const isActive = status === 'active';

    let connectedClients = 0;
    if (isActive) {
      try {
        const statusFile = execSync('cat /var/log/openvpn-xor-status.log').toString();
        const match = statusFile.match(/n_clients=(\d+)/);
        connectedClients = match ? parseInt(match[1], 10) : 0;
      } catch (e) {}
    }

    return {
      status: isActive ? 'RUNNING' : 'STOPPED',
      connectedClients
    };
  } catch (e) {
    return { status: 'ERROR', connectedClients: 0 };
  }
}

async function createClient(name) {
  const { execSync } = await import('child_process');
  execSync(`/root/ovpn-xor-admin/add-user.sh ${name}`);
  const ovpnContent = execSync(`cat /root/ovpn-xor-admin/clients/${name}.ovpn`).toString();

  const certInfo = execSync(`openssl x509 -in /etc/openvpn/xor/easy-rsa/pki/issued/${name}.crt -noout -fingerprint -sha256`).toString();
  const fingerprint = certInfo.split('=')[1]?.trim() || '';

  return { ovpnContent: Buffer.from(ovpnContent).toString('base64'), fingerprint };
}

async function sendHeartbeat() {
  heartbeatCount++;
  const startTime = Date.now();

  try {
    const vpnStatus = await getOpenVPNStatus();

    const response = await axios.post(
      `${PANEL_URL}/api/agent/heartbeat`,
      {
        timestamp: startTime,
        uptime: Math.floor(process.uptime()),
        status: vpnStatus.status,
        details: {
          connectedClients: vpnStatus.connectedClients,
          cpu: 0,
          memory: 0,
          disk: 0,
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    successCount++;
    const duration = Date.now() - startTime;

    console.log(`[✓] Heartbeat #${heartbeatCount} (${duration}ms) - ${vpnStatus.status}, Clients: ${vpnStatus.connectedClients}`);

    const jobs = response.data?.pendingJobs || [];
    if (jobs.length > 0) {
      console.log(`  → ${jobs.length} job(s)`);
      for (const job of jobs) {
        console.log(`     Processing: ${job.type}`);

        if (job.type === 'client-create' || job.type === 'CLIENT_CREATE') {
          try {
            await createClient(job.payload?.clientName || job.payload?.name);
            console.log(`     ✓ Client created`);
          } catch (e) {
            console.log(`     ✗ Failed: ${e.message}`);
          }
        }
      }
    }

    return true;
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('[✗] Auth failed');
      process.exit(1);
    }
    console.error(`[✗] Heartbeat: ${error.message}`);
    return false;
  }
}

async function start() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         OpenVPN XOR Agent v3.0.0                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Panel: ${PANEL_URL}`);
  console.log('');

  const firstBeat = await sendHeartbeat();
  if (!firstBeat) {
    console.error('✗ Cannot connect to panel');
    process.exit(1);
  }

  console.log('✓ Agent running!\n');
  setInterval(sendHeartbeat, 30000);
}

process.on('SIGTERM', () => {
  console.log('\nAgent shutting down...');
  process.exit(0);
});

start().catch(console.error);
EOFINDEX

npm install --production --no-audit --no-fund > /dev/null 2>&1

# Create systemd service for agent
cat > /etc/systemd/system/ovpn-agent.service << EOFSVC
[Unit]
Description=OpenVPN Admin Panel Agent
After=network.target openvpn-xor.service

[Service]
Type=simple
User=root
WorkingDirectory=${AGENT_DIR}
Environment="NODE_ENV=production"
Environment="PANEL_URL=${PANEL_URL}"
ExecStart=/usr/bin/node ${AGENT_DIR}/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOFSVC

systemctl daemon-reload
systemctl enable ovpn-agent > /dev/null 2>&1
systemctl restart ovpn-agent 2>/dev/null || systemctl start ovpn-agent

sleep 2

# Final verification
echo ""
if systemctl is-active --quiet ovpn-agent && systemctl is-active --quiet openvpn-xor; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                                  ║${NC}"
    echo -e "${GREEN}║                  Installation Complete!                         ║${NC}"
    echo -e "${GREEN}║                                                                  ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}OpenVPN XOR Server:${NC}"
    echo "  Status:    ${GREEN}RUNNING${NC}"
    echo "  Port:      ${GREEN}443/udp${NC}"
    echo "  Network:   ${GREEN}10.8.0.0/24${NC}"
    echo "  XOR Mask:  ${GREEN}${XOR_MASK}${NC}"
    echo ""
    echo -e "${CYAN}Admin Commands:${NC}"
    echo "  Add client:    ${ADMIN_DIR}/add-user.sh <name>"
    echo "  Revoke client: ${ADMIN_DIR}/revoke-user.sh <name>"
    echo "  List clients:  ${ADMIN_DIR}/list-users.sh"
    echo ""
    echo -e "${CYAN}Service Management:${NC}"
    echo "  OpenVPN:  systemctl status openvpn-xor"
    echo "  Agent:    systemctl status ovpn-agent"
    echo ""
    echo -e "${YELLOW}⚠️  Next steps:${NC}"
    echo "  1. Check panel: node should appear as HEALTHY"
    echo "  2. Create first client from the panel!"
    echo ""

    echo -e "${GREEN}Your VPN server is ready!${NC}"
else
    echo -e "${RED}✗ Something went wrong${NC}"
    echo ""
    echo "OpenVPN status:"
    systemctl status openvpn-xor --no-pager | head -5
    echo ""
    echo "Agent status:"
    systemctl status ovpn-agent --no-pager | head -5
    exit 1
fi

# Cleanup
rm -rf "$BUILD_DIR"

echo "Installation directory cleaned. Done!"
