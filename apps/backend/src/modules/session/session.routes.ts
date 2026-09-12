import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@devine/db";
import { requireUser } from "../auth/session.js";
import { GithubService } from "../github/github.service.js";
import { DockerSandboxProvider } from "../sandbox/docker.provider.js";
import { AgentTools } from "../agent/agent.tool.js";
import { AgentService } from "../agent/agent.service.js";
import type { AgentRepo } from "../agent/agent.service.js";

const router = Router();
const github = new GithubService();
const provider = new DockerSandboxProvider();
const tools = new AgentTools(provider);
const agent = new AgentService(tools);

router.use(requireUser);

const sessionInclude = {
  repository: true,
  repositories: { include: { repository: true }, orderBy: { createdAt: "asc" as const } },
  sandboxes: { orderBy: { createdAt: "desc" as const }, take: 1 },
};

function slugForRepo(fullName: string, taken: Set<string>): string {
  const base = fullName.split("/").pop()?.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase() || "repo";
  let slug = base;
  let i = 2;
  while (taken.has(slug)) {
    slug = `${base}-${i}`;
    i++;
  }
  taken.add(slug);
  return slug;
}

router.get("/", async (_req, res, next) => {
  try {
    const sessions = await prisma.workspace.findMany({
      where: { userId: res.locals.user.id },
      orderBy: { updatedAt: "desc" },
      include: { ...sessionInclude, messages: { orderBy: { createdAt: "asc" }, take: 50 } },
    });
    res.json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const session = await prisma.workspace.findFirst({
      where: { id, userId: res.locals.user.id },
      include: { ...sessionInclude, messages: { orderBy: { createdAt: "asc" }, take: 200 } },
    });
    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }
    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

/**
 * Runs entirely in the background — the HTTP routes below return as soon
 * as placeholder rows exist, then this fills them in as work completes.
 * This is what lets session creation respond in milliseconds instead of
 * however long clone+install+start actually takes, and it's also what
 * fixes the "works the first time, breaks the second" bug: previously,
 * one repo's clone failing (a transient GitHub API hiccup, for example)
 * threw out of the whole synchronous handler and destroyed the entire
 * container — including repos that had *already* succeeded. Now each
 * repo is isolated in its own try/catch, so one failure doesn't take
 * down the others.
 *
 * Known limitation: this is in-process, fire-and-forget — if the backend
 * restarts mid-provisioning (e.g. `bun --watch` picking up a code change),
 * the job dies with the process and the session is left showing
 * "provisioning" forever. A real job queue (BullMQ, etc.) would survive
 * that; not worth the added infra until this is actually running for
 * real users under load.
 */
async function provisionSandboxInBackground(
  workspaceId: string,
  userId: string,
  slugged: Array<{
    repo: { id: string; fullName: string; name: string; cloneUrl: string; githubId: number };
    slug: string;
  }>,
) {
  let sandbox: Awaited<ReturnType<typeof provider.create>>;

  try {
    sandbox = await provider.create(slugged.map((s) => s.slug));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create sandbox";
    await prisma.workspace.update({ where: { id: workspaceId }, data: { status: "failed", error: message } });
    await prisma.workspaceRepository.updateMany({
      where: { workspaceId },
      data: { status: "failed", error: "Sandbox container could not be created" },
    });
    return;
  }

  const appBySlug = new Map(sandbox.apps.map((app) => [app.slug, app]));
  const primaryApp = appBySlug.get(slugged[0].slug)!;

  // The container exists now — Shell/Code tabs are already usable even
  // before any repo finishes cloning, so mark the session active
  // immediately rather than waiting for every repo to resolve.
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      status: "active",
      sandboxes: {
        create: {
          containerId: sandbox.containerId,
          port: primaryApp.hostPort,
          codeServerPort: sandbox.codeServerPort,
          codeServerUrl: sandbox.codeServerUrl,
          previewUrl: primaryApp.previewUrl,
          status: "running",
        },
      },
    },
  });

  let anySucceeded = false;

  for (const { repo, slug } of slugged) {
    const app = appBySlug.get(slug)!;

    try {
      const access = await github.getRepoInstallationTokenForUser(userId, repo.githubId);
      await provider.clone(sandbox.containerId, repo.cloneUrl, slug, access.token);
      await provider.installDependencies(sandbox.containerId, slug);

      // Cloned + installed successfully — code browsing and shell access
      // work from this point even if starting a dev server below fails.
      await prisma.workspaceRepository.update({
        where: { workspaceId_repositoryId: { workspaceId, repositoryId: repo.id } },
        data: {
          port: app.internalPort,
          previewPort: app.hostPort,
          previewUrl: app.previewUrl,
          status: "running",
          error: null,
        },
      });
      anySucceeded = true;

      try {
        await provider.startApplication(sandbox.containerId, slug, app.internalPort);
        await provider.waitForApplication(sandbox.containerId, app.internalPort, 60_000);
      } catch (previewError) {
        // Not fatal — the repo is usable, it just doesn't have a
        // confirmed-live preview (no dev/start script, or it didn't
        // respond in time). Record why, without downgrading the repo's
        // overall "running" status.
        await prisma.workspaceRepository.update({
          where: { workspaceId_repositoryId: { workspaceId, repositoryId: repo.id } },
          data: {
            error:
              previewError instanceof Error
                ? `Preview unavailable: ${previewError.message}`
                : "Preview unavailable",
          },
        });
      }
    } catch (repoError) {
      const message = repoError instanceof Error ? repoError.message : "Failed to set up this repository";
      await prisma.workspaceRepository.update({
        where: { workspaceId_repositoryId: { workspaceId, repositoryId: repo.id } },
        data: { status: "failed", error: message },
      });
      // Deliberately continue the loop — one repo failing shouldn't stop
      // the others from being attempted.
    }
  }

  if (!anySucceeded) {
    // Nothing usable came out of this — no point keeping the container.
    await provider.destroy(sandbox.containerId).catch(() => undefined);
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: "failed", error: "None of the attached repositories could be set up" },
    });
  }
}

