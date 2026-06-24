#!/usr/bin/env bash
set -euo pipefail

# OpenVPN XOR v2.7.3 final installer
# Ubuntu 22.04 / 24.04
# Source: OpenVPN 2.7.3 + luzrain/openvpn-xorpatch patches/v2.7.3

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

OPENVPN_VERSION="2.7.3"
OPENVPN_TAG="v2.7.3"

# Configurable from the panel (passed as env by the agent on NODE_INSTALL).
PORT="${PORT:-443}"
PROTO="${PROTO:-udp}"
USE_XOR="${USE_XOR:-1}"            # 1 = OpenVPN+XOR, 0 = standard (no scramble)
DNS_MODE="${DNS_MODE:-standard}"  # standard | empty | custom
CUSTOM_DNS="${CUSTOM_DNS:-}"      # comma-separated, used when DNS_MODE=custom
MTU="${MTU:-1500}"
MSSFIX="${MSSFIX:-1360}"
DOMAIN="${DOMAIN:-}"              # client 'remote' uses this if set, else SERVER_HOST
RESTORE="${RESTORE:-0}"          # 1 = a PKI backup was restored; keep it, don't regenerate

# --- Configurable OpenVPN options (passed by the panel on NODE_INSTALL) -------
# Obfuscation transform applied by the XOR patch's `scramble` directive.
#   none | xormask | xorptrpos | reverse | obfuscate
OBFUSCATION="${OBFUSCATION:-}"
CIPHER="${CIPHER:-AES-256-GCM}"          # data-channel AEAD cipher (primary)
AUTH="${AUTH:-SHA256}"                   # HMAC digest (SHA256 | SHA512)
TUNNEL_MODE="${TUNNEL_MODE:-full}"       # full = redirect all traffic | split = VPN subnet only
CLIENT_TO_CLIENT="${CLIENT_TO_CLIENT:-0}"
DUPLICATE_CN="${DUPLICATE_CN:-0}"

# Back-compat: derive OBFUSCATION from the legacy USE_XOR flag when not given,
# then keep USE_XOR consistent (used by the XOR-mask persistence logic below).
if [[ -z "$OBFUSCATION" ]]; then
  [[ "$USE_XOR" == "1" ]] && OBFUSCATION="xormask" || OBFUSCATION="none"
fi
[[ "$OBFUSCATION" == "none" ]] && USE_XOR=0 || USE_XOR=1

VPN_SUBNET="10.8.0.0"
VPN_NETMASK="255.255.255.0"

BUILD_ROOT="/usr/local/src/openvpn-xor-v273-build"
PATCH_REPO="$BUILD_ROOT/openvpn-xorpatch"
SRC_DIR="$BUILD_ROOT/openvpn-$OPENVPN_VERSION"

OVPN_PREFIX="/usr/local/openvpn-xor"
OVPN_BIN="$OVPN_PREFIX/sbin/openvpn"
OVPN_LINK="/usr/local/sbin/openvpn-xor"

OVPN_DIR="/etc/openvpn/xor"
EASYRSA_DIR="$OVPN_DIR/easy-rsa"
ADMIN_DIR="/root/ovpn-xor-admin"
CLIENTS_DIR="$ADMIN_DIR/clients"

SFTP_USER="ubuntu"
EXPORT_DIR="/home/$SFTP_USER/ovpn-clients"

echo "=== OpenVPN XOR v2.7.3 Final Installer ==="
echo

SERVER_HOST="${SERVER_HOST:-$(curl -4 -fsSL --max-time 10 https://ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')}"
FIRST_USER="${FIRST_USER:-client1}"

if [[ -z "$SERVER_HOST" ]]; then
  echo "ERROR: server host is empty"
  exit 1
fi

if [[ -z "$FIRST_USER" ]]; then
  echo "ERROR: first client name is empty"
  exit 1
fi

if [[ "$FIRST_USER" =~ [^a-zA-Z0-9._-] ]]; then
  echo "ERROR: client name may contain only letters, numbers, dot, underscore, hyphen"
  exit 1
fi

REMOTE_HOST="${DOMAIN:-$SERVER_HOST}"

# Preserve the XOR mask across reconfigurations (including toggling XOR off then
# on) so already-issued client configs keep working. Prefer the persisted
# config.env, fall back to the running server.conf, else generate a fresh one.
if [[ -f "$ADMIN_DIR/config.env" ]] && grep -q '^XOR_MASK=' "$ADMIN_DIR/config.env"; then
  XOR_MASK="$(grep -m1 '^XOR_MASK=' "$ADMIN_DIR/config.env" | cut -d= -f2-)"
