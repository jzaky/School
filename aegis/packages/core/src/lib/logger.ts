import pino from "pino";

/**
 * Structured logger. Secret-bearing paths are redacted so a mistaken log line
 * cannot leak credentials. Never put raw parameters of a tool call in a log line;
 * use the evidence ledger for that.
 */
// Read directly rather than through env(): the logger is created when this module is imported, and full
// environment validation (secrets, database URL) must not run at import time, for example during an image build.
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: process.env.OTEL_SERVICE_NAME || "aegis" },
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
