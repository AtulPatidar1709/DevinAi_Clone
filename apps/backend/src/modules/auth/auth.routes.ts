import { Router } from "express";
import { createHash } from "node:crypto";
import { prisma } from "@devine/db";
import { config } from "../../config.js";
import { clearSession, createSession, getSessionUser, requireUser } from "./session.js";
import { GithubAuthService } from "./github-auth.service.js";

const router = Router();
const githubAuth = new GithubAuthService();

router.get("/github", async (_req, res, next) => {
  try {
    const state = await githubAuth.createLoginState();
    res.redirect(githubAuth.buildLoginUrl(state));
  } catch (error) {
    next(error);
  }
});

router.get("/github/callback", async (req, res, next) => {
  try {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    if (!code || !state) throw new Error("GitHub OAuth callback is missing code/state");

    const stateHash = createHash("sha256").update(state).digest("hex");
    const stateRecord = await prisma.githubOAuthState.findUnique({ where: { stateHash } });
    if (!stateRecord || stateRecord.expiresAt <= new Date()) {
      throw new Error("GitHub OAuth state is invalid or expired");
    }

    const tokens = await githubAuth.exchangeCode(code);
    const user = await githubAuth.upsertUser(
      tokens.accessToken,
      tokens.refreshToken,
      tokens.accessTokenExpiresAt,
      tokens.refreshTokenExpiresAt,
    );

    await prisma.githubOAuthState.delete({ where: { id: stateRecord.id } });
    await createSession(user.id, res);

    res.redirect(`${config.FRONTEND_URL}/`);
  } catch (error) {
    next(error);
  }
});

router.get("/me", async (req, res, next) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.json({ success: true, data: null });
      return;
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        githubId: user.githubId,
        githubLogin: user.githubLogin,
        githubName: user.githubName,
        githubEmail: user.githubEmail,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    await clearSession(req, res);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get("/protected-test", requireUser, (req, res) => {
  res.json({ success: true, githubLogin: res.locals.user.githubLogin });
});

export default router;
