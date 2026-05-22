import { buildApp, buildServices } from "./app.js";
import { loadConfig } from "./config/env.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const adminSplit = config.adminPort !== null && config.adminPort !== config.port;
  const services = await buildServices(config);

  // When admin and api share the port we register both surfaces on the
  // same Fastify instance. When they're split, we spin up two — they
  // share `services` (so the DB connection and the OPAQUE seed/AKE
  // keypair are not duplicated).
  const api = await buildApp(config, { mode: adminSplit ? "api" : "all", services });
  const admin = adminSplit
    ? await buildApp(config, { mode: "admin", services })
    : null;

  const shutdown = async (signal: string): Promise<void> => {
    api.log.info({ signal }, "shutting down");
    try {
      if (admin) await admin.close();
      await api.close();
      services.store.close();
      process.exit(0);
    } catch (err) {
      api.log.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await api.listen({ port: config.port, host: config.host });
  if (admin) {
    await admin.listen({ port: config.adminPort!, host: config.adminHost });
    admin.log.info(
      {
        port: config.adminPort,
        host: config.adminHost,
      },
      "admin surface listening on private port",
    );
  }
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("fatal startup error:", err);
  process.exit(1);
});
