#!/usr/bin/env bash
set -euo pipefail

#############################################
#  OpenVPN Admin Panel — one-command install #
#  curl -fsSL <raw>/quick-install.sh | sudo bash
#  Non-interactive: sudo DOMAIN=vpn.x.com ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=... bash
#############################################

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }
err()  { echo -e "${RED}$*${NC}"; }

[[ $EUID -ne 0 ]] && { err "Run as root: curl ... | sudo bash"; exit 1; }

REPO_URL="${REPO_URL:-https://github.com/tunnect-spec/ovpn-admin.git}"
REPO_DIR="${REPO_DIR:-/opt/ovpn-admin}"
DOMAIN="${DOMAIN:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

SERVER_IP="$(curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"

log "=== OpenVPN Admin Panel — Quick Install ==="

# --- Interactive setup: prompt for anything not supplied via env, if a terminal
#     is available. Otherwise fall back to defaults / a generated password. ---
if { : </dev/tty; } 2>/dev/null; then
  if [[ -z "$DOMAIN" ]]; then
    read -rp "Domain for the panel (blank = http://${SERVER_IP}:3000): " DOMAIN </dev/tty || true
  fi
  if [[ -z "$ADMIN_EMAIL" ]]; then
    read -rp "Admin email [admin@example.com]: " ADMIN_EMAIL </dev/tty || true
  fi
  if [[ -z "$ADMIN_PASSWORD" ]]; then
    while true; do
      read -rsp "Admin password (min 8 chars): " ADMIN_PASSWORD </dev/tty; echo >/dev/tty
      if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then echo "  too short — try again" >/dev/tty; ADMIN_PASSWORD=""; continue; fi
      read -rsp "Confirm admin password: " _p2 </dev/tty; echo >/dev/tty
      [[ "$ADMIN_PASSWORD" == "$_p2" ]] && break
      echo "  passwords do not match — try again" >/dev/tty; ADMIN_PASSWORD=""
    done
  fi
fi
[[ -z "$ADMIN_EMAIL" ]] && ADMIN_EMAIL="admin@example.com"
if [[ -z "$ADMIN_PASSWORD" ]]; then
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)"
  ADMIN_PASSWORD_GENERATED=1
fi

if [[ -n "$DOMAIN" ]]; then PANEL_URL="https://$DOMAIN"; else PANEL_URL="http://${SERVER_IP}:3000"; fi
echo "Panel URL: $PANEL_URL"
echo "Admin:     $ADMIN_EMAIL"

export DEBIAN_FRONTEND=noninteractive
# Prefer IPv4 when IPv6 egress is broken (common on VPS).
if ! curl -6 -sf --max-time 5 https://github.com >/dev/null 2>&1 \
   && curl -4 -sf --max-time 5 https://github.com >/dev/null 2>&1; then
  sed -i '/^precedence ::ffff:0:0\/96/d' /etc/gai.conf 2>/dev/null || true
  echo "precedence ::ffff:0:0/96  100" >> /etc/gai.conf
fi

log "[1/6] Installing Docker + git…"
command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git ca-certificates curl; }
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
docker compose version >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq docker-compose-plugin; }

# Docker build/runtime must resolve DNS even on hosts with broken IPv6 egress
# (otherwise 'pnpm i' fails with EAI_AGAIN registry.npmjs.org). Pin IPv4 resolvers.
if [[ ! -f /etc/docker/daemon.json ]]; then
  mkdir -p /etc/docker
  printf '{ "dns": ["1.1.1.1", "8.8.8.8"] }\n' > /etc/docker/daemon.json
  systemctl restart docker 2>/dev/null || service docker restart 2>/dev/null || true
  sleep 4
fi

log "[2/6] Fetching source…"
if [[ -d "$REPO_DIR/.git" ]]; then
  git -C "$REPO_DIR" fetch --depth 1 origin main && git -C "$REPO_DIR" reset --hard origin/main
else
  rm -rf "$REPO_DIR"; git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"

log "[3/6] Generating secrets + config…"
# Reuse existing secrets on re-install (keeps sessions valid + lets the panel
# decrypt previously-stored PKI backups). Only the 4 secrets are reused.
val() { [[ -f .env ]] && grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(val POSTGRES_PASSWORD)}"; POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 24)}"
JWT_SECRET="${JWT_SECRET:-$(val JWT_SECRET)}";       JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 48 | tr -d '\n')}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(val ENCRYPTION_KEY)}"; ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -hex 16)}"
API_TOKEN_SALT="${API_TOKEN_SALT:-$(val API_TOKEN_SALT)}"; API_TOKEN_SALT="${API_TOKEN_SALT:-$(openssl rand -hex 24)}"

cat > .env <<EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
API_TOKEN_SALT=$API_TOKEN_SALT
NEXT_PUBLIC_APP_URL=$PANEL_URL
PANEL_URL=$PANEL_URL
NODE_ENV=production
EOF
chmod 600 .env

log "[4/6] Building + starting containers (first run compiles the panel — a few minutes)…"
docker compose --env-file .env -f docker/compose.yml up -d --build

log "[5/6] Applying database schema + creating the admin…"
for i in $(seq 1 60); do
  docker compose --env-file .env -f docker/compose.yml exec -T postgres pg_isready -U ovpn >/dev/null 2>&1 && break
  sleep 2
done
docker compose --env-file .env -f docker/compose.yml run --rm --no-deps --user root \
  -e SEED_ADMIN_EMAIL="$ADMIN_EMAIL" -e SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  worker sh -lc "corepack enable >/dev/null 2>&1; pnpm prisma db push && pnpm exec tsx prisma/seed.ts"

log "[6/6] Waiting for the panel to respond…"
PANEL_OK=0
for i in $(seq 1 60); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://localhost:3000/login || true)" == "200" ]] && { PANEL_OK=1; break; }
  sleep 2
done

echo ""
log "========================================"
[[ "$PANEL_OK" == "1" ]] && log "  Installation complete — panel is up" || warn "  Installed, but the panel did not answer yet (check logs below)"
log "========================================"
echo "Panel:    $PANEL_URL"
echo "Email:    $ADMIN_EMAIL"
if [[ "${ADMIN_PASSWORD_GENERATED:-0}" == "1" ]]; then echo "Password: $ADMIN_PASSWORD   (generated — change it after first login)"; else echo "Password: (the one you entered)"; fi
echo ""
echo "Logs:     docker compose --env-file $REPO_DIR/.env -f $REPO_DIR/docker/compose.yml logs -f panel"
echo "Restart:  docker compose --env-file $REPO_DIR/.env -f $REPO_DIR/docker/compose.yml restart"
warn "Put the panel behind TLS (a domain + reverse proxy) for production."
