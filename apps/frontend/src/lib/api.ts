export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed (${response.status})`);
  }
  return data as T;
}

export const api = {
  me: () => request<{ success: boolean; data: User | null }>("/api/auth/me"),
  logout: () => request<{ success: boolean }>("/api/auth/logout", { method: "POST" }),
  githubStatus: () => request<{ success: boolean; data: GithubStatus }>("/api/github/status"),
  githubRepositories: () => request<{ success: boolean; data: GithubRepository[] }>("/api/github/repositories"),
  repositories: () => request<{ success: boolean; data: Repository[] }>("/api/repositories"),
  connectRepository: (githubId: number) => request<{ success: boolean; data: Repository }>("/api/repositories", {
    method: "POST",
    body: JSON.stringify({ githubId }),
  }),
  sessions: () => request<{ success: boolean; data: Session[] }>("/api/sessions"),
  session: (id: string) => request<{ success: boolean; data: Session }>(`/api/sessions/${id}`),
  createSession: (repositoryIds: string[] = [], name?: string) => request<{ success: boolean; data: Session }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ repositoryIds, name }),
  }),
  attachRepositories: (id: string, repositoryIds: string[]) =>
    request<{ success: boolean; data: Session }>(`/api/sessions/${id}/repos`, {
      method: "POST",
      body: JSON.stringify({ repositoryIds }),
    }),
  deleteSession: (id: string) => request<{ success: boolean }>(`/api/sessions/${id}`, { method: "DELETE" }),
  pushRepository: (id: string, repositoryId: string, message: string, branch?: string) =>
    request<{ success: boolean; data: CommandResult }>(`/api/sessions/${id}/repos/${repositoryId}/push`, {
      method: "POST",
      body: JSON.stringify({ message, branch }),
    }),
  files: (id: string, path = ".", repo?: string) =>
    request<{ success: boolean; data: CommandResult }>(
      `/api/sessions/${id}/files?path=${encodeURIComponent(path)}${repo ? `&repo=${encodeURIComponent(repo)}` : ""}`,
    ),
  logs: (id: string, repo?: string) =>
    request<{ success: boolean; data: CommandResult }>(
      `/api/sessions/${id}/logs${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`,
    ),
  previewReady: (id: string, repo?: string) =>
    request<{ success: boolean; data: { ready: boolean; error?: string } }>(
      `/api/sessions/${id}/preview/ready${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`,
    ),
  shell: (id: string, command: string, repo?: string) => request<{ success: boolean; data: CommandResult }>(`/api/sessions/${id}/shell`, {
    method: "POST",
    body: JSON.stringify({ command, repo }),
  }),
};

export async function streamChat(
  id: string,
  message: string,
  onEvent: (event: any) => void,
) {
  const response = await fetch(`${API_URL}/api/sessions/${id}/chat/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Unable to start agent stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        // Ignore malformed SSE frames.
      }
    }
  }
}

export type User = {
  id: string;
  githubId: number;
  githubLogin: string;
  githubName: string | null;
  githubEmail: string | null;
  avatarUrl: string | null;
};

export type GithubStatus = {
  installed: boolean;
  installationCount: number;
  connectedRepositoryCount: number;
};

export type GithubRepository = {
  githubId: number;
  name: string;
  fullName: string;
  owner: string;
  url: string;
  cloneUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  installationId: string;
};

export type Repository = GithubRepository & {
  id: string;
  _count?: { workspaces: number };
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type Session = {
  id: string;
  name: string;
  status: string;
  error: string | null;
  workspaceKey: string;
  repository: Repository | null;
  repositories: Array<{
    id: string;
    slug: string;
    port: number | null;
    previewPort: number | null;
    previewUrl: string | null;
    status: string;
    error: string | null;
    repository: Repository;
  }>;
  sandboxes: Array<{
    id: string;
    containerId: string;
    port: number;
    codeServerPort: number;
    codeServerUrl: string;
    previewUrl: string;
    status: string;
  }>;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }>;
};
