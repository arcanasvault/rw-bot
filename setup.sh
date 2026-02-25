#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="remnawave-vpn-bot"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"
NGINX_DIR="$PROJECT_DIR/nginx"
NGINX_CONF_DIR="$NGINX_DIR/conf.d"
NGINX_CERTS_DIR="$NGINX_DIR/certs"
NGINX_WEBROOT_DIR="$NGINX_DIR/www"
CERT_RENEW_LOG="$PROJECT_DIR/logs/cert-renew.log"

if [[ "${EUID}" -ne 0 ]]; then
  SUDO="sudo"
else
  SUDO=""
fi

COMPOSE_MODE=""

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

run_docker() {
  if [[ -n "$SUDO" ]]; then
    $SUDO docker "$@"
  else
    docker "$@"
  fi
}

detect_compose() {
  if run_docker compose version >/dev/null 2>&1; then
    COMPOSE_MODE="plugin"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_MODE="legacy"
    return
  fi

  die "Docker Compose not found."
}

run_compose() {
  if [[ -z "$COMPOSE_MODE" ]]; then
    detect_compose
  fi

  if [[ "$COMPOSE_MODE" == "plugin" ]]; then
    (cd "$PROJECT_DIR" && run_docker compose "$@")
  else
    (cd "$PROJECT_DIR" && docker-compose "$@")
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Command not found: $1"
}

install_prerequisites() {
  command -v apt-get >/dev/null 2>&1 || die "This installer supports Ubuntu/Debian (apt-get) only."

  log "Installing base dependencies"
  $SUDO apt-get update -y
  $SUDO apt-get install -y curl git ca-certificates gnupg lsb-release jq openssl
}

