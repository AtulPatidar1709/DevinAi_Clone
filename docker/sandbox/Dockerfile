FROM codercom/code-server:latest

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    gosu \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && node --version \
    && npm --version \
    && rm -rf /var/lib/apt/lists/*

# Git uses this askpass helper for private GitHub repositories. The token is
# injected only into the docker exec environment for the clone operation.
RUN printf '#!/bin/sh\ncase "$1" in\n  *Username*) echo "${GIT_USERNAME:-x-access-token}" ;;\n  *Password*) echo "$GITHUB_TOKEN" ;;\n  *) echo "" ;;\nesac\n' > /usr/local/bin/devine-git-askpass \
    && chmod 755 /usr/local/bin/devine-git-askpass

RUN mkdir -p /workspace \
    && chown -R coder:coder /workspace

# Entrypoint runs as root (needed to fix ownership of the mounted npm cache
# volume — Docker always creates named volumes owned by root), then drops
# to the unprivileged `coder` user via gosu before starting code-server.
# The cache volume is mounted at /home/coder/.npm by docker.provider.ts and
# shared across every sandbox container, so `npm install` only pays the
# full network download cost once, ever — subsequent sessions restore
# packages from the local cache instead of re-downloading them.
#
# The chown itself only needs to run ONCE, ever — not on every container
# start. `chown -R` walks every file in the cache to check its ownership,
# and that cache only grows over the life of the volume, so re-running it
# every start gets slower and slower the longer the project's been used —
# eventually slow enough to blow past the readiness timeout below and make
# session creation fail outright. A marker file inside the volume itself
# records that it's already correctly owned, so every start after the
# first is an instant no-op check instead of a full recursive walk.
RUN printf '#!/bin/sh\nset -e\nmkdir -p /home/coder/.npm\nif [ ! -f /home/coder/.npm/.devine-chowned ]; then\n  chown -R coder:coder /home/coder/.npm\n  touch /home/coder/.npm/.devine-chowned\nfi\nchown -R coder:coder /workspace\ntouch /tmp/.devine-cache-ready\nexec gosu coder code-server --bind-addr 0.0.0.0:8080 --auth "$AUTH" /workspace\n' > /usr/local/bin/devine-entrypoint.sh \
    && chmod 755 /usr/local/bin/devine-entrypoint.sh

WORKDIR /workspace

EXPOSE 8080

# AUTH controls whether code-server requires a login screen. Default "none"
# so it can be embedded directly in an <iframe> without a manual login step.
# Each container only listens on the host's loopback interface and is
# destroyed with the session, so this is acceptable for local/dev use; set
# AUTH=password (and PASSWORD=...) at `docker run` time if the sandbox port
# is ever exposed beyond localhost.
ENV AUTH=none
ENV PASSWORD=""

# Stays root here — devine-entrypoint.sh drops privileges itself via gosu.
ENTRYPOINT ["/usr/local/bin/devine-entrypoint.sh"]
