import { Router } from "express";
import { prisma } from "@devine/db";
import { config } from "../../config.js";
import { requireUser } from "../auth/session.js";
import { GithubService } from "./github.service.js";

const router = Router();
const github = new GithubService();

/**
 * GitHub → your server. Public: verified by HMAC signature, not by
 * a Devine session. Must stay mounted with express.raw() (see server.ts)
 * so the signature can be checked against the untouched request body.
 */
router.post("/webhook", async (req, res, next) => {
  try {
    await github.handleWebhook(req);
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * GitHub → user's browser, after they finish picking repos on the
 * install screen. This is the "Setup URL" configured in the GitHub
 * App's settings. Public route: ownership is proven by resolving the
 * `state` param against GithubInstallState (created in /install),
 * not by the caller's session — the browser doing this top-level
 * redirect may not reliably carry the Devine session cookie.
 */
router.get("/setup", async (req, res, next) => {
  try {
    const state = String(req.query.state ?? "");
    const installationId = Number(req.query.installation_id);

    if (!state || !Number.isInteger(installationId)) {
      throw new Error("GitHub setup callback is missing state or installation_id");
    }

    await github.completeInstall(state, installationId);
    res.redirect(`${config.FRONTEND_URL}/repositories?github=connected`);
  } catch (error) {
    next(error);
  }
});

/**
 * Everything below this point requires a logged-in Devine user.
 */
router.use(requireUser);

router.get("/status", async (_req, res, next) => {
  try {
    const user = res.locals.user;
    const installations = await prisma.githubInstallation.findMany({ where: { userId: user.id } });
    const repositories = await prisma.repository.count({ where: { userId: user.id } });

    res.json({
      success: true,
      data: {
        installed: installations.length > 0,
        installationCount: installations.length,
        connectedRepositoryCount: repositories,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/install", async (req, res, next) => {
  try {
    const user = res.locals.user;
    const url = await github.createInstallUrl(user.id);
    res.redirect(url);
  } catch (error) {
    next(error);
  }
});

router.get("/repositories", async (_req, res, next) => {
  try {
    const repos = await github.listAccessibleRepositories(res.locals.user.id);
    res.json({
      success: true,
      data: repos.map((repo) => ({
        githubId: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        owner: repo.owner.login,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch ?? "main",
        isPrivate: repo.private,
        installationId: repo.installationId,
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
