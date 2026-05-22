/**
 * Tiny typed fetch wrapper. Reads the admin session token from
 * localStorage when `auth` is requested.
 */
const SESSION_KEY = "impw.admin.session.v1";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(SESSION_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface Opts {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth === true) {
    const token = getStoredToken();
    if (token !== null) headers["Authorization"] = `Bearer ${token}`;
  }
  const init: RequestInit = { method: opts.method ?? "GET", headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(path, init);
  if (res.status === 204) return null as T;
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  if (!res.ok) {
    const err = parsed as { error?: string } | undefined;
    throw new ApiError(res.status, parsed, err?.error ?? `HTTP ${res.status}`);
  }
  return parsed as T;
}
