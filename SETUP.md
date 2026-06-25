# OpenVPN Admin Panel - Setup Guide

Complete setup instructions for the self-hosted OpenVPN admin panel.

## Prerequisites

- **Docker** & Docker Compose (production)
- **Node.js** 20+ & **pnpm** 9+ (local development only)
- **VPN node**: a server running Ubuntu 22.04/24.04 with root access

## Production install (recommended)

One command on a fresh Ubuntu server installs Docker and brings up the whole
stack (postgres + redis + panel + worker) via Docker Compose:

```bash
curl -fsSL https://raw.githubusercontent.com/tunnect-spec/ovpn-admin/main/quick-install.sh | sudo bash
```

It prompts for the admin email/password (or generates one) and prints the panel
URL when done. Re-run the same command to update an existing install. Front the
panel with TLS (a domain + reverse proxy) for production.

## Local development

### 1. Clone & install

```bash
git clone https://github.com/tunnect-spec/ovpn-admin.git
cd ovpn-admin
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env   # then fill in the secrets (see comments in the file)
```

### 3. Start datastores, apply schema, seed an admin

```bash
# Bring up postgres + redis (uncomment the postgres `ports` block in
# docker/compose.yml first so the host can reach it on 127.0.0.1:5432).
docker compose -f docker/compose.yml up -d postgres redis

pnpm db:push                                            # apply the schema
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='a-strong-password' pnpm db:seed
```

The admin login is whatever you pass in `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
(email defaults to `admin@example.com`; the password has no default — in
production a missing `SEED_ADMIN_PASSWORD` is a hard error).

### 4. Start the panel + worker

```bash
pnpm dev
```

Panel will be available at http://localhost:3000.

### 5. Add your first node

1. Log in to the panel.
2. Go to Nodes → Add Node, enter a name and host.
3. Copy the install command it shows and run it on your VPN server as root:

```bash
curl -fsSL <PANEL_URL>/api/agent/install.sh | \
  AGENT_TOKEN=<token_from_panel> PANEL_URL=<PANEL_URL> bash
```

### 6. Install OpenVPN

If the node doesn't have OpenVPN installed:

1. Go to Node Details in panel
2. Click "Install OpenVPN"
3. Wait for job to complete
4. First client created automatically

## Development

```bash
# Install dependencies
pnpm install

# Run database migrations
pnpm db:push

# Seed data
pnpm db:seed

# Start panel + worker
pnpm dev

# Start individually
pnpm --filter @ovpn/panel dev
pnpm --filter @ovpn/worker dev
```

## Production

### Docker Compose

```bash
# Build and start all services
docker compose -f docker/compose.yml up -d

# View logs
docker compose -f docker/compose.yml logs -f

# Stop services
docker compose -f docker/compose.yml down
```

### Manual Build

```bash
# Build all packages
pnpm build

# Start panel
cd apps/panel && pnpm start

# Start worker
cd apps/worker && pnpm start
```

## VPN Server Requirements

- Ubuntu 22.04 or 24.04
- Root access
- Port 443/UDP open in firewall
- At least 512MB RAM
- 1GB disk space minimum

## Troubleshooting

### Agent won't connect

```bash
# Check agent status on VPN server
systemctl status ovpn-agent

# View agent logs
journalctl -u ovpn-agent -f

# Test panel connectivity (the installer endpoint is public)
curl -v <PANEL_URL>/api/agent/install.sh
```

### OpenVPN won't start

```bash
# Check status
systemctl status openvpn-xor

# View logs
tail -f /var/log/openvpn-xor.log

# Check config
/usr/local/sbin/openvpn-xor --config /etc/openvpn/xor/server.conf --verb 7
```

### Database issues

```bash
# Reset database
pnpm db:push --force-reset

# Re-seed
pnpm db:seed
```

## Security Notes

1. **Change default password** immediately after first login
2. **Use HTTPS** in production
3. **Restrict firewall** to necessary ports only
4. **Use strong JWT_SECRET** (32+ characters)
5. **Backup database** regularly
6. **Rotate registration tokens** periodically

## Client Setup

Downloaded .ovpn files work with:
- OpenVPN for Android
- OpenVPN Connect (iOS)
- Viscosity (macOS)
- OpenVPN GUI (Windows)

**Important:** Client must support XOR/scramble patch.
