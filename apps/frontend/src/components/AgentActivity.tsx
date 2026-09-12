import { useState } from "react";
import {
  Check,
  ChevronRight,
  FileEdit,
  FileText,
  FolderSearch,
  GitFork,
  Loader2,
  ScrollText,
  TerminalSquare,
  TriangleAlert,
} from "lucide-react";

export type EventLine = {
  type: string;
  tool?: string;
  message?: string;
  input?: Record<string, unknown>;
  output?: unknown;
};

const TOOL_META: Record<
  string,
  { icon: typeof FileText; label: (input?: Record<string, unknown>) => string }
> = {
  list_files: {
    icon: FolderSearch,
    label: (input) => `Exploring ${input?.path ? String(input.path) : "files"}`,
  },
  read_file: {
    icon: FileText,
    label: (input) => `Reading ${input?.path ? String(input.path) : "a file"}`,
  },
  write_file: {
    icon: FileEdit,
    label: (input) => `Editing ${input?.path ? String(input.path) : "a file"}`,
  },
  run_command: {
    icon: TerminalSquare,
    label: (input) => `Running ${input?.command ? String(input.command) : "a command"}`,
  },
  get_logs: {
    icon: ScrollText,
    label: () => "Checking application logs",
  },
  push_changes: {
    icon: GitFork,
    label: (input) => `Pushing ${input?.repo ? String(input.repo) : "changes"} to GitHub`,
  },
};

function outputPreview(output: unknown): string | null {
  if (output == null) return null;
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null && "stdout" in output) {
    const o = output as { stdout?: string; stderr?: string };
    return [o.stdout, o.stderr].filter(Boolean).join("\n") || null;
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return null;
  }
}

function Step({ event, isLatest }: { event: EventLine; isLatest: boolean }) {
  const [open, setOpen] = useState(false);

  if (event.type === "tool_started" || event.type === "tool_completed") {
    const meta = event.tool ? TOOL_META[event.tool] : undefined;
    const Icon = meta?.icon ?? TerminalSquare;
    const label = meta ? meta.label(event.input) : event.tool ?? "Working";
    const running = event.type === "tool_started";
    const preview = outputPreview(event.output);

    return (
      <div className="rounded-lg border border-white/[0.05] bg-white/[0.02]">
        <button
          onClick={() => preview && setOpen((v) => !v)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left ${preview ? "cursor-pointer" : "cursor-default"}`}
        >
          {running ? (
            <Loader2 size={13} className="shrink-0 animate-spin text-zinc-500" />
          ) : (
            <Icon size={13} className="shrink-0 text-zinc-500" />
          )}
          <span className={`min-w-0 flex-1 truncate font-mono text-[12px] ${running ? "text-zinc-400" : "text-zinc-500"}`}>
            {label}
          </span>
          {!running && preview && (
            <ChevronRight
              size={12}
              className={`shrink-0 text-zinc-700 transition-transform ${open ? "rotate-90" : ""}`}
            />
          )}
          {!running && <Check size={12} className="shrink-0 text-emerald-600" />}
        </button>
        {open && preview && (
          <pre className="max-h-56 overflow-auto border-t border-white/[0.05] px-3 py-2 text-[11px] leading-5 text-zinc-600">
            {preview.slice(0, 4000)}
          </pre>
        )}
      </div>
    );
  }

  if (event.type === "agent_error") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2">
        <TriangleAlert size={13} className="mt-0.5 shrink-0 text-red-400" />
        <span className="text-[12px] leading-5 text-red-300">{event.message}</span>
      </div>
    );
  }

  // agent_started / stream_started / other lifecycle markers — only show
  // the very latest one as a subtle status line, skip the rest to avoid
  // clutter once real tool steps are underway.
  if (!isLatest) return null;
  if (event.type === "agent_started" || event.type === "stream_started") {
    return (
      <div className="flex items-center gap-2 px-1 text-[12px] text-zinc-600">
        <Loader2 size={12} className="animate-spin" /> Starting up…
      </div>
    );
  }

  return null;
}

export function AgentActivity({ events, active }: { events: EventLine[]; active: boolean }) {
  const steps = events.filter(
    (e) => e.type !== "agent_completed" && e.type !== "agent_result" && e.type !== "stream_completed",
  );

  if (steps.length === 0 && !active) return null;

  return (
    <div className="mb-5">
      {active && (
        <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-zinc-400">
          <Loader2 size={13} className="animate-spin" /> Devine is working…
        </div>
      )}
      <div className="space-y-1.5">
        {steps.map((event, index) => (
          <Step key={index} event={event} isLatest={index === steps.length - 1} />
        ))}
      </div>
    </div>
  );
}