router.post("/", async (req, res, next) => {
  try {
    const body = z
      .object({
        repositoryId: z.string().min(1).optional(),
        repositoryIds: z.array(z.string().min(1)).max(4).optional(),
        name: z.string().trim().min(1).max(120).optional(),
      })
      .parse(req.body);

    const repositoryIds = body.repositoryIds ?? (body.repositoryId ? [body.repositoryId] : []);

    const userId = res.locals.user.id;

    // No repositories: a plain chat-only session. No sandbox is created —
    // one gets provisioned later, on demand, when repos are attached via
    // POST /:id/repos.
    if (repositoryIds.length === 0) {
      const workspace = await prisma.workspace.create({
        data: {
          userId,
          name: body.name || "New chat",
          workspaceKey: randomUUID(),
        },
        include: sessionInclude,
      });
      res.status(201).json({ success: true, data: workspace });
      return;
    }

    const repositories = await prisma.repository.findMany({
      where: { id: { in: repositoryIds }, userId },
    });

    if (repositories.length !== repositoryIds.length) {
      res.status(404).json({ success: false, error: "One or more repositories are not connected to this Devine account" });
      return;
    }
    // Preserve the order the caller requested (findMany doesn't guarantee it).
    const orderedRepos = repositoryIds.map((id) => repositories.find((r) => r.id === id)!);
    const taken = new Set<string>();
    const slugged = orderedRepos.map((repo) => ({ repo, slug: slugForRepo(repo.fullName, taken) }));

    // Everything below returns fast — actual provisioning (container
    // create, clone, install, start) happens in the background below, and
    // the frontend polls GET /:id to watch these rows go from "pending" to
    // "running"/"failed". This is what lets the UI navigate to the session
    // immediately with a loader instead of blocking on however long
    // clone+install+start takes.
    const workspace = await prisma.workspace.create({
      data: {
        userId,
        repositoryId: slugged[0].repo.id,
        name: body.name || (slugged.length > 1 ? slugged.map((s) => s.repo.name).join(" + ") : slugged[0].repo.name),
        workspaceKey: randomUUID(),
        status: "provisioning",
        repositories: {
          create: slugged.map(({ repo, slug }) => ({
            repositoryId: repo.id,
            slug,
            status: "pending",
          })),
        },
      },
      include: sessionInclude,
    });

    void provisionSandboxInBackground(workspace.id, userId, slugged).catch((error) => {
      console.error(`Background provisioning failed for workspace ${workspace.id}:`, error);
    });

    res.status(201).json({ success: true, data: workspace });
  } catch (error) {
    next(error);
  }
});

