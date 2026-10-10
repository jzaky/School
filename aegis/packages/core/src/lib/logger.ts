import pino from "pino";
import { env } from "../env.js";

/**
 * Structured logger. Secret-bearing paths are redacted so a mistaken log line
 * cannot leak credentials. Never put raw parameters of a tool call in a log line;
 * use the evidence ledger for that.
 */
export const logger = pino({
  level: env().LOG_LEVEL,
  base: { service: env().OTEL_SERVICE_NAME },
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "apiKey",
      "*.apiKey",
      "secret",
      "*.secret",
      "authorization",
      "*.authorization",
      "headers.authorization",
      "headers.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
      "params",
      "*.params",
      "clientSecret",
      "*.clientSecret",
    ],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
