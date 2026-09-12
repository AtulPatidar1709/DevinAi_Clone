import { GithubIcon } from "../lib/github-icon";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, ChevronDown, FileCode2, GitBranch, LogOut, Menu, Plus, Search, Settings, Sparkles, TerminalSquare, Trash2 } from "lucide-react";
import { api, type Repository, type Session, type User } from "../lib/api";
import { RepositoryPicker } from "../components/RepositoryPicker";

export default function Home({ user, onLogout }: { user: User; onLogout: () => void }) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<Repository[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    Promise.all([api.sessions(), api.repositories()]).then(([s, r]) => {
      setSessions(s.data);
      setRepositories(r.data);
    });
  }, []);

  const recent = useMemo(() => sessions.slice(0, 6), [sessions]);

  async function submit() {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      const session = await api.createSession(selectedRepos.map((r) => r.id), message.slice(0, 70));
      navigate(`/sessions/${session.data.id}`, { state: { initialMessage: message } });
    } finally {
      setSending(false);
    }
  }

  async function deleteSession(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    if (!confirm("Delete this session? This will also destroy its sandbox container. This can't be undone.")) return;
    await api.deleteSession(id);
    setSessions((items) => items.filter((s) => s.id !== id));
  }

  async function logout() {
    await api.logout();
    onLogout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-[#111112] text-zinc-200">
      <aside className="fixed inset-y-0 left-0 hidden w-[276px] border-r border-white/[0.07] bg-[#101011] lg:flex lg:flex-col">
        <div className="flex h-12 items-center gap-2 px-4">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-white text-xs font-bold text-black">D</div>
          <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-white/5">{user.githubLogin}<ChevronDown size={13} className="text-zinc-600" /></button>
        </div>
        <nav className="px-2">
          <button onClick={() => { setSelectedRepos([]); setPickerOpen(true); }} className="flex w-full items-center gap-3 rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-white"><Plus size={16} /> New session</button>
          <button className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-white/5 hover:text-zinc-200"><Sparkles size={15} /> Automations</button>
          <button className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-white/5 hover:text-zinc-200"><Bot size={15} /> Security</button>
          <button onClick={() => navigate("/repositories")} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-white/5 hover:text-zinc-200"><GitBranch size={15} /> Repositories</button>
        </nav>
        <div className="mt-7 flex items-center justify-between px-4 text-xs text-zinc-600"><span>Recent</span><Search size={14} /></div>
        <div className="mt-2 flex-1 overflow-y-auto px-2">
          {recent.map((session) => (
            <button key={session.id} onClick={() => navigate(`/sessions/${session.id}`)} className="group mb-1 flex w-full items-center gap-1 rounded-lg px-3 py-2 text-left hover:bg-white/5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-zinc-300">{session.name}</div>
                <div className="mt-1 flex items-center gap-1 text-xs text-zinc-700">
                  <GitBranch size={11} />
                  {session.repositories?.length
                    ? session.repositories.map((r) => r.repository.name).join(" + ")
                    : session.repository?.fullName ?? "No repository"}
                </div>
              </div>
              <span
                onClick={(e) => deleteSession(session.id, e)}
                className="shrink-0 rounded-md p-1.5 text-zinc-700 opacity-0 hover:bg-white/10 hover:text-red-400 group-hover:opacity-100"
                title="Delete session"
              >
                <Trash2 size={13} />
              </span>
            </button>
          ))}
        </div>
        <div className="border-t border-white/[0.06] p-3">
          <button onClick={() => navigate("/repositories")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-white/5 hover:text-zinc-200"><Settings size={15} /> Settings & GitHub access</button>
          <button onClick={logout} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-white/5 hover:text-zinc-200"><LogOut size={15} /> Log out</button>
        </div>
      </aside>

      <main className="min-h-screen lg:pl-[276px]">
        <div className="flex h-12 items-center justify-between border-b border-white/[0.06] px-4 lg:hidden"><button><Menu size={18} /></button><span className="text-sm font-medium">Devine</span><button><Search size={18} /></button></div>
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-5 pb-20">
          <div className="mb-5 flex items-center gap-2 text-2xl font-semibold tracking-tight text-white"><div className="grid h-8 w-8 place-items-center rounded-xl bg-white text-sm font-bold text-black">D</div> Devine</div>
          <div className="w-full max-w-[700px]">
            <div className="rounded-2xl border border-white/10 bg-[#1b1b1d] shadow-[0_25px_80px_rgba(0,0,0,.25)]">
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder="Ask Devine to build features, fix bugs, or work on your code" className="h-28 w-full resize-none bg-transparent px-5 py-4 text-sm leading-6 text-zinc-200 outline-none placeholder:text-zinc-600" />
              <div className="relative flex items-center justify-between border-t border-white/[0.06] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <button onClick={() => setMenuOpen((v) => !v)} className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-white"><Plus size={19} /></button>
                  {menuOpen && <div className="absolute mt-36 w-52 rounded-xl border border-white/10 bg-[#1c1c1f] p-1.5 shadow-2xl"><button onClick={() => { setPickerOpen(true); setMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5"><GitBranch size={15} /> Repositories</button><button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-600"><FileCode2 size={15} /> Files</button><button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-600"><TerminalSquare size={15} /> Shell</button></div>}
                  <button onClick={() => setPickerOpen(true)} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-200"><GitBranch size={14} /> {selectedRepos.length ? selectedRepos.map((r) => r.name).join(" + ") : "Attach repositories (optional)"}</button>
                </div>
                <button disabled={!message.trim() || sending} onClick={submit} className="grid h-8 w-8 place-items-center rounded-full bg-white text-black disabled:cursor-not-allowed disabled:opacity-30"><ChevronDown size={16} className="rotate-[-90deg]" /></button>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-zinc-700"><GithubIcon size={12} /> GitHub connected as {user.githubLogin}</div>
          </div>

          <div className="mt-14 grid w-full max-w-[700px] grid-cols-1 gap-2 sm:grid-cols-3">
            {[{ icon: GitBranch, title: "Repositories", text: `${repositories.length} connected`, action: () => navigate("/repositories") }, { icon: Plus, title: "New session", text: "Start on a repository", action: () => setPickerOpen(true) }, { icon: TerminalSquare, title: "Sandbox", text: "Docker-powered workspace", action: () => undefined }].map((item) => <button key={item.title} onClick={item.action} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left hover:bg-white/[0.04]"><item.icon size={16} className="text-zinc-500" /><div className="mt-3 text-sm font-medium text-zinc-300">{item.title}</div><div className="mt-1 text-xs text-zinc-700">{item.text}</div></button>)}
          </div>
        </div>
      </main>

      <RepositoryPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={(repos) => { setSelectedRepos(repos); setPickerOpen(false); }} />
    </div>
  );
}
