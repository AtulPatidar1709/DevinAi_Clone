import { config } from "../../config.js";
import { AgentTools } from "./agent.tool.js";
import { LLMClient, type LLMMessage, type LLMTool } from "./llm/llm.client.js";

export interface AgentRepo {
  slug: string;
  fullName: string;
  previewPort?: number;
}

export interface AgentRequest {
  /** Absent when the session has no repositories attached yet — the agent
   * runs in plain-conversation mode with no tools available. */
  containerId?: string;
  instruction: string;
  repos: AgentRepo[];
  /** Used only if the model calls push_changes. Fetches a fresh, short-lived
   * GitHub token for the given repo slug — kept lazy rather than passed in
   * upfront since agent runs can outlive a single installation token. */
  getAccessToken?: (slug: string) => Promise<string>;
}

export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
}

export interface AgentEvent {
  type:
    | "agent_started"
    | "tool_started"
    | "tool_completed"
    | "agent_completed"
    | "agent_error";

  tool?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  message?: string;
}

export class AgentService {
  private readonly llm: LLMClient;

  constructor(private readonly tools: AgentTools) {
    this.llm = new LLMClient({
      baseUrl: config.LLM_BASE_URL,
      apiKey: config.LLM_API_KEY,
    });
  }

  private getToolDefinitions(repos: AgentRepo[]): LLMTool[] {
    if (repos.length === 0) return [];

    const slugs = repos.map((r) => r.slug);
    const repoParam = {
      type: "string",
      description:
        repos.length > 1
          ? `Which repository to target. One of: ${slugs.join(", ")}.`
          : `Which repository to target (only "${slugs[0]}" is attached).`,
      enum: slugs,
    };

    return [
      {
        type: "function",
        function: {
          name: "list_files",
          description: "List files inside one of the user's repositories.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Directory path relative to the repository root.",
              },
              repo: repoParam,
            },
            required: repos.length > 1 ? ["path", "repo"] : ["path"],
          },
        },
      },

      {
        type: "function",
        function: {
          name: "read_file",
          description:
            "Read the contents of a file inside one of the user's repositories.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "File path relative to the repository root.",
              },
              repo: repoParam,
            },
            required: repos.length > 1 ? ["path", "repo"] : ["path"],
          },
        },
      },

      {
        type: "function",
        function: {
          name: "write_file",
          description: "Write or replace a file inside one of the user's repositories.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "File path relative to the repository root.",
              },
              content: {
                type: "string",
                description: "Complete new file contents.",
              },
              repo: repoParam,
            },
            required: repos.length > 1 ? ["path", "content", "repo"] : ["path", "content"],
          },
        },
      },

      {
        type: "function",
        function: {
          name: "run_command",
          description: "Run a shell command inside one of the user's repositories.",
          parameters: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "Shell command to execute.",
              },
              repo: repoParam,
            },
            required: repos.length > 1 ? ["command", "repo"] : ["command"],
          },
        },
      },

      {
        type: "function",
        function: {
          name: "get_logs",
          description: "Get dev-server logs for one of the user's running applications.",
          parameters: {
            type: "object",
            properties: {
              repo: repoParam,
            },
          },
        },
      },

      {
        type: "function",
        function: {
          name: "push_changes",
          description:
            "Commit and push all pending changes in a repository back to its GitHub remote. Only call this when the user has asked for changes to be pushed/saved to GitHub.",
          parameters: {
            type: "object",
            properties: {
              repo: repoParam,
              message: {
                type: "string",
                description: "Commit message summarizing the change.",
              },
              branch: {
                type: "string",
                description:
                  "Optional branch name to push to. Defaults to the repository's current branch.",
              },
            },
            required: repos.length > 1 ? ["repo", "message"] : ["message"],
          },
        },
      },
    ];
  }

  private resolveSlug(repos: AgentRepo[], requested: unknown): string {
    const slug = typeof requested === "string" && requested.trim() ? requested.trim() : repos[0]?.slug;

    if (!slug || !repos.some((r) => r.slug === slug)) {
      throw new Error(
        `Unknown repository "${String(requested)}". Attached repositories: ${repos
          .map((r) => r.slug)
          .join(", ")}`,
      );
    }

    return slug;
  }

  private async executeTool(
    request: AgentRequest,
    name: string,
    argumentsJson: string,
  ): Promise<unknown> {
    let args: Record<string, unknown>;

    try {
      args = JSON.parse(argumentsJson);
    } catch {
      throw new Error(`Invalid arguments for tool ${name}`);
    }

    const { containerId, repos } = request;

    if (!containerId) {
      // Defensive — shouldn't happen since no tools are offered to the
      // model when a session has no attached repos/sandbox.
      throw new Error("No sandbox is available for this session yet.");
    }

    switch (name) {
      case "list_files":
        return this.tools.listFiles(
          containerId,
          String(args.path ?? "").trim() || ".",
          this.resolveSlug(repos, args.repo),
        );

      case "read_file":
        return this.tools.readFile(
          containerId,
          String(args.path),
          this.resolveSlug(repos, args.repo),
        );

      case "write_file":
        return this.tools.writeFile(
          containerId,
          String(args.path),
          String(args.content ?? ""),
          this.resolveSlug(repos, args.repo),
        );

      case "run_command":
        return this.tools.runCommand(
          containerId,
          String(args.command),
          this.resolveSlug(repos, args.repo),
        );

      case "get_logs":
        return this.tools.getLogs(containerId, this.resolveSlug(repos, args.repo));

      case "push_changes": {
        const slug = this.resolveSlug(repos, args.repo);

        if (!request.getAccessToken) {
          throw new Error("Pushing changes is not available for this session");
        }

        const accessToken = await request.getAccessToken(slug);

        return this.tools.pushChanges(
          containerId,
          slug,
          accessToken,
          String(args.message ?? "Devine agent changes"),
          typeof args.branch === "string" && args.branch.trim() ? args.branch.trim() : undefined,
        );
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /**
   * Whether the preview needs a hard reload after this run. Next's own dev
   * server already hot-patches most edits live (same as running it
   * locally) — forcing a reload on every message defeats that and makes
   * even trivial edits feel slow. A reload is only actually needed when
   * something changed that the running dev-server process can't pick up
   * on its own: new/changed dependencies, which require reinstalling and
   * the server noticing a fresh node_modules.
   */
  private computeRequiresReload(steps: AgentStep[]): boolean {
    const installPattern = /\b(npm|yarn|pnpm|bun)\s+(install|ci|add)\b/i;

    return steps.some((step) => {
      if (step.tool === "write_file" && typeof step.input.path === "string") {
        return /(^|\/)package(-lock)?\.json$/.test(step.input.path);
      }
      if (step.tool === "run_command" && typeof step.input.command === "string") {
        return installPattern.test(step.input.command);
      }
      return false;
    });
  }

  async run(request: AgentRequest, onEvent?: (event: AgentEvent) => void) {
    onEvent?.({
      type: "agent_started",
      message: "Agent started",
    });

    const systemPrompt =
      request.repos.length === 0
        ? `
You are Devine, an AI coding assistant.

No repository is attached to this session yet, so you're in plain-conversation mode: you have no tools and cannot read, write, or run any code right now.

You can freely:
- discuss ideas and requirements
- plan an approach or architecture
- explain code concepts, patterns, or trade-offs
- help design what to build before any repository exists

If the user asks you to actually make changes, run commands, or inspect real files, tell them plainly that you'll need a repository attached to this session first, and that they can do that from the session page whenever they're ready — don't pretend to have made changes you didn't.

Format answers using markdown where it aids clarity: headers for sections, tables for structured comparisons, bullet lists for multi-part explanations, and fenced code blocks for code snippets.
`.trim()
        : `
You are Devine, an autonomous coding agent.

You work inside a sandbox containing ${request.repos.length > 1 ? "the user's repositories" : "the user's repository"}.

${
  request.repos.length > 1
    ? `Attached repositories (pass the "repo" argument matching one of these slugs on every tool call):
${request.repos.map((r) => `- ${r.slug} (${r.fullName})`).join("\n")}
`
    : `Attached repository: ${request.repos[0]?.fullName ?? "repository"}`
}

Your goal is to safely modify the repositor${request.repos.length > 1 ? "ies" : "y"} according to the user's instruction and verify that your changes work.

Follow this workflow:

1. INSPECT
   - Start by inspecting the repository structure${request.repos.length > 1 ? " of each relevant repository" : ""}.
   - Identify the framework, language, package manager, and relevant project files.
   - Read the files relevant to the user's request.
   - Never assume the contents of a file when you can inspect it.

2. PLAN
   - Determine the smallest reasonable change required.
   - Avoid modifying unrelated files.
   - Prefer existing project patterns and conventions.
   ${request.repos.length > 1 ? "- If the change spans both repositories (e.g. an API contract), keep them consistent." : ""}

3. MODIFY
   - Use write_file only when a change is actually required.
   - Preserve existing code that is unrelated to the user's request.
   - Do not rewrite an entire file when a smaller change is sufficient.

4. VALIDATE
   - The dev server is already running with hot-reload for every repo — you do NOT need to (re)start it, and editing files is enough for changes to reach the live preview automatically.
   - Scale validation to the size of the change. For a small, targeted edit (copy tweak, style change, a few lines), a quick sanity check is enough — e.g. re-reading the changed file, or a lightweight lint/typecheck if one's fast — not a full production build.
   - Reserve a full "npm run build" for changes where it's actually warranted: structural changes, new dependencies, or when the user explicitly asks you to verify the build.
   - Never re-run "npm install" unless you actually changed package.json/package-lock (added, removed, or updated a dependency) — dependencies were already installed once when this session started.
   - Do not claim that a change works unless whatever validation you did actually succeeded.

5. RECOVER
   - If validation fails, inspect the error output.
   - Determine the likely cause.
   - Read the relevant files if necessary.
   - Make a targeted fix.
   - Run the validation command again.
   - Repeat only when necessary.

6. PUSH (only if explicitly requested)
   - Only call push_changes if the user explicitly asked you to push, save, or commit changes to GitHub.
   - Never push automatically just because validation succeeded.

7. FINISH
   - Stop once the requested change is complete and validation succeeds.
   - Clearly explain:
     - what files were changed (and in which repository, if more than one)
     - what was changed
     - what validation was performed
     - whether validation succeeded
     - whether changes were pushed to GitHub
   - Format answers using markdown where it aids clarity: headers for sections, tables for structured comparisons (e.g. project layout, file/role/tech breakdowns), bullet lists for multi-part explanations, and fenced code blocks for code/commands/output.

Safety rules:

- Never modify unrelated files.
- Never invent file contents when they can be inspected.
- Never expose or request secrets such as API keys, passwords, or .env values.
- Do not modify .git, node_modules, or generated build directories unless explicitly required.
- Do not claim success when a command failed.
- Keep changes minimal and focused.
`.trim();

    const messages: LLMMessage[] = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: request.instruction,
      },
    ];

    const steps: AgentStep[] = [];

    const maxIterations = 15;
    const maxToolCalls = 30;
    let totalToolCalls = 0;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const tools = this.getToolDefinitions(request.repos);

      const response = await this.llm.chat({
        model: config.LLM_MODEL,
        messages,
        tools: tools.length > 0 ? tools : undefined,
      });

      if (response.content) {
        messages.push({
          role: "assistant",
          content: response.content,
          tool_calls:
            response.toolCalls.length > 0 ? response.toolCalls : undefined,
        });
      } else {
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: response.toolCalls,
        });
      }

      if (response.toolCalls.length === 0) {
        onEvent?.({
          type: "agent_completed",
          message: response.content ?? "Agent completed successfully",
        });

        return {
          success: true,
          message: response.content,
          steps,
          requiresReload: this.computeRequiresReload(steps),
        };
      }

      for (const toolCall of response.toolCalls) {
        totalToolCalls++;

        if (totalToolCalls > maxToolCalls) {
          const message = `Maximum number of tool calls exceeded (${maxToolCalls})`;

          onEvent?.({
            type: "agent_error",
            message,
          });

          return {
            success: false,
            message,
            steps,
            requiresReload: this.computeRequiresReload(steps),
          };
        }

        const toolName = toolCall.function.name;

        let toolInput: Record<string, unknown>;

        try {
          toolInput = JSON.parse(toolCall.function.arguments);
        } catch {
          const message = `Invalid arguments for tool ${toolName}`;

          onEvent?.({
            type: "agent_error",
            tool: toolName,
            message,
          });

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error: message,
            }),
          });

          continue;
        }

        // Notify that the tool started
        onEvent?.({
          type: "tool_started",
          tool: toolName,
          input: toolInput,
        });

        try {
          const output = await this.executeTool(
            request,
            toolName,
            toolCall.function.arguments,
          );

          // Notify that the tool completed
          onEvent?.({
            type: "tool_completed",
            tool: toolName,
            input: toolInput,
            output,
          });

          steps.push({
            tool: toolName,
            input: toolInput,
            output,
          });

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(output),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          // Notify that the tool failed
          onEvent?.({
            type: "agent_error",
            tool: toolName,
            input: toolInput,
            message,
          });

          // Give the error back to the LLM
          // so it can decide what to do next.
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error: message,
            }),
          });
        }
      }
    }

    const message =
      "Agent stopped because the maximum number of iterations was reached.";

    onEvent?.({
      type: "agent_error",
      message,
    });

    return {
      success: false,
      message,
      steps,
      requiresReload: this.computeRequiresReload(steps),
    };
  }
}
