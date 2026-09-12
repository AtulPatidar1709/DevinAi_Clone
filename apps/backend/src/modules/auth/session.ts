import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { prisma } from "@devine/db";
import { config } from "../../config.js";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, res: Response) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.authSession.create({
    data: { tokenHash, userId, expiresAt },
  });

  res.cookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: config.SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });

  return token;
}

export async function getSessionUser(req: Request) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${config.SESSION_COOKIE_NAME}=`));

  if (!cookie) return null;

  const token = decodeURIComponent(cookie.slice(config.SESSION_COOKIE_NAME.length + 1));
  const tokenHash = hashToken(token);

  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt <= new Date()) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  return session.user;
}

export async function requireUser(req: Request, res: Response, next: (error?: unknown) => void) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    res.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export async function clearSession(req: Request, res: Response) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${config.SESSION_COOKIE_NAME}=`));

  if (cookie) {
    const token = decodeURIComponent(cookie.slice(config.SESSION_COOKIE_NAME.length + 1));
    await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  res.clearCookie(config.SESSION_COOKIE_NAME, { path: "/" });
}
