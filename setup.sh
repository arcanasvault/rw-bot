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

is_port_in_use() {
  local port="$1"

  if command -v ss >/dev/null 2>&1; then
    if ss -ltn "( sport = :$port )" 2>/dev/null | tail -n +2 | grep -q .; then
      return 0
    fi
  fi

  if command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
  fi

  return 1
}

suggest_host_app_port() {
  if is_port_in_use 4000; then
    echo "5000"
  else
    echo "4000"
  fi
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

ensure_env_file() {
  local env_file="$PROJECT_DIR/.env"

  if [[ ! -f "$env_file" ]]; then
    log "Creating .env from .env.example"
    cp "$PROJECT_DIR/.env.example" "$env_file"
  fi

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

  prompt_var "REMNAWAVE_URL" "RemnaWave panel URL" "http://localhost:3000"
  prompt_var "REMNAWAVE_TOKEN" "RemnaWave API token" "" true
  prompt_var "LOGO_PATH" "Local logo path for QR (absolute or project-relative)" "./logo.png"

  prompt_var "TETRA98_API_KEY" "Tetra98 API key" "" true
  prompt_var "MANUAL_CARD_NUMBER" "Manual card number"

  prompt_var "MIN_WALLET_CHARGE_TOMANS" "Min wallet charge (Tomans)" "10000"
  prompt_var "MAX_WALLET_CHARGE_TOMANS" "Max wallet charge (Tomans)" "10000000"

  prompt_var "PORT" "Container app port" "4000"
  local suggested_app_port
  suggested_app_port="$(suggest_host_app_port)"
  if [[ "$suggested_app_port" == "5000" ]]; then
    warn "Host port 4000 is already in use. Suggested bot host port: 5000"
  fi
  prompt_var "APP_PORT" "Host app port mapping" "$suggested_app_port"

  chmod 700 "$env_file"
  log ".env secured with chmod 700"
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

check_app_health() {
  local app_port
  app_port="$(read_env_value APP_PORT)"
  app_port="${app_port:-4000}"

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

install_setup() {
  install_docker_if_needed
  require_cmd git
  require_cmd awk

  ensure_env_file
  run_compose up -d --build db app
  sleep 5
  run_migrations
  check_app_health || true

  log "Install/Setup completed"
}

start_restart() {
  detect_compose
  run_compose up -d --build
  check_app_health || true
}

stop_services() {
  detect_compose
  run_compose stop
}

update_project() {
  detect_compose
  require_cmd git

  log "Pulling latest code"
  (cd "$PROJECT_DIR" && git pull --rebase --autostash)

  start_restart
  run_migrations
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

reset_database_completely() {
  detect_compose
  warn "This will delete ALL data permanently!"
  read -r -p "Are you sure you want to reset database completely? (yes/no): " confirm
  if [[ "$(echo "$confirm" | tr '[:upper:]' '[:lower:]')" != "yes" ]]; then
    warn "Database reset canceled."
    return
  fi

  run_compose up -d db app

  if run_compose exec -T app pnpm prisma migrate reset --force; then
    log "Database reset completed using prisma migrate reset."
    return
  fi

  warn "prisma migrate reset failed. Running fallback reset via docker volumes."
  run_compose down -v --remove-orphans
  run_compose up -d --build db app
  run_migrations
  log "Database reset completed using fallback flow."
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
9) Reset Database Completely
0) Exit
MENU
}

main_loop() {
  while true; do
    print_menu
    read -r -p "Select an option [0-9]: " choice

    case "$choice" in
      1) install_setup ;;
      2) start_restart ;;
      3) stop_services ;;
      4) update_project ;;
      5) show_logs ;;
      6) backup_db ;;
      7) restore_db ;;
      8) uninstall_stack ;;
      9) reset_database_completely ;;
      0)
        log "Goodbye."
        exit 0
        ;;
      *) warn "Invalid option. Please choose 0-9." ;;
    esac
  done
}

main_loop
