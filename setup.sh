#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="remnawave-vpn-bot"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"

if [[ "${EUID}" -ne 0 ]]; then
  SUDO="sudo"
else
  SUDO=""
fi

COMPOSE_CMD=""
DOCKER_CMD="docker"

log() {
  printf "\n[%s] %s\n" "$APP_NAME" "$*"
}

warn() {
  printf "\n[%s][WARN] %s\n" "$APP_NAME" "$*"
}

die() {
  printf "\n[%s][ERROR] %s\n" "$APP_NAME" "$*" >&2
  exit 1
}

run_compose() {
  if [[ -z "$COMPOSE_CMD" ]]; then
    detect_compose
  fi

  (cd "$PROJECT_DIR" && eval "$COMPOSE_CMD" "$@")
}

detect_compose() {
  # Prefer modern 'docker compose' (v2 plugin)
  if docker compose version >/dev/null 2>&1; then
    DOCKER_CMD="docker"
    COMPOSE_CMD="$DOCKER_CMD compose"
    return
  fi

  if [[ -n "$SUDO" ]] && $SUDO docker compose version >/dev/null 2>&1; then
    DOCKER_CMD="$SUDO docker"
    COMPOSE_CMD="$DOCKER_CMD compose"
    return
  fi

  # Fallback to legacy (but we try to avoid it)
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
    warn "Using legacy docker-compose v1 – consider upgrading to v2 plugin for compatibility."
    return
  fi

  if [[ -n "$SUDO" ]] && command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="$SUDO docker-compose"
    warn "Using legacy docker-compose v1 – consider upgrading to v2 plugin for compatibility."
    return
  fi

  die "Docker Compose not found. Please install docker-compose-plugin."
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Command not found: $1"
}

install_docker_if_needed() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker and Compose v2 already installed."
    detect_compose
    return
  fi

  command -v apt-get >/dev/null 2>&1 || die "This installer currently supports Ubuntu/Debian with apt-get."

  log "Installing latest Docker Engine and Compose v2 plugin from official repo..."

  # Uninstall any old/conflicting packages
  $SUDO apt-get remove -y docker docker-engine docker.io containerd runc podman-docker docker-compose docker-compose-v2 || true

  # Install dependencies
  $SUDO apt-get update -y
  $SUDO apt-get install -y ca-certificates curl gnupg lsb-release

  # Add Docker's official GPG key
  $SUDO mkdir -p /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

  # Add Docker repo
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | \
    $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null

  # Update and install
  $SUDO apt-get update -y
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  # Enable and start Docker
  $SUDO systemctl enable docker
  $SUDO systemctl start docker

  # Add current user to docker group (non-root access)
  if [[ -n "${SUDO_USER:-}" ]]; then
    $SUDO usermod -aG docker "$SUDO_USER" || true
    warn "User $SUDO_USER added to docker group. Log out and back in (or 'newgrp docker') for non-sudo docker commands."
  elif [[ -n "${USER:-}" ]]; then
    $SUDO usermod -aG docker "$USER" || true
    warn "User $USER added to docker group. Log out and back in for non-sudo docker."
  fi

  detect_compose
  log "Docker and Compose v2 installation complete."
}

upsert_env() {
  local key="$1"
  local value="$2"
  local file="$PROJECT_DIR/.env"
  local tmp
  tmp="$(mktemp)"

  awk -v k="$key" -v v="$value" '
    BEGIN { updated = 0 }
    index($0, k "=") == 1 { print k "=" v; updated = 1; next }
    { print }
    END { if (updated == 0) print k "=" v }
  ' "$file" >"$tmp"

  mv "$tmp" "$file"
}

read_env_value() {
  local key="$1"
  local file="$PROJECT_DIR/.env"
  grep -E "^${key}=" "$file" | tail -n1 | cut -d '=' -f2- || true
}

ensure_env_exists() {
  [[ -f "$PROJECT_DIR/.env" ]] || die ".env file not found. Run Install/Setup first."
}

