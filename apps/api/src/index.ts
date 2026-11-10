import { pino } from "pino";
import { createApp } from "./app.js";
import { createTokenVerifier } from "./auth.js";
import { loadConfig, type Config } from "./config.js";
import { createPool } from "./db.js";

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = pino({
  level: config.logLevel,
  transport: config.nodeEnv === "development" ? { target: "pino-pretty" } : undefined,
});

const pool = config.databaseUrl ? createPool(config.databaseUrl, config.databaseCaCert) : null;
pool?.on("error", (err) => logger.error({ err }, "idle database client error"));
const verifyToken = config.supabaseUrl ? createTokenVerifier(config.supabaseUrl, config.jwtSecret) : null;

if (config.missing.length > 0) {
  logger.warn(`Protected API routes return 503 until these are set: ${config.missing.join(", ")}`);
}

const server = createApp({ config, logger, db: pool, verifyToken }).listen(config.port, "0.0.0.0", () => {
  logger.info(`RationSync API listening on port ${config.port}`);
});

function shutdown() {
  server.close(async () => {
    await pool?.end();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
