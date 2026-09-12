import { GithubIcon } from "../lib/github-icon";
import { API_URL } from "../lib/api";

export default function Login() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#111112] px-5 text-white">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-white text-black text-lg font-bold">D</div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Devine</h1>
        <p className="mt-2 text-sm text-zinc-500">Your AI coding agent, connected to your GitHub repositories.</p>
        <a href={`${API_URL}/api/auth/github`} className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-zinc-200">
          <GithubIcon size={18} /> Continue with GitHub
        </a>
        <p className="mt-4 text-xs leading-5 text-zinc-600">You can choose which repositories Devine can access after signing in.</p>
      </div>
    </main>
  );
}
