#!/usr/bin/env bash
set -euo pipefail

#############################################
#  OpenVPN Admin Panel — one-command install #
#  curl -fsSL <raw>/quick-install.sh | sudo bash
#  Optional: sudo DOMAIN=vpn.example.com ADMIN_EMAIL=you@x.com bash
#############################################

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }
err()  { echo -e "${RED}$*${NC}"; }

[[ $EUID -ne 0 ]] && { err "Run as root: curl ... | sudo bash"; exit 1; }

REPO_URL="${REPO_URL:-https://github.com/tunnect-spec/ovpn-admin.git}"
REPO_DIR="${REPO_DIR:-/opt/ovpn-admin}"
DOMAIN="${DOMAIN:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

SERVER_IP="$(curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -n "$DOMAIN" ]]; then PANEL_URL="https://$DOMAIN"; else PANEL_URL="http://${SERVER_IP}:3000"; fi

log "=== OpenVPN Admin Panel — Quick Install ==="
echo "Panel URL: $PANEL_URL"

export DEBIAN_FRONTEND=noninteractive

# Prefer IPv4 if IPv6 egress is broken (common on VPS).
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
# Ensure the compose plugin is present.
if ! docker compose version >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin
fi

log "[2/6] Fetching source…"
if [[ -d "$REPO_DIR/.git" ]]; then
  git -C "$REPO_DIR" fetch --depth 1 origin main && git -C "$REPO_DIR" reset --hard origin/main
else
  rm -rf "$REPO_DIR"
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"

log "[3/6] Generating secrets + config…"
# Reuse existing secrets on re-install so sessions/encrypted data survive.
if [[ -f .env ]]; then
  set -a; . ./.env; set +a
fi
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 24)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 48 | tr -d '\n')}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -hex 16)}"
API_TOKEN_SALT="${API_TOKEN_SALT:-$(openssl rand -hex 24)}"
[[ -z "$ADMIN_PASSWORD" ]] && ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)"

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

log "[4/6] Building + starting containers (first build compiles the panel — a few minutes)…"
docker compose -f docker/compose.yml up -d --build

log "[5/6] Waiting for the database, then applying schema + admin…"
for i in $(seq 1 60); do
  if docker compose -f docker/compose.yml exec -T postgres pg_isready -U ovpn >/dev/null 2>&1; then break; fi
  sleep 2
done
# Apply schema + seed the admin using the worker image (it has prisma + tsx + the repo).
docker compose -f docker/compose.yml run --rm --no-deps --user root \
  -e SEED_ADMIN_EMAIL="$ADMIN_EMAIL" -e SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  worker sh -lc "corepack enable >/dev/null 2>&1; pnpm prisma db push --skip-generate && pnpm exec tsx prisma/seed.ts"

log "[6/6] Waiting for the panel to respond…"
for i in $(seq 1 45); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://localhost:3000/login || true)"
  [[ "$code" == "200" ]] && break
  sleep 2
done

echo ""
log "========================================"
log "  Installation complete"
log "========================================"
echo "Panel:    $PANEL_URL"
echo "Email:    $ADMIN_EMAIL"
echo "Password: $ADMIN_PASSWORD"
warn "Change the admin password after first login. Put the panel behind TLS (a domain) for production."
echo ""
echo "Logs:    docker compose -f $REPO_DIR/docker/compose.yml logs -f panel"
echo "Restart: docker compose -f $REPO_DIR/docker/compose.yml restart"
