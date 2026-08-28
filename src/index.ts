import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { connectDb } from "./db/connect.js";
import { authRouter } from "./routes/auth.js";
import { accountRouter } from "./routes/account.js";
import { fleetRouter } from "./routes/fleet.js";
import { loadsRouter } from "./routes/loads.js";
import { commissionsRouter } from "./routes/commissions.js";
import { paymentsRouter } from "./routes/payments.js";
import { expensesRouter } from "./routes/expenses.js";
import { invoicesRouter } from "./routes/invoices.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { usersRouter } from "./routes/users.js";
import { activityRouter } from "./routes/activity.js";
import { documentsRouter } from "./routes/documents.js";
import { settingsRouter } from "./routes/settings.js";
import { reportsRouter } from "./routes/reports.js";
import { notificationsRouter } from "./routes/notifications.js";
import { searchRouter } from "./routes/search.js";
import { errorHandler } from "./middleware/errorHandler.js";

async function main() {
  await connectDb();

  const app = express();

  // Reflect any Origin (allows all frontends). Required instead of "*" when credentials: true.
  const corsOptions: cors.CorsOptions = {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  };

  console.log("CORS: allowing all origins (reflect request Origin)");
  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "truck-dispatch-api",
      cors: "reflect-all-origins",
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/account", accountRouter);
  app.use("/api/fleet", fleetRouter);
  app.use("/api/loads", loadsRouter);
  app.use("/api/commissions", commissionsRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/expenses", expensesRouter);
  app.use("/api/invoices", invoicesRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/activity", activityRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/search", searchRouter);

  app.use(errorHandler);

  app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
