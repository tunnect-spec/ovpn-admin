#!/usr/bin/env bash
set -euo pipefail

# OpenVPN Admin — Node one-command installer.
# Deploys the REAL agent (apps/agent), registers it with the panel, installs
# OpenVPN XOR, and runs the agent as a systemd service.
#
# Usage (from the panel's "Add node" command):
#   curl -fsSL <PANEL>/api/agent/install.sh | AGENT_TOKEN=<regToken> PANEL_URL=<PANEL> bash

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0"; exit 1
fi

AGENT_TOKEN="${AGENT_TOKEN:-}"          # one-time registration token from the panel
PANEL_URL="${PANEL_URL:-}"
REPO_URL="${REPO_URL:-https://github.com/tunnect-spec/ovpn-admin.git}"
INSTALL_OPENVPN="${INSTALL_OPENVPN:-1}"
AGENT_DIR="/opt/ovpn-agent"
SRC_DIR="/opt/ovpn-admin-src"

[[ -z "$AGENT_TOKEN" ]] && { echo "ERROR: AGENT_TOKEN (registration token) is required"; exit 1; }
[[ -z "$PANEL_URL"  ]] && { echo "ERROR: PANEL_URL is required"; exit 1; }
PANEL_URL="${PANEL_URL%/}"

echo "=== OpenVPN Admin Node Installer ==="
echo "Panel: $PANEL_URL"

# 1) Many VPS hosts are dual-stack with broken IPv6 egress; prefer IPv4 so
#    apt/git/npm/curl don't hang on dead AAAA routes.
if ! curl -6 -sf --max-time 5 https://github.com >/dev/null 2>&1 \
   && curl -4 -sf --max-time 5 https://github.com >/dev/null 2>&1; then
  echo "IPv6 egress unavailable -> preferring IPv4"
  sed -i '/^precedence ::ffff:0:0\/96/d' /etc/gai.conf 2>/dev/null || true
  echo "precedence ::ffff:0:0/96  100" >> /etc/gai.conf
fi

# 2) Toolchain
export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || apt-get update -qq
  apt-get install -y nodejs >/dev/null
fi
command -v git >/dev/null 2>&1 || apt-get install -y git >/dev/null
echo "Node $(node -v), git $(git --version | awk '{print $3}')"

# 3) Fetch + build the real agent
echo "Fetching agent source..."
rm -rf "$SRC_DIR"
git clone --depth 1 "$REPO_URL" "$SRC_DIR" >/dev/null 2>&1
cd "$SRC_DIR/apps/agent"
echo "Building agent..."
npm install --no-audit --no-fund >/dev/null 2>&1
npx tsc

# 4) Install agent runtime
mkdir -p "$AGENT_DIR"
rm -rf "$AGENT_DIR/dist"
cp -r dist "$AGENT_DIR/dist"
cat > "$AGENT_DIR/package.json" <<'PKG'
{ "name": "ovpn-agent", "private": true, "dependencies": { "axios": "^1.7.0", "dotenv": "^17.4.2" } }
PKG
cd "$AGENT_DIR"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1

# 5) Register with the panel (exchange registration token for the API token)
echo "Registering with panel..."
API_TOKEN="$(PANEL_URL="$PANEL_URL" AGENT_TOKEN="$AGENT_TOKEN" node -e '
  const os = require("os");
  const axios = require("/opt/ovpn-agent/node_modules/axios");
  (async () => {
    try {
      const r = await axios.post(process.env.PANEL_URL + "/api/agent/register", {
        token: process.env.AGENT_TOKEN,
        agentVersion: "3.1.0",
        systemInfo: { os: os.type() + " " + os.release(), kernel: os.release(), arch: process.arch },
      }, { headers: { "User-Agent": "ovpn-agent/3.1.0" }, timeout: 30000 });
      process.stdout.write(r.data && r.data.node && r.data.node.apiToken ? r.data.node.apiToken : "");
    } catch (e) {
      console.error("REGISTER_FAILED:", e.response ? JSON.stringify(e.response.data) : e.message);
      process.exit(1);
    }
  })();
')"
[[ -z "$API_TOKEN" ]] && { echo "ERROR: registration did not return an API token"; exit 1; }
printf '%s' "$API_TOKEN" > "$AGENT_DIR/.api_token"
printf 'PANEL_URL=%s\nAGENT_HEARTBEAT_INTERVAL=30\n' "$PANEL_URL" > "$AGENT_DIR/.env"
chmod 600 "$AGENT_DIR/.api_token" "$AGENT_DIR/.env"
echo "Registered."

# 6) Install OpenVPN XOR (idempotent — skip if already present)
if [[ "$INSTALL_OPENVPN" == "1" ]]; then
  if [[ -x /usr/local/sbin/openvpn-xor ]]; then
    echo "OpenVPN XOR already installed — skipping."
  else
    echo "Installing OpenVPN XOR (compiles from source; several minutes)..."
    bash "$SRC_DIR/install-openvpn-xor.sh"
  fi
fi

# 7) Run the agent as a systemd service
cat > /etc/systemd/system/ovpn-agent.service <<UNIT
[Unit]
Description=OpenVPN Admin Agent
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=$AGENT_DIR
ExecStart=/usr/bin/node $AGENT_DIR/dist/index.js
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now ovpn-agent >/dev/null 2>&1
sleep 3

if systemctl is-active --quiet ovpn-agent; then
  echo "=== Node installed. Agent running. ==="
  echo "Logs: journalctl -u ovpn-agent -f"
else
  echo "ERROR: agent failed to start"; journalctl -u ovpn-agent -n 30 --no-pager; exit 1
fi
