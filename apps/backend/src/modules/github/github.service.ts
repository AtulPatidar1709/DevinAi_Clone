import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { App } from "octokit";
import { prisma } from "@devine/db";
import { config } from "../../config.js";
import { GithubAuthService } from "../auth/github-auth.service.js";

export interface GithubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  default_branch: string | null;
  private: boolean;
  owner: { login: string };
}

function privateKey() {
  return config.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
}

export class GithubService {
  private readonly auth = new GithubAuthService();

  private verifyWebhookSignature(req: Request): boolean {
    const secret = config.GITHUB_WEBHOOK_SECRET;

    if (!secret) {
      throw new Error("GITHUB_WEBHOOK_SECRET is not configured");
    }

    // Express request headers are a plain object, not a Fetch Headers
    // instance — use bracket/property access, not `.get()`.
    const signature = req.headers["x-hub-signature-256"] as string | undefined;

    if (!signature) {
      return false;
    }

    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      throw new Error(
        "GitHub webhook requires the raw request body. Configure express.raw() for /api/github/webhook.",
      );
    }

    const expectedSignature =
      "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

    const received = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);

    if (received.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(received, expected);
  }

  private async handleInstallationWebhook(payload: Record<string, any>) {
    const action = payload.action;

    const installation = payload.installation;

    if (!installation) {
      console.warn(
        "[GitHub Webhook] installation event without installation payload",
      );
      return;
    }

    const installationId = Number(installation.id);

    if (!Number.isInteger(installationId)) {
      console.warn("[GitHub Webhook] Invalid installation ID");
      return;
    }

    console.log(
      `[GitHub Webhook] installation action=${action} installationId=${installationId}`,
    );

    /**
     * installation.created
     */
    if (action === "created") {
      const account = installation.account;

      if (!account) {
        console.warn("[GitHub Webhook] Installation has no account");
        return;
      }

      /**
       * The important part here is finding the Devine user.
       *
       * Your installation flow already creates GithubInstallState
       * before sending the user to GitHub.
       *
       * completeInstall() already creates GithubInstallation,
       * so normally this event may arrive before/after that callback.
       *
       * Therefore we don't blindly create a user association here.
       */
      const existingInstallation = await prisma.githubInstallation.findUnique({
        where: {
          installationId,
        },
      });

      if (!existingInstallation) {
        console.log(
          `[GitHub Webhook] Installation ${installationId} received before Devine setup callback`,
        );

        return;
      }

      await prisma.githubInstallation.update({
        where: {
          installationId,
        },
        data: {
          accountId: Number(account.id),
          accountLogin: account.login,
          accountType: account.type,
          repositorySelection: installation.repository_selection,
        },
      });

      console.log(`[GitHub Webhook] Installation ${installationId} updated`);

      return;
    }

    /**
     * installation.deleted
     */
    if (action === "deleted") {
      await this.removeInstallation(installationId);

      return;
    }

    /**
     * Other installation events:
     *
     * suspend
     * unsuspend
     * new_permissions_accepted
     */
    if (
      action === "suspend" ||
      action === "unsuspend" ||
      action === "new_permissions_accepted"
    ) {
      const existingInstallation = await prisma.githubInstallation.findUnique({
        where: {
          installationId,
        },
      });

      if (!existingInstallation) {
        return;
      }

      await prisma.githubInstallation.update({
        where: {
          installationId,
        },
        data: {
          repositorySelection: installation.repository_selection,
        },
      });
    }
  }

  private async handleInstallationRepositoriesWebhook(
    payload: Record<string, any>,
  ) {
    const action = payload.action;

    const installationId = Number(payload.installation?.id);

    if (!Number.isInteger(installationId)) {
      console.warn("[GitHub Webhook] Invalid installation ID");
      return;
    }

    const installation = await prisma.githubInstallation.findUnique({
      where: {
        installationId,
      },
    });

    if (!installation) {
      console.warn(
        `[GitHub Webhook] Installation ${installationId} is not connected to a Devine user`,
      );

      return;
    }

    console.log(
      `[GitHub Webhook] installation_repositories action=${action} installationId=${installationId}`,
    );

    /**
     * GitHub gives us repositories_added
     * and repositories_removed.
     */

    const addedRepositories = Array.isArray(payload.repositories_added)
      ? payload.repositories_added
      : [];

    const removedRepositories = Array.isArray(payload.repositories_removed)
      ? payload.repositories_removed
      : [];

    /**
     * ADD repositories
     */
    for (const githubRepo of addedRepositories) {
      await prisma.repository.upsert({
        where: {
          userId_githubId: {
            userId: installation.userId,
            githubId: Number(githubRepo.id),
          },
        },

        update: {
          installationId: installation.id,
          owner: githubRepo.owner?.login ?? "",
          name: githubRepo.name,
          fullName: githubRepo.full_name,
          url: githubRepo.html_url,
          cloneUrl: githubRepo.clone_url,
          defaultBranch: githubRepo.default_branch ?? "main",
          isPrivate: Boolean(githubRepo.private),
        },

        create: {
          userId: installation.userId,
          installationId: installation.id,
          githubId: Number(githubRepo.id),
          owner: githubRepo.owner?.login ?? "",
          name: githubRepo.name,
          fullName: githubRepo.full_name,
          url: githubRepo.html_url,
          cloneUrl: githubRepo.clone_url,
          defaultBranch: githubRepo.default_branch ?? "main",
          isPrivate: Boolean(githubRepo.private),
        },
      });

      console.log(
        `[GitHub Webhook] Repository connected: ${githubRepo.full_name}`,
      );
    }

    /**
     * REMOVE repositories
     */
    for (const githubRepo of removedRepositories) {
      const githubId = Number(githubRepo.id);

      if (!Number.isInteger(githubId)) {
        continue;
      }

      await prisma.repository.deleteMany({
        where: {
          userId: installation.userId,
          githubId,
        },
      });

      console.log(
        `[GitHub Webhook] Repository disconnected: ${githubRepo.full_name}`,
      );
    }

    /**
     * Update installation repository selection.
     */
    if (payload.installation) {
      await prisma.githubInstallation.update({
        where: {
          installationId,
        },

        data: {
          repositorySelection: payload.installation.repository_selection,
        },
      });
    }
  }

  private async removeInstallation(installationId: number) {
    const installation = await prisma.githubInstallation.findUnique({
      where: {
        installationId,
      },
    });

    if (!installation) {
      return;
    }

    /**
     * Remove repositories belonging to this
     * GitHub installation.
     */
    await prisma.repository.deleteMany({
      where: {
        installationId: installation.id,
      },
    });

    await prisma.githubInstallation.delete({
      where: {
        installationId,
      },
    });

    console.log(`[GitHub Webhook] Installation ${installationId} removed`);
  }

  private async handleInstallationDeletedWebhook(payload: Record<string, any>) {
    const installationId = Number(payload.installation?.id);

    if (!Number.isInteger(installationId)) {
      return;
    }

    await this.removeInstallation(installationId);
  }

  async handleWebhook(req: Request) {
    const isValid = this.verifyWebhookSignature(req);

    if (!isValid) {
      throw new Error("Invalid GitHub webhook signature");
    }

    const event = req.headers["x-github-event"] as string | undefined;

    if (!event) {
      throw new Error("Missing x-github-event header");
    }

    const payload = JSON.parse((req.body as any).toString("utf8")) as Record<
      string,
      any
    >;

    console.log(`[GitHub Webhook] event=${event}`);

    switch (event) {
      /**
       * User installed the GitHub App.
       */
      case "installation": {
        await this.handleInstallationWebhook(payload);
        break;
      }

      /**
       * User changed the repositories selected
       * for the GitHub App.
       */
      case "installation_repositories": {
        await this.handleInstallationRepositoriesWebhook(payload);
        break;
      }

      /**
       * User removed the GitHub App.
       */
      case "installation_deleted": {
        await this.handleInstallationDeletedWebhook(payload);
        break;
      }

      default: {
        console.log(`[GitHub Webhook] Ignoring event: ${event}`);
      }
    }
  }

  private getApp() {
    if (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY) {
      throw new Error("GitHub App ID/private key are not configured");
    }

    return new App({
      appId: Number(config.GITHUB_APP_ID),
      privateKey: privateKey(),
    });
  }

  async createInstallUrl(userId: string, suggestedTargetId?: number) {
    if (!config.GITHUB_APP_SLUG)
      throw new Error("GITHUB_APP_SLUG is not configured");

    const state = randomBytes(32).toString("hex");
    const stateHash = createHash("sha256").update(state).digest("hex");

    console.log(
      "Create Insall Url inside Backend State Hash" +
        stateHash +
        "UserID " +
        userId,
    );

    const data = await prisma.githubInstallState.create({
      data: {
        stateHash,
        userId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const url = new URL(
      `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`,
    );

    url.searchParams.set("state", state);

    console.log("Full Url after installation , " , url);

    if (suggestedTargetId) {
      url.searchParams.set("suggested_target_id", String(suggestedTargetId));
    }

    console.log(
      "Full Url after suggestedTargetId passes condition installation , ",
      url.toString(),
    );

    return url.toString();
  }

  async completeInstall(state: string, installationId: number) {
    const stateHash = createHash("sha256").update(state).digest("hex");
    const stateRecord = await prisma.githubInstallState.findUnique({
      where: { stateHash },
    });

    if (!stateRecord || stateRecord.expiresAt <= new Date()) {
      throw new Error("GitHub installation state is invalid or expired");
    }

    const user = await prisma.user.findUnique({
      where: { id: stateRecord.userId },
    });
    if (!user) throw new Error("Devine user not found");

    const userToken = await this.auth.getValidUserToken(user);
    const installations = await this.auth.githubRequest<{
      installations: Array<{
        id: number;
        account: { id: number; login: string; type: string };
        repository_selection: string;
      }>;
    }>(userToken, "/user/installations");

    const installation = installations.installations.find(
      (item) => item.id === installationId,
    );
    if (!installation) {
      throw new Error(
        "The GitHub installation does not belong to the signed-in GitHub user",
      );
    }

    await prisma.githubInstallation.upsert({
      where: { installationId },
      update: {
        userId: user.id,
        accountId: installation.account.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        repositorySelection: installation.repository_selection,
      },
      create: {
        installationId,
        userId: user.id,
        accountId: installation.account.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        repositorySelection: installation.repository_selection,
      },
    });

    await prisma.githubInstallState.delete({ where: { id: stateRecord.id } });
  }

  async listAccessibleRepositories(
    userId: string,
  ): Promise<Array<GithubRepository & { installationId: string }>> {
    const installations = await prisma.githubInstallation.findMany({
      where: { userId },
    });
    const result: Array<GithubRepository & { installationId: string }> = [];
    const seen = new Set<number>();

    for (const installation of installations) {
      const octokit = await this.getInstallationOctokit(
        installation.installationId,
      );
      let page = 1;

      while (true) {
        const response = await octokit.request(
          "GET /installation/repositories",
          {
            per_page: 100,
            page,
          },
        );
        const repos = response.data.repositories as GithubRepository[];
        for (const repo of repos) {
          if (!seen.has(repo.id)) {
            seen.add(repo.id);
            result.push({ ...repo, installationId: installation.id });
          }
        }
        if (repos.length < 100) break;
        page++;
      }
    }

    return result;
  }

  async getInstallationOctokit(installationId: number) {
    const app = this.getApp();
    return app.getInstallationOctokit(installationId);
  }

  async getRepositoryForUser(userId: string, githubId: number) {
    const repos = await this.listAccessibleRepositories(userId);
    return repos.find((repo) => repo.id === githubId) ?? null;
  }

  async syncRepositoryToDevine(userId: string, githubId: number) {
    const repo = await this.getRepositoryForUser(userId, githubId);
    if (!repo) {
      throw new Error("Repository is not currently authorized for Devine");
    }

    return prisma.repository.upsert({
      where: { userId_githubId: { userId, githubId } },
      update: {
        installationId: repo.installationId,
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch || "main",
        isPrivate: repo.private,
      },
      create: {
        userId,
        installationId: repo.installationId,
        githubId: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch || "main",
        isPrivate: repo.private,
      },
    });
  }

  async getRepoInstallationTokenForUser(
    userId: string,
    githubRepositoryId: number,
  ) {
    const repo = await this.getRepositoryForUser(userId, githubRepositoryId);
    if (!repo) throw new Error("Repository is not authorized for Devine");

    const installation = await prisma.githubInstallation.findUnique({
      where: { id: repo.installationId },
    });
    if (!installation) throw new Error("GitHub installation not found");

    const app = this.getApp();
    const response = await app.octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installation.installationId,
        repository_ids: [githubRepositoryId],
      },
    );

    return {
      token: response.data.token as string,
      repository: repo,
      expiresAt: new Date(response.data.expires_at),
    };
  }
}