elif [[ -f "$OVPN_DIR/server.conf" ]] && grep -q '^scramble xormask ' "$OVPN_DIR/server.conf"; then
  XOR_MASK="$(grep -m1 '^scramble xormask ' "$OVPN_DIR/server.conf" | awk '{print $3}')"
else
  XOR_MASK="$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9_-' | head -c 28)"
fi

# --- Config renderers (shared by the fresh-install and reconfigure paths) ---

# The `scramble` directive for the chosen obfuscation mode (empty for none).
# Server and client MUST carry the identical line.
render_scramble_line() {
  case "$OBFUSCATION" in
    xormask)   echo "scramble xormask $XOR_MASK" ;;
    xorptrpos) echo "scramble xorptrpos" ;;
    reverse)   echo "scramble reverse" ;;
    obfuscate) echo "scramble obfuscate $XOR_MASK" ;;
    *)         : ;;   # none → no scramble line
  esac
}

# data-ciphers list with the chosen primary first, the rest as negotiable
# fallbacks (all AEAD, DCO-compatible). Server and client must agree.
render_cipher_list() {
  local out="$CIPHER" c
  for c in AES-256-GCM AES-128-GCM CHACHA20-POLY1305; do
    [[ "$c" != "$CIPHER" ]] && out="$out:$c"
  done
  echo "$out"
}

render_dns_pushes() {
  case "$DNS_MODE" in
    empty) : ;;                                  # push no DNS
    custom)
      local old="$IFS"; IFS=','
      for d in $CUSTOM_DNS; do
        d="$(echo "$d" | tr -d ' ')"
        [[ -n "$d" ]] && echo "push \"dhcp-option DNS $d\""
      done
      IFS="$old"
      ;;
    *)                                           # standard
      echo 'push "dhcp-option DNS 1.1.1.1"'
      echo 'push "dhcp-option DNS 8.8.8.8"'
      ;;
  esac
}

install_disconnect_hook() {
  mkdir -p "$OVPN_DIR/traffic"
  cat > "$OVPN_DIR/client-disconnect.sh" <<'DISCONNECT'
#!/usr/bin/env bash
# OpenVPN calls this on disconnect with $common_name/$bytes_received/$bytes_sent.
set -eu
DIR=/etc/openvpn/xor/traffic
cn="${common_name:-}"
case "$cn" in *[!a-zA-Z0-9._-]*|'') exit 0 ;; esac
mkdir -p "$DIR"; f="$DIR/$cn"
up=0; down=0
if [ -f "$f" ]; then read -r up down < "$f" 2>/dev/null || { up=0; down=0; }; fi
echo "$(( ${up:-0} + ${bytes_received:-0} )) $(( ${down:-0} + ${bytes_sent:-0} ))" > "$f"
exit 0
DISCONNECT
  chmod +x "$OVPN_DIR/client-disconnect.sh"
}

write_server_conf() {
  # client-config-dir holds per-client overrides; a file named after the CN
  # containing `disable` blocks that client (reversible enable/disable). The
  # unix management socket lets the agent kill a single client's live session.
  mkdir -p "$OVPN_DIR/ccd"
  {
    cat <<EOF
port $PORT
proto $PROTO
dev tun
disable-dco

persist-key
persist-tun

topology subnet
server $VPN_SUBNET $VPN_NETMASK

ca $EASYRSA_DIR/pki/ca.crt
cert $EASYRSA_DIR/pki/issued/server.crt
key $EASYRSA_DIR/pki/private/server.key

dh none
tls-groups secp256r1

tls-crypt $OVPN_DIR/tls-crypt.key
crl-verify $OVPN_DIR/crl.pem

client-config-dir $OVPN_DIR/ccd
management $OVPN_DIR/mgmt.sock unix

data-ciphers $(render_cipher_list)
data-ciphers-fallback $CIPHER
auth $AUTH

keepalive 10 120
tun-mtu $MTU
mssfix $MSSFIX
EOF
    # NB: these are `if/fi`, not `[[ … ]] && echo`. Under `set -e`, a trailing
    # `[[ false ]] && echo` returns 1 and would abort the whole script (this is
    # exactly what broke TCP/split reconfigures). `if/fi` always returns 0.
    # Full tunnel = push a default route; split tunnel = only the VPN subnet.
    if [[ "$TUNNEL_MODE" != "split" ]]; then echo 'push "redirect-gateway def1 bypass-dhcp"'; fi
    render_dns_pushes
    if [[ "$CLIENT_TO_CLIENT" == "1" ]]; then echo "client-to-client"; fi
    if [[ "$DUPLICATE_CN" == "1" ]]; then echo "duplicate-cn"; fi
    local scramble; scramble="$(render_scramble_line)"
    if [[ -n "$scramble" ]]; then echo "$scramble"; fi
    cat <<EOF

verb 3
status /var/log/openvpn-xor-status.log 10
status-version 2
log-append /var/log/openvpn-xor.log

script-security 2
client-disconnect $OVPN_DIR/client-disconnect.sh
EOF
    # explicit-exit-notify is UDP-only; it errors the parser on TCP.
    if [[ "$PROTO" == "udp" ]]; then echo "explicit-exit-notify 1"; fi
  } > "$OVPN_DIR/server.conf"
}

