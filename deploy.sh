#!/usr/bin/env bash
# Run this FROM the project root on the EC2 instance (~/devine).
# Safe to re-run any time you push new code — it rebuilds and restarts
# everything but does not touch your .env or the database.
set -euo pipefail

echo "==> Building sandbox image"
docker build -t devine-sandbox:latest ./docker/sandbox

echo "==> Running database migrations against Neon"
(
  cd packages/db
  docker run --rm --env-file ../../.env -v "$(pwd)":/app -w /app oven/bun:1.3-slim \
    sh -c "bun install --frozen-lockfile && bunx prisma migrate deploy --config prisma.config.ts"
)

echo "==> Building and starting backend, frontend, and Caddy"
docker compose up -d --build

echo "==> Done. Tailing backend logs (Ctrl+C to stop watching, containers keep running):"
docker compose logs -f backend
