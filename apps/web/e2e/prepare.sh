#!/usr/bin/env bash
# Migrates and seeds the TEST database (never the dev one) and builds what the e2e run starts.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL_TEST:?DATABASE_URL_TEST is not set (see .env.example)}"
: "${REDIS_URL_TEST:?REDIS_URL_TEST is not set (see .env.example)}"

# Workspace packages export only ./dist (gitignored), so build them (and the API) before seeding.
pnpm turbo run build --filter=@beautyspa/api... --filter='@beautyspa/web^...'

export NODE_ENV=test
export DATABASE_URL="$DATABASE_URL_TEST"
pnpm --filter @beautyspa/api db:deploy
pnpm --filter @beautyspa/api db:seed

# NEXT_PUBLIC_API_URL is inlined at build time, so the web build must see the e2e API address.
NODE_ENV=production API_URL=http://localhost:3101 NEXT_PUBLIC_API_URL=http://localhost:3101 \
  NEXT_PUBLIC_SITE_URL=http://localhost:3100 pnpm exec next build
