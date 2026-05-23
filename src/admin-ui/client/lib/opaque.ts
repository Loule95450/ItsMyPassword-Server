/**
 * OPAQUE register + login flows against the admin endpoints. Wraps the
 * @cloudflare/opaque-ts client and our typed api() helper.
 */
import {
  KE2,
  OpaqueClient,
  OpaqueID,
  RegistrationResponse,
  getOpaqueConfig,
} from "@cloudflare/opaque-ts";

import { api } from "./api.js";

const SERVER_IDENTITY = "keyfount-server";
const opaqueConfig = getOpaqueConfig(OpaqueID.OPAQUE_P256);

export async function opaqueRegister(
  username: string,
  password: string,
  startPath: string,
  finishPath: string,
): Promise<{ adminId: string; sessionToken: string }> {
  const client = new OpaqueClient(opaqueConfig);
  const req = await client.registerInit(password);
  if (req instanceof Error) throw req;
  const start = await api<{ response: number[] }>(startPath, {
    method: "POST",
    body: { username, request: req.serialize() },
  });
  const fin = await client.registerFinish(
    RegistrationResponse.deserialize(opaqueConfig, start.response),
    SERVER_IDENTITY,
  );
  if (fin instanceof Error) throw fin;
  return api(finishPath, {
    method: "POST",
    body: { username, record: fin.record.serialize() },
  });
}

export async function opaqueLogin(
  username: string,
  password: string,
): Promise<{ adminId: string; sessionToken: string }> {
  const client = new OpaqueClient(opaqueConfig);
  const ke1 = await client.authInit(password);
  if (ke1 instanceof Error) throw ke1;
  const start = await api<{ ke2: number[]; challengeToken: string }>(
    "/admin/auth/login/start",
    { method: "POST", body: { username, ke1: ke1.serialize() } },
  );
  const fin = await client.authFinish(
    KE2.deserialize(opaqueConfig, start.ke2),
    SERVER_IDENTITY,
  );
  if (fin instanceof Error) throw new Error("invalid_login");
  return api("/admin/auth/login/finish", {
    method: "POST",
    body: { challengeToken: start.challengeToken, ke3: fin.ke3.serialize() },
  });
}
