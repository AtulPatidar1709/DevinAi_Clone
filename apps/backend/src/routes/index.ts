import { Router } from "express";
import apiRouter from "../routes/index.ts";

import app from "../app";

const router = Router();

app.use("/api", apiRouter);

export default router;