prompt_var() {
  local key="$1"
  local prompt="$2"
  local default_value="${3:-}"
  local secret="${4:-false}"
  local current

  current="$(read_env_value "$key")"
  if [[ -n "$current" ]]; then
    default_value="$current"
  fi

  local user_input=""
  if [[ "$secret" == "true" ]]; then
    read -r -s -p "$prompt [hidden]: " user_input
    printf "\n"
  else
    if [[ -n "$default_value" ]]; then
      read -r -p "$prompt [$default_value]: " user_input
      user_input="${user_input:-$default_value}"
    else
      read -r -p "$prompt: " user_input
    fi
  fi

  user_input="${user_input:-$default_value}"
  if [[ -z "$user_input" ]]; then
    die "Value required for $key"
  fi

  upsert_env "$key" "$user_input"
}

ensure_env_file() {
  local env_file="$PROJECT_DIR/.env"

  if [[ ! -f "$env_file" ]]; then
    log "Creating .env from .env.example"
    cp "$PROJECT_DIR/.env.example" "$env_file"
  fi

  prompt_var "APP_URL" "Public HTTPS domain for webhook (without trailing slash, e.g. https://bot.example.com)"
  prompt_var "WEBHOOK_PATH" "Telegram webhook path" "/telegram/webhook"
  prompt_var "BOT_TOKEN" "Telegram BOT_TOKEN" "" true
  prompt_var "BOT_USERNAME" "Telegram bot username (without @)"
  prompt_var "ADMIN_TG_IDS" "Admin Telegram IDs (comma separated)"
  prompt_var "ADMIN_TG_HANDLE" "Support/admin Telegram handle (with @ preferred)"

  prompt_var "POSTGRES_DB" "Postgres DB name" "vpn_bot"
  prompt_var "POSTGRES_USER" "Postgres username" "vpn_bot"
  prompt_var "POSTGRES_PASSWORD" "Postgres password" "vpn_bot_password" true
  prompt_var "POSTGRES_PORT" "Postgres port exposed on host" "5432"

  local pg_db pg_user pg_pass
  pg_db="$(read_env_value POSTGRES_DB)"
  pg_user="$(read_env_value POSTGRES_USER)"
  pg_pass="$(read_env_value POSTGRES_PASSWORD)"

  upsert_env "DATABASE_URL" "postgresql://${pg_user}:${pg_pass}@db:5432/${pg_db}?schema=public"
  prompt_var "RUN_SEED" "Run seed at container start? (true/false)" "false"

  prompt_var "REMNAWAVE_URL" "RemnaWave panel URL (e.g. https://panel.example.com)"
  prompt_var "REMNAWAVE_TOKEN" "RemnaWave API token" "" true

  prompt_var "TETRA98_API_KEY" "Tetra98 API key" "" true
  prompt_var "MANUAL_CARD_NUMBER" "Manual card number"

  prompt_var "MIN_WALLET_CHARGE_TOMANS" "Min wallet charge (Tomans)" "10000"
  prompt_var "MAX_WALLET_CHARGE_TOMANS" "Max wallet charge (Tomans)" "10000000"

  prompt_var "PORT" "Container app port" "3000"
  prompt_var "APP_PORT" "Host app port mapping" "3000"

  chmod 700 "$env_file"
  log ".env secured with chmod 700"
}

