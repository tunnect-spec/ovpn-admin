#!/bin/bash
# =============================================================================
# OpenVPN Admin Panel - Production Install Script
# This script will install and configure the complete application
# Supported: Ubuntu 22.04/24.04, Debian 11+
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/ovpn-admin"
REPO_URL="${REPO_URL:-https://github.com/your-repo/ovpn-admin.git}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-localhost}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@$(hostname -f)}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 16 | tr -d "=+/:")}"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root"
        log_info "Use: sudo bash $0"
        exit 1
    fi
}

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
    else
        log_error "Cannot detect OS"
        exit 1
    fi
    log_info "Detected OS: $OS $OS_VERSION"
}

check_requirements() {
    log_info "Checking requirements..."

    # Check RAM
    RAM_GB=$(free -g | awk '/^Mem:/{print $2}')
    if [ "$RAM_GB" -lt 2 ]; then
        log_warn "Less than 2GB RAM available. Recommended: 2GB+"
    fi

    # Check disk space
    DISK_GB=$(df -BG / | tail -1 | awk '{print $4}' | tr -d 'G')
    if [ "$DISK_GB" -lt 10 ]; then
        log_error "Less than 10GB disk space available"
        exit 1
    fi

    log_success "Requirements check passed"
}

install_docker() {
    if command -v docker &> /dev/null; then
        log_success "Docker already installed: $(docker --version)"
    else
        log_info "Installing Docker..."

        if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
            # Update packages
            apt-get update -qq

            # Install prerequisites
            apt-get install -y \
                ca-certificates \
                curl \
                gnupg \
                lsb-release

            # Add Docker's official GPG key
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/$OS/gpg | \
                gpg --dearmor -o /etc/apt/keyrings/docker.gpg

            # Set up repository
            echo \
                "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
                https://download.docker.com/linux/$OS \
                $(lsb_release -cs) stable" | \
                tee /etc/apt/sources.list.d/docker.list > /dev/null

            # Install Docker
            apt-get update -qq
            apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

            log_success "Docker installed: $(docker --version)"
        else
            log_error "Unsupported OS for Docker installation"
            exit 1
        fi
    fi

    # Start Docker
    systemctl start docker
    systemctl enable docker

    # Check docker-compose
    if docker compose version &> /dev/null; then
        log_success "Docker Compose available: $(docker compose version)"
    else
        log_error "Docker Compose not available"
        exit 1
    fi
}

generate_secrets() {
    log_info "Generating secure secrets..."

    JWT_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | head -c 32)
    ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d "=+/" | head -c 32)
    PASSWORD_SALT=$(openssl rand -hex 16)
    API_TOKEN_SALT=$(openssl rand -hex 16)

    log_success "Secrets generated"
}

create_directory() {
    log_info "Creating installation directory..."

    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"

    log_success "Working directory: $INSTALL_DIR"
}

clone_repository() {
    log_info "Getting application files..."

    # If repository URL is provided, clone it
    if [ "$REPO_URL" != "https://github.com/your-repo/ovpn-admin.git" ]; then
        if [ -d "$INSTALL_DIR/.git" ]; then
            log_info "Repository exists, pulling latest..."
            git fetch origin
            git reset --hard origin/$BRANCH
        else
            git clone -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
        fi
    else
        # For development/testing - copy from local or use provided archive
        log_warn "Using local files (REPO_URL not set)"

        # Create basic structure if not exists
        mkdir -p apps/panel apps/worker apps/agent packages/db packages/types
    fi

    log_success "Application files ready"
}

create_env_file() {
    log_info "Creating environment configuration..."

    cat > "$INSTALL_DIR/.env" << EOF
# Database
DATABASE_URL="postgresql://ovpn:$(openssl rand -base64 16 | tr -d "=+")@localhost:5432/ovpn_admin"

# Redis
REDIS_URL="redis://localhost:6379"

# Security (auto-generated)
JWT_SECRET="$JWT_SECRET"
ENCRYPTION_KEY="$ENCRYPTION_KEY"
PASSWORD_SALT="$PASSWORD_SALT"
API_TOKEN_SALT="$API_TOKEN_SALT"

# Application
NEXT_PUBLIC_APP_URL="https://$DOMAIN"
PANEL_URL="https://$DOMAIN"
NODE_ENV="production"

# Agent
AGENT_HEARTBEAT_INTERVAL="30"
AGENT_HEARTBEAT_TIMEOUT="5"
EOF

    # Generate Docker Compose env file
    cat > "$INSTALL_DIR/docker/.env" << EOF
# PostgreSQL
POSTGRES_USER=ovpn
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d "=+")
POSTGRES_DB=ovpn_admin

