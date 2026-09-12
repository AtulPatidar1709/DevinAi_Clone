# Deploying Devine to EC2 (Ubuntu) — full steps

Assumes: EC2 instance not yet launched, using DuckDNS for a free domain and Neon for Postgres.

---

## 1. Get a free domain (DuckDNS)

1. Go to https://www.duckdns.org, sign in with GitHub/Google.
2. Under "add domain", create something like `devine-yourname` → you now own `devine-yourname.duckdns.org`.
3. Copy your **token** shown at the top of the page — you'll need it in step 4.
4. Leave the IP field blank for now; you'll fill it in once the instance exists (step 3).

---

## 2. Launch the EC2 instance

AWS Console → EC2 → Launch Instance:

| Setting | Value |
|---|---|
| Name | devine |
| AMI | Ubuntu Server 24.04 LTS |
| Instance type | `t3.large` (2 vCPU/8GB) minimum, `t3.xlarge` for headroom |
| Key pair | Create new → download the `.pem` file, keep it safe |
| Storage | 30 GB minimum (gp3) |

**Security Group** — add these inbound rules:

| Type | Port range | Source |
|---|---|---|
| SSH | 22 | My IP |
| HTTP | 80 | Anywhere (0.0.0.0/0) |
| HTTPS | 443 | Anywhere (0.0.0.0/0) |
| Custom TCP | 10000–10500 | Anywhere (0.0.0.0/0) |

Launch it.

---

## 3. Allocate an Elastic IP and point DuckDNS at it

1. EC2 Console → Elastic IPs → Allocate → Associate with your new instance.
2. Copy that IP.
3. Back on DuckDNS: paste it into the IP field for your subdomain, click "update ip".

Confirm it resolves:
```bash
ping devine-yourname.duckdns.org
```
Should reply from your Elastic IP.

---

## 4. SSH in and install Docker

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<your-elastic-ip>

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit
ssh -i your-key.pem ubuntu@<your-elastic-ip>   # reconnect so the group change applies
```

---

## 5. Get the code onto the instance

From your **local machine** (where you unzipped `devine-full-project.zip`):
```bash
scp -i your-key.pem -r devine-fixed-v2 ubuntu@<your-elastic-ip>:~/devine
```

---

## 6. Create your Neon database

1. https://neon.tech → new project.
2. Dashboard → Connection string → copy the **direct** one (no `-pooler` in the hostname).

---

## 7. Configure the environment

```bash
ssh -i your-key.pem ubuntu@<your-elastic-ip>
cd ~/devine
cp .env.production.example .env
openssl rand -hex 32   # run this twice
nano .env
```

Fill in `.env`:
```env
DATABASE_URL="postgresql://<user>:<password>@<endpoint>.neon.tech/<db>?sslmode=require"
FRONTEND_URL=https://devine-yourname.duckdns.org
GITHUB_CALLBACK_URL=https://devine-yourname.duckdns.org/api/auth/github/callback
GITHUB_SETUP_URL=https://devine-yourname.duckdns.org/api/github/setup
GITHUB_WEBHOOK_SECRET=<first openssl output>
GITHUB_APP_ID=<from your GitHub App>
GITHUB_APP_CLIENT_ID=<from your GitHub App>
GITHUB_APP_CLIENT_SECRET=<from your GitHub App>
GITHUB_APP_SLUG=<from your GitHub App>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
SANDBOX_CODE_SERVER_AUTH=password
SANDBOX_CODE_SERVER_PASSWORD=<second openssl output>
SANDBOX_PUBLIC_HOST=devine-yourname.duckdns.org
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=<your key>
LLM_MODEL=openai/gpt-4o-mini
```

---

## 8. Update your GitHub App settings

On github.com → your GitHub App's settings page, change:
- **Callback URL** → `https://devine-yourname.duckdns.org/api/auth/github/callback`
- **Setup URL** → `https://devine-yourname.duckdns.org/api/github/setup`
- **Webhook URL** → `https://devine-yourname.duckdns.org/api/github/webhook`

---

## 9. Replace the domain placeholder in two files

```bash
sed -i 's/devine.yourdomain.com/devine-yourname.duckdns.org/g' Caddyfile
sed -i 's/devine.yourdomain.com/devine-yourname.duckdns.org/g' docker-compose.yml
```

Double check they took effect:
```bash
grep -n duckdns Caddyfile docker-compose.yml
```

---

## 10. Deploy

```bash
chmod +x deploy.sh
./deploy.sh
```

This builds the sandbox image, runs the Neon migration, builds and starts the backend/frontend/Caddy, and tails the backend logs. First run takes several minutes (Docker image builds + Let's Encrypt cert issuance). Ctrl+C once you see it running — the containers stay up.

---

## 11. Verify

Visit `https://devine-yourname.duckdns.org` — should load with a valid HTTPS cert, no browser warning. Log in with GitHub, connect a repo, start a session, confirm a sandbox actually spins up and chat/preview work.

---

## Redeploying later

After pushing new code changes to the instance (`scp` the changed files or `git pull` if you set it up as a repo), just run `./deploy.sh` again — it rebuilds and restarts everything without touching your `.env` or losing database data.
