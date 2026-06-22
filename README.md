# OpenVPN Admin Panel

Self-hosted admin panel for managing OpenVPN XOR nodes.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Panel (Next.js)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────────┐ │
│  │   UI/App    │  │  API Routes │  │  Background Workers │ │
│  └─────────────┘  └─────────────┘  └────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │                        │                    │
    ┌────▼─────┐          ┌─────▼──────┐       ┌─────▼─────┐
    │PostgreSQL│          │   Redis    │       │  Agent    │
    └──────────┘          │  (BullMQ)  │       │  (Node.js) │
                          └────────────┘       └───────┬─────┘
                                                  │
                                          ┌───────▼────────┐
                                          │  VPN Node      │
                                          │  OpenVPN XOR   │
                                          └────────────────┘
```

## Features

- **Multi-node management** - Add and manage multiple VPN servers
- **Client lifecycle** - Create, revoke, and download .ovpn configs
- **Agent-based** - Secure polling communication (works behind NAT)
- **Audit logging** - Track all administrative actions
- **Job queue** - Background operations with retry logic
- **Stateless** - Multiple panel instances supported

## Tech Stack

- **Panel**: Next.js 15, TypeScript, Tailwind CSS
- **Database**: PostgreSQL + Prisma ORM
- **Queue**: Redis + BullMQ
- **Agent**: Node.js, Axios
- **VPN**: OpenVPN 2.7.3 with XOR patch

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development)
- VPN server(s) with Ubuntu 22.04/24.04

### Option A: Install from GitHub (Recommended for Production)

```bash
# Quick install with auto-configuration
curl -fsSL https://raw.githubusercontent.com/tunnect-spec/ovpn-admin/main/quick-install.sh | sudo bash

# Or with custom domain
curl -fsSL https://raw.githubusercontent.com/tunnect-spec/ovpn-admin/main/quick-install.sh | \
  sudo DOMAIN=vpn.example.com bash
```

This will:
- Install Docker & Docker Compose
- Generate secure secrets
- Set up PostgreSQL + Redis
- Build and start all services
- Create admin user with generated password

### Option B: Manual Installation

#### 1. Clone & Setup

```bash
git clone https://github.com/tunnect-spec/ovpn-admin.git
cd ovpn-admin
cp .env.example .env
# Edit .env with your settings
```

### 2. Start Services

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on port 5432
- Redis on port 6379
- Panel on http://localhost:3000
- Background worker

### 3. Create Admin User

```bash
docker exec -it ovpn-admin-panel npx prisma db push
docker exec -it ovpn-admin-panel node -e "
  const { hashPassword } = require('./dist/lib/crypto.js');
  const { prisma } = require('./dist/lib/prisma.js');
  (async () => {
    const admin = await prisma.admin.create({
      data: {
        email: 'admin@example.com',
        passwordHash: await hashPassword('your-password'),
        role: 'SUPERADMIN',
      },
    });
    console.log('Admin created:', admin.email);
  })().catch(console.error);
"
```

### 4. Add Your First Node

1. Login at http://localhost:3000/login
2. Go to Nodes → Add Node
3. Enter name and host
4. Copy the install command
5. Run on your VPN server (as root):
   ```bash
   curl -fsSL https://panel.example.com/install-agent.sh | \
   AGENT_TOKEN=<token> PANEL_URL=https://panel.example.com bash
   ```
6. Wait for node status to become HEALTHY

### 5. Install OpenVPN (Optional)

If the node doesn't have OpenVPN XOR installed yet:

1. Go to Node Details → Install OpenVPN
2. Enter server host (domain or IP)
3. Wait for job completion
4. First client will be created automatically

## Project Structure

```
ovpn-admin/
├── apps/
│   ├── panel/          # Next.js admin UI
│   ├── agent/          # Node agent (Node.js service)
│   └── worker/         # BullMQ background worker
├── packages/
│   ├── api/            # Zod validators
│   ├── db/             # Prisma schema & client
│   └── types/          # Shared TypeScript types
├── docker/
│   └── compose.yml     # Docker services
└── prisma/
    └── schema.prisma   # Database schema
```

## API Endpoints

### Panel API
- `POST /api/auth/login` - Admin login
- `GET /api/nodes` - List nodes
- `POST /api/nodes` - Create node
- `GET /api/nodes/:id` - Node details
- `POST /api/nodes/:id/install` - Install OpenVPN
- `GET /api/nodes/:nodeId/clients` - List clients
- `POST /api/nodes/:nodeId/clients` - Create client
- `DELETE /api/clients/:id` - Revoke client
- `GET /api/clients/:id/download` - Download .ovpn
- `GET /api/jobs` - List jobs
- `GET /api/audit-logs` - Audit history

### Agent API
- `POST /api/agent/register` - Node registration
- `POST /api/agent/heartbeat` - Health check
- `POST /api/agent/create-client` - Create VPN client
- `POST /api/agent/revoke-client` - Revoke VPN client

## Configuration

Environment variables (see `.env.example`):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | JWT signing secret |
| `ENCRYPTION_KEY` | API token encryption (32 bytes hex) |
| `NEXT_PUBLIC_APP_URL` | Panel base URL |

## Security Notes

- All agent communication uses HTTPS + token auth
- API tokens are encrypted at rest (AES-256-GCM)
- Registration tokens are one-time, expire in 24h
- All admin actions are logged
- Agent runs with whitelisted commands only

## License

MIT
