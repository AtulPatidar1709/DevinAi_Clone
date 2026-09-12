FROM oven/bun:1.3-slim

# The docker CLI client (not the daemon) — the backend shells out to
# `docker run/exec/rm` to manage sandbox containers. It talks to the
# *host's* Docker daemon via the socket mounted in docker-compose.yml
# (docker-outside-of-docker), not a nested daemon inside this container.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install workspace deps first for better layer caching.
COPY package.json bun.lock ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/db/package.json packages/db/package.json
RUN bun install --frozen-lockfile

COPY packages/db packages/db
COPY apps/backend apps/backend

RUN cd packages/db && bun run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "apps/backend/src/server.ts"]
