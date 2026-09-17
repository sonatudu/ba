#!/usr/bin/env bash
# Bootstrap one Oracle Always Free VM as a lasting host for Ba and later apps.
# Run on the VM as ubuntu (with sudo).
set -euo pipefail

APP_USER="${APP_USER:-ba}"
APPS_ROOT="${APPS_ROOT:-/opt/apps}"
DATA_ROOT="${DATA_ROOT:-/var/data}"

sudo apt-get update
sudo apt-get install -y ca-certificates curl git ufw

# Node 20
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Caddy for HTTPS (add site blocks under /etc/caddy/apps later)
if ! command -v caddy >/dev/null 2>&1; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update
  sudo apt-get install -y caddy
fi

sudo mkdir -p "$APPS_ROOT" "$DATA_ROOT/ba"
id -u "$APP_USER" >/dev/null 2>&1 || sudo useradd --system --home "$APPS_ROOT" --shell /usr/sbin/nologin "$APP_USER"
sudo chown -R "$APP_USER:$APP_USER" "$APPS_ROOT" "$DATA_ROOT"

sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
echo "y" | sudo ufw enable || true

echo
echo "Host layout ready:"
echo "  apps: $APPS_ROOT/<app-name>"
echo "  data: $DATA_ROOT/<app-name>"
echo "  node $(node -v)"
echo "Next: clone Ba into $APPS_ROOT/ba and install the systemd unit."
