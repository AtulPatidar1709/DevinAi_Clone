import { Router } from "express";
import { z } from "zod";
import { DockerSandboxProvider } from "../sandbox/docker.provider.js";
import { AgentTools } from "./agent.tool.js";
import { AgentService } from "./agent.service.js";
import { requireUser } from "../auth/session.js";

const router = Router();
const provider = new DockerSandboxProvider();
const tools = new AgentTools(provider);
const agent = new AgentService(tools);

// Keep the existing low-level endpoints, but do not expose them anonymously.
router.use(requireUser);

router.post("/prepare", async (req, res, next) => {
  try {
    const { repositoryUrl } = z
      .object({
        repositoryUrl: z.url(),
      })
      .parse(req.body);

    const sandbox = await provider.create(["repository"]);

    try {
      await provider.clone(sandbox.containerId, repositoryUrl, "repository");
      // Install dependencies
      await provider.installDependencies(sandbox.containerId, "repository");
      await provider.startApplication(sandbox.containerId, "repository", 3000);
      await provider.waitForApplication(sandbox.containerId);
    } catch (error) {
      await provider.destroy(sandbox.containerId);
      throw error;
    }

    res.status(201).json({
      success: true,
      data: sandbox,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/execute", async (req, res, next) => {
  try {
    const { containerId, command } = z
      .object({
        containerId: z.string(),
        command: z.string(),
      })
      .parse(req.body);

    const result = await provider.execute(containerId, command);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * List files inside repository.
 */
router.post("/tools/list-files", async (req, res, next) => {
  try {
    const { containerId, path } = z
      .object({
        containerId: z.string(),
        path: z.string().optional(),
      })
      .parse(req.body);

    const result = await tools.listFiles(
      containerId,
      path,
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Read a file inside repository.
 */
router.post("/tools/read-file", async (req, res, next) => {
  try {
    const { containerId, path } = z
      .object({
        containerId: z.string(),
        path: z.string(),
      })
      .parse(req.body);

    const result = await tools.readFile(
      containerId,
      path,
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Write a file inside repository.
 */
router.post("/tools/write-file", async (req, res, next) => {
  try {
    const { containerId, path, content } = z
      .object({
        containerId: z.string(),
        path: z.string(),
        content: z.string(),
      })
      .parse(req.body);

    const result = await tools.writeFile(
      containerId,
      path,
      content,
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Run a command inside repository.
 */
router.post("/tools/run-command", async (req, res, next) => {
  try {
    const { containerId, command } = z
      .object({
        containerId: z.string(),
        command: z.string(),
      })
      .parse(req.body);

    const result = await tools.runCommand(
      containerId,
      command,
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get application logs.
 */
router.post("/tools/logs", async (req, res, next) => {
  try {
    const { containerId } = z
      .object({
        containerId: z.string(),
      })
      .parse(req.body);

    const result = await tools.getLogs(
      containerId,
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/run", async (req, res, next) => {
  try {
    const { containerId, instruction } = z
      .object({
        containerId: z.string(),
        instruction: z.string(),
      })
      .parse(req.body);

    const events: unknown[] = [];

    const result = await agent.run(
      {
        containerId,
        instruction,
        repos: [{ slug: "repository", fullName: "repository" }],
      },
      (event) => {
        // console.log("🔥🔥🔥 AGENT EVENT RECEIVED 🔥🔥🔥");
        // console.log(event);

        events.push(event);
      },
    );

    res.json({
      success: true,
      data: {
        ...result,
        events,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/run/stream", async (req, res, next) => {
  try {
    console.log("SSE 1: request received");

    const { containerId, instruction } = z
      .object({
        containerId: z.string(),
        instruction: z.string(),
      })
      .parse(req.body);

    console.log("SSE 2: body parsed");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.flushHeaders();

    console.log("SSE 3: headers flushed");

    const sendEvent = (event: unknown) => {
      console.log("SSE EVENT:", event);

      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    sendEvent({
      type: "stream_started",
      message: "Agent stream started",
    });

    console.log("SSE 4: starting agent");

    const result = await agent.run(
      {
        containerId,
        instruction,
        repos: [{ slug: "repository", fullName: "repository" }],
      },
      (event) => {
        sendEvent(event);
      },
    );

    console.log("SSE 5: agent finished");

    sendEvent({
      type: "agent_result",
      result,
    });

    sendEvent({
      type: "stream_completed",
    });

    res.end();
  } catch (error) {
    console.error("SSE ERROR:", error);
    next(error);
  }
});

router.delete("/sandbox/:containerId", async (req, res, next) => {
  try {
    const { containerId } = z
      .object({
        containerId: z.string().min(1),
      })
      .parse(req.params);

    await provider.destroy(containerId);

    res.json({
      success: true,
      message: "Sandbox destroyed successfully",
    });
  } catch (error) {
    next(error);
  }
});

export default router;