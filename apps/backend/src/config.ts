import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
import { z } from "zod";

export const config = z
  .object({
    PORT: z.coerce.number().default(3000),
    FRONTEND_URL: z.string().default("http://localhost:5173"),
    SESSION_COOKIE_NAME: z.string().default("devine_session"),
    SESSION_DAYS: z.coerce.number().default(30),

    GITHUB_API_URL: z.string().default("https://api.github.com"),
    GITHUB_APP_ID: z.string().default(""),
    GITHUB_APP_CLIENT_ID: z.string().default(""),
    GITHUB_APP_CLIENT_SECRET: z.string().default(""),
    GITHUB_APP_SLUG: z.string().default(""),
    GITHUB_APP_PRIVATE_KEY: z.string().default(""),
    GITHUB_CALLBACK_URL: z.string().default("http://localhost:3000/api/auth/github/callback"),
    GITHUB_SETUP_URL: z.string().default("http://localhost:3000/api/github/setup"),
    GITHUB_WEBHOOK_SECRET : z.string().default("default-webhook-secret"),
    SANDBOX_IMAGE: z.string().default("devine-sandbox:latest"),
    SANDBOX_MEMORY: z.string().default("3g"),
    SANDBOX_CPUS: z.string().default("3"),
    SANDBOX_BASE_PORT: z.coerce.number().default(10000),
    SANDBOX_CODE_SERVER_PASSWORD: z.string().default("devine-local"),
    // "none" lets the Code tab embed code-server directly in an iframe with
    // no login step — fine on localhost, but a real security risk on a
    // public server (anyone who finds the port gets a shell). Set to
    // "password" for any non-local deployment.
    SANDBOX_CODE_SERVER_AUTH: z.enum(["none", "password"]).default("none"),
    // Hostname/IP used to build previewUrl / codeServerUrl for each sandbox.
    // Defaults to localhost for local dev; set to your server's public
    // domain or IP in production so preview links actually resolve for
    // anyone other than the machine running the backend.
    SANDBOX_PUBLIC_HOST: z.string().default("localhost"),
    LLM_BASE_URL: z.string().default("https://api.openai.com/v1"),
    LLM_API_KEY: z.string().default(""),
    LLM_MODEL: z.string().default(""),
  })
  .parse(process.env);
