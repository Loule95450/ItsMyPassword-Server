import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp } from "../src/app.js";
import type { Config } from "../src/config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

const testConfig = (overrides: Partial<Config> = {}): Config => ({
  port: 0,
  host: "127.0.0.1",
  databasePath: ":memory:",
  logLevel: "fatal",
  trustProxy: false,
  adminPort: null,
  adminHost: "127.0.0.1",
  corsOrigins: [],
  serverHmacKey: Buffer.alloc(32, 1),
  ...overrides,
});

describe("CORS", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it("does not emit Access-Control-* headers when CORS_ORIGINS is empty", async () => {
    app = await buildApp(testConfig(), { migrationsDir: MIGRATIONS_DIR });
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://random.example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("echoes back a configured origin", async () => {
    app = await buildApp(
      testConfig({ corsOrigins: ["chrome-extension://abcdef"] }),
      { migrationsDir: MIGRATIONS_DIR },
    );
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "chrome-extension://abcdef" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdef");
  });

  it("rejects a non-listed origin", async () => {
    app = await buildApp(
      testConfig({ corsOrigins: ["chrome-extension://only-me"] }),
      { migrationsDir: MIGRATIONS_DIR },
    );
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example.com" },
    });
    // CORS does not block the request server-side — it just doesn't issue
    // the Access-Control-Allow-Origin header, and the browser will refuse
    // to expose the body. Server still answers 200 to the GET.
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("handles preflight OPTIONS for a configured origin", async () => {
    app = await buildApp(
      testConfig({ corsOrigins: ["chrome-extension://abcdef"] }),
      { migrationsDir: MIGRATIONS_DIR },
    );
    const res = await app.inject({
      method: "OPTIONS",
      url: "/auth/opaque/register/start",
      headers: {
        origin: "chrome-extension://abcdef",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization",
      },
    });
    expect([200, 204]).toContain(res.statusCode);
    expect(res.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdef");
    expect(res.headers["access-control-allow-methods"]).toMatch(/POST/i);
  });
});
