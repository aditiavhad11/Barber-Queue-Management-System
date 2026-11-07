import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { healthcheck } from "./config/db.js";
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
import "./jobs/emergencyClosureQueue.js";
import { startScheduledQueueWorker } from "./services/scheduledQueueService.js";
dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error(
    "JWT_SECRET is missing in backend/.env. Copy .env.example to .env and set it.",
  );
  process.exit(1);
}
const app = express();
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

runMigrations()
  .then(() => startScheduledQueueWorker())
  .catch((e) => console.error("Database migration failed:", e.message));

app.listen(Number(process.env.PORT || 4000), () =>
  console.log(
    `Barber Queue API running on http://localhost:${process.env.PORT || 4000}`,
  ),
);
