import pino from "pino";
import pinoHttp from "pino-http";

export const logger = pino({
  level:
    process.env.LOG_LEVEL ||
    (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.body.password",
    "req.body.login_password",
    "req.body.code",
    "req.body.token",
  ],
});

export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) =>
      req.url === "/api/health" && process.env.NODE_ENV === "production",
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});

