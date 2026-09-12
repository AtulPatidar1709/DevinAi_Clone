import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  // If a response (e.g. an SSE stream) already sent headers, we can't send
  // a fresh status/JSON body — that throws "Cannot set headers after they
  // are sent". Just end the connection and let the route-level catch that
  // triggered this have already told the client what happened.
  if (res.headersSent) {
    console.error(error);
    res.end();
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: "Validation failed", issues: error.issues });
    return;
  }
  console.error(error);
  res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Internal server error" });
};