/**
 * Attaches repositories to a session that doesn't have a sandbox yet
 * (i.e. one created with zero repos, chat-only). Provisions a fresh
 * sandbox sized for exactly these repos, in the background — same
 * pattern as POST / above. Only supported when the session currently has
 * no repositories/sandbox — Docker's port mappings are fixed at
 * container-creation time, so adding repos to an already-provisioned
 * sandbox would require destroying and recreating it (re-cloning
 * everything); that's not implemented here.
 */
router.post("/:id/repos", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { repositoryIds } = z
      .object({ repositoryIds: z.array(z.string().min(1)).min(1).max(4) })
      .parse(req.body);

    const userId = res.locals.user.id;
    const session = await prisma.workspace.findFirst({
      where: { id, userId },
      include: { sandboxes: true, repositories: true },
    });

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    if (session.repositories.length > 0 || session.sandboxes.length > 0) {
      res.status(409).json({
        success: false,
        error: "This session already has repositories attached. Create a new session to use a different set of repositories.",
      });
      return;
    }

    const repositories = await prisma.repository.findMany({
      where: { id: { in: repositoryIds }, userId },
    });

    if (repositories.length !== repositoryIds.length) {
      res.status(404).json({ success: false, error: "One or more repositories are not connected to this Devine account" });
      return;
    }
    const orderedRepos = repositoryIds.map((repoId) => repositories.find((r) => r.id === repoId)!);
    const taken = new Set<string>();
    const slugged = orderedRepos.map((repo) => ({ repo, slug: slugForRepo(repo.fullName, taken) }));

    const updated = await prisma.workspace.update({
      where: { id },
      data: {
        status: "provisioning",
        repositoryId: slugged[0].repo.id,
        name:
          session.name && session.name !== "New chat"
            ? session.name
            : slugged.length > 1
              ? slugged.map((s) => s.repo.name).join(" + ")
              : slugged[0].repo.name,
        repositories: {
          create: slugged.map(({ repo, slug }) => ({
            repositoryId: repo.id,
            slug,
            status: "pending",
          })),
        },
      },
      include: sessionInclude,
    });

    void provisionSandboxInBackground(id, userId, slugged).catch((error) => {
      console.error(`Background provisioning failed for workspace ${id}:`, error);
    });

    res.status(201).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const session = await prisma.workspace.findFirst({
      where: { id, userId: res.locals.user.id },
      include: { sandboxes: true },
    });
    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    for (const sandbox of session.sandboxes) {
      await provider.destroy(sandbox.containerId).catch(() => undefined);
    }
    // WorkspaceRepository, Sandbox, AgentTask, ChatMessage all cascade
    // via the Prisma schema's onDelete: Cascade — one delete is enough.
    await prisma.workspace.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * Builds the repo list + lazy token-fetcher the agent needs for a session,
 * shared by both the buffered and streaming chat endpoints.
 */
async function buildAgentContext(session: {
  id: string;
  userId: string;
  repositories: Array<{ slug: string; status: string; repository: { id: string; fullName: string; githubId: number } }>;
}) {
  // Only repos that actually finished cloning are safe to expose as agent
  // tools — a "pending" repo (still cloning in the background) or a
  // "failed" one has no usable checkout yet, and offering tools for it
  // would just produce confusing "no such directory" errors mid-run.
  const readyRepos = session.repositories.filter((r) => r.status === "running");

  const repos: AgentRepo[] = readyRepos.map((r) => ({
    slug: r.slug,
    fullName: r.repository.fullName,
  }));

  const slugToRepoId = new Map(readyRepos.map((r) => [r.slug, r.repository]));

  const getAccessToken = async (slug: string) => {
    const repo = slugToRepoId.get(slug);
    if (!repo) throw new Error(`Unknown repository slug: ${slug}`);
    const access = await github.getRepoInstallationTokenForUser(session.userId, repo.githubId);
    return access.token;
  };

  return { repos, getAccessToken };
}

router.post("/:id/chat", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { message } = z.object({ message: z.string().trim().min(1).max(20_000) }).parse(req.body);
    const userId = res.locals.user.id;

    const session = await prisma.workspace.findFirst({
      where: { id, userId },
      include: { ...sessionInclude },
    });

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    await prisma.chatMessage.create({ data: { workspaceId: id, role: "user", content: message } });

    const events: unknown[] = [];
    const { repos, getAccessToken } = await buildAgentContext({ ...session, userId });

    const result = await agent.run(
      { containerId: session.sandboxes[0]?.containerId, instruction: message, repos, getAccessToken },
      (event) => events.push(event),
    );

    await prisma.chatMessage.create({
      data: {
        workspaceId: id,
        role: "assistant",
        content: result.message || "Agent finished.",
        metadata: JSON.parse(JSON.stringify({ result, events })),
      },
    });

    await prisma.agentTask.create({
      data: {
        workspaceId: id,
        prompt: message,
        status: result.success ? "completed" : "failed",
        result: JSON.parse(JSON.stringify({ ...result, events })),
      },
    });

    await prisma.workspace.update({ where: { id }, data: { updatedAt: new Date() } });

    res.json({ success: true, data: { ...result, events } });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/chat/stream", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { message } = z.object({ message: z.string().trim().min(1).max(20_000) }).parse(req.body);
    const userId = res.locals.user.id;

    const session = await prisma.workspace.findFirst({
      where: { id, userId },
      include: { ...sessionInclude },
    });

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    await prisma.chatMessage.create({ data: { workspaceId: id, role: "user", content: message } });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    send({ type: "stream_started" });

    const events: unknown[] = [];
    const { repos, getAccessToken } = await buildAgentContext({ ...session, userId });
    let result: Awaited<ReturnType<typeof agent.run>>;

    try {
      result = await agent.run(
        { containerId: session.sandboxes[0]?.containerId, instruction: message, repos, getAccessToken },
        (event) => {
          events.push(event);
          send(event);
        },
      );
    } catch (agentError) {
      // Headers are already flushed at this point (SSE stream is open), so
      // we can't fall through to the normal error-handler middleware —
      // report the failure as an SSE event instead and close the stream.
      const errorMessage =
        agentError instanceof Error ? agentError.message : "Agent failed";

      console.error("Agent run failed mid-stream:", agentError);

      await prisma.chatMessage.create({
        data: {
          workspaceId: id,
          role: "assistant",
          content: `Agent failed: ${errorMessage}`,
          metadata: JSON.parse(JSON.stringify({ error: errorMessage, events })),
        },
      });

      await prisma.agentTask.create({
        data: {
          workspaceId: id,
          prompt: message,
          status: "failed",
          result: JSON.parse(JSON.stringify({ error: errorMessage, events })),
        },
      });

      send({ type: "agent_error", message: errorMessage });
      send({ type: "stream_completed" });
      res.end();
      return;
    }

    await prisma.chatMessage.create({
      data: {
        workspaceId: id,
        role: "assistant",
        content: result.message || "Agent finished.",
        metadata: JSON.parse(JSON.stringify({ result, events })),
      },
    });

    await prisma.agentTask.create({
      data: {
        workspaceId: id,
        prompt: message,
        status: result.success ? "completed" : "failed",
        result: JSON.parse(JSON.stringify({ ...result, events })),
      },
    });

    send({ type: "agent_result", result });
    send({ type: "stream_completed" });
    res.end();
  } catch (error) {
    // Only reaches here for failures *before* SSE headers were sent
    // (e.g. session lookup, validation) — safe to hand off normally.
    next(error);
  }
});