# Runtime config sourced by add-user.sh when generating client .ovpn files.
write_config_env() {
  mkdir -p "$ADMIN_DIR"
  cat > "$ADMIN_DIR/config.env" <<EOF
SERVER_HOST=$SERVER_HOST
CLIENT_REMOTE=$REMOTE_HOST
PORT=$PORT
PROTO=$PROTO
USE_XOR=$USE_XOR
OBFUSCATION=$OBFUSCATION
CIPHER=$CIPHER
AUTH=$AUTH
TUNNEL_MODE=$TUNNEL_MODE
MTU=$MTU
MSSFIX=$MSSFIX
XOR_MASK=$XOR_MASK
OVPN_DIR=$OVPN_DIR
EASYRSA_DIR=$EASYRSA_DIR
CLIENTS_DIR=$CLIENTS_DIR
OVPN_BIN=$OVPN_BIN
OVPN_LINK=$OVPN_LINK
EXPORT_DIR=$EXPORT_DIR
SFTP_USER=$SFTP_USER
EOF
}

write_add_user_script() {
  mkdir -p "$ADMIN_DIR"
  cat > "$ADMIN_DIR/add-user.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

USER_NAME="${1:-}"

if [[ -z "$USER_NAME" ]]; then
  echo "Usage: $0 username"
  exit 1
fi

if [[ "$USER_NAME" =~ [^a-zA-Z0-9._-] ]]; then
  echo "Username may contain only letters, numbers, dot, underscore, hyphen"
  exit 1
fi

source /root/ovpn-xor-admin/config.env

# Client scramble line must match the server EXACTLY. Derive it from the
# obfuscation mode (falling back to the legacy USE_XOR flag for old installs).
OBFUSCATION="${OBFUSCATION:-}"
if [[ -z "$OBFUSCATION" ]]; then
  [[ "${USE_XOR:-1}" == "1" ]] && OBFUSCATION="xormask" || OBFUSCATION="none"
fi
SCRAMBLE_LINE=""
case "$OBFUSCATION" in
  xormask)   SCRAMBLE_LINE="scramble xormask $XOR_MASK" ;;
  xorptrpos) SCRAMBLE_LINE="scramble xorptrpos" ;;
  reverse)   SCRAMBLE_LINE="scramble reverse" ;;
  obfuscate) SCRAMBLE_LINE="scramble obfuscate $XOR_MASK" ;;
esac

# data-ciphers / auth must also match the server.
CIPHER="${CIPHER:-AES-256-GCM}"
AUTH="${AUTH:-SHA256}"
DATA_CIPHERS="$CIPHER"
for c in AES-256-GCM AES-128-GCM CHACHA20-POLY1305; do
  [[ "$c" != "$CIPHER" ]] && DATA_CIPHERS="$DATA_CIPHERS:$c"
done

mkdir -p "$CLIENTS_DIR"

cd "$EASYRSA_DIR"

if [[ -f "$EASYRSA_DIR/pki/issued/$USER_NAME.crt" ]]; then
  echo "User already exists: $USER_NAME"
  exit 1
fi

# Certificate validity. CERT_EXPIRE_DAYS (passed by the agent for a client with a
# chosen expiry) makes the cert genuinely stop authenticating on that date.
# Default to 3650 days (≈ the CA lifetime) when no expiry was selected.
CERT_EXPIRE_DAYS="${CERT_EXPIRE_DAYS:-}"
[[ -n "$CERT_EXPIRE_DAYS" ]] || CERT_EXPIRE_DAYS=3650
EASYRSA_CERT_EXPIRE="$CERT_EXPIRE_DAYS" EASYRSA_BATCH=1 ./easyrsa build-client-full "$USER_NAME" nopass

