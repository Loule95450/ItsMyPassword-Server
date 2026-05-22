/**
 * Mode-aware route exposure. When the operator binds admin on a private
 * port and api on the public one, the api surface must NOT expose any
 * /admin/* endpoint and the admin surface must NOT expose any of the
 * user-facing /auth/* or /events|/snapshots routes.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp, buildServices } from "../src/app.js";
import type { Config } from "../src/config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

const testConfig = (): Config => ({
  port: 0,
  host: "127.0.0.1",
  adminPort: null,
  adminHost: "127.0.0.1",
  databasePath: ":memory:",
  logLevel: "fatal",
  trustProxy: false,
  corsOrigins: [],
  serverHmacKey: Buffer.alloc(32, 1),
});

describe("split-mode route exposure", () => {
  let apps: FastifyInstance[] = [];
  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
  });

  it("api-only instance hides /admin/state", async () => {
    const services = await buildServices(testConfig(), { migrationsDir: MIGRATIONS_DIR });
    const api = await buildApp(testConfig(), {
      migrationsDir: MIGRATIONS_DIR,
      mode: "api",
      services,
    });
    apps.push(api);
    const r = await api.inject({ method: "GET", url: "/admin/state" });
    expect(r.statusCode).toBe(404);
  });

  it("api-only instance hides admin login + setup", async () => {
    const services = await buildServices(testConfig(), { migrationsDir: MIGRATIONS_DIR });
    const api = await buildApp(testConfig(), {
      migrationsDir: MIGRATIONS_DIR,
      mode: "api",
      services,
    });
    apps.push(api);
    const setup = await api.inject({
      method: "POST",
      url: "/admin/setup/register/start",
      payload: { username: "x", request: [0] },
    });
    const login = await api.inject({
      method: "POST",
      url: "/admin/auth/login/start",
      payload: { username: "x", ke1: [0] },
    });
    expect(setup.statusCode).toBe(404);
    expect(login.statusCode).toBe(404);
  });

  it("admin-only instance hides user auth + sync routes", async () => {
    const services = await buildServices(testConfig(), { migrationsDir: MIGRATIONS_DIR });
    const admin = await buildApp(testConfig(), {
      migrationsDir: MIGRATIONS_DIR,
      mode: "admin",
      services,
    });
    apps.push(admin);

    for (const url of [
      "/auth/opaque/register/start",
      "/auth/opaque/login/start",
      "/events",
      "/snapshots/latest",
      "/devices",
    ]) {
      const r = await admin.inject({ method: "GET", url });
      expect([404, 405]).toContain(r.statusCode);
    }
  });

  it("admin-only instance exposes /admin/state", async () => {
    const services = await buildServices(testConfig(), { migrationsDir: MIGRATIONS_DIR });
    const admin = await buildApp(testConfig(), {
      migrationsDir: MIGRATIONS_DIR,
      mode: "admin",
      services,
    });
    apps.push(admin);
    const r = await admin.inject({ method: "GET", url: "/admin/state" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ adminExists: false });
  });

  it("both instances expose /health", async () => {
    const services = await buildServices(testConfig(), { migrationsDir: MIGRATIONS_DIR });
    const api = await buildApp(testConfig(), {
      migrationsDir: MIGRATIONS_DIR,
      mode: "api",
      services,
    });
    const admin = await buildApp(testConfig(), {
      migrationsDir: MIGRATIONS_DIR,
      mode: "admin",
      services,
    });
    apps.push(api, admin);
    expect((await api.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await admin.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});
