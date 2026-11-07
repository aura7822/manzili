#!/usr/bin/env bash
set -e

echo "=== 1. Checking Local PostgreSQL Service ==="

install_and_start_postgres() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    case "$ID" in
      ubuntu|debian)
        echo "Detected $ID. Installing PostgreSQL via apt..."
        sudo apt update && sudo apt install -y postgresql postgresql-contrib
        sudo systemctl enable --now postgresql
        ;;
      arch)
        echo "Detected Arch Linux. Installing PostgreSQL via pacman..."
        sudo pacman -Sy --noconfirm postgresql
        if [ ! -d "/var/lib/postgres/data/base" ]; then
          echo "Initializing PostgreSQL data directory..."
          sudo -u postgres initdb -D /var/lib/postgres/data
        fi
        sudo systemctl enable --now postgresql
        ;;
      fedora|rhel|centos)
        echo "Detected $ID. Installing PostgreSQL via dnf..."
        sudo dnf install -y postgresql-server postgresql-contrib
        sudo postgresql-setup --initdb || true
        sudo systemctl enable --now postgresql
        ;;
      alpine)
        echo "Detected Alpine Linux. Installing PostgreSQL via apk..."
        sudo apk add postgresql postgresql-contrib
        sudo /etc/init.d/postgresql start
        ;;
      *)
        echo "Unsupported Linux distro: $ID. Please install PostgreSQL manually."
        exit 1
        ;;
    esac
  else
    echo "Unable to determine Linux distribution."
    exit 1
  fi
}

if ! command -v psql &> /dev/null; then
  echo "PostgreSQL CLI (psql) is not installed."
  install_and_start_postgres
else
  echo "PostgreSQL binary detected."
  if command -v systemctl &> /dev/null; then
    if ! systemctl is-active --quiet postgresql; then
      echo "PostgreSQL service is stopped. Starting service..."
      sudo systemctl start postgresql
    else
      echo "PostgreSQL service is running."
    fi
  fi
fi

echo -e "\n=== 2. Running Neon Init & Link ==="
npx neon@latest init -y \
  --org-id org-lucky-darkness-43020680 \
  --project-id cold-hall-89784657 \
  --branch production \
  --services postgres

echo -e "\n=== 3. Deploying Policy to Neon ==="
npx neon@latest deploy

echo -e "\n=== 4. Running Database Migrations ==="
pnpm run migrate

echo -e "\n✅ Neon deployment and database migration complete!"