CA="$(cat "$EASYRSA_DIR/pki/ca.crt")"
CERT="$(awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' "$EASYRSA_DIR/pki/issued/$USER_NAME.crt")"
KEY="$(cat "$EASYRSA_DIR/pki/private/$USER_NAME.key")"
TLS="$(cat "$OVPN_DIR/tls-crypt.key")"

cat > "$CLIENTS_DIR/$USER_NAME.ovpn" <<EOC
client
dev tun
proto $PROTO

remote $CLIENT_REMOTE $PORT

resolv-retry infinite
nobind

persist-key
persist-tun

remote-cert-tls server

data-ciphers $DATA_CIPHERS
data-ciphers-fallback $CIPHER
auth $AUTH

tun-mtu $MTU
mssfix $MSSFIX

$SCRAMBLE_LINE

verb 3

<ca>
$CA
</ca>

<cert>
$CERT
</cert>

<key>
$KEY
</key>

<tls-crypt>
$TLS
</tls-crypt>
EOC

chmod 600 "$CLIENTS_DIR/$USER_NAME.ovpn"

echo "Created user: $USER_NAME"
echo "Config: $CLIENTS_DIR/$USER_NAME.ovpn"

if [[ -n "${EXPORT_DIR:-}" && -n "${SFTP_USER:-}" && -d "/home/$SFTP_USER" ]]; then
  mkdir -p "$EXPORT_DIR"
  cp "$CLIENTS_DIR/$USER_NAME.ovpn" "$EXPORT_DIR/$USER_NAME.ovpn"
  chown "$SFTP_USER:$SFTP_USER" "$EXPORT_DIR/$USER_NAME.ovpn"
  chmod 600 "$EXPORT_DIR/$USER_NAME.ovpn"
  echo "Exported for SFTP: $EXPORT_DIR/$USER_NAME.ovpn"
fi
EOF
  chmod +x "$ADMIN_DIR/add-user.sh"
}

# Fast path: if OpenVPN is already installed, just reconfigure from the new
# options and restart — no recompile, PKI untouched (existing clients keep
# working). This is what makes changing XOR/DNS/domain/MTU cheap and safe.
if [[ -x "$OVPN_BIN" && -f "$EASYRSA_DIR/pki/ca.crt" ]]; then
  echo "=== OpenVPN already installed - reconfiguring only ==="
  echo "OBFUSCATION=$OBFUSCATION CIPHER=$CIPHER AUTH=$AUTH PROTO=$PROTO PORT=$PORT TUNNEL=$TUNNEL_MODE C2C=$CLIENT_TO_CLIENT DUP=$DUPLICATE_CN DNS=$DNS_MODE DOMAIN=${DOMAIN:-<server ip>} MTU=$MTU MSSFIX=$MSSFIX"
  echo "PROGRESS:30:Applying new configuration"
  install_disconnect_hook
  write_server_conf
  write_config_env
  write_add_user_script
  # The listen port/proto may have changed on reconfigure — make sure the new
  # one is open (idempotent; old rules linger harmlessly until a full reinstall).
  iptables -C INPUT -p "$PROTO" --dport "$PORT" -j ACCEPT 2>/dev/null || \
    iptables -A INPUT -p "$PROTO" --dport "$PORT" -j ACCEPT
  netfilter-persistent save 2>/dev/null || true
  echo "PROGRESS:90:Restarting OpenVPN"
  systemctl restart openvpn-xor 2>/dev/null || systemctl start openvpn-xor 2>/dev/null || true
  sleep 1
  systemctl is-active --quiet openvpn-xor && { echo "PROGRESS:100:Reconfigured"; echo "OK: reconfigured"; } || {
    echo "ERROR: openvpn-xor failed to start after reconfigure"
    tail -40 /var/log/openvpn-xor.log 2>/dev/null || true
    journalctl -u openvpn-xor -n 40 --no-pager 2>/dev/null || true
    exit 1
  }
  exit 0
fi

echo
echo "Server host: $SERVER_HOST"
echo "First user: $FIRST_USER"
echo "Protocol: $PROTO"
echo "Port: $PORT"
echo "XOR mask: $XOR_MASK"
echo

sleep 2

echo "PROGRESS:5:Preparing installation"
echo "=== Stop old service ==="
systemctl stop openvpn-xor 2>/dev/null || true
systemctl reset-failed openvpn-xor 2>/dev/null || true

echo "PROGRESS:12:Installing dependencies"
echo "=== Install dependencies ==="