show_nginx_hint() {
  ensure_env_exists
  local app_url host
  app_url="$(read_env_value APP_URL)"
  host="${app_url#https://}"
  host="${host#http://}"

  cat <<NGINX

Important: Telegram webhooks REQUIRE valid HTTPS!

Nginx reverse proxy example (with HTTPS via Certbot/Let's Encrypt):

sudo apt install nginx certbot python3-certbot-nginx -y

Create /etc/nginx/sites-available/bot:
server {
    listen 80;
    listen [::]:80;
    server_name ${host};

    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${host};

    ssl_certificate /etc/letsencrypt/live/${host}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${host}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:$(read_env_value APP_PORT);
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

Then: sudo ln -s /etc/nginx/sites-available/bot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

Obtain cert: sudo certbot --nginx -d ${host}

Webhook URL to set in BotFather: ${app_url}$(read_env_value WEBHOOK_PATH)

NGINX
}

install_setup() {
  install_docker_if_needed
  require_cmd git
  require_cmd awk

  ensure_env_file

  log "Building and starting containers"
  run_compose up -d --build

  log "Waiting for DB to become healthy"
  sleep 10  # Increased slightly for reliability

  log "Running Prisma generate"
  run_compose exec -T app pnpm prisma generate

  log "Applying Prisma migrations"
  run_compose exec -T app pnpm prisma migrate deploy

  if [[ "$(read_env_value RUN_SEED)" == "true" ]]; then
    log "Running seed"
    run_compose exec -T app pnpm db:seed
  fi

  show_nginx_hint
  log "Install/Setup completed. If using non-root, run 'newgrp docker' or relogin."
}

start_restart() {
  detect_compose
  log "Starting/restarting services"
  run_compose up -d --build
}

stop_services() {
  detect_compose
  log "Stopping services"
  run_compose stop
}

update_project() {
  detect_compose
  require_cmd git

  log "Pulling latest code"
  (cd "$PROJECT_DIR" && git pull --rebase --autostash)

  log "Rebuilding and restarting"
  run_compose up -d --build

  log "Applying migrations"
  run_compose exec -T app pnpm prisma migrate deploy
}

show_logs() {
  detect_compose
  read -r -p "Service name (app/db, default app): " service
  service="${service:-app}"

  if [[ "$service" != "app" && "$service" != "db" ]]; then
    die "Invalid service. Use app or db."
  fi

  run_compose logs -f --tail=200 "$service"
}

backup_db() {
  detect_compose
  ensure_env_exists
  mkdir -p "$BACKUP_DIR"

  local pg_user pg_db ts out_file
  pg_user="$(read_env_value POSTGRES_USER)"
  pg_db="$(read_env_value POSTGRES_DB)"
  ts="$(date +%Y%m%d_%H%M%S)"
  out_file="$BACKUP_DIR/db_${ts}.sql"

  log "Creating database backup: $out_file"
  run_compose exec -T db pg_dump -U "$pg_user" -d "$pg_db" >"$out_file"
  log "Backup completed"
}

restore_db() {
  detect_compose
  ensure_env_exists
  local file pg_user pg_db

  read -r -p "Enter full path to SQL backup file: " file
  [[ -f "$file" ]] || die "File not found: $file"

  pg_user="$(read_env_value POSTGRES_USER)"
  pg_db="$(read_env_value POSTGRES_DB)"

  warn "This will overwrite data in database '$pg_db'."
  read -r -p "Type YES to continue: " confirm
  [[ "$confirm" == "YES" ]] || {
    warn "Restore canceled."
    return
  }

  log "Restoring backup from $file"
  cat "$file" | run_compose exec -T db psql -U "$pg_user" -d "$pg_db"
  log "Restore completed"
}

uninstall_stack() {
  detect_compose
  warn "This will stop and remove containers, networks, and volumes."
  read -r -p "Type DELETE to continue: " confirm
  [[ "$confirm" == "DELETE" ]] || {
    warn "Uninstall canceled."
    return
  }

  run_compose down -v --remove-orphans
  log "Stack removed"
}

print_menu() {
  cat <<'MENU'

==============================
 Telegram VPN Bot - Operations
==============================
1) Install / Setup
2) Start / Restart
3) Stop
4) Update (git pull + rebuild)
5) Logs
6) Backup DB
7) Restore DB
8) Uninstall (remove containers + volumes)
9) Exit
MENU
}

main_loop() {
  while true; do
    print_menu
    read -r -p "Select an option [1-9]: " choice

    case "$choice" in
      1) install_setup ;;
      2) start_restart ;;
      3) stop_services ;;
      4) update_project ;;
      5) show_logs ;;
      6) backup_db ;;
      7) restore_db ;;
      8) uninstall_stack ;;
      9)
        log "Goodbye."
        exit 0
        ;;
      *) warn "Invalid option. Please choose 1-9." ;;
    esac
  done
}

main_loop