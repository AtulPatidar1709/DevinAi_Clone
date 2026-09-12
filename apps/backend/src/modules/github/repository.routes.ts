import { Router } from "express";
import { z } from "zod";
import { prisma } from "@devine/db";
import { requireUser } from "../auth/session.js";
import { GithubService } from "./github.service.js";

const router = Router();
const github = new GithubService();
router.use(requireUser);

router.get("/", async (_req, res, next) => {
  try {
    const repositories = await prisma.repository.findMany({
      where: { userId: res.locals.user.id },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { workspaces: true } } },
    });

    res.json({ success: true, data: repositories });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { githubId } = z.object({ githubId: z.coerce.number().int().positive() }).parse(req.body);
    const repository = await github.syncRepositoryToDevine(res.locals.user.id, githubId);
    res.status(201).json({ success: true, data: repository });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const repository = await prisma.repository.findFirst({
      where: { id, userId: res.locals.user.id },
    });
    if (!repository) {
      res.status(404).json({ success: false, error: "Repository not found" });
      return;
    }

    await prisma.repository.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