# CRITICAL: this installer runs as a child of the ovpn-agent systemd service.
# Ubuntu's `needrestart` hook runs after apt upgrades shared libraries (libssl,
# openssl, …) and, in automatic mode, restarts every affected daemon — INCLUDING
# ovpn-agent. Restarting the agent SIGTERMs it, which kills this very script
# mid-compile and fails the install. Fully suspend needrestart (and keep apt
# non-interactive) for every apt call below so provisioning never bounces the
# agent or unrelated services.
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_SUSPEND=1
export NEEDRESTART_MODE=l

apt update
apt install -y \
  git curl wget ca-certificates \
  build-essential autoconf automake libtool pkg-config patch \
  libssl-dev liblzo2-dev liblz4-dev libpam0g-dev libcap-ng-dev \
  libnl-3-dev libnl-genl-3-dev \
  easy-rsa iptables-persistent netfilter-persistent \
  openssl tar gzip nano iproute2 binutils dnsutils

echo "=== Backup old installation if exists ==="

BACKUP_SUFFIX="$(date +%F-%H%M%S)"

if [[ "$RESTORE" == "1" ]]; then
  echo "RESTORE=1 — preserving restored PKI in $OVPN_DIR / $ADMIN_DIR (not moving aside)."
else
  if [[ -d "$OVPN_DIR" ]]; then
    mv "$OVPN_DIR" "$OVPN_DIR.backup.$BACKUP_SUFFIX"
    echo "Backed up old $OVPN_DIR"
  fi

  if [[ -d "$ADMIN_DIR" ]]; then
    mv "$ADMIN_DIR" "$ADMIN_DIR.backup.$BACKUP_SUFFIX"
    echo "Backed up old $ADMIN_DIR"
  fi
fi

rm -rf "$OVPN_PREFIX"
rm -f "$OVPN_LINK"

echo "=== Clean build directory ==="

rm -rf "$BUILD_ROOT"
mkdir -p "$BUILD_ROOT"
cd "$BUILD_ROOT"

echo "PROGRESS:28:Downloading OpenVPN source"
echo "=== Download OpenVPN $OPENVPN_VERSION source ==="

wget -O "openvpn-$OPENVPN_VERSION.tar.gz" \
  "https://swupdate.openvpn.org/community/releases/openvpn-$OPENVPN_VERSION.tar.gz"

tar -xzf "openvpn-$OPENVPN_VERSION.tar.gz"

if [[ ! -f "$SRC_DIR/configure.ac" ]]; then
  echo "ERROR: configure.ac not found in $SRC_DIR"
  exit 1
fi

echo "=== Clone XOR patch repo ==="

git clone https://github.com/luzrain/openvpn-xorpatch.git "$PATCH_REPO"

PATCH_DIR="$PATCH_REPO/patches/$OPENVPN_TAG"

if [[ ! -d "$PATCH_DIR" ]]; then
  echo "ERROR: patch directory not found: $PATCH_DIR"
  echo "Available patch directories:"
  find "$PATCH_REPO/patches" -maxdepth 1 -type d | sort
  exit 1
fi

PATCH_FILES="$(find "$PATCH_DIR" -maxdepth 1 -type f \( -name '*.diff' -o -name '*.patch' \) | sort)"
PATCH_COUNT="$(echo "$PATCH_FILES" | sed '/^$/d' | wc -l)"

echo "=== Patch files ==="
echo "$PATCH_FILES"

if [[ "$PATCH_COUNT" -ne 5 ]]; then
  echo "ERROR: expected exactly 5 patch files for v2.7.3, found $PATCH_COUNT"
  exit 1
fi

echo "PROGRESS:38:Applying obfuscation patches"
echo "=== Apply XOR patches ==="

cd "$SRC_DIR"

for p in $PATCH_FILES; do
  echo "Applying patch: $p"

  if patch --dry-run -p1 < "$p" >/tmp/openvpn-xor-patch-test.log 2>&1; then
    patch -p1 < "$p"
    echo "Applied with -p1"
  elif patch --dry-run -p0 < "$p" >/tmp/openvpn-xor-patch-test.log 2>&1; then
    patch -p0 < "$p"
    echo "Applied with -p0"
  else
    echo "ERROR: failed to apply patch: $p"
    cat /tmp/openvpn-xor-patch-test.log || true
    exit 1
  fi
done

echo "=== Verify patched source ==="

grep -R "xormethod" -n src/openvpn >/dev/null || {
  echo "ERROR: xormethod not found after patch"
  exit 1
}

grep -R "xormask" -n src/openvpn >/dev/null || {
  echo "ERROR: xormask not found after patch"
  exit 1
}

grep -R "scramble" -n src/openvpn >/dev/null || {
  echo "ERROR: scramble not found after patch"
  exit 1
}

echo "OK: patched source contains XOR/scramble code"

echo "PROGRESS:45:Compiling OpenVPN from source (this takes a few minutes)"
echo "=== Build OpenVPN XOR ==="

autoreconf -i -v -f
./configure --prefix="$OVPN_PREFIX"
make clean || true
make -j"$(nproc)"
echo "PROGRESS:68:Installing compiled binary"
make install

if [[ ! -x "$OVPN_BIN" ]]; then
  echo "ERROR: OpenVPN binary not found: $OVPN_BIN"
  exit 1
fi

ln -sf "$OVPN_BIN" "$OVPN_LINK"

echo "=== Binary version ==="
"$OVPN_LINK" --version | head -20

echo "=== Prepare directories ==="

mkdir -p "$OVPN_DIR"
mkdir -p "$ADMIN_DIR"
mkdir -p "$CLIENTS_DIR"

echo "PROGRESS:78:Generating PKI and certificates"
echo "=== Setup EasyRSA ==="

if [[ -f "$EASYRSA_DIR/pki/ca.crt" ]]; then
  echo "Existing CA found (restored from backup) — keeping CA + client certs, skipping PKI generation."
  cd "$EASYRSA_DIR"
  [[ -f "$EASYRSA_DIR/pki/crl.pem" ]] || EASYRSA_BATCH=1 ./easyrsa gen-crl || true
  cp -f "$EASYRSA_DIR/pki/crl.pem" "$OVPN_DIR/crl.pem" 2>/dev/null || true
  chmod 644 "$OVPN_DIR/crl.pem" 2>/dev/null || true
else
  make-cadir "$EASYRSA_DIR"
  cd "$EASYRSA_DIR"

  ./easyrsa init-pki
  EASYRSA_BATCH=1 ./easyrsa build-ca nopass
  EASYRSA_BATCH=1 ./easyrsa build-server-full server nopass
  ./easyrsa gen-crl

  cp "$EASYRSA_DIR/pki/crl.pem" "$OVPN_DIR/crl.pem"
  chmod 644 "$OVPN_DIR/crl.pem"
fi

echo "=== Generate tls-crypt key ==="

if [[ -f "$OVPN_DIR/tls-crypt.key" ]]; then
  echo "tls-crypt key present (restored) — keeping it."
else
  "$OVPN_LINK" --genkey secret "$OVPN_DIR/tls-crypt.key"
  chmod 600 "$OVPN_DIR/tls-crypt.key"
fi

echo "=== Write parse-test config ==="

cat > "$OVPN_DIR/parse-test.conf" <<EOF
dev null
ifconfig-noexec
route-noexec
verb 4
scramble xormask testmask123
EOF

set +e
"$OVPN_LINK" --config "$OVPN_DIR/parse-test.conf" --help >/tmp/openvpn-xor-accept-test.log 2>&1
set -e

if grep -Eiq "Unrecognized option.*scramble|unknown option.*scramble|Options error.*scramble" /tmp/openvpn-xor-accept-test.log; then
  echo "ERROR: built binary does not accept scramble option"
  cat /tmp/openvpn-xor-accept-test.log
  exit 1
fi

echo "OK: binary accepts scramble option"
rm -f "$OVPN_DIR/parse-test.conf"

echo "=== Write server config + traffic hook ==="
install_disconnect_hook
write_server_conf

echo "=== Enable IPv4 forwarding ==="

cat > /etc/sysctl.d/99-openvpn-xor.conf <<EOF
net.ipv4.ip_forward=1
EOF

sysctl --system

echo "=== Detect external interface ==="

EXT_IFACE="$(ip route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}' | head -n1)"

if [[ -z "$EXT_IFACE" ]]; then
  echo "ERROR: could not detect external interface"
  exit 1
fi

echo "External interface: $EXT_IFACE"

echo "PROGRESS:88:Configuring firewall and routing"
echo "=== Configure firewall/NAT ==="

iptables -C INPUT -p "$PROTO" --dport "$PORT" -j ACCEPT 2>/dev/null || \
iptables -A INPUT -p "$PROTO" --dport "$PORT" -j ACCEPT

iptables -C INPUT -i tun+ -j ACCEPT 2>/dev/null || \
iptables -A INPUT -i tun+ -j ACCEPT

