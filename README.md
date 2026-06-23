# OpenVPN Admin Panel

Self-hosted admin panel for managing OpenVPN **XOR** nodes — DPI-bypassing VPN
servers — with per-client traffic accounting, real-time monitoring, and truly
seamless server migration (the PKI follows the node, so existing client configs
keep working).

## Architecture

The panel never connects *to* your nodes. Each node runs a small **agent** that
polls the panel over outbound HTTPS (so it works behind NAT/firewalls), executes
OpenVPN operations locally, and reports back.

```
                         ┌──────────────────────────────┐
                         │        Panel (Next.js)        │
                         │     UI  +  REST API routes     │
                         └──────────────┬───────────────┘
            ┌───────────────┬───────────┼───────────────┐
       ┌────▼─────┐    ┌────▼────┐  ┌────▼─────────┐     │ outbound
       │PostgreSQL│    │  Redis  │  │  Maintenance │     │ heartbeat
       │ + encrypted    │ (rate   │  │   worker     │     │ (polling)
       │  PKI backups│  │  limit) │  │ (sweeps)     │     │
       └──────────┘    └─────────┘  └──────────────┘ ┌───▼──────────┐
                                                     │   Agent      │
                                                     │  (Node.js)   │
                                                     └───┬──────────┘
                                                  ┌──────▼────────┐
                                                  │ OpenVPN XOR    │
                                                  │  (the VPN)     │
                                                  └────────────────┘
```

## Features

- **Multi-node management** — add and manage many VPN servers from one dashboard.
- **OpenVPN XOR** — built-in XOR scramble mask to bypass Deep Packet Inspection
  (DPI). XOR can be toggled on/off per node.
- **Configurable install** — choose **XOR on/off, DNS (standard/none/custom),
  domain, MTU/MSSFIX** in the panel; the agent applies exactly those settings.
- **Seamless server migration** — the agent automatically backs up the full PKI
  (CA, all client certs/keys, CRL, tls-crypt key, XOR mask) to the panel
  (encrypted). If a server is blocked, deploy a fresh VPS with one command and
  the **same CA, certificates and mask are restored** — point your domain at the
  new IP and every existing `.ovpn` keeps working. *Verified end-to-end,
  including a from-source rebuild on a clean server.*
- **Per-client traffic accounting** — cumulative upload/download (GB) per client
  and live online/offline status, collected via a `client-disconnect` hook.
- **Client lifecycle** — create, revoke (with working CRL + immediate reload),
  and download `.ovpn` configs.
- **Agent-based, NAT-friendly** — agents poll the panel; nothing needs to be
  exposed on the node. Auth via JWT (jose, HS256) and per-node API tokens.
- **System monitoring** — OS, architecture, CPU, memory, disk, uptime, connected
  clients, per node.
- **Maintenance worker** — marks stale nodes UNHEALTHY, fails timed-out jobs,
  expires clients past their date.
- **Audit logging** — every administrative action is recorded.
- **Modern responsive UI** — flat, minimal dark theme with subtle motion; works
  on desktop and mobile.

## Security

- JWT signed/verified with **jose** (HS256, enforced algorithm).
- **Fail-fast secrets**: the panel refuses to start in production with missing or
  default `JWT_SECRET` / `ENCRYPTION_KEY` / `API_TOKEN_SALT`.
- **Encrypted at rest** (AES-256-GCM): PKI backups *and* client `.ovpn` artifacts.
- **Login rate limiting** (Redis-backed, fails open).
- API tokens hashed; registration tokens are one-time and expire in 24h.
- Admin passwords hashed with **bcrypt**.
- HttpOnly + SameSite cookie session; no token exposed to client JS.

## Tech Stack

- **Panel**: Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Database**: PostgreSQL + Prisma 7 (driver adapter)
- **Cache**: Redis (login rate limiting)
- **Agent**: Node.js 24 LTS, Axios
- **VPN**: OpenVPN 2.7.3 + XOR patch (built from source on the node)

## Quick Start

### Prerequisites

- Docker & Docker Compose
- A VPN server (or several) running Ubuntu 22.04 / 24.04
- Node.js 20+ and pnpm 9+ (for local development only)

### 1. Run the panel

```bash
git clone https://github.com/tunnect-spec/ovpn-admin.git
cd ovpn-admin
cp .env.example .env
# Generate strong secrets and fill them in .env:
#   openssl rand -base64 48   (JWT_SECRET)
#   openssl rand -hex 16      (ENCRYPTION_KEY)
#   openssl rand -base64 32   (API_TOKEN_SALT, POSTGRES_PASSWORD)
# Set NEXT_PUBLIC_APP_URL / PANEL_URL to the panel's public HTTPS URL.

docker compose -f docker/compose.yml up -d --build
```

Postgres and Redis are internal-only (not published to the host). Put the panel
behind a reverse proxy with TLS.

### 2. Create the admin

```bash
docker exec -e SEED_ADMIN_EMAIL=admin@example.com -e SEED_ADMIN_PASSWORD='your-strong-password' \
  ovpn-admin-panel node_modules/.bin/tsx prisma/seed.ts
```

Then sign in at your panel URL with that email/password.

### 3. Add a node (one command installs the agent)

1. In the panel: **Nodes → Add Node**, enter a name and host.
2. Copy the install command and run it on your VPS as root:

   ```bash
   curl -fsSL <PANEL_URL>/api/agent/install.sh | AGENT_TOKEN=<token> PANEL_URL=<PANEL_URL> bash
   ```

   This installs **only the agent** (Node + the agent service). The node then
   appears in the panel.

### 4. Install OpenVPN with your settings

1. Open the node → **Install OpenVPN**.
2. Choose XOR on/off, DNS mode, **domain**, MTU/MSSFIX.
3. The agent builds OpenVPN XOR from source and applies your options. The first
   client is created automatically.

> Tip: set a **domain** — your client `.ovpn` files will use it, which makes
> migration to a new server a DNS change away.

### Server migration (a blocked server → a new one)

1. Node details → **Migrate Server** → confirm to get a fresh install command.
2. Run that command on your **new** clean VPS.
3. Click **Install OpenVPN** — the agent restores the backed-up PKI before
   installing, so the **same CA, client certs and XOR mask** come back.
4. Re-point your domain to the new server's IP. Existing clients reconnect with
   their current `.ovpn` — nothing to redistribute.

## Project Structure

```
ovpn-admin/
├── apps/
│   ├── panel/     # Next.js admin UI + REST API
│   ├── agent/     # Node agent that runs on each VPN server
│   └── worker/    # Maintenance daemon (stale nodes, job timeouts, expiry)
├── packages/
│   ├── api/       # Zod validators
│   ├── db/        # Prisma schema & client
│   └── types/     # Shared TypeScript types
├── docker/
│   └── compose.yml
├── install-openvpn-xor.sh   # OpenVPN XOR installer (run by the agent)
├── install-agent.sh         # one-command node installer (served by the panel)
└── prisma/schema.prisma
```

## Development

```bash
pnpm install
pnpm --filter @ovpn/panel dev   # panel on :3000
pnpm --filter @ovpn/panel test  # unit tests
```

## License

MIT
