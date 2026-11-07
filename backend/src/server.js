import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { healthcheck, pool } from "./config/db.js";
import { runMigrations } from "./config/migrate.js";
import authRoutes from "./routes/authRoutes.js";
import shopRoutes from "./routes/shopRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import complaintRoutes from "./routes/complaintRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import schemeRoutes from "./routes/schemeRoutes.js";
import errorHandler from "./middleware/errorHandler.js";
import {
  startEmergencyClosureWorker,
  stopEmergencyClosureWorker,
} from "./jobs/emergencyClosureQueue.js";
import {
  startScheduledQueueWorker,
  stopScheduledQueueWorker,
} from "./services/scheduledQueueService.js";
import { httpLogger, logger } from "./utils/logger.js";

dotenv.config();

if (!process.env.JWT_SECRET) {
  logger.fatal(
    "JWT_SECRET is missing in backend/.env. Copy .env.example to .env and set it.",
  );
  process.exit(1);
}

export const app = express();
const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin))
        return callback(null, true);
      try {
        const u = new URL(origin);
        if (
          process.env.NODE_ENV !== "production" &&
          ["localhost", "127.0.0.1"].includes(u.hostname)
        )
          return callback(null, true);
      } catch {}
      callback(new Error("CORS origin not allowed"));
    },
  }),
);

app.use(httpLogger);
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await healthcheck();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/shops", shopRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/complaints", complaintRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/schemes", schemeRoutes);

app.use(errorHandler);

let isShuttingDown = false;

export function setupGracefulShutdown(server) {
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, "Shutdown signal received. Starting graceful shutdown...");

    const forceExitTimer = setTimeout(() => {
      logger.fatal("Graceful shutdown timeout exceeded (10s). Forcing process exit.");
      process.exit(1);
    }, 10000);
    forceExitTimer.unref?.();

    server.close(async (err) => {
      if (err) {
        logger.error({ err }, "Error closing HTTP server");
      } else {
        logger.info("HTTP server closed to new requests.");
      }

      try {
        logger.info("Stopping background queue workers...");
        await stopEmergencyClosureWorker();
        stopScheduledQueueWorker();
        logger.info("Background queue workers stopped.");

        logger.info("Closing database connection pool...");
        await pool.end();
        logger.info("Database connection pool closed.");

        logger.info("Graceful shutdown completed successfully.");
        clearTimeout(forceExitTimer);
        process.exit(0);
      } catch (shutdownErr) {
        logger.error({ err: shutdownErr }, "Error during graceful shutdown cleanup");
        process.exit(1);
      }
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export async function startServer() {
  try {
    // 1. DB check
    logger.info("Verifying database connection...");
    await healthcheck();
    logger.info("Database connection verified successfully.");

    // 2. Migrations
    logger.info("Running database migrations...");
    await runMigrations();
    logger.info("Database migrations applied successfully.");

    // 3. Worker start
    logger.info("Starting background queue workers...");
    startEmergencyClosureWorker();
    startScheduledQueueWorker();
    logger.info("Background queue workers started.");

    // 4. Listen
    const port = Number(process.env.PORT || 4000);
    const server = app.listen(port, () => {
      logger.info(
        `Barber Queue API running on http://localhost:${port}`,
      );
    });

    setupGracefulShutdown(server);
    return server;
  } catch (error) {
    logger.fatal({ err: error }, "Server startup failed. Exiting process.");
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule && process.env.NODE_ENV !== "test") {
  startServer();
}