iptables -C FORWARD -i tun+ -j ACCEPT 2>/dev/null || \
iptables -A FORWARD -i tun+ -j ACCEPT

iptables -C FORWARD -i tun+ -o "$EXT_IFACE" -j ACCEPT 2>/dev/null || \
iptables -A FORWARD -i tun+ -o "$EXT_IFACE" -j ACCEPT

iptables -C FORWARD -i "$EXT_IFACE" -o tun+ -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
iptables -A FORWARD -i "$EXT_IFACE" -o tun+ -m state --state RELATED,ESTABLISHED -j ACCEPT

iptables -t nat -C POSTROUTING -s 10.8.0.0/24 -o "$EXT_IFACE" -j MASQUERADE 2>/dev/null || \
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o "$EXT_IFACE" -j MASQUERADE

netfilter-persistent save

echo "=== Create systemd service ==="

cat > /etc/systemd/system/openvpn-xor.service <<EOF
[Unit]
Description=OpenVPN XOR Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$OVPN_BIN --config $OVPN_DIR/server.conf
Restart=on-failure
RestartSec=3
LimitNPROC=100
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW CAP_SETGID CAP_SETUID CAP_SETPCAP
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
DeviceAllow=/dev/net/tun rw
ProtectSystem=false
ProtectHome=false

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable openvpn-xor

echo "=== Write admin config ==="

write_config_env
chmod 600 "$ADMIN_DIR/config.env"

echo "=== Create admin scripts ==="

write_add_user_script

cat > "$ADMIN_DIR/revoke-user.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

USER_NAME="${1:-}"

if [[ -z "$USER_NAME" ]]; then
  echo "Usage: $0 username"
  exit 1
fi

source /root/ovpn-xor-admin/config.env

cd "$EASYRSA_DIR"

if [[ ! -f "$EASYRSA_DIR/pki/issued/$USER_NAME.crt" ]]; then
  echo "User certificate not found: $USER_NAME"
  exit 1
fi

EASYRSA_BATCH=1 ./easyrsa revoke "$USER_NAME"
./easyrsa gen-crl

cp "$EASYRSA_DIR/pki/crl.pem" "$OVPN_DIR/crl.pem"
chmod 644 "$OVPN_DIR/crl.pem"

rm -f "$CLIENTS_DIR/$USER_NAME.ovpn"
rm -f "$EXPORT_DIR/$USER_NAME.ovpn" 2>/dev/null || true
# Clear any disable override and free the CN for re-issue. The revoked serial
# stays in the CRL (the old cert is permanently blocked); EasyRSA's index keeps
# unique_subject=no so the same name can be issued a fresh cert later.
rm -f "$OVPN_DIR/ccd/$USER_NAME" 2>/dev/null || true
rm -f "$EASYRSA_DIR/pki/issued/$USER_NAME.crt" \
      "$EASYRSA_DIR/pki/private/$USER_NAME.key" \
      "$EASYRSA_DIR/pki/reqs/$USER_NAME.req" 2>/dev/null || true

systemctl restart openvpn-xor

echo "Revoked user: $USER_NAME"
EOF

chmod +x "$ADMIN_DIR/revoke-user.sh"

cat > "$ADMIN_DIR/list-users.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

INDEX="/etc/openvpn/xor/easy-rsa/pki/index.txt"

if [[ ! -f "$INDEX" ]]; then
  echo "No EasyRSA index found"
  exit 1
fi

echo "Active users:"
awk '$1 == "V" && $5 ~ /CN=/ {print "- " $5}' "$INDEX" | sed 's|/CN=||g' || true

echo
echo "Revoked users:"
awk '$1 == "R" && $5 ~ /CN=/ {print "- " $5}' "$INDEX" | sed 's|/CN=||g' || true
EOF

chmod +x "$ADMIN_DIR/list-users.sh"

cat > "$ADMIN_DIR/status.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "=== Service ==="
systemctl status openvpn-xor --no-pager | head -80 || true

echo
echo "=== Listening UDP 443 ==="
ss -lunpt | grep ':443' || true

echo
echo "=== OpenVPN status file ==="
cat /var/log/openvpn-xor-status.log 2>/dev/null || echo "No status file yet"

echo
echo "=== Last logs ==="
journalctl -u openvpn-xor -n 80 --no-pager || true
EOF

chmod +x "$ADMIN_DIR/status.sh"

cat > "$ADMIN_DIR/check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

source /root/ovpn-xor-admin/config.env

echo "=== Binary ==="
"$OVPN_LINK" --version | head -10

