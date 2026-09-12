import path from "node:path";
import { DockerSandboxProvider } from "../sandbox/docker.provider.js";

const DEFAULT_SLUG = "repository";

export class AgentTools {
  constructor(private readonly sandbox: DockerSandboxProvider) {}

  private repoRoot(slug: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
      throw new Error(`Invalid repository slug: ${slug}`);
    }
    return `/workspace/${slug}`;
  }

  private safePath(slug: string, input: string): string {
    const requested = (input || ".").trim();

    const normalized = requested.replaceAll("\\", "/");

    if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
      throw new Error("Absolute paths are not allowed");
    }

    const repositoryRoot = this.repoRoot(slug);

    const resolved = path.posix.normalize(`${repositoryRoot}/${normalized}`);

    if (
      resolved !== repositoryRoot &&
      !resolved.startsWith(`${repositoryRoot}/`)
    ) {
      throw new Error("Path escapes repository");
    }

    const lowerPath = normalized.toLowerCase();

    const protectedPaths = [".git", "node_modules", ".env"];

    const firstPart = lowerPath.split("/")[0];

    if (protectedPaths.includes(firstPart)) {
      throw new Error(`Access to protected path is not allowed: ${normalized}`);
    }

    return normalized || ".";
  }

  async listFiles(containerId: string, inputPath = ".", slug = DEFAULT_SLUG) {
    const safePath = this.safePath(slug, inputPath);
    const root = this.repoRoot(slug);

    return this.sandbox.execute(
      containerId,
      `cd '${root}' && find "${safePath}" -maxdepth 3 -type f`,
    );
  }

  async readFile(containerId: string, inputPath: string, slug = DEFAULT_SLUG) {
    const safePath = this.safePath(slug, inputPath);
    const root = this.repoRoot(slug);

    return this.sandbox.execute(containerId, `cd '${root}' && cat "${safePath}"`);
  }

  async writeFile(containerId: string, inputPath: string, content: string, slug = DEFAULT_SLUG) {
    const safePath = this.safePath(slug, inputPath);
    const root = this.repoRoot(slug);

    const encoded = Buffer.from(content, "utf8").toString("base64");

    return this.sandbox.execute(
      containerId,
      `cd '${root}' && echo '${encoded}' | base64 -d > "${safePath}"`,
    );
  }

  async runCommand(containerId: string, command: string, slug = DEFAULT_SLUG) {
    const safeCommand = this.validateCommand(command);
    const root = this.repoRoot(slug);

    return this.sandbox.execute(containerId, `cd '${root}' && ${safeCommand}`, 120_000);
  }

  async getLogs(containerId: string, slug = DEFAULT_SLUG) {
    return this.sandbox.getApplicationLogs(containerId, slug);
  }

  async pushChanges(
    containerId: string,
    slug: string,
    accessToken: string,
    message: string,
    branch?: string,
  ) {
    this.repoRoot(slug); // validates slug
    return this.sandbox.pushChanges(containerId, slug, accessToken, message, branch);
  }

  private validateCommand(command: string): string {
    const trimmed = command.trim();

    if (!trimmed) {
      throw new Error("Command cannot be empty");
    }

    // Commands that should NEVER be executed by the coding agent.
    const blockedPatterns = [
      /\brm\s+-rf\s+\/\s*$/i,
      /\brm\s+-rf\s+\/\*/i,
      /\bmkfs\b/i,
      /\bdd\s+if=/i,
      /\bshutdown\b/i,
      /\breboot\b/i,
      /\bpoweroff\b/i,
      /\binit\s+0\b/i,
      /\bsystemctl\b/i,
      /\bdocker\b/i,
      /\bchmod\s+777\b/i,
      /\bchown\s+-R\s+.*\/\s*$/i,
      /\bcurl\b.*\|\s*(bash|sh)/i,
      /\bwget\b.*\|\s*(bash|sh)/i,
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(trimmed)) {
        throw new Error(`Blocked potentially dangerous command: ${trimmed}`);
      }
    }

    return trimmed;
  }
}
