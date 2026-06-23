#!/bin/bash
set -e

#############################################
#  OpenVPN Admin Panel - One-Line Install  #
#############################################

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Detect server IP
SERVER_IP=$(curl -s -4 ifconfig.me || curl -s -4 icanhazip.com || echo "localhost")

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  OpenVPN Admin Panel - Quick Install   ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Server IP: ${SERVER_IP}"
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Run as root: sudo bash $0${NC}"
   exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo -e "${RED}Cannot detect OS${NC}"
    exit 1
fi

# Install dependencies
echo -e "${YELLOW}[1/8] Installing dependencies...${NC}"

if [[ "$OS" == "ubuntu" || "$OS" == "debian" ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y curl git ca-certificates gnupg unzip ssl-cert
else
    yum install -y curl git unzip ca-certificates
fi

# Install Docker if not exists
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    if [[ "$OS" == "ubuntu" || "$OS" == "debian" ]]; then
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || \
        curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
            tee /etc/apt/sources.list.d/docker.list > /dev/null 2>/dev/null || \
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | \
            tee /etc/apt/sources.list.d/docker.list > /dev/null
        apt-get update -qq
        apt-get install -y docker-ce docker-compose-plugin
    else
        yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin || \
        curl -fsSL https://get.docker.com | sh
    fi
    systemctl start docker
    systemctl enable docker
fi

# Install Node.js 20 if not exists
if ! command -v node &> /dev/null || [ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 20 ]; then
    echo "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    if [[ "$OS" == "ubuntu" || "$OS" == "debian" ]]; then
        apt-get install -y nodejs
    else
        yum install -y nodejs npm
    fi
fi

# Install pnpm if not exists
if ! command -v pnpm &> /dev/null; then
    echo "Installing pnpm..."
    npm install -g pnpm
fi

echo -e "${GREEN}Dependencies installed!${NC}"

# Clone repository
echo -e "${YELLOW}[2/8] Cloning repository...${NC}"

REPO_DIR="/root/ovpn"
if [ -d "$REPO_DIR" ]; then
    echo "Directory exists, removing..."
    rm -rf "$REPO_DIR"
fi

git clone https://github.com/tunnect-spec/ovpn-admin.git "$REPO_DIR"
cd "$REPO_DIR"

echo -e "${GREEN}Repository cloned!${NC}"

# Generate secrets
echo -e "${YELLOW}[3/8] Generating secure secrets...${NC}"

DB_PASS=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
JWT_SECRET=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
PASSWORD_SALT=$(openssl rand -base64 16 | tr -d '/+=')
API_TOKEN_SALT=$(openssl rand -base64 16 | tr -d '/+=')

# Create .env file
cat > .env << EOF
# Database
DATABASE_URL="postgresql://ovpn:${DB_PASS}@localhost:5432/ovpn_admin"

# Redis
REDIS_URL="redis://localhost:6379"

# Security
JWT_SECRET="${JWT_SECRET}"
ENCRYPTION_KEY="${ENCRYPTION_KEY}"
PASSWORD_SALT="${PASSWORD_SALT}"
API_TOKEN_SALT="${API_TOKEN_SALT}"

# Application URLs
NEXT_PUBLIC_APP_URL="http://${SERVER_IP}:3000"
PANEL_URL="http://${SERVER_IP}:3000"

# Environment
NODE_ENV="production"

# Agent Configuration
AGENT_HEARTBEAT_INTERVAL="30"
AGENT_HEARTBEAT_TIMEOUT="5"
EOF

echo -e "${GREEN}Secrets generated!${NC}"

# Prompt for admin credentials
echo -e "${YELLOW}[4/7] Configuring admin account...${NC}"
echo ""

# Validate and get admin email
while true; do
  read -p "Enter admin email: " ADMIN_EMAIL < /dev/tty
  if [[ "$ADMIN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    break
  else
    echo -e "${RED}Invalid email format. Please try again.${NC}"
  fi
done

# Validate and get admin password
while true; do
  read -s -p "Enter admin password (min 8 characters): " ADMIN_PASSWORD < /dev/tty
  echo ""
  if [[ ${#ADMIN_PASSWORD} -ge 8 ]]; then
    read -s -p "Confirm admin password: " ADMIN_PASSWORD_CONFIRM < /dev/tty
    echo ""
    if [[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD_CONFIRM" ]]; then
      break
    else
      echo -e "${RED}Passwords do not match. Please try again.${NC}"
    fi
  else
    echo -e "${RED}Password must be at least 8 characters. Please try again.${NC}"
  fi
done

echo ""
echo -e "${GREEN}Admin account configured!${NC}"

# Start PostgreSQL and Redis
echo -e "${YELLOW}[4/7] Starting PostgreSQL and Redis...${NC}"

# Remove existing containers if any
docker rm -f ovpn-postgres ovpn-redis 2>/dev/null || true

# Start PostgreSQL
docker run -d --name ovpn-postgres \
    -e POSTGRES_USER=ovpn \
    -e POSTGRES_PASSWORD="${DB_PASS}" \
    -e POSTGRES_DB=ovpn_admin \
    -p 5432:5432 \
    --restart unless-stopped \
    postgres:16-alpine

# Start Redis
docker run -d --name ovpn-redis \
    -p 6379:6379 \
    --restart unless-stopped \
    redis:7-alpine

# Wait for databases to be ready
echo "Waiting for databases..."
sleep 15

until docker exec ovpn-postgres pg_isready -U ovpn &> /dev/null; do
    echo "Waiting for PostgreSQL..."
    sleep 2
done

until docker exec ovpn-redis redis-cli ping &> /dev/null; do
    echo "Waiting for Redis..."
    sleep 2
done

echo -e "${GREEN}Databases started!${NC}"

# Install dependencies
echo -e "${YELLOW}[6/8] Installing npm dependencies...${NC}"

cd "$REPO_DIR"
pnpm install --silent

echo -e "${GREEN}Dependencies installed!${NC}"

# Build packages and apps
echo -e "${YELLOW}[7/8] Building application...${NC}"

# Generate Prisma client
npx prisma generate

# Build packages
cd "$REPO_DIR/packages/types" && npm run build
cd "$REPO_DIR/packages/db" && npm run build

# Build apps
cd "$REPO_DIR"
pnpm run build:panel || pnpm run build:panel
pnpm run build:worker

echo -e "${GREEN}Application built!${NC}"

# Setup database
echo -e "${YELLOW}[8/8] Setting up database...${NC}"

cd "$REPO_DIR"
npx prisma db push --skip-generate

# Create admin user with provided credentials
cat > prisma/seed.ts << SEED_EOF
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const password = '${ADMIN_PASSWORD}';
  // MUST be bcrypt — the login route verifies with bcrypt.compare(). A SHA-256
  // hash here would lock the admin out entirely.
  const hash = await bcrypt.hash(password, 12);

  const admin = await prisma.admin.upsert({
    where: { email: '${ADMIN_EMAIL}' },
    update: {},
    create: {
      email: '${ADMIN_EMAIL}',
      passwordHash: hash,
      role: 'SUPERADMIN',
    },
  });

  console.log('Created admin: ${ADMIN_EMAIL}');
  console.log('IMPORTANT: Change password after first login!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.\$disconnect();
  });
SEED_EOF

pnpm run db:seed

echo -e "${GREEN}Database setup complete!${NC}"

# Create systemd services
echo "Creating systemd services..."

# Panel service
cat > /etc/systemd/system/ovpn-panel.service << EOF
[Unit]
Description=OpenVPN Admin Panel
After=network.target docker.service

[Service]
Type=simple
User=root
WorkingDirectory=${REPO_DIR}/apps/panel
Environment=NODE_ENV=production
EnvironmentFile=${REPO_DIR}/.env
ExecStart=/usr/bin/node ${REPO_DIR}/apps/panel/node_modules/next/dist/bin/next start -p 3000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Worker service
cat > /etc/systemd/system/ovpn-worker.service << EOF
[Unit]
Description=OpenVPN Admin Worker
After=network.target docker.service ovpn-panel.service

[Service]
Type=simple
User=root
WorkingDirectory=${REPO_DIR}/apps/worker
Environment=NODE_ENV=production
EnvironmentFile=${REPO_DIR}/.env
ExecStart=${REPO_DIR}/node_modules/.bin/tsx src/index.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Start services
systemctl daemon-reload
systemctl enable ovpn-panel ovpn-worker
systemctl restart ovpn-panel
systemctl restart ovpn-worker

sleep 5

# Final status
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Installation Complete!              ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}🎉 OpenVPN Admin Panel is running!${NC}"
echo ""
echo "Panel URL: ${GREEN}http://${SERVER_IP}:3000${NC}"
echo ""
echo "Admin Login:"
echo "  Email: ${YELLOW}${ADMIN_EMAIL}${NC}"
echo "  Password: ${YELLOW}(the password you entered)${NC}"
echo ""
echo -e "${RED}⚠️  CHANGE PASSWORD AFTER FIRST LOGIN!${NC}"
echo ""
echo "Commands:"
echo "  View logs:    journalctl -u ovpn-panel -f"
echo "  Restart:      systemctl restart ovpn-panel"
echo "  Stop:         systemctl stop ovpn-panel ovpn-worker"
echo ""
echo -e "${GREEN}========================================${NC}"