install_docker_if_needed() {
  if command -v docker >/dev/null 2>&1 && (run_docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1); then
    log "Docker and Compose already installed."
    detect_compose
    return
  fi

  install_prerequisites

  log "Installing Docker and Docker Compose plugin"
  $SUDO apt-get install -y docker.io docker-compose-plugin
  $SUDO systemctl enable docker
  $SUDO systemctl start docker

  if [[ -n "${SUDO_USER:-}" ]]; then
    $SUDO usermod -aG docker "$SUDO_USER" || true
    warn "User $SUDO_USER added to docker group. You may need to logout/login once."
  fi

  detect_compose
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

is_true_value() {
  local raw="${1:-}"
  case "$(echo "$raw" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

validate_webhook_url() {
  local app_url
  app_url="$(read_env_value APP_URL)"

  [[ "$app_url" == https://* ]] || die "APP_URL must be HTTPS for Telegram webhook."

  local hostport
  hostport="${app_url#https://}"
  hostport="${hostport%%/*}"

  if [[ "$hostport" == *:* ]]; then
    local port
    port="${hostport##*:}"
    if [[ "$port" != "443" && "$port" != "80" && "$port" != "88" && "$port" != "8443" ]]; then
      die "Webhook port must be 443/80/88/8443. Current APP_URL port: $port"
    fi
  fi
}

ensure_env_file() {
  local env_file="$PROJECT_DIR/.env"

  if [[ ! -f "$env_file" ]]; then
    log "Creating .env from .env.example"
    cp "$PROJECT_DIR/.env.example" "$env_file"
  fi

  prompt_var "APP_URL" "Public HTTPS URL for webhook (no trailing slash)"
  prompt_var "WEBHOOK_PATH" "Telegram webhook path" "/telegram/webhook"
  prompt_var "WEBHOOK_SET_RETRIES" "Webhook setup retries" "3"
  prompt_var "BOT_TOKEN" "Telegram BOT_TOKEN" "" true
  prompt_var "BOT_USERNAME" "Telegram bot username (without @)"
  prompt_var "ADMIN_TG_IDS" "Admin Telegram IDs (comma separated)"
  prompt_var "ADMIN_TG_HANDLE" "Support/admin Telegram handle"

  prompt_var "POSTGRES_DB" "Postgres DB name" "vpn_bot"
  prompt_var "POSTGRES_USER" "Postgres username" "vpn_bot"
  prompt_var "POSTGRES_PASSWORD" "Postgres password" "vpn_bot_password" true
  prompt_var "POSTGRES_PORT" "Postgres host port" "5432"

  local pg_db pg_user pg_pass
  pg_db="$(read_env_value POSTGRES_DB)"
  pg_user="$(read_env_value POSTGRES_USER)"
  pg_pass="$(read_env_value POSTGRES_PASSWORD)"

  upsert_env "DATABASE_URL" "postgresql://${pg_user}:${pg_pass}@db:5432/${pg_db}?schema=public"
  prompt_var "RUN_SEED" "Run seed at startup? (true/false)" "false"

  prompt_var "REMNAWAVE_URL" "RemnaWave panel URL"
  prompt_var "REMNAWAVE_TOKEN" "RemnaWave API token" "" true

  prompt_var "TETRA98_API_KEY" "Tetra98 API key" "" true
  prompt_var "MANUAL_CARD_NUMBER" "Manual card number"

  prompt_var "MIN_WALLET_CHARGE_TOMANS" "Min wallet charge (Tomans)" "10000"
  prompt_var "MAX_WALLET_CHARGE_TOMANS" "Max wallet charge (Tomans)" "10000000"

  prompt_var "PORT" "Container app port" "3000"
  prompt_var "APP_PORT" "Host app port mapping" "3000"

  prompt_var "ENABLE_NGINX" "Enable bundled NGINX + Certbot? (true/false)" "false"
  prompt_var "DOMAIN" "Domain for NGINX/HTTPS (if enabled)" "example.com"
  prompt_var "LETSENCRYPT_EMAIL" "Let's Encrypt email (if enabled)" "admin@example.com"

  chmod 700 "$env_file"
  log ".env secured with chmod 700"
}

ensure_nginx_dirs() {
  mkdir -p "$NGINX_CONF_DIR" "$NGINX_CERTS_DIR" "$NGINX_WEBROOT_DIR" "$PROJECT_DIR/logs"
}

write_nginx_http_config() {
  local domain="$1"
  cat >"$NGINX_CONF_DIR/default.conf" <<NGINX
server {
    listen 80;
    server_name ${domain};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
}

write_nginx_https_config() {
  local domain="$1"
  cat >"$NGINX_CONF_DIR/default.conf" <<NGINX
server {
    listen 80;
    server_name ${domain};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
}

obtain_letsencrypt_certificate() {
  local domain="$1"
  local email="$2"

  run_docker run --rm \
    -v "$NGINX_CERTS_DIR:/etc/letsencrypt" \
    -v "$NGINX_WEBROOT_DIR:/var/www/certbot" \
    certbot/certbot certonly \
    --webroot -w /var/www/certbot \
    -d "$domain" \
    --email "$email" \
    --agree-tos \
    --no-eff-email \
    --non-interactive
}

create_self_signed_certificate() {
  local domain="$1"
  local cert_dir="$NGINX_CERTS_DIR/live/$domain"

  mkdir -p "$cert_dir"
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -subj "/CN=$domain" \
    -keyout "$cert_dir/privkey.pem" \
    -out "$cert_dir/fullchain.pem"
}

reload_nginx_service() {
  if run_compose --profile nginx exec -T nginx nginx -s reload >/dev/null 2>&1; then
    return
  fi

  run_compose --profile nginx restart nginx
}

setup_cert_renew_cron() {
  mkdir -p "$(dirname "$CERT_RENEW_LOG")"
  local cron_line="17 3 * * * cd $PROJECT_DIR && bash scripts/renew-certs.sh >> $CERT_RENEW_LOG 2>&1"
  local current
  current="$(crontab -l 2>/dev/null || true)"

  if echo "$current" | grep -F "$PROJECT_DIR && bash scripts/renew-certs.sh" >/dev/null 2>&1; then
    log "Cert renew cron already exists"
    return
  fi

  (echo "$current"; echo "$cron_line") | crontab -
  log "Added daily cert renewal cron"
}

setup_nginx_certbot() {
  ensure_env_exists
  local domain email
  domain="$(read_env_value DOMAIN)"
  email="$(read_env_value LETSENCRYPT_EMAIL)"

  [[ -n "$domain" ]] || die "DOMAIN is required for NGINX setup"
  [[ -n "$email" ]] || die "LETSENCRYPT_EMAIL is required for NGINX setup"

  ensure_nginx_dirs
  write_nginx_http_config "$domain"

  log "Starting docker stack with nginx profile"
  run_compose --profile nginx up -d --build db app nginx
  sleep 5

  log "Requesting Let's Encrypt certificate for $domain"
  if obtain_letsencrypt_certificate "$domain" "$email"; then
    log "Let's Encrypt certificate issued"
  else
    warn "Let's Encrypt failed. Creating self-signed fallback certificate"
    create_self_signed_certificate "$domain"
    warn "Self-signed certificate is not recommended for Telegram production webhooks"
  fi

  write_nginx_https_config "$domain"
  reload_nginx_service
  setup_cert_renew_cron

  upsert_env "APP_URL" "https://$domain"
  upsert_env "ENABLE_NGINX" "true"

  log "NGINX + HTTPS setup complete"
}

check_app_health() {
  local app_port
  app_port="$(read_env_value APP_PORT)"
  app_port="${app_port:-3000}"

  local i
  for i in {1..20}; do
    if curl -fsS "http://127.0.0.1:${app_port}/health" >/dev/null 2>&1; then
      log "App health check passed"
      return 0
    fi
    sleep 2
  done

  warn "App health check failed on http://127.0.0.1:${app_port}/health"
  return 1
}

set_webhook() {
  ensure_env_exists
  validate_webhook_url

  local bot_token app_url webhook_path webhook_url
  bot_token="$(read_env_value BOT_TOKEN)"
  app_url="$(read_env_value APP_URL)"
  webhook_path="$(read_env_value WEBHOOK_PATH)"

  app_url="${app_url%/}"
  webhook_url="${app_url}${webhook_path}"

  log "Setting Telegram webhook to $webhook_url"

  local set_resp
  set_resp="$(curl -fsS -X POST "https://api.telegram.org/bot${bot_token}/setWebhook" \
    --data-urlencode "url=${webhook_url}" \
    --data-urlencode "drop_pending_updates=false" \
    --data-urlencode "allowed_updates=[\"message\",\"callback_query\"]")" || {
      warn "setWebhook request failed"
      return 1
    }

  if command -v jq >/dev/null 2>&1; then
    local ok description
    ok="$(echo "$set_resp" | jq -r '.ok')"
    description="$(echo "$set_resp" | jq -r '.description')"
    if [[ "$ok" != "true" ]]; then
      warn "setWebhook failed: $description"
      return 1
    fi
    log "setWebhook success: $description"
  else
    log "setWebhook response: $set_resp"
  fi

  return 0
}

verify_webhook_info() {
  ensure_env_exists
  local bot_token
  bot_token="$(read_env_value BOT_TOKEN)"

  local info_resp
  info_resp="$(curl -fsS "https://api.telegram.org/bot${bot_token}/getWebhookInfo")" || {
    warn "getWebhookInfo request failed"
    return 1
  }

  if command -v jq >/dev/null 2>&1; then
    local ok url pending last_error
    ok="$(echo "$info_resp" | jq -r '.ok')"
    url="$(echo "$info_resp" | jq -r '.result.url')"
    pending="$(echo "$info_resp" | jq -r '.result.pending_update_count')"
    last_error="$(echo "$info_resp" | jq -r '.result.last_error_message // empty')"

    if [[ "$ok" != "true" ]]; then
      warn "getWebhookInfo failed"
      return 1
    fi

    log "Webhook info: url=$url pending_updates=$pending"
    if [[ -n "$last_error" ]]; then
      warn "Webhook last_error_message: $last_error"
    fi
  else
    log "Webhook info response: $info_resp"
  fi

  return 0
}

run_migrations() {
  log "Running Prisma generate"
  run_compose exec -T app pnpm prisma generate

  log "Applying Prisma migrations"
  run_compose exec -T app pnpm prisma migrate deploy

  if is_true_value "$(read_env_value RUN_SEED)"; then
    log "Running seed"
    run_compose exec -T app pnpm db:seed
  fi
}

show_nginx_hint() {
  ensure_env_exists
  local app_url
  app_url="$(read_env_value APP_URL)"

  cat <<TXT

Nginx reverse proxy hint (if you use host NGINX):

server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

Current APP_URL: $app_url
Webhook path: $(read_env_value WEBHOOK_PATH)
TXT
}

install_setup() {
  install_docker_if_needed
  require_cmd git
  require_cmd awk

  ensure_env_file

  local enable_nginx
  enable_nginx="$(read_env_value ENABLE_NGINX)"

  if is_true_value "$enable_nginx"; then
    ensure_nginx_dirs
    run_compose --profile nginx up -d --build db app nginx
  else
    run_compose up -d --build db app
  fi

  sleep 5
  run_migrations

  if is_true_value "$enable_nginx"; then
    setup_nginx_certbot
  fi

  check_app_health || true
  set_webhook || true
  verify_webhook_info || true
  show_nginx_hint

  log "Install/Setup completed"
}

start_restart() {
  detect_compose
  if is_true_value "$(read_env_value ENABLE_NGINX)"; then
    run_compose --profile nginx up -d --build
  else
    run_compose up -d --build
  fi

  check_app_health || true
}

stop_services() {
  detect_compose
  if is_true_value "$(read_env_value ENABLE_NGINX)"; then
    run_compose --profile nginx stop
  else
    run_compose stop
  fi
}

update_project() {
  detect_compose
  require_cmd git

  log "Pulling latest code"
  (cd "$PROJECT_DIR" && git pull --rebase --autostash)

  start_restart
  run_migrations
  set_webhook || true
  verify_webhook_info || true
}

show_logs() {
  detect_compose
  read -r -p "Service name (app/db/nginx, default app): " service
  service="${service:-app}"

  if [[ "$service" != "app" && "$service" != "db" && "$service" != "nginx" ]]; then
    die "Invalid service. Use app, db, or nginx."
  fi

  if [[ "$service" == "nginx" ]]; then
    run_compose --profile nginx logs -f --tail=200 "$service"
  else
    run_compose logs -f --tail=200 "$service"
  fi
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

  run_compose --profile nginx down -v --remove-orphans
  log "Stack removed"
}

manual_nginx_setup() {
  install_docker_if_needed
  ensure_env_file
  setup_nginx_certbot
  set_webhook || true
  verify_webhook_info || true
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
10) Setup NGINX + Certbot (optional)
MENU
}

# User-editable section: menu dispatcher
main_loop() {
  while true; do
    print_menu
    read -r -p "Select an option [1-10]: " choice

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
      10) manual_nginx_setup ;;
      *) warn "Invalid option. Please choose 1-10." ;;
    esac
  done
}

main_loop
