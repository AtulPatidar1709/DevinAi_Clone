import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api, type User } from "./lib/api";
import Login from "./pages/login";
import Home from "./pages/home";
import Repositories from "./pages/repositories";
import Session from "./pages/session";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me()
      .then((result) => setUser(result.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-[#111112] text-sm text-zinc-500">Loading Devine…</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="*" element={user ? <AuthenticatedRoutes user={user} setUser={setUser} /> : <Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function AuthenticatedRoutes({ user, setUser }: { user: User; setUser: (user: User | null) => void }) {
  return (
    <Routes>
      <Route path="/" element={<Home user={user} onLogout={() => setUser(null)} />} />
      <Route path="/repositories" element={<Repositories user={user} />} />
      <Route path="/sessions/:id" element={<Session user={user} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
