# Deploying Devine — VPS + Docker + Neon + Caddy

## What this gets you

- **Backend**: containerized, talks to the *host's* Docker daemon (via a mounted socket) to spawn sandbox containers — same code path as your local dev setup, just running on a rented machine.
- **Frontend**: built once into static files, served directly by Caddy.
- **Database**: Neon (managed Postgres) — nothing to self-host or back up yourself.
- **HTTPS**: automatic via Caddy + Let's Encrypt — no certbot, no manual renewal.
- **Sandboxes**: still real Docker containers on that same VPS, published on host ports directly (not proxied through Caddy — see "Known limitation" at the bottom).

## 1. Provision a VPS

Any of these work — pick based on budget/familiarity: Hetzner CX32 (cheap, solid), DigitalOcean Droplet, AWS Lightsail/EC2, GCP Compute Engine. Minimum realistic spec: **4 vCPU / 8GB RAM** — each sandbox container can use up to `SANDBOX_MEMORY`/`SANDBOX_CPUS` (3g/3 cores by default), so this fits maybe 2 concurrent sessions comfortably; size up if you expect more.

OS: Ubuntu 24.04 LTS (or Debian 12 — matches what these Dockerfiles assume).

## 2. Point a domain at it

Create an `A` record: `devine.yourdomain.com` → your VPS's public IP. Caddy needs this to be live and resolving *before* it can issue a certificate.

## 3. Install Docker on the VPS

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in for the group change to take effect
```

## 4. Open the firewall

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (Caddy redirects to HTTPS)
sudo ufw allow 443/tcp   # HTTPS
# Sandbox preview + code-server ports — see docker.provider.ts's port range logic.
# 500 ports covers SANDBOX_BASE_PORT (10000) + up to ~250 concurrent sessions
# (each uses 2+ ports: one code-server, one+ per attached repo).
sudo ufw allow 10000:10500/tcp
sudo ufw enable
```

## 5. Get your code onto the server

```bash
git clone <your-repo-url> devine
cd devine
```
(Or `scp`/rsync it up if it's not in git yet.)

## 6. Set up your Neon database

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the **direct** connection string (not the pooled `-pooler` one — see the comment in `.env.production.example` for why).
3. Copy `.env.production.example` to `.env` in your project root and fill in every value — the Neon URL, your GitHub App credentials, and generate real random strings for `GITHUB_WEBHOOK_SECRET` and `SANDBOX_CODE_SERVER_PASSWORD`:
   ```bash
   cp .env.production.example .env
   openssl rand -hex 32   # run twice, use one output for each secret
   ```

## 7. Update your GitHub App settings

In your GitHub App's settings page, change these to your real domain (they currently point at `localhost:3000`):
- **Callback URL** → `https://devine.yourdomain.com/api/auth/github/callback`
- **Setup URL** → `https://devine.yourdomain.com/api/github/setup`
- **Webhook URL** → `https://devine.yourdomain.com/api/github/webhook`

No more ngrok needed — Caddy's real HTTPS endpoint replaces it.

## 8. Update the Caddyfile and compose file with your actual domain

Both `Caddyfile` and `docker-compose.yml` (the `VITE_API_URL` build arg) have `devine.yourdomain.com` as a placeholder — replace every occurrence with your real domain.

## 9. Build the sandbox image

This is the same image your local sessions use — build it once on the server:
```bash
docker build -t devine-sandbox:latest ./docker/sandbox
```

## 10. Run the migration against Neon

```bash
cd packages/db
docker run --rm --env-file ../../.env -v "$(pwd)":/app -w /app oven/bun:1.3-slim \
  sh -c "bun install --frozen-lockfile && bunx prisma migrate deploy --config prisma.config.ts"
cd ../..
```
(`migrate deploy`, not `migrate dev` — this applies existing migrations without prompting or generating new ones, which is the correct one for production.)

## 11. Bring it all up

```bash
docker compose up -d --build
```

This builds and starts the backend (with Docker-socket access), builds the frontend once and copies its static output into a shared volume, and starts Caddy — which will automatically request and install a Let's Encrypt certificate for your domain on first request.

## 12. Verify

```bash
docker compose logs -f backend
```
Visit `https://devine.yourdomain.com` — you should get a valid HTTPS cert (no browser warning) and land on the login page. Try connecting a GitHub repo and starting a session to confirm the whole chain (webhook, sandbox creation, preview) works end to end.

## Known limitation: sandbox ports aren't behind HTTPS

Preview URLs and code-server URLs currently resolve to `http://devine.yourdomain.com:<port>` — plain HTTP, directly on the raw published port, not proxied through Caddy. This works, but two things are worth knowing:
1. Browsers will warn about mixed content if your main app is HTTPS and a preview iframe is plain HTTP — usually fine for previews opened in a new tab, more annoying embedded in an iframe.
2. It's not encrypted in transit.

Fixing this properly means dynamic reverse-proxy routing (e.g. a wildcard subdomain per session, or a path-based proxy that maps session IDs to internal ports) — a real feature, not a config tweak. Worth doing once you're running this for real users; not blocking for getting a working deployment up first.