# Application
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
NEXT_PUBLIC_APP_URL=https://$DOMAIN
NODE_ENV=production
EOF

    log_success "Environment files created"
}

setup_docker_compose() {
    log_info "Setting up Docker Compose configuration..."

    cat > "$INSTALL_DIR/docker-compose.yml" << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: ovpn-admin-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-ovpn}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:-ovpn_admin}
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
    command: redis-server --appendonly yes
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
      DATABASE_URL: postgresql://${POSTGRES_USER:-ovpn}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-ovpn_admin}
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      PASSWORD_SALT: ${PASSWORD_SALT}
      API_TOKEN_SALT: ${API_TOKEN_SALT}
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
      DATABASE_URL: postgresql://${POSTGRES_USER:-ovpn}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-ovpn_admin}
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
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

    log_success "Docker Compose configuration created"
}

build_images() {
    log_info "Building Docker images (this may take a few minutes)..."

    # Check if Dockerfile exists, if not create minimal ones
    if [ ! -f "$INSTALL_DIR/Dockerfile.panel" ]; then
        log_warn "Creating Dockerfiles..."
        create_dockerfiles
    fi

    # Build panel
    log_info "Building panel image..."
    docker build -f "$INSTALL_DIR/Dockerfile.panel" -t ovpn-admin-panel:latest "$INSTALL_DIR" || {
        log_error "Panel build failed"
        return 1
    }

    # Build worker
    log_info "Building worker image..."
    docker build -f "$INSTALL_DIR/Dockerfile.worker" -t ovpn-admin-worker:latest "$INSTALL_DIR" || {
        log_error "Worker build failed"
        return 1
    }

    log_success "Docker images built successfully"
}

create_dockerfiles() {
    # Panel Dockerfile
    cat > "$INSTALL_DIR/Dockerfile.panel" << 'EOF'
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm@latest
RUN pnpm install
COPY . .
RUN pnpm --filter @ovpn/panel build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm@latest
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-lock.yaml
RUN pnpm install --prod
COPY --from=builder /app/apps/panel/dist ./apps/panel/dist
COPY --from=builder /app/apps/panel/package.json ./apps/panel/
COPY --from=builder /app/apps/panel/node_modules ./apps/panel/node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "apps/panel/dist/server.js"]
EOF

    # Worker Dockerfile
    cat > "$INSTALL_DIR/Dockerfile.worker" << 'EOF'
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm@latest
RUN pnpm install
COPY . .
RUN pnpm --filter @ovpn/worker build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm@latest
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-lock.yaml
RUN pnpm install --prod
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]
EOF
}

start_services() {
    log_info "Starting services..."

    cd "$INSTALL_DIR"

    # Stop any existing containers
    docker compose down 2>/dev/null || true

    # Start services
    docker compose up -d

    # Wait for services to be healthy
    log_info "Waiting for services to be ready..."
    local max_attempts=60
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if docker compose ps | grep -q "healthy"; then
            log_success "Services are ready!"
            break
        fi
        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done
    echo ""

    # Show status
    docker compose ps
}

create_admin_user() {
    log_info "Creating admin user..."

    # Wait for panel to be ready
    sleep 5

    # Generate password hash and create admin
    docker exec ovpn-admin-panel node -e "
      const bcrypt = require('bcryptjs');
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();

      async function createAdmin() {
        // bcrypt — MUST match the login route's bcrypt.compare(). A SHA-256
        // hash here would make the admin unable to log in.
        const passwordHash = bcrypt.hashSync('${ADMIN_PASSWORD}', 12);

        // Check if admin exists
        const existing = await prisma.admin.findUnique({
          where: { email: '${ADMIN_EMAIL}' }
        });

        if (existing) {
          console.log('Admin already exists, updating password...');
          await prisma.admin.update({
            where: { email: '${ADMIN_EMAIL}' },
            data: { passwordHash, role: 'SUPERADMIN' }
          });
        } else {
          await prisma.admin.create({
            data: {
              email: '${ADMIN_EMAIL}',
              passwordHash,
              role: 'SUPERADMIN'
            }
          });
        }

        console.log('Admin user created successfully!');
        await prisma.\$disconnect();
      }

      createAdmin().catch(console.error);
    " || {
        # No SQL fallback: Postgres cannot produce a bcrypt hash, and a SHA-256
        # row would lock the admin out. Fail loudly with a recovery command.
        log_error "Admin creation failed. Re-run after the panel is healthy:"
        log_error "  docker exec ovpn-admin-panel sh -c 'SEED_ADMIN_EMAIL=${ADMIN_EMAIL} SEED_ADMIN_PASSWORD=${ADMIN_PASSWORD} node_modules/.bin/tsx prisma/seed.ts'"
    }

    log_success "Admin user created/updated"
}

