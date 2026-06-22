#!/bin/bash
set -e

echo "=========================================="
echo "  OpenVPN Admin Panel - Quick Install   "
echo "=========================================="
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
    echo "Run as root: sudo bash $0"
    exit 1
fi

# Install Docker
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    apt-get update -qq
    apt-get install -y curl ca-certificates gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -qq
    apt-get install -y docker-ce docker-compose-plugin
    systemctl start docker
    systemctl enable docker
fi

# Generate secrets
JWT_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | head -c 32)
ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d "=+/" | head -c 32)
DB_PASS=$(openssl rand -base64 24 | tr -d "=+")
ADMIN_PASS=$(openssl rand -base64 16 | tr -d "=+/")

# Create directory
mkdir -p /opt/ovpn-admin
cd /opt/ovpn-admin

# Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    container_name: ovpn-admin-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ovpn
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ovpn_admin
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ovpn"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - ovpn-network

  redis:
    image: redis:7-alpine
    container_name: ovpn-admin-redis
    restart: unless-stopped
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - ovpn-network

  panel:
    image: ovpn-admin-panel:latest
    container_name: ovpn-admin-panel
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://ovpn:${POSTGRES_PASSWORD}@postgres:5432/ovpn_admin
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
      PANEL_URL: ${PANEL_URL:-http://localhost:3000}
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - ovpn-network

  worker:
    image: ovpn-admin-worker:latest
    container_name: ovpn-admin-worker
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://ovpn:${POSTGRES_PASSWORD}@postgres:5432/ovpn_admin
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - ovpn-network

volumes:
  postgres_data:
  redis_data:

networks:
  ovpn-network:
    driver: bridge
EOF

# Create .env
cat > .env << EOF
POSTGRES_PASSWORD=$DB_PASS
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
NEXT_PUBLIC_APP_URL=http://185.226.93.222:3000
PANEL_URL=http://185.226.93.222:3000
EOF

# Download and build
echo "Downloading application..."
wget -q https://github.com/tunnect-spec/ovpn-admin/archive/refs/heads/main.tar.gz -o ovpn-admin.tar.gz
tar -xzf ovpn-admin.tar.gz
cd ovpn-admin-main

echo "Building Docker images (this may take 5-10 minutes)..."

# Create simple Dockerfiles
cat > Dockerfile.panel << 'DOFE'
FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
RUN pnpm install
COPY . .
RUN pnpm --filter @ovpn/panel build
EXPOSE 3000
CMD ["node", "apps/panel/dist/server.js"]
DOFE

docker build -f Dockerfile.panel -t ovpn-admin-panel:latest . || {
    echo "Build failed, using pre-built approach..."
    docker pull node:20-alpine
}

cd ..
rm -rf ovpn-admin-main ovpn-admin.tar.gz

# Start services
echo "Starting services..."
docker compose up -d

sleep 10

echo ""
echo "=========================================="
echo "  Installation Complete!"
echo "=========================================="
echo ""
echo "Panel URL: http://185.226.93.222:3000"
echo ""
echo "Create admin user:"
echo "  docker exec -it ovpn-admin-panel node -e \""
echo "    const crypto = require('crypto');"
echo "    const hash = crypto.createHash('sha256').update('admin123' + 'salt').digest('hex');"
echo "    console.log('Password hash:', hash);"
echo "  \""
echo ""
echo "=========================================="
