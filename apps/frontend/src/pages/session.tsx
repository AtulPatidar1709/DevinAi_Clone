import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Code2,
  ExternalLink,
  GitBranch,
  GitFork,
  Loader2,
  Menu,
  RefreshCw,
  Send,
  Shell,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  api,
  streamChat,
  type CommandResult,
  type Session,
  type User,
} from "../lib/api";
import { AgentActivity, type EventLine } from "../components/AgentActivity";
import { RepositoryPicker } from "../components/RepositoryPicker";
import { Markdown } from "../components/Markdown";

export default function SessionPage({ user }: { user: User }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const initialMessage = (location.state as { initialMessage?: string } | null)
    ?.initialMessage;
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [events, setEvents] = useState<EventLine[]>([]);
  const [tab, setTab] = useState<"overview" | "code" | "shell">("overview");
  const [logs, setLogs] = useState<CommandResult | null>(null);
  const [shellCommand, setShellCommand] = useState("");
  const [shellResult, setShellResult] = useState<CommandResult | null>(null);
  const [shellRunning, setShellRunning] = useState(false);
  // Bumping this remounts the preview <iframe> (via `key`), forcing a real
  // network reload instead of relying on the page's own HMR socket to
  // recover. See waitForPreview() below for why this is needed.
  const [previewReloadToken, setPreviewReloadToken] = useState(0);
  const [previewSyncing, setPreviewSyncing] = useState(false);
  const [activeRepoSlug, setActiveRepoSlug] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushMessage, setPushMessage] = useState("");
  // Shown immediately when the user hits send, before the backend has
  // confirmed or streamed anything back — removed once load() pulls the
  // real, persisted version from the DB. Without this the user's own
  // message didn't appear until the *entire* agent run finished.
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const autoSent = useRef(false);

  async function load() {
    const result = await api.session(id);
    setSession(result.data);
    setActiveRepoSlug((current) => current ?? result.data.repositories[0]?.slug ?? null);
    return result.data;
  }

  useEffect(() => {
    load();
  }, [id]);

  // While the sandbox is still being set up in the background (container
  // creation, clone, install, dev-server start), poll for progress instead
  // of leaving the page static — this is what lets us navigate here
  // immediately after "Create session" rather than waiting for the whole
  // setup to finish first.
  useEffect(() => {
    const stillSettingUp =
      session?.status === "provisioning" || (session?.repositories.some((r) => r.status === "pending") ?? false);

    if (!stillSettingUp) return;

    const interval = setInterval(load, 1500);
    return () => clearInterval(interval);
  }, [session?.status, session?.repositories]);

  useEffect(() => {
    const stillProvisioning =
      session?.status === "provisioning" || (session?.repositories.some((r) => r.status === "pending") ?? false);

    if (
      initialMessage &&
      session &&
      !autoSent.current &&
      session.messages.length === 0 &&
      !stillProvisioning
    ) {
      autoSent.current = true;
      send(initialMessage);
    }
  }, [initialMessage, session]);

  // Polls the sandbox until the dev server is confirmed back up (not just
  // "responded once", which can catch it mid-rebuild) before we force the
  // preview iframe to reload. Reloading too early after a large edit is
  // what produces 404s for stale chunk hashes and a page with no CSS.
  async function waitForPreview() {
    setPreviewSyncing(true);
    try {
      await api.previewReady(id, activeRepoSlug ?? undefined);
    } catch {
      // If the check itself fails, still attempt a reload below — better
      // than leaving a guaranteed-stale iframe on screen.
    } finally {
      setPreviewSyncing(false);
      setPreviewReloadToken((token) => token + 1);
    }
  }

  async function send(text = message) {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setMessage("");
    setEvents([]);
    setPendingUserMessage(value);
    let requiresReload = false;
    try {
      await streamChat(id, value, (event) => {
        setEvents((items) => [...items, event]);
        if (event.type === "agent_result" && (event as any).result?.requiresReload) {
          requiresReload = true;
        }
      });
    } catch (error) {
      setEvents((items) => [
        ...items,
        {
          type: "agent_error",
          message: error instanceof Error ? error.message : "Agent failed",
        },
      ]);
    } finally {
      await load();
      setPendingUserMessage(null);
      setSending(false);
      // Next's own dev server already hot-patches most file edits live —
      // same as editing locally. Forcing a hard reload on every message
      // fights that and makes even trivial edits feel slow. Only force
      // one when the agent actually changed dependencies (new/updated
      // package.json, an install command) — that's the one case the
      // already-running dev server genuinely can't pick up on its own.
      if (requiresReload) {
        await waitForPreview();
      }
    }
  }

  async function loadLogs() {
    setTab("overview");
    const result = await api.logs(id, activeRepoSlug ?? undefined);
    setLogs(result.data);
  }

  async function runShell() {
    if (!shellCommand.trim() || shellRunning) return;
    setShellRunning(true);
    try {
      const result = await api.shell(id, shellCommand, activeRepoSlug ?? undefined);
      setShellResult(result.data);
    } catch (error) {
      setShellResult({
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : "Command failed to run",
      });
    } finally {
      setShellRunning(false);
    }
  }

  async function deleteSession() {
    if (!confirm("Delete this session? This will also destroy its sandbox container. This can't be undone.")) return;
    await api.deleteSession(id);
    navigate("/");
  }

  async function attachRepos(repos: Array<{ id: string }>) {
    setAttachPickerOpen(false);
    if (repos.length === 0 || attaching) return;
    setAttaching(true);
    try {
      await api.attachRepositories(id, repos.map((r) => r.id));
      await load();
    } catch (error) {
      setEvents((items) => [
        ...items,
        {
          type: "agent_error",
          message: error instanceof Error ? error.message : "Failed to attach repository",
        },
      ]);
    } finally {
      setAttaching(false);
    }
  }

  async function pushToGithub() {
    const activeRepo = session?.repositories.find((r) => r.slug === activeRepoSlug);
    if (!activeRepo || pushing) return;
    setPushing(true);
    try {
      const result = await api.pushRepository(
        id,
        activeRepo.repository.id,
        pushMessage.trim() || "Devine changes",
      );
      setShellResult(result.data);
      setTab("shell");
      setPushMessage("");
    } catch (error) {
      setShellResult({
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : "Push failed",
      });
      setTab("shell");
    } finally {
      setPushing(false);
    }
  }

  const sandbox = session?.sandboxes?.[0];
  const repos = session?.repositories ?? [];
  const activeRepo = repos.find((r) => r.slug === activeRepoSlug) ?? repos[0];
  const previewUrl = activeRepo?.previewUrl ?? sandbox?.previewUrl ?? null;
  const isProvisioning =
    session?.status === "provisioning" || repos.some((r) => r.status === "pending");

  return (
    <div className="flex h-screen overflow-hidden bg-[#111112] text-zinc-200">
      <aside className="hidden w-[276px] shrink-0 border-r border-white/[0.07] bg-[#101011] lg:flex lg:flex-col">
        <div className="flex h-12 items-center gap-2 px-4">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-white text-xs font-bold text-black">
            D
          </div>
          <span className="text-sm font-medium">{user.githubLogin}</span>
        </div>
        <nav className="px-2">
          <button
            onClick={() => navigate("/")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft size={15} /> New session
          </button>
          <button
            onClick={() => navigate("/repositories")}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-white/5 hover:text-white"
          >
            <GitBranch size={15} /> Repositories
          </button>
        </nav>
        <div className="mt-6 px-4 text-xs uppercase tracking-wider text-zinc-700">
          Session
        </div>
        <div className="mt-2 px-3">
          <div className="rounded-lg bg-white/[0.05] px-3 py-2">
            <div className="truncate text-sm text-zinc-300">
              {session?.name ?? "Loading…"}
            </div>
            <div className="mt-1 space-y-0.5">
              {(session?.repositories ?? []).map((r) => (
                <div key={r.id} className="truncate text-xs text-zinc-700">
                  {r.repository.fullName}
                </div>
              ))}
            </div>
          </div>
          {session && (
            <button
              onClick={deleteSession}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 size={13} /> Delete session
            </button>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="grid h-8 w-8 place-items-center rounded-lg text-zinc-600 hover:bg-white/5 hover:text-white"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-zinc-200">
                {session?.name}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-700">
                <GitBranch size={10} />
                {repos.length
                  ? repos.map((r) => r.repository.fullName).join(" + ")
                  : session?.repository?.fullName}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-md border border-white/[0.06] px-2 py-1 text-[11px] text-zinc-600">
              Agent
            </span>
            <button
              onClick={deleteSession}
              title="Delete session"
              className="grid h-8 w-8 place-items-center rounded-lg text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 size={15} />
            </button>
            <button className="grid h-8 w-8 place-items-center rounded-lg text-zinc-600 hover:bg-white/5 hover:text-white">
              <Menu size={16} />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(420px,1fr)_minmax(420px,1.2fr)]">
          <section className="flex min-h-0 flex-col border-r border-white/[0.06]">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="mx-auto max-w-[640px]">
                {session?.messages.map((item) => (
                  <div
                    key={item.id}
                    className={`mb-5 ${item.role === "user" ? "flex justify-end" : ""}`}
                  >
                    <div
                      className={
                        item.role === "user"
                          ? "max-w-[85%] rounded-2xl bg-[#252528] px-4 py-3 text-sm leading-6 text-zinc-200"
                          : "max-w-[85%]"
                      }
                    >
                      {item.role === "user" ? item.content : <Markdown content={item.content} />}
                    </div>
                  </div>
                ))}
                {pendingUserMessage && (
                  <div className="mb-5 flex justify-end">
                    <div className="max-w-[85%] rounded-2xl bg-[#252528] px-4 py-3 text-sm leading-6 text-zinc-200">
                      {pendingUserMessage}
                    </div>
                  </div>
                )}
                <AgentActivity events={events} active={sending} />
              </div>
            </div>
            <div className="border-t border-white/[0.06] p-4">
              <div className="mx-auto max-w-[640px] rounded-2xl border border-white/10 bg-[#1b1b1d]">
                {repos.length === 0 && (
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
                    <span className="text-xs text-zinc-600">
                      No repository attached — chatting is available, but code changes need one.
                    </span>
                    <button
                      onClick={() => setAttachPickerOpen(true)}
                      disabled={attaching}
                      className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-white/10 disabled:opacity-40"
                    >
                      {attaching ? <Loader2 size={11} className="animate-spin" /> : <GitBranch size={11} />}
                      Attach repository
                    </button>
                  </div>
                )}
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Ask Devine to build features, fix bugs, or work on your code"
                  className="h-24 w-full resize-none bg-transparent px-4 py-3 text-sm leading-6 outline-none placeholder:text-zinc-700"
                />
                <div className="flex items-center justify-between px-3 pb-3">
                  <div className="flex items-center gap-2 text-xs text-zinc-700">
                    <TerminalSquare size={14} />
                    {repos.length === 0 ? "Chat only — no sandbox yet" : "Sandbox connected"}
                  </div>
                  <button
                    onClick={() => send()}
                    disabled={!message.trim() || sending}
                    className="grid h-8 w-8 place-items-center rounded-full bg-white text-black disabled:opacity-30"
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="hidden min-h-0 flex-col bg-[#151516] lg:flex">
            <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/[0.06] px-3">
              <TabButton
                active={tab === "overview"}
                onClick={() => setTab("overview")}
                label="Overview"
              />
              <TabButton
                active={tab === "code"}
                onClick={() => setTab("code")}
                label="Code"
              />
              <TabButton
                active={tab === "shell"}
                onClick={() => setTab("shell")}
                label="Shell"
              />
              {repos.length > 1 && (
                <div className="ml-2 flex items-center gap-1 border-l border-white/[0.06] pl-2">
                  {repos.map((r) => (
                    <button
                      key={r.slug}
                      onClick={() => setActiveRepoSlug(r.slug)}
                      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${activeRepoSlug === r.slug ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-300"}`}
                    >
                      {r.status === "pending" && <Loader2 size={9} className="animate-spin text-zinc-600" />}
                      {r.status === "failed" && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                      {r.repository.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="ml-auto flex items-center gap-1">
                {tab === "overview" && previewUrl && (
                  <button
                    onClick={waitForPreview}
                    disabled={previewSyncing}
                    title="Reload preview"
                    className="grid h-7 w-7 place-items-center rounded-md text-zinc-600 hover:bg-white/5 hover:text-white disabled:opacity-40"
                  >
                    <RefreshCw
                      size={14}
                      className={previewSyncing ? "animate-spin" : ""}
                    />
                  </button>
                )}
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="grid h-7 w-7 place-items-center rounded-md text-zinc-600 hover:bg-white/5 hover:text-white"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
                <button
                  onClick={loadLogs}
                  className="grid h-7 w-7 place-items-center rounded-md text-zinc-600 hover:bg-white/5 hover:text-white"
                >
                  <TerminalSquare size={14} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {tab === "overview" && (
                <div className="h-full p-3">
                  <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#0e0e0f]">
                    <div className="flex h-9 items-center gap-1 border-b border-white/[0.06] px-3">
                      <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                      <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                      <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                      <div className="ml-2 truncate rounded-md bg-white/[0.03] px-2 py-1 text-[10px] text-zinc-700">
                        {previewUrl ?? "Preview unavailable"}
                      </div>
                    </div>
                    {isProvisioning ? (
                      <div className="grid flex-1 place-items-center p-8 text-center">
                        <div className="w-full max-w-sm">
                          <Loader2 size={22} className="mx-auto animate-spin text-zinc-500" />
                          <div className="mt-4 text-sm text-zinc-300">Setting up your sandbox…</div>
                          <p className="mt-1 text-xs text-zinc-700">
                            This runs in the background — feel free to leave this open.
                          </p>
                          <div className="mt-5 space-y-2 text-left">
                            {repos.map((r) => (
                              <div
                                key={r.id}
                                className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                              >
                                {r.status === "pending" && (
                                  <Loader2 size={12} className="shrink-0 animate-spin text-zinc-500" />
                                )}
                                {r.status === "running" && (
                                  <span className="grid h-3 w-3 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                  </span>
                                )}
                                {r.status === "failed" && (
                                  <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                                )}
                                <span className="flex-1 truncate text-xs text-zinc-400">{r.repository.name}</span>
                                <span className="shrink-0 text-[10px] text-zinc-600">
                                  {r.status === "pending" ? "Cloning & installing…" : r.status === "running" ? "Ready" : "Failed"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : previewUrl ? (
                      <div className="relative min-h-0 flex-1">
                        <iframe
                          key={`${activeRepoSlug}-${previewReloadToken}`}
                          title="Sandbox preview"
                          src={previewUrl}
                          className="h-full w-full border-0 bg-white"
                        />
                        {previewSyncing && (
                          <div className="absolute inset-0 grid place-items-center bg-[#0e0e0f]/90 backdrop-blur-sm">
                            <div className="flex flex-col items-center gap-2">
                              <Loader2 size={18} className="animate-spin text-zinc-400" />
                              <span className="text-xs text-zinc-500">
                                Rebuilding preview…
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="grid flex-1 place-items-center p-8 text-center">
                        <div>
                          <div className={`mx-auto grid h-12 w-12 place-items-center rounded-2xl text-zinc-600 ${activeRepo?.status === "failed" ? "bg-red-500/10 text-red-400" : "bg-white/[0.04]"}`}>
                            <Code2 size={20} />
                          </div>
                          <div className="mt-4 text-sm text-zinc-400">
                            {activeRepo?.status === "failed" ? "Setup failed for this repository" : "No live preview yet"}
                          </div>
                          <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-700">
                            {activeRepo?.status === "failed"
                              ? activeRepo.error || "See the Shell tab for more detail."
                              : activeRepo?.error ||
                                "Devine can still inspect, edit and run your repository from the Code and Shell tabs."}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  {logs && (
                    <pre className="mt-3 max-h-48 overflow-auto rounded-xl border border-white/[0.06] bg-black/30 p-3 text-[11px] leading-5 text-zinc-600">
                      {logs.stdout || logs.stderr || "No logs"}
                    </pre>
                  )}
                </div>
              )}
              {tab === "code" && (
                <div className="h-full p-3">
                  {sandbox?.codeServerUrl ? (
                    <iframe
                      title="Sandbox editor"
                      src={`${sandbox.codeServerUrl}/?folder=/workspace`}
                      className="h-full w-full rounded-xl border border-white/[0.07] bg-[#0e0e0f]"
                    />
                  ) : (
                    <div className="grid h-full place-items-center p-8 text-center">
                      <div>
                        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.04] text-zinc-600">
                          <Code2 size={20} />
                        </div>
                        <div className="mt-4 text-sm text-zinc-400">
                          Editor unavailable
                        </div>
                        <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-700">
                          The sandbox isn't reporting a code-server URL for
                          this session.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {tab === "shell" && (
                <div className="flex h-full flex-col p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-600">
                      <Shell size={14} /> Run commands inside {activeRepo?.repository.name ?? "the sandbox"}
                    </div>
                    {activeRepo && (
                      <div className="flex items-center gap-1.5">
                        <input
                          value={pushMessage}
                          onChange={(e) => setPushMessage(e.target.value)}
                          placeholder="Commit message"
                          className="w-40 rounded-md border border-white/10 bg-[#0e0e0f] px-2 py-1 text-[11px] text-zinc-300 outline-none placeholder:text-zinc-700"
                        />
                        <button
                          onClick={pushToGithub}
                          disabled={pushing}
                          className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-white/10 disabled:opacity-40"
                        >
                          {pushing ? <Loader2 size={12} className="animate-spin" /> : <GitFork size={12} />}
                          Push to GitHub
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#0e0e0f] px-3 py-2">
                    <span className="text-xs text-zinc-700">$</span>
                    <input
                      value={shellCommand}
                      onChange={(e) => setShellCommand(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") runShell();
                      }}
                      disabled={shellRunning}
                      placeholder="npm run build"
                      className="w-full bg-transparent text-xs text-zinc-300 outline-none placeholder:text-zinc-700 disabled:opacity-50"
                    />
                    <button
                      onClick={runShell}
                      disabled={shellRunning}
                      className="flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-[11px] text-black disabled:opacity-50"
                    >
                      {shellRunning && <Loader2 size={11} className="animate-spin" />}
                      {shellRunning ? "Running…" : "Run"}
                    </button>
                  </div>
                  <pre className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-white/[0.06] bg-black/30 p-4 text-[11px] leading-5 text-zinc-600">
                    {shellRunning
                      ? "Running…"
                      : shellResult
                        ? `${shellResult.stdout}${shellResult.stderr ? `\n${shellResult.stderr}` : ""}`
                        : "Shell output will appear here."}
                  </pre>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
      <RepositoryPicker
        open={attachPickerOpen}
        onClose={() => setAttachPickerOpen(false)}
        confirmLabel="Attach"
        onConfirm={attachRepos}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-xs ${active ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-300"}`}
    >
      {label}
    </button>
  );
}
