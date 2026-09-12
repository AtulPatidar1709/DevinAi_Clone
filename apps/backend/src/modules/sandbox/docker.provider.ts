import { randomUUID } from "node:crypto";
import { config } from "../../config.js";
import { runCommand } from "../../lib/command.js";

export interface ExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SandboxApp {
  slug: string;
  internalPort: number;
  hostPort: number;
  previewUrl: string;
}

export interface SandboxInstance {
  containerId: string;
  codeServerPort: number;
  codeServerUrl: string;
  apps: SandboxApp[];
}

const PORT_CONFLICT_PATTERN = /port is already allocated|address already in use|bind.*failed/i;
// Pulls the actual port number out of Docker's own error, e.g.
// 'Bind for 0.0.0.0:10001 failed: port is already allocated'
const PORT_FROM_ERROR_PATTERN = /Bind for [\d.]+:(\d+) failed/i;

export class DockerSandboxProvider {
  /**
   * @param slugs Folder name (under /workspace) for each repository this
   * sandbox will hold. One slug = one internal port (3000, 3001, ...) and
   * one published host port. Pass a single slug for a normal one-repo
   * session.
   */
  async create(slugs: string[] = ["repository"]): Promise<SandboxInstance> {
    if (slugs.length === 0) {
      throw new Error("At least one repository slug is required to create a sandbox");
    }

    // Retries the whole port-allocate-then-docker-run sequence when a port
    // conflicts. Two things can cause that:
    //  1. A genuine race — two sandboxes created back-to-back both probe
    //     the same "free" port before either container has actually bound
    //     it yet.
    //  2. A Windows-specific quirk where two processes can both report a
    //     successful bind to the same port (different socket-reuse rules
    //     than Linux), so our own probe can report a port as free when
    //     Docker itself will still fail to use it.
    // Case 2 means re-probing alone isn't enough — the probe can give the
    // exact same wrong answer on every retry. So any port Docker's own
    // error message names as the actual conflict gets explicitly
    // blacklisted for the rest of these attempts, forcing real progress
    // even when the probe can't be trusted.
    const maxAttempts = 5;
    const blockedPorts = new Set<number>();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.attemptCreate(slugs, blockedPorts);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!PORT_CONFLICT_PATTERN.test(lastError.message)) {
          throw lastError;
        }

