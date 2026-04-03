#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "Docker Compose is required" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required" >&2
  exit 1
fi

if [[ ! -d "$PROJECT_DIR/nginx/certs" || ! -d "$PROJECT_DIR/nginx/www" ]]; then
  echo "Nginx certificate directories not found. Skipping renew." >&2
  exit 0
fi

docker run --rm \
  -v "$PROJECT_DIR/nginx/certs:/etc/letsencrypt" \
  -v "$PROJECT_DIR/nginx/www:/var/www/certbot" \
  certbot/certbot renew --webroot -w /var/www/certbot --quiet

(cd "$PROJECT_DIR" && "${COMPOSE_CMD[@]}" --profile nginx exec -T nginx nginx -s reload)
