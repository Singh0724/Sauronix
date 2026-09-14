#!/usr/bin/env bash
# ==============================================================================
# Autonomous AI Enterprise Studio v5.0 — Oracle Cloud Always Free Setup Script
# Target: Ubuntu 22.04 / 24.04 LTS on Ampere A1 (ARM64, 4 OCPU, 24 GB RAM)
# ==============================================================================

set -euo pipefail

echo "======================================================================"
echo "Starting Autonomous AI Enterprise Studio VPS Provisioning..."
echo "Target: Oracle Cloud Always Free 24 GB RAM VM"
echo "======================================================================"

# 1. Update and install base dependencies
echo "[1/6] Updating APT repositories & installing base utilities..."
sudo apt-get update -y
sudo apt-get install -y curl wget git ufw apt-transport-https ca-certificates gnupg lsb-release

# 2. Install Node.js 24 LTS
echo "[2/6] Installing Node.js 24 LTS..."
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install Docker & Docker Compose
echo "[3/6] Installing Docker Engine & Docker Compose Plugin..."
if ! command -v docker &> /dev/null; then
  sudo mkdir -p /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker "$USER"
fi

# 4. Configure local firewall (Keep safe; Cloudflare Tunnel needs NO open ports)
echo "[4/6] Configuring local UFW firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
# Allow local port 3000 for localhost testing
sudo ufw allow 3000/tcp
sudo ufw --force enable

# 5. Install Cloudflare Tunnel (cloudflared)
echo "[5/6] Installing official Cloudflare Tunnel daemon (cloudflared)..."
ARCH=$(dpkg --print-architecture)
if [ "$ARCH" = "arm64" ]; then
  CLOUDFLARED_DEB="cloudflared-linux-arm64.deb"
else
  CLOUDFLARED_DEB="cloudflared-linux-amd64.deb"
fi

wget -q "https://github.com/cloudflare/cloudflared/releases/latest/download/${CLOUDFLARED_DEB}" -O /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
rm /tmp/cloudflared.deb

# 6. Verify installation
echo "[6/6] Verifying toolchain..."
echo "Node.js version: $(node -v)"
echo "NPM version:     $(npm -v)"
echo "Docker version:  $(docker --version)"
echo "Cloudflared:     $(cloudflared --version)"

echo "======================================================================"
echo "Provisioning complete! Your Oracle Cloud VM is ready."
echo ""
echo "Next Steps:"
echo "1. Run your studio server: npm run cctv"
echo "2. Connect Cloudflare Tunnel (Free, zero port forwarding, automatic HTTPS):"
echo "   cloudflared tunnel --url http://localhost:3000"
echo "   (This outputs your free public https://*.trycloudflare.com link!)"
echo "======================================================================"
