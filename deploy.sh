#!/bin/bash
# =============================================================================
# OpenVPN Admin Panel - Deployment Script
# Version: 3.1.0
# =============================================================================

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          OpenVPN Admin Panel - Deployment                  ║${NC}"
echo -e "${CYAN}║                      v3.1.0                                 ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "apps/panel" ]; then
    echo -e "${YELLOW}Error: Please run this script from the project root${NC}"
    exit 1
fi

echo -e "${CYAN}[Step 1/4]${NC} Pulling latest changes..."
git pull origin main

echo -e "${CYAN}[Step 2/4]${NC} Installing dependencies..."
pnpm install

echo -e "${CYAN}[Step 3/4]${NC} Building panel..."
pnpm build:panel

echo -e "${CYAN}[Step 4/4]${NC} Restarting panel service..."
if command -v pm2 &> /dev/null; then
    pm2 restart ovpn-panel 2>/dev/null || pm2 start 'pnpm start:panel' --name ovpn-panel
    echo -e "${GREEN}✓ Panel restarted with PM2${NC}"
else
    echo -e "${YELLOW}PM2 not found. Please restart manually.${NC}"
fi

echo ""
echo -e "${GREEN}✓ Deployment complete!${NC}"
echo ""
echo -e "Panel URL: ${GREEN}https://therockybalbo.xyz${NC}"
echo ""
