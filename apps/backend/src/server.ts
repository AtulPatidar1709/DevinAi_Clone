import express from "express";
import cors from "cors";
import { config } from "./config.js";
import agentRoutes from "./modules/agent/agent.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import githubRoutes from "./modules/github/github.routes.js";
import repositoryRoutes from "./modules/github/repository.routes.js";
import sessionRoutes from "./modules/session/session.routes.js";
import { errorHandler } from "./middleware/error-handler.js";

const app = express();

app.use(
  cors({
    origin: config.FRONTEND_URL,
    credentials: true,
  }),
);

// The GitHub webhook needs the raw request body to verify the
// x-hub-signature-256 HMAC. express.json() below would otherwise
// also try to parse the same request (it has no path restriction),
// and since the stream can only be consumed once, one of the two
// parsers ends up with an empty/corrupt body. Exclude the webhook
// path from JSON parsing explicitly.
app.use(
  "/api/github/webhook",
  express.raw({ type: "application/json" }),
);

app.use((req, res, next) => {
  if (req.path === "/api/github/webhook") return next();
  express.json({ limit: "2mb" })(req, res, next);
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/github", githubRoutes);
app.use("/api/repositories", repositoryRoutes);
app.use("/api/sessions", sessionRoutes);

// Existing low-level agent/sandbox endpoints remain available. The new session
// endpoints are the authenticated product-facing wrapper around them.
app.use("/api/agent", agentRoutes);

app.use(errorHandler);

app.listen(config.PORT, () =>
  console.log(`Devine backend running on http://localhost:${config.PORT}`),
);
