/**
 * Environment-driven configuration. Read once at boot; never re-read so the
 * server has a stable, auditable view of its settings.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid integer for ${name}: ${raw}`);
  return parsed;
}

export interface Config {
  readonly port: number;
  readonly host: string;
  /**
   * Port for the admin endpoints + web UI. When `null` or equal to
   * `port`, admin routes are colocated on the API server. When
   * different, two Fastify instances are spun up so the operator can
   * bind the admin port to 127.0.0.1 / a VPN while leaving the API
   * port public.
   */
  readonly adminPort: number | null;
  /** Host the admin instance binds to. Defaults to 127.0.0.1 — local
   * loopback only — so the admin is private out of the box. */
  readonly adminHost: string;
  readonly databasePath: string;
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  readonly trustProxy: boolean;
  readonly corsOrigins: readonly string[];
  /** HMAC key used to derive email_hash and ip_hash (never an email/IP in clear). */
  readonly serverHmacKey: Buffer;
}

function parseLogLevel(value: string): Config["logLevel"] {
  if (
    value === "fatal" ||
    value === "error" ||
    value === "warn" ||
    value === "info" ||
    value === "debug" ||
    value === "trace"
  ) {
    return value;
  }
  throw new Error(`Invalid LOG_LEVEL: ${value}`);
}

export function loadConfig(): Config {
  const hmacB64 = required("SERVER_HMAC_KEY");
  const hmac = Buffer.from(hmacB64, "base64");
  if (hmac.byteLength < 32) {
    throw new Error("SERVER_HMAC_KEY must decode to at least 32 random bytes");
  }
  const origins = optional("CORS_ORIGINS", "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  const adminPortRaw = process.env["ADMIN_PORT"];
  const adminPort =
    adminPortRaw === undefined || adminPortRaw === "" ? null : Number.parseInt(adminPortRaw, 10);
  if (adminPort !== null && Number.isNaN(adminPort)) {
    throw new Error(`Invalid integer for ADMIN_PORT: ${adminPortRaw}`);
  }

  return {
    port: optionalInt("PORT", 8080),
    host: optional("HOST", "0.0.0.0"),
    adminPort,
    adminHost: optional("ADMIN_HOST", "127.0.0.1"),
    databasePath: optional("DATABASE_PATH", "./data/keyfount.db"),
    logLevel: parseLogLevel(optional("LOG_LEVEL", "info")),
    trustProxy: optional("TRUST_PROXY", "true") === "true",
    corsOrigins: origins,
    serverHmacKey: hmac,
  };
}
