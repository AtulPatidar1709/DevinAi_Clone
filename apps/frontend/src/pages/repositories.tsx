import { GithubIcon } from "../lib/github-icon";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  LockKeyhole,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  api,
  type GithubRepository,
  type Repository,
  type User,
} from "../lib/api";
import { RepositoryPicker } from "../components/RepositoryPicker";

export default function Repositories({ user }: { user: User }) {
  const navigate = useNavigate();
  const [connected, setConnected] = useState<Repository[]>([]);
  const [available, setAvailable] = useState<GithubRepository[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        api.repositories(),
        api.githubRepositories(),
      ]);
      setConnected(a.data);
      setAvailable(b.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function install() {
    setInstalling(true);
    window.location.href = `${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}/api/github/install`;
  }

  return (
    <div className="min-h-screen bg-[#111112] text-zinc-200">
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#111112]/90 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-sm text-zinc-500 hover:text-white"
          >
            <ArrowLeft size={16} /> Home
          </button>
          <div className="flex items-center gap-2 text-sm">
            <img src={user.avatarUrl ?? ""} className="h-6 w-6 rounded-full" />{" "}
            {user.githubLogin}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs text-zinc-600">
              <GithubIcon size={13} /> GitHub access
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              Repositories
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">
              Manage the repositories available to your Devine sessions. GitHub
              App access is global; each sandbox simply chooses one of these
              repositories.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={load}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-zinc-500 hover:bg-white/5 hover:text-white"
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-zinc-200"
            >
              <Plus size={16} /> Add repository
            </button>
          </div>
        </div>

        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-600">
              Connected to Devine · {connected.length}
            </h2>
            {!available.length && !loading && (
              <button
                onClick={install}
                disabled={installing}
                className="text-xs text-zinc-500 underline-offset-4 hover:text-white hover:underline"
              >
                {installing ? "Opening GitHub…" : "Manage GitHub access"}
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#171718]">
            {connected.map((repo) => (
              <div
                key={repo.id}
                className="flex items-center gap-4 border-b border-white/[0.06] p-4 last:border-0"
              >
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-zinc-300">
                  <GitBranch size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">
                    {repo.fullName}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-zinc-600">
                    <span>{repo.defaultBranch}</span>
                    {repo.isPrivate && (
                      <>
                        <span>·</span>
                        <LockKeyhole size={11} /> private
                      </>
                    )}
                    <span>·</span>
                    <span>{repo._count?.workspaces ?? 0} sessions</span>
                  </div>
                </div>
                <a
                  href={repo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg p-2 text-zinc-600 hover:bg-white/5 hover:text-zinc-200"
                >
                  <ExternalLink size={15} />
                </a>
              </div>
            ))}
            {!connected.length && !loading && (
              <div className="p-10 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.04] text-zinc-600">
                  <GithubIcon size={21} />
                </div>
                <div className="mt-4 text-sm text-zinc-300">
                  No repositories connected yet
                </div>
                <p className="mt-1 text-xs text-zinc-600">
                  Install the Devine GitHub App and select the repositories you
                  want to use.
                </p>
                <button
                  onClick={install}
                  className="mt-5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
                >
                  Connect GitHub repositories
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-600">
            Available through GitHub App
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {available
              .filter(
                (repo) =>
                  !connected.some((item) => item.githubId === repo.githubId),
              )
              .map((repo) => (
                <div
                  key={repo.githubId}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.05]">
                      <GithubIcon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-zinc-300">
                        {repo.fullName}
                      </div>
                      <div className="mt-1 text-xs text-zinc-700">
                        {repo.isPrivate ? "Private" : "Public"} ·{" "}
                        {repo.defaultBranch}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const result = await api.connectRepository(
                          repo.githubId,
                        );
                        setConnected((items) => [result.data, ...items]);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-lg bg-white text-black hover:bg-zinc-200"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </section>
      </main>
      <RepositoryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        confirmLabel="Done"
        onConfirm={(repos) => {
          setConnected((items) => {
            const existingIds = new Set(items.map((x) => x.id));
            const additions = repos.filter((r) => !existingIds.has(r.id));
            return [...additions, ...items];
          });
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
