#!/bin/sh
# API container entrypoint: wait for DB -> prisma db push -> db:sql -> optional demo seed -> exec the command.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

DB_HOST=$(node -e "console.log(new URL(process.env.DATABASE_URL).hostname)")
DB_PORT=$(node -e "console.log(new URL(process.env.DATABASE_URL).port || 5432)")

echo "[entrypoint] waiting for postgres at ${DB_HOST}:${DB_PORT}"
tries=0
until pg_isready -q -h "$DB_HOST" -p "$DB_PORT"; do
  tries=$((tries + 1))
  if [ "$tries" -ge "${DB_WAIT_RETRIES:-60}" ]; then
    echo "[entrypoint] postgres not ready after ${tries} attempts" >&2
    exit 1
  fi
  sleep 2
done

# Set RUN_DB_SETUP=false on additional replicas so only one instance changes the schema.
if [ "${RUN_DB_SETUP:-true}" = "true" ]; then
  echo "[entrypoint] prisma db push (no --accept-data-loss: destructive changes abort the start)"
  npm run db:push
  # db push drops indexes/triggers Prisma does not know, so the sql/*.sql files are always re-applied.
  echo "[entrypoint] applying prisma/sql/*.sql"
  npm run db:sql
fi

if [ "${SEED_DEMO:-false}" = "true" ]; then
  if [ "${NODE_ENV:-}" = "production" ] && [ "${ALLOW_DEMO_SEED:-}" != "true" ]; then
    echo "[entrypoint] SEED_DEMO=true ignored: NODE_ENV=production requires ALLOW_DEMO_SEED=true" >&2
  else
    echo "[entrypoint] seeding demo data (known demo passwords)"
    npm run seed
  fi
fi

exec "$@"