echo
echo "=== Config scramble line ==="
grep -n "scramble" "$OVPN_DIR/server.conf" || true

echo
echo "=== Parse-test scramble ==="
cat > /tmp/openvpn-xor-parse-test.conf <<EOC
dev null
ifconfig-noexec
route-noexec
verb 4
scramble xormask testmask123
EOC

set +e
"$OVPN_LINK" --config /tmp/openvpn-xor-parse-test.conf --help >/tmp/openvpn-xor-parse-test.log 2>&1
set -e

if grep -Eiq "Unrecognized option.*scramble|unknown option.*scramble|Options error.*scramble" /tmp/openvpn-xor-parse-test.log; then
  echo "ERROR: scramble not supported"
  tail -40 /tmp/openvpn-xor-parse-test.log
else
  echo "OK: no unrecognized scramble error"
fi

echo
echo "=== Service ==="
systemctl is-active openvpn-xor || true

echo
echo "=== Port ==="
ss -lunpt | grep ':443' || true

echo
echo "=== Export dir ==="
ls -la "$EXPORT_DIR" 2>/dev/null || true
EOF

chmod +x "$ADMIN_DIR/check.sh"

cat > "$ADMIN_DIR/backup.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

BACKUP_FILE="/root/openvpn-xor-backup-$(date +%F-%H%M%S).tar.gz"

tar -czf "$BACKUP_FILE" \
  /etc/openvpn/xor \
  /root/ovpn-xor-admin \
  /etc/systemd/system/openvpn-xor.service

chmod 600 "$BACKUP_FILE"

echo "Backup created:"
echo "$BACKUP_FILE"
EOF

chmod +x "$ADMIN_DIR/backup.sh"

cat > /usr/local/bin/export-ovpn <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

CLIENT="${1:-}"

if [[ -z "$CLIENT" ]]; then
  echo "Usage: export-ovpn clientname"
  exit 1
fi

source /root/ovpn-xor-admin/config.env

SRC="$CLIENTS_DIR/$CLIENT.ovpn"
DST="$EXPORT_DIR/$CLIENT.ovpn"

if [[ ! -f "$SRC" ]]; then
  echo "Config not found: $SRC"
  exit 1
fi

mkdir -p "$EXPORT_DIR"
cp "$SRC" "$DST"
chown "$SFTP_USER:$SFTP_USER" "$DST"
chmod 600 "$DST"

echo "Exported: $DST"
EOF

chmod +x /usr/local/bin/export-ovpn

echo "PROGRESS:94:Starting OpenVPN service"
echo "=== Start OpenVPN XOR service ==="

rm -f /var/log/openvpn-xor.log
systemctl restart openvpn-xor
sleep 2

if ! systemctl is-active --quiet openvpn-xor; then
  echo "ERROR: openvpn-xor service is not active"
  echo "Manual debug:"
  echo "$OVPN_BIN --config $OVPN_DIR/server.conf --verb 7"
  tail -120 /var/log/openvpn-xor.log 2>/dev/null || true
  journalctl -u openvpn-xor -n 80 --no-pager || true
  exit 1
fi

echo "PROGRESS:98:Creating first client"
echo "=== Create first user ==="

# Idempotent: on a reinstall or migration the PKI (and this first client) may
# already exist. add-user.sh exits non-zero in that case, which would fail the
# whole install under `set -e` — so skip creation when the cert already exists.
if [[ -f "$EASYRSA_DIR/pki/issued/$FIRST_USER.crt" ]]; then
  echo "First client '$FIRST_USER' already exists — skipping"
else
  "$ADMIN_DIR/add-user.sh" "$FIRST_USER"
fi

echo
echo "=== Installation complete ==="
echo
echo "Server host: $SERVER_HOST"
echo "Protocol: $PROTO"
echo "Port: $PORT"
echo "XOR mask: $XOR_MASK"
echo
echo "First client config:"
echo "$CLIENTS_DIR/$FIRST_USER.ovpn"
echo
echo "SFTP export path:"
echo "$EXPORT_DIR/$FIRST_USER.ovpn"
echo
echo "Admin directory:"
echo "$ADMIN_DIR"
echo
echo "Commands:"
echo "cd $ADMIN_DIR"
echo "./add-user.sh username"
echo "./revoke-user.sh username"
echo "./list-users.sh"
echo "./status.sh"
echo "./check.sh"
echo "./backup.sh"
echo "export-ovpn username"
echo
echo "Important:"
echo "Client app must support OpenVPN XOR / scramble xormask."




