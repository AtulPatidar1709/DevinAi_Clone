import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@devine/db";
import { config } from "../../config.js";

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2026-03-10",
};

function appSecretConfigured() {
  return Boolean(
    config.GITHUB_APP_CLIENT_ID &&
      config.GITHUB_APP_CLIENT_SECRET &&
      config.GITHUB_APP_ID,
  );
}

export class GithubAuthService {
  assertConfigured() {
    if (!appSecretConfigured()) {
      throw new Error("GitHub App credentials are not configured");
    }
  }

  async createLoginState() {
    this.assertConfigured();
    const rawState = randomBytes(32).toString("hex");
    const stateHash = createHash("sha256").update(rawState).digest("hex");

    // The state is intentionally stored server-side so the OAuth callback is
    // bound to the browser flow that initiated it.
    await prisma.githubOAuthState.create({
      data: {
        stateHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    return rawState;
  }

  buildLoginUrl(state: string) {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", config.GITHUB_APP_CLIENT_ID);
    url.searchParams.set("redirect_uri", config.GITHUB_CALLBACK_URL);
    url.searchParams.set("state", state);
    // GitHub App user authorization uses the app's fine-grained permissions,
    // not OAuth scopes. See GitHub's Login with GitHub using a GitHub App docs.
    return url.toString();
  }

  async exchangeCode(code: string) {
    this.assertConfigured();

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.GITHUB_APP_CLIENT_ID,
        client_secret: config.GITHUB_APP_CLIENT_SECRET,
        code,
      }),
    });

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || "GitHub OAuth exchange failed");
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      accessTokenExpiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null,
      refreshTokenExpiresAt: data.refresh_token_expires_in
        ? new Date(Date.now() + data.refresh_token_expires_in * 1000)
        : null,
    };
  }

  async githubRequest<T>(token: string, pathname: string, init: RequestInit = {}) {
    const response = await fetch(`${config.GITHUB_API_URL}${pathname}`, {
      ...init,
      headers: {
        ...GITHUB_HEADERS,
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}: ${JSON.stringify(body)}`);
    }

    return body as T;
  }

  async upsertUser(accessToken: string, refreshToken: string | null, accessTokenExpiresAt: Date | null, refreshTokenExpiresAt: Date | null) {
    const profile = await this.githubRequest<{
      id: number;
      login: string;
      name: string | null;
      email: string | null;
      avatar_url: string | null;
    }>(accessToken, "/user");

    let email = profile.email;
    try {
      const emails = await this.githubRequest<Array<{ email: string; primary: boolean; verified: boolean }>>(
        accessToken,
        "/user/emails",
      );
      email = emails.find((item) => item.primary && item.verified)?.email ?? email;
    } catch {
      // Email is optional for this project; profile login is enough.
    }

    return prisma.user.upsert({
      where: { githubId: profile.id },
      update: {
        githubLogin: profile.login,
        githubName: profile.name,
        githubEmail: email,
        avatarUrl: profile.avatar_url,
        githubAccessToken: accessToken,
        githubRefreshToken: refreshToken,
        githubTokenExpiresAt: accessTokenExpiresAt,
        githubRefreshExpiresAt: refreshTokenExpiresAt,
      },
      create: {
        githubId: profile.id,
        githubLogin: profile.login,
        githubName: profile.name,
        githubEmail: email,
        avatarUrl: profile.avatar_url,
        githubAccessToken: accessToken,
        githubRefreshToken: refreshToken,
        githubTokenExpiresAt: accessTokenExpiresAt,
        githubRefreshExpiresAt: refreshTokenExpiresAt,
      },
    });
  }

  async getValidUserToken(user: { id: string; githubAccessToken: string | null; githubRefreshToken: string | null; githubTokenExpiresAt: Date | null; githubRefreshExpiresAt: Date | null }) {
    if (!user.githubAccessToken) throw new Error("GitHub authorization is missing");

    if (!user.githubTokenExpiresAt || user.githubTokenExpiresAt.getTime() > Date.now() + 60_000) {
      return user.githubAccessToken;
    }

    if (!user.githubRefreshToken) {
      throw new Error("GitHub authorization expired. Please sign in with GitHub again.");
    }

    if (user.githubRefreshExpiresAt && user.githubRefreshExpiresAt.getTime() <= Date.now()) {
      throw new Error("GitHub refresh authorization expired. Please sign in with GitHub again.");
    }

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.GITHUB_APP_CLIENT_ID,
        client_secret: config.GITHUB_APP_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: user.githubRefreshToken,
      }),
    });

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
    };

    if (!response.ok || !data.access_token) {
      throw new Error("Unable to refresh GitHub authorization. Please sign in again.");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        githubAccessToken: data.access_token,
        githubRefreshToken: data.refresh_token ?? user.githubRefreshToken,
        githubTokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
        githubRefreshExpiresAt: data.refresh_token_expires_in
          ? new Date(Date.now() + data.refresh_token_expires_in * 1000)
          : user.githubRefreshExpiresAt,
      },
    });

    return data.access_token;
  }
}