/**
 * Manual "push to GitHub" action, independent of the agent — for when the
 * user just wants to save the current state of a repo without asking the
 * agent to do anything else first.
 */
router.post("/:id/repos/:repositoryId/push", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const repositoryId = z.string().min(1).parse(req.params.repositoryId);
    const { message, branch } = z
      .object({
        message: z.string().trim().min(1).max(500).default("Devine changes"),
        branch: z.string().trim().min(1).max(200).optional(),
      })
      .parse(req.body ?? {});

    const userId = res.locals.user.id;
    const session = await prisma.workspace.findFirst({
      where: { id, userId },
      include: { ...sessionInclude },
    });

    if (!session || !session.sandboxes[0]) {
      res.status(404).json({ success: false, error: "Session or sandbox not found" });
      return;
    }

    const link = session.repositories.find((r) => r.repositoryId === repositoryId);
    if (!link) {
      res.status(404).json({ success: false, error: "Repository is not attached to this session" });
      return;
    }

    const access = await github.getRepoInstallationTokenForUser(userId, link.repository.githubId);
    const result = await provider.pushChanges(
      session.sandboxes[0].containerId,
      link.slug,
      access.token,
      message,
      branch,
    );

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/shell", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { command, repo } = z
      .object({ command: z.string().min(1).max(10_000), repo: z.string().optional() })
      .parse(req.body);
    const session = await prisma.workspace.findFirst({
      where: { id, userId: res.locals.user.id },
      include: { ...sessionInclude },
    });
    if (!session?.sandboxes[0]) {
      res.status(404).json({ success: false, error: "Session or sandbox not found" });
      return;
    }

    const slug = repo || session.repositories[0]?.slug;
    const result = await tools.runCommand(session.sandboxes[0].containerId, command, slug);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/files", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const inputPath = String(req.query.path ?? ".");
    const repo = req.query.repo ? String(req.query.repo) : undefined;
    const session = await prisma.workspace.findFirst({
      where: { id, userId: res.locals.user.id },
      include: { ...sessionInclude },
    });
    if (!session?.sandboxes[0]) {
      res.status(404).json({ success: false, error: "Session or sandbox not found" });
      return;
    }

    const slug = repo || session.repositories[0]?.slug;
    const result = await tools.listFiles(session.sandboxes[0].containerId, inputPath, slug);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * Polls the app inside the sandbox until it responds twice in a row
 * (with a short gap between checks), then reports ready. This is what
 * the frontend calls before hard-reloading the preview iframe after the
 * agent finishes — reloading too early, mid-rebuild, is what causes
 * stale/missing chunk requests (404s) and broken styles after large edits.
 */
router.get("/:id/preview/ready", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const repo = req.query.repo ? String(req.query.repo) : undefined;
    const session = await prisma.workspace.findFirst({
      where: { id, userId: res.locals.user.id },
      include: { ...sessionInclude },
    });
    if (!session?.sandboxes[0]) {
      res.status(404).json({ success: false, error: "Session or sandbox not found" });
      return;
    }

    const containerId = session.sandboxes[0].containerId;
    const link = repo
      ? session.repositories.find((r) => r.slug === repo)
      : session.repositories[0];
    const port = link?.port ?? 3000;

    try {
      await provider.waitForApplication(containerId, port, 25_000);
      // Stabilization check: make sure it's still responding a moment
      // later, not just mid-compile-flicker.
      await new Promise((resolve) => setTimeout(resolve, 700));
      await provider.waitForApplication(containerId, port, 5_000);
      res.json({ success: true, data: { ready: true } });
    } catch (error) {
      res.json({
        success: true,
        data: { ready: false, error: error instanceof Error ? error.message : "Not ready" },
      });
    }
  } catch (error) {
    next(error);
  }
});

router.get("/:id/logs", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const repo = req.query.repo ? String(req.query.repo) : undefined;
    const session = await prisma.workspace.findFirst({
      where: { id, userId: res.locals.user.id },
      include: { ...sessionInclude },
    });
    if (!session?.sandboxes[0]) {
      res.status(404).json({ success: false, error: "Session or sandbox not found" });
      return;
    }
    const slug = repo || session.repositories[0]?.slug;
    const result = await tools.getLogs(session.sandboxes[0].containerId, slug);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
