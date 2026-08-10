import { env } from './config/env';
import app from "./app";
import { prisma } from "db/client";

async function startServer() {
  try {
    await prisma.$connect();

    console.log("Connected to the database");

    const server = app.listen(env.PORT, () => {
      console.log(`Server is running on port ${env.PORT}`);
    });

    server.on("error", (error) => {
      console.error("HTTP server error:", error);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();