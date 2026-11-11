import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { actorOf, authenticate, type VerifyToken } from "./auth.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { errorHandler, HttpError, notFound } from "./errors.js";
import { beneficiaryRouter } from "./routes/beneficiary.js";
import { notificationsRouter } from "./routes/notifications.js";
import { registrationRouter } from "./routes/registration.js";
import { shopSupplyRouter } from "./routes/shop-supply.js";
import { shopVisitsRouter } from "./routes/shop-visits.js";
import { shopRouter } from "./routes/shop.js";
import { warehouseRouter } from "./routes/warehouse.js";
import { warehouseSupplyRouter } from "./routes/warehouse-supply.js";

export interface AppDeps {
  config: Config;
  logger: Logger;
  db: Db | null;
  verifyToken: VerifyToken | null;
}

export function createApp({ config, logger, db, verifyToken }: AppDeps) {
  const app = express();
  app.set("trust proxy", 1); // Render terminates TLS in front of the service
  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      redact: ["req.headers.authorization", "req.headers.cookie"],
      autoLogging: { ignore: (req) => req.url === "/health" },
    }),
  );
  app.use(
    cors({
      // Requests without an Origin (server-side rendering, curl) are not subject to CORS.
      origin: (origin, done) => done(null, !origin || config.corsOrigins.includes(origin)),
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", authConfigured: Boolean(db && verifyToken) });
  });

  const v1 = Router();
  if (db && verifyToken) {
    v1.use(authenticate(verifyToken, db));
    v1.get("/me", (req, res) => {
      res.json(actorOf(req));
    });
    v1.use("/registration", registrationRouter(db));
    v1.use("/shop", shopRouter(db), shopSupplyRouter(db), shopVisitsRouter(db));
    v1.use("/warehouse", warehouseRouter(db), warehouseSupplyRouter(db));
    v1.use("/notifications", notificationsRouter(db));
    v1.use("/beneficiary", beneficiaryRouter(db));
  } else {
    // Fail closed: without auth configuration no protected route is reachable.
    v1.use(() => {
      throw new HttpError(503, "auth_not_configured", "Sign-in is not configured on this server yet.");
    });
  }
  app.use("/api/v1", v1);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
