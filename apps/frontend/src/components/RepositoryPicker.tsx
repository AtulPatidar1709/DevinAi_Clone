import { useEffect, useMemo, useState } from "react";
import { ExternalLink, GitBranch, LockKeyhole, Plus, Search } from "lucide-react";
import { GithubIcon } from "../lib/github-icon";
import { api, type GithubRepository, type Repository, API_URL } from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (repos: Repository[]) => void;
  confirmLabel?: string;
};

export function RepositoryPicker({ open, onClose, onConfirm, confirmLabel = "Create session" }: Props) {
  const [connected, setConnected] = useState<Repository[]>([]);
  const [available, setAvailable] = useState<GithubRepository[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());

    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        const [a, b] = await Promise.all([api.repositories(), api.githubRepositories()]);
        if (mounted) {
          setConnected(a.data);
          setAvailable(b.data);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "An error occurred");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [open]);

  const filteredConnected = useMemo(
    () => connected.filter((repo) => repo.fullName.toLowerCase().includes(query.toLowerCase())),
    [connected, query],
  );

  const connectedIds = new Set(connected.map((repo) => repo.githubId));
  const filteredAvailable = available.filter(
    (repo) => !connectedIds.has(repo.githubId) && repo.fullName.toLowerCase().includes(query.toLowerCase()),
  );

  async function connect(repo: GithubRepository) {
    try {
      const result = await api.connectRepository(repo.githubId);
      setConnected((items) => [result.data, ...items]);
      toggle(result.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect repository");
    }
  }

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 4) {
        next.add(id);
      }
      return next;
    });
  }

  function confirm() {
    const repos = connected.filter((repo) => selectedIds.has(repo.id));
    if (repos.length === 0) return;
    onConfirm(repos);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#1b1b1d] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="border-b border-white/10 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Repositories</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Select up to 4 repositories to attach to this session — e.g. a frontend and a backend repo together.
              </p>
            </div>
            <button onClick={onClose} className="rounded-lg px-3 py-1 text-zinc-500 hover:bg-white/5 hover:text-white">Esc</button>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-[#111113] px-3 py-2">
            <Search size={16} className="text-zinc-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repositories" className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600" />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {loading && <div className="p-6 text-center text-sm text-zinc-500">Loading repositories…</div>}
          {error && <div className="m-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

          <div className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-zinc-600">Connected</div>
          {filteredConnected.map((repo) => {
            const selected = selectedIds.has(repo.id);
            return (
              <button
                key={repo.id}
                onClick={() => toggle(repo.id)}
                className={`flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-white/5 ${selected ? "bg-white/[0.06] ring-1 ring-inset ring-white/20" : ""}`}
              >
                <div
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[10px] font-bold ${selected ? "border-white bg-white text-black" : "border-white/20 text-transparent"}`}
                >
                  ✓
                </div>
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-zinc-300"><GitBranch size={17} /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-100">{repo.fullName}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-zinc-600">
                    {repo.isPrivate && <><LockKeyhole size={11} /> private</>}
                    <span>{repo.defaultBranch}</span>
                  </div>
                </div>
              </button>
            );
          })}

          <div className="px-2 pb-2 pt-5 text-xs font-medium uppercase tracking-wider text-zinc-600">Available from GitHub</div>
          {filteredAvailable.map((repo) => (
            <div key={repo.githubId} className="flex items-center gap-3 rounded-xl p-3 hover:bg-white/5">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-zinc-300"><GithubIcon size={17} /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-100">{repo.fullName}</div>
                <div className="mt-1 text-xs text-zinc-600">{repo.defaultBranch} · {repo.isPrivate ? "private" : "public"}</div>
              </div>
              <button onClick={() => connect(repo)} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10">
                <Plus size={13} /> Add
              </button>
              <a href={repo.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="rounded-lg p-2 text-zinc-600 hover:bg-white/5 hover:text-zinc-200"><ExternalLink size={14} /></a>
            </div>
          ))}

          {!loading && !filteredConnected.length && !filteredAvailable.length && (
            <div className="p-8 text-center">
              <div className="text-sm text-zinc-400">No repositories available.</div>
              <p className="mt-1 text-xs text-zinc-700">Install the Devine GitHub App or update its repository access.</p>
              <a href={`${API_URL}/api/github/install`} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-black"><GithubIcon size={13} /> Manage GitHub access</a>
            </div>
          )}
          {!loading && (
            <div className="mt-3 border-t border-white/[0.06] p-3 text-center">
              <a href={`${API_URL}/api/github/install`} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-200"><GithubIcon size={13} /> Manage GitHub repository access</a>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 bg-[#161618] px-5 py-3">
          <span className="text-xs text-zinc-500">
            {selectedIds.size === 0
              ? "Select at least one repository"
              : `${selectedIds.size} repositor${selectedIds.size === 1 ? "y" : "ies"} selected (max 4)`}
          </span>
          <button
            onClick={confirm}
            disabled={selectedIds.size === 0}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