        const match = lastError.message.match(PORT_FROM_ERROR_PATTERN);
        if (match) {
          blockedPorts.add(Number(match[1]));
        }
        // else: fall through and retry with freshly re-probed ports
      }
    }

    throw new Error(
      `Failed to create sandbox after ${maxAttempts} attempts — a port kept conflicting even after avoiding every port Docker itself reported as busy (${[...blockedPorts].join(", ") || "none identified"}). This usually means a leftover process (e.g. a stuck Docker port-proxy from a previously force-removed container) is still holding a port Docker needs. Check what's bound to it (on Windows: netstat -ano | findstr ":<port>", then taskkill /PID <pid> /F, or restart Docker Desktop) and try again. Underlying error: ${lastError?.message}`,
    );
  }

  private async attemptCreate(slugs: string[], blockedPorts: Set<number>): Promise<SandboxInstance> {
    const name = `devine-sandbox-${randomUUID().slice(0, 8)}`;

    const codeServerPort = await this.findFreePort(undefined, blockedPorts);

    let nextSearchFrom = codeServerPort + 1;
    const apps: SandboxApp[] = [];

    for (let i = 0; i < slugs.length; i++) {
      const hostPort = await this.findFreePort(nextSearchFrom, blockedPorts);
      nextSearchFrom = hostPort + 1;

      apps.push({
        slug: slugs[i],
        internalPort: 3000 + i,
        hostPort,
        previewUrl: `http://${config.SANDBOX_PUBLIC_HOST}:${hostPort}`,
      });
    }

    const portArgs = [
      "-p",
      `${codeServerPort}:8080`,
      ...apps.flatMap((app) => ["-p", `${app.hostPort}:${app.internalPort}`]),
    ];

    const result = await runCommand(
      "docker",
      [
        "run",
        "-d",
        "--rm",

        "--name",
        name,

        "--memory",
        config.SANDBOX_MEMORY,

        "--cpus",
        config.SANDBOX_CPUS,

        ...portArgs,

        // Shared across every sandbox container so `npm install` restores
        // packages from a local cache instead of re-downloading the full
        // dependency tree from the registry on every new session.
        "-v",
        "devine-sandbox-npm-cache:/home/coder/.npm",

        "-e",
        `AUTH=${config.SANDBOX_CODE_SERVER_AUTH}`,

        "-e",
        `PASSWORD=${config.SANDBOX_CODE_SERVER_PASSWORD}`,

        config.SANDBOX_IMAGE,
      ],
      {
        timeoutMs: 30_000,
      },
    );

    if (result.exitCode !== 0) {
      throw new Error(
        ["Docker create failed", result.stderr, result.stdout].join("\n"),
      );
    }

    const containerId = result.stdout.trim();

    // The entrypoint chowns the (potentially large, cached) npm directory
    // before touching this marker file. docker run -d returns as soon as
    // the container starts, not once that chown finishes, so without this
    // wait the very first clone/install call could race a slow chown on a
    // big shared cache and hit a permissions error.
    await this.waitForEntrypointReady(containerId);

    return {
      containerId,
      codeServerPort,
      codeServerUrl: `http://${config.SANDBOX_PUBLIC_HOST}:${codeServerPort}`,
      apps,
    };
  }

  private async waitForEntrypointReady(containerId: string, timeoutMs = 20_000): Promise<void> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const result = await runCommand(
        "docker",
        ["exec", containerId, "test", "-f", "/tmp/.devine-cache-ready"],
        { timeoutMs: 3_000 },
      );

      if (result.exitCode === 0) return;

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Sandbox container ${containerId} did not finish initializing in time`);
  }

  /**
   * Every application command runs as the unprivileged `coder` user inside
   * the container. The image's own default user is root (the entrypoint
   * needs root briefly to fix ownership of the mounted npm-cache volume,
   * then drops to `coder` itself for code-server) — but `docker exec`
   * ignores that drop and uses the image's default user unless told
   * otherwise, so every exec call here does so explicitly. Without this,
   * npm/git commands run as root and leave root-owned files in the shared
   * cache volume, which then fights the entrypoint's chown on the next
   * container and produces EACCES errors.
   */
  private static readonly SANDBOX_USER = "coder";

  async execute(
    containerId: string,
    command: string,
    timeoutMs = 120_000,
  ): Promise<ExecuteResult> {
    return runCommand(
      "docker",
      ["exec", "-u", DockerSandboxProvider.SANDBOX_USER, containerId, "bash", "-lc", command],
      { timeoutMs },
    );
  }

  async clone(
    containerId: string,
    url: string,
    slug: string,
    accessToken?: string,
  ): Promise<ExecuteResult> {
    if (!/^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(url)) {
      throw new Error("Unsupported repository URL");
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
      throw new Error("Invalid repository slug");
    }

    const cloneCommand = `mkdir -p /workspace && cd /workspace && rm -rf '${slug}' && git clone --depth 1 '${url}' '${slug}'`;

    const result = accessToken
      ? await runCommand(
          "docker",
          [
            "exec",
            "-u",
            DockerSandboxProvider.SANDBOX_USER,
            "-e",
            `GITHUB_TOKEN=${accessToken}`,
            "-e",
            "GIT_ASKPASS=/usr/local/bin/devine-git-askpass",
            "-e",
            "GIT_USERNAME=x-access-token",
            "-e",
            "GIT_TERMINAL_PROMPT=0",
            containerId,
            "bash",
            "-lc",
            cloneCommand,
          ],
          { timeoutMs: 180_000 },
        )
      : await this.execute(containerId, cloneCommand, 180_000);

    if (result.exitCode !== 0) {
      throw new Error(
        [
          "Repository clone failed",
          `repository: ${url}`,
          `slug: ${slug}`,
          `exitCode: ${result.exitCode}`,
          `stdout: ${result.stdout}`,
          `stderr: ${result.stderr}`,
        ].join("\n"),
      );
    }

    return result;
  }

  /**
   * Commits and pushes any pending changes in the given repo folder back
   * to GitHub. Uses the same askpass helper as clone(); accessToken should
   * be a fresh, short-lived GitHub App installation token.
   */
  async pushChanges(
    containerId: string,
    slug: string,
    accessToken: string,
    message: string,
    branch?: string,
  ): Promise<ExecuteResult> {
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
      throw new Error("Invalid repository slug");
    }

    const safeMessage = message.replaceAll("'", "'\\''");
    const branchCmd = branch
      ? `git checkout -B '${branch.replaceAll("'", "'\\''")}'`
      : "true";

    const command = `
      cd /workspace/${slug}
      git config user.email "agent@devine.local"
      git config user.name "Devine Agent"
      ${branchCmd}
      git add -A
      if git diff --cached --quiet; then
        echo "No changes to commit"
        exit 0
      fi
      git commit -m '${safeMessage}'
      git push origin HEAD
    `;

    const result = await runCommand(
      "docker",
      [
        "exec",
        "-u",
        DockerSandboxProvider.SANDBOX_USER,
        "-e",
        `GITHUB_TOKEN=${accessToken}`,
        "-e",
        "GIT_ASKPASS=/usr/local/bin/devine-git-askpass",
        "-e",
        "GIT_USERNAME=x-access-token",
        "-e",
        "GIT_TERMINAL_PROMPT=0",
        containerId,
        "bash",
        "-lc",
        command,
      ],
      { timeoutMs: 60_000 },
    );

    if (result.exitCode !== 0) {
      throw new Error(
        ["Push failed", `stdout: ${result.stdout}`, `stderr: ${result.stderr}`].join("\n"),
      );
    }

    return result;
  }

  async installDependencies(containerId: string, slug: string): Promise<ExecuteResult> {
    const result = await this.execute(
      containerId,
      `
        cd /workspace/${slug}

        if [ -f package-lock.json ]; then
          echo "Found package-lock.json"
          echo "Running npm ci..."
          npm ci

        elif [ -f package.json ]; then
          echo "Found package.json"
          echo "Running npm install..."
          npm install

        elif [ -f requirements.txt ]; then
          echo "Found requirements.txt"
          echo "Running pip install..."
          pip install -r requirements.txt

        else
          echo "No supported dependency file found"
        fi
      `,
      300_000,
    );

    if (result.exitCode !== 0) {
      throw new Error(
        [
          "Dependency installation failed",
          `slug: ${slug}`,
          `exitCode: ${result.exitCode}`,
          `stdout: ${result.stdout}`,
          `stderr: ${result.stderr}`,
        ].join("\n"),
      );
    }

    return result;
  }

  async waitForApplication(
    containerId: string,
    port = 3000,
    timeoutMs = 60_000,
  ): Promise<void> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const result = await this.execute(
        containerId,
        `curl -fsS http://127.0.0.1:${port} >/dev/null 2>&1`,
        5_000,
      );

      if (result.exitCode === 0) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error(`Application on port ${port} failed to start within ${timeoutMs}ms`);
  }

  async startApplication(containerId: string, slug: string, port: number): Promise<ExecuteResult> {
    const result = await this.execute(
      containerId,
      `
      cd /workspace/${slug}

      # Native filesystem events (inotify) work reliably for changes made
      # inside this same container — including edits from the embedded
      # code-server — but polling is a cheap, well-known safety net for
      # edge cases where a given host's Docker storage driver doesn't
      # propagate them promptly. Without this, "edit in Code tab, see it
      # in Preview instantly" can occasionally lag.
      export CHOKIDAR_USEPOLLING=true
      export WATCHPACK_POLLING=true

      if [ -f package.json ]; then
        echo "Node.js project detected"

        if npm run | grep -q " dev"; then
          echo "Starting development server..."
          nohup npm run dev -- --hostname 0.0.0.0 --port ${port} \
            > /tmp/devine-app-${slug}.log 2>&1 &

        elif npm run | grep -q " start"; then
          echo "Starting production server..."
          PORT=${port} nohup npm start \
            > /tmp/devine-app-${slug}.log 2>&1 &

        else
          echo "No dev or start script found"
          exit 1
        fi

      elif [ -f manage.py ]; then
        echo "Django project detected"

        nohup python3 manage.py runserver 0.0.0.0:${port} \
          > /tmp/devine-app-${slug}.log 2>&1 &

      elif [ -f app.py ]; then
        echo "Python application detected"

        nohup python3 app.py \
          > /tmp/devine-app-${slug}.log 2>&1 &

      else
        echo "Unable to detect supported project"
        exit 1
      fi

      echo "Application start command launched"
    `,
      30_000,
    );

    if (result.exitCode !== 0) {
      throw new Error(
        [
          "Application start failed",
          `slug: ${slug}`,
          `exitCode: ${result.exitCode}`,
          `stdout: ${result.stdout}`,
          `stderr: ${result.stderr}`,
        ].join("\n"),
      );
    }

    return result;
  }

  async getApplicationLogs(containerId: string, slug = "repository"): Promise<ExecuteResult> {
    return this.execute(
      containerId,
      `cat /tmp/devine-app-${slug}.log 2>/dev/null || true`,
      10_000,
    );
  }

  async destroy(id: string): Promise<void> {
    const result = await runCommand("docker", ["rm", "-f", id]);

    if (result.exitCode !== 0 && !result.stderr.includes("No such container")) {
      throw new Error(result.stderr);
    }
  }

  private async findFreePort(startPort?: number, blockedPorts?: Set<number>): Promise<number> {
    const basePort = startPort ?? config.SANDBOX_BASE_PORT;

    for (let i = 0; i < 500; i++) {
      const port = basePort + i;

      if (blockedPorts?.has(port)) {
        continue;
      }

      const result = await runCommand(
        "bun",
        [
          "-e",
          `
          const net = require("net");

          const server = net.createServer();

          server.once("error", () => {
            process.exit(1);
          });

          server.listen(
            ${port},
            "0.0.0.0",
            () => {
              server.close(() => {
                process.exit(0);
              });
            }
          );
          `,
        ],
        {
          timeoutMs: 2_000,
        },
      );

      if (result.exitCode === 0) {
        return port;
      }
    }

    throw new Error("No free sandbox port found");
  }
}
