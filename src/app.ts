import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { createOpaqueService } from "./auth/opaque.js";
import { createChallengeService } from "./auth/challenges.js";
import { createLoginRateLimiter } from "./auth/ratelimit.js";
import { createSessionService } from "./auth/sessions.js";
import type { Config } from "./config/env.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { syncRoutes } from "./routes/sync.js";
import { createAdminChallengeService } from "./auth/admin-challenges.js";
import { createAdminSessionService } from "./auth/admin-sessions.js";
import { createAuditLogger } from "./store/audit.js";
import { createAdminRepo } from "./store/admins.js";
import { migrate, openStore } from "./store/db.js";
import { createSyncRepo } from "./store/sync.js";
import { createUserRepo } from "./store/users.js";

export interface AppOptions {
  /** Override migrations directory (for tests). */
  migrationsDir?: string;
}

export async function buildApp(
  config: Config,
  options: AppOptions = {},
): Promise<FastifyInstance> {
  // Ensure data dir exists for file-backed DBs.
  if (config.databasePath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });
  }
  const store = openStore(config.databasePath);
  migrate(store.db, options.migrationsDir);

  const opaque = await createOpaqueService(store.db);
  const users = createUserRepo(store.db);
  const sessions = createSessionService(store.db);
  const challenges = createChallengeService(store.db);
  const ratelimitLogin = createLoginRateLimiter(store.db);
  const audit = createAuditLogger(store.db);
  const sync = createSyncRepo(store.db);
  const admins = createAdminRepo(store.db);
  const adminSessions = createAdminSessionService(store.db);
  const adminChallenges = createAdminChallengeService(store.db);

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body",
          "res.body",
        ],
        remove: true,
      },
    },
    trustProxy: config.trustProxy,
    disableRequestLogging: false,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    },
    strictTransportSecurity: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  await app.register(sensible);

  // Browser extensions, mobile webviews, and second-origin Web UIs all need
  // CORS to be able to reach the API. The list of allowed origins is
  // configured via CORS_ORIGINS (comma-separated). When empty, CORS is
  // effectively disabled — the same-origin model (Caddy + the API on one
  // hostname) suffices and no preflight is allowed.
  if (config.corsOrigins.length > 0) {
    await app.register(cors, {
      origin: [...config.corsOrigins],
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 600,
      credentials: false,
    });
  }

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
  });

  await app.register(healthRoutes);
  await app.register(async (instance) => {
    await authRoutes(instance, {
      opaque,
      users,
      sessions,
      challenges,
      rateLimit: ratelimitLogin,
      audit,
      hmacKey: config.serverHmacKey,
    });
  });
  await app.register(async (instance) => {
    await syncRoutes(instance, { sync, sessions });
  });
  await app.register(async (instance) => {
    await adminRoutes(instance, {
      opaque,
      admins,
      users,
      sessions: adminSessions,
      challenges: adminChallenges,
      audit,
      hmacKey: config.serverHmacKey,
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: "not_found" });
  });

  // Expose the raw DB handle for integration tests. Production paths
  // never read this property.
   
  (app as any).__store_db = store.db;

  app.addHook("onClose", async () => {
    store.close();
  });

  // Purge expired sessions/challenges/login_attempts on a schedule.
  const purgeTimer = setInterval(() => {
    try {
      sessions.purgeExpired();
      challenges.purgeExpired();
      adminSessions.purgeExpired();
      adminChallenges.purgeExpired();
      ratelimitLogin.purgeOld();
    } catch (err) {
      app.log.warn({ err }, "background purge failed");
    }
  }, 60_000).unref();
  app.addHook("onClose", async () => {
    clearInterval(purgeTimer);
  });

  return app;
}
