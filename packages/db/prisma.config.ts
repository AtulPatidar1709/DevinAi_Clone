import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const configDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(configDir, "../../.env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required in the project-root .env");
}

export default defineConfig({
  // Relative to this prisma.config.ts. Prisma 7 recursively loads all
  // *.prisma files in this directory.
  schema: "./prisma",
  migrations: {
    path: "./prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
