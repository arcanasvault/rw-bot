#!/usr/bin/env sh
set -eu

echo "[entrypoint] running prisma generate"
pnpm prisma generate

echo "[entrypoint] running prisma migrate deploy"
pnpm prisma migrate deploy

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] running seed"
  pnpm db:seed
fi

echo "[entrypoint] starting app"
exec node dist/app.js