setup_firewall() {
    log_info "Configuring firewall..."

    if command -v ufw &> /dev/null; then
        ufw allow 22/tcp    # SSH
        ufw allow 80/tcp    # HTTP
        ufw allow 443/tcp   # HTTPS
        ufw allow 3000/tcp  # Panel (optional if behind reverse proxy)

        # Enable ufw if not already enabled
        ufw --force enable

        log_success "Firewall configured"
    else
        log_warn "ufw not found, skipping firewall configuration"
    fi
}

create_systemd_service() {
    log_info "Creating systemd service for auto-start..."

    cat > /etc/systemd/system/ovpn-admin.service << EOF
[Unit]
Description=OpenVPN Admin Panel
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable ovpn-admin.service

    log_success "Systemd service created"
}

print_success_message() {
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo -e "${GREEN}🎉 INSTALLATION COMPLETED SUCCESSFULLY!${NC}"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo -e "${BLUE}Access Details:${NC}"
    echo -e "  Panel URL:  ${GREEN}https://$DOMAIN${NC}"
    echo -e "  Login:      ${GREEN}$ADMIN_EMAIL${NC}"
    echo -e "  Password:   ${YELLOW}$ADMIN_PASSWORD${NC}"
    echo ""
    echo -e "${BLUE}⚠️  IMPORTANT:${NC}"
    echo "  1. Save these credentials securely!"
    echo "  2. Configure reverse proxy (nginx) for HTTPS"
    echo "  3. Change the admin password after first login"
    echo ""
    echo -e "${BLUE}Management Commands:${NC}"
    echo "  View logs:     docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
    echo "  Restart:      systemctl restart ovpn-admin"
    echo "  Stop:          systemctl stop ovpn-admin"
    echo "  Update:        cd $INSTALL_DIR && git pull && docker compose build && docker compose up -d"
    echo ""
    echo -e "${BLUE}Adding VPN Nodes:${NC}"
    echo "  1. Login to the panel"
    echo "  2. Go to Nodes → Add Node"
    echo "  3. Enter your VPN server details"
    echo "  4. Copy the install command"
    echo "  5. Run it on your VPN server"
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Save credentials to file
    cat > "$INSTALL_DIR/credentials.txt" << EOF
OpenVPN Admin Panel - Installation Details
===========================================

Panel URL: https://$DOMAIN
Login: $ADMIN_EMAIL
Password: $ADMIN_PASSWORD

Installation Date: $(date)
Installation Directory: $INSTALL_DIR

IMPORTANT: Save this file securely!
EOF

    chmod 600 "$INSTALL_DIR/credentials.txt"
    log_info "Credentials saved to: $INSTALL_DIR/credentials.txt"
}

# =============================================================================
# MAIN INSTALLATION FLOW
# =============================================================================

main() {
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo -e "${BLUE}OpenVPN Admin Panel - Production Installation${NC}"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --domain)
                DOMAIN="$2"
                shift 2
                ;;
            --email)
                ADMIN_EMAIL="$2"
                shift 2
                ;;
            --password)
                ADMIN_PASSWORD="$2"
                shift 2
                ;;
            --dir)
                INSTALL_DIR="$2"
                shift 2
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    # Run installation steps
    check_root
    detect_os
    check_requirements
    install_docker
    generate_secrets
    create_directory
    clone_repository
    create_env_file
    setup_docker_compose
    build_images
    start_services
    create_admin_user
    setup_firewall
    create_systemd_service
    print_success_message

    log_success "Installation completed successfully!"
}

# Run main function
main "$@"
