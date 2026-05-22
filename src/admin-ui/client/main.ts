/**
 * Admin web UI — single-page controller. Now ships:
 *   - the original setup / login / dashboard branching,
 *   - a 4-tab filter (pending / approved / rejected / all),
 *   - revoke (back to rejected) + irreversible delete actions with
 *     a confirmation modal that asks for an optional reason.
 *
 * Styles come from a Tailwind v4 build (admin.css) that mirrors the
 * website's design tokens.
 */
import {
  KE2,
  OpaqueClient,
  OpaqueID,
  RegistrationResponse,
  getOpaqueConfig,
} from "@cloudflare/opaque-ts";

const SERVER_IDENTITY = "itsmypassword-server";
const SESSION_KEY = "impw.admin.session.v1";
const opaqueConfig = getOpaqueConfig(OpaqueID.OPAQUE_P256);

type Filter = "pending" | "approved" | "rejected" | "all";
type UserStatus = "pending" | "approved" | "rejected";

interface UserRow {
  id: string;
  emailHashHex: string;
  status: UserStatus;
  createdAt: number;
  decidedAt: number | null;
  lastSeenAt: number | null;
  rejectionReason?: string;
}

// --- tiny DOM helpers -------------------------------------------------

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}
function $$(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(sel));
}
function show(id: string): void {
  $(id).hidden = false;
}
function hide(id: string): void {
  $(id).hidden = true;
}
function setText(id: string, text: string): void {
  $(id).textContent = text;
}
function showError(id: string, message: string): void {
  const el = $(id);
  el.textContent = message;
  el.hidden = false;
}
function clearError(id: string): void {
  $(id).hidden = true;
}

// --- HTTP -------------------------------------------------------------

interface FetchOpts {
  method?: string;
  body?: unknown;
  auth?: boolean;
}
async function api<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth) {
    const token = localStorage.getItem(SESSION_KEY);
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
    /* keep as text */
  }
  if (!res.ok) {
    const err = parsed as { error?: string } | undefined;
    throw Object.assign(new Error(err?.error ?? `HTTP ${res.status}`), {
      status: res.status,
      body: parsed,
    });
  }
  return parsed as T;
}

// --- OPAQUE flows -----------------------------------------------------

async function opaqueRegister(
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
  return api<{ adminId: string; sessionToken: string }>(finishPath, {
    method: "POST",
    body: { username, record: fin.record.serialize() },
  });
}

async function opaqueLogin(
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
  if (fin instanceof Error) {
    throw new Error("invalid_login");
  }
  return api<{ adminId: string; sessionToken: string }>(
    "/admin/auth/login/finish",
    {
      method: "POST",
      body: { challengeToken: start.challengeToken, ke3: fin.ke3.serialize() },
    },
  );
}

// --- View routing -----------------------------------------------------

type View = "loading" | "setup" | "login" | "dashboard";

function switchView(view: View): void {
  for (const v of ["loading", "setup", "login", "dashboard"] as const) {
    if (v === view) show(`view-${v}`);
    else hide(`view-${v}`);
  }
}

let currentFilter: Filter = "pending";

async function decideStartView(): Promise<void> {
  switchView("loading");
  const state = await api<{ adminExists: boolean }>("/admin/state");
  if (!state.adminExists) {
    switchView("setup");
    return;
  }
  const token = localStorage.getItem(SESSION_KEY);
  if (token === null) {
    switchView("login");
    return;
  }
  try {
    const me = await api<{ username: string }>("/admin/me", { auth: true });
    setText("who", `connecté en tant que ${me.username}`);
    $("logout-btn").hidden = false;
    switchView("dashboard");
    await loadUsers();
  } catch {
    localStorage.removeItem(SESSION_KEY);
    switchView("login");
  }
}

// --- Setup view -------------------------------------------------------

function wireSetup(): void {
  const form = $<HTMLFormElement>("setup-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError("setup-error");
    const username = ($("setup-username") as HTMLInputElement).value.trim();
    const pw1 = ($("setup-password") as HTMLInputElement).value;
    const pw2 = ($("setup-password-2") as HTMLInputElement).value;
    if (pw1 !== pw2) {
      showError("setup-error", "Les deux mots de passe diffèrent.");
      return;
    }
    if (pw1.length < 8) {
      showError("setup-error", "Le mot de passe doit faire au moins 8 caractères.");
      return;
    }
    const submit = $<HTMLButtonElement>("setup-submit");
    submit.disabled = true;
    submit.textContent = "Création…";
    try {
      const result = await opaqueRegister(
        username,
        pw1,
        "/admin/setup/register/start",
        "/admin/setup/register/finish",
      );
      localStorage.setItem(SESSION_KEY, result.sessionToken);
      await decideStartView();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showError("setup-error", humanError(message));
    } finally {
      submit.disabled = false;
      submit.textContent = "Créer mon compte admin";
    }
  });
}

// --- Login view -------------------------------------------------------

function wireLogin(): void {
  const form = $<HTMLFormElement>("login-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError("login-error");
    const username = ($("login-username") as HTMLInputElement).value.trim();
    const password = ($("login-password") as HTMLInputElement).value;
    const submit = $<HTMLButtonElement>("login-submit");
    submit.disabled = true;
    submit.textContent = "Connexion…";
    try {
      const result = await opaqueLogin(username, password);
      localStorage.setItem(SESSION_KEY, result.sessionToken);
      ($("login-password") as HTMLInputElement).value = "";
      await decideStartView();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showError("login-error", humanError(message));
    } finally {
      submit.disabled = false;
      submit.textContent = "Se connecter";
    }
  });
}

// --- Dashboard --------------------------------------------------------

async function refreshCounts(): Promise<void> {
  // Cheap: 4 calls in parallel, the user can wait <1 s on a sane DB.
  const [pending, approved, rejected, all] = await Promise.all([
    api<{ total: number }>("/admin/users?status=pending&limit=1", { auth: true }),
    api<{ total: number }>("/admin/users?status=approved&limit=1", { auth: true }),
    api<{ total: number }>("/admin/users?status=rejected&limit=1", { auth: true }),
    api<{ total: number }>("/admin/users?status=all&limit=1", { auth: true }),
  ]);
  const counts: Record<Filter, number> = {
    pending: pending.total,
    approved: approved.total,
    rejected: rejected.total,
    all: all.total,
  };
  for (const tab of $$(".tab")) {
    const f = (tab.dataset["filter"] ?? "all") as Filter;
    const pill = tab.querySelector<HTMLElement>(`[data-count="${f}"]`);
    if (pill !== null) pill.textContent = String(counts[f]);
  }
}

async function loadUsers(): Promise<void> {
  const list = $("users-list");
  list.innerHTML = `<li class="p-6 text-(--color-ink-3) text-sm">Chargement…</li>`;
  try {
    const [data] = await Promise.all([
      api<{ users: UserRow[]; total: number }>(
        `/admin/users?status=${encodeURIComponent(currentFilter)}&limit=200`,
        { auth: true },
      ),
      refreshCounts(),
    ]);
    renderUsers(data.users);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    list.innerHTML = `<li class="callout callout-danger m-4">Erreur de chargement : ${escapeHtml(message)}</li>`;
  }
}

function statusPill(status: UserStatus): string {
  if (status === "approved")
    return `<span class="pill pill-success">Approuvé</span>`;
  if (status === "rejected")
    return `<span class="pill pill-danger">Refusé</span>`;
  return `<span class="pill pill-warn">En attente</span>`;
}

function actionButtons(u: UserRow): string {
  const id = escapeHtml(u.id);
  if (u.status === "pending") {
    return `
      <button data-act="reject" data-id="${id}" class="btn-ghost btn-sm">Refuser</button>
      <button data-act="approve" data-id="${id}" class="btn-success btn-sm">Approuver</button>
    `;
  }
  if (u.status === "approved") {
    return `
      <button data-act="delete" data-id="${id}" class="btn-ghost btn-sm">Supprimer…</button>
      <button data-act="revoke" data-id="${id}" class="btn-danger btn-sm">Révoquer</button>
    `;
  }
  // rejected
  return `
    <button data-act="delete" data-id="${id}" class="btn-ghost btn-sm">Supprimer…</button>
    <button data-act="approve" data-id="${id}" class="btn-success btn-sm">Approuver</button>
  `;
}

function renderUsers(users: UserRow[]): void {
  const list = $("users-list");
  if (users.length === 0) {
    list.innerHTML = `<li class="p-6 text-(--color-ink-3) text-sm text-center">Aucun utilisateur dans cette catégorie.</li>`;
    return;
  }
  list.innerHTML = users
    .map((u) => {
      const created = new Date(u.createdAt).toLocaleString("fr-FR");
      const decided =
        u.decidedAt !== null ? new Date(u.decidedAt).toLocaleString("fr-FR") : null;
      const last =
        u.lastSeenAt !== null ? new Date(u.lastSeenAt).toLocaleString("fr-FR") : null;
      return `
        <li class="row-entry m-4">
          <div class="flex flex-col gap-1.5 min-w-0">
            <div class="flex items-center gap-2.5 flex-wrap">
              ${statusPill(u.status)}
              <code class="font-mono text-xs text-(--color-ink-3) break-all">${escapeHtml(u.emailHashHex)}</code>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--color-ink-3)">
              <span>Demandé : ${escapeHtml(created)}</span>
              ${decided !== null ? `<span>Décidé : ${escapeHtml(decided)}</span>` : ""}
              ${last !== null ? `<span>Vu : ${escapeHtml(last)}</span>` : ""}
              ${u.rejectionReason !== undefined ? `<span>Raison : ${escapeHtml(u.rejectionReason)}</span>` : ""}
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${actionButtons(u)}
          </div>
        </li>
      `;
    })
    .join("");
}

// --- Confirmation modal ----------------------------------------------

interface ConfirmOpts {
  title: string;
  body: string;
  okLabel: string;
  okClass: "btn-danger" | "btn-success";
  withReason: boolean;
}

async function confirm(opts: ConfirmOpts): Promise<string | null> {
  return new Promise((resolve) => {
    setText("confirm-title", opts.title);
    setText("confirm-body", opts.body);
    $("confirm-reason-wrap").hidden = !opts.withReason;
    const reasonInput = $("confirm-reason") as HTMLInputElement;
    reasonInput.value = "";
    const ok = $<HTMLButtonElement>("confirm-ok");
    ok.textContent = opts.okLabel;
    ok.className = `${opts.okClass} btn-sm`;
    show("confirm-overlay");

    const cancel = $<HTMLButtonElement>("confirm-cancel");
    const cleanup = (): void => {
      hide("confirm-overlay");
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
    };
    const onOk = (): void => {
      const reason = opts.withReason ? reasonInput.value.trim() : "";
      cleanup();
      resolve(opts.withReason ? reason : "");
    };
    const onCancel = (): void => {
      cleanup();
      resolve(null);
    };
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
  });
}

// --- Actions ----------------------------------------------------------

async function approve(id: string): Promise<void> {
  await api(`/admin/users/${id}/approve`, { method: "POST", auth: true });
}
async function reject(id: string): Promise<void> {
  const reason = await confirm({
    title: "Refuser cette demande ?",
    body: "L'utilisateur verra l'éventuelle raison sur sa page de connexion.",
    okLabel: "Refuser",
    okClass: "btn-danger",
    withReason: true,
  });
  if (reason === null) return;
  await api(`/admin/users/${id}/reject`, {
    method: "POST",
    auth: true,
    body: reason.length > 0 ? { reason } : {},
  });
}
async function revoke(id: string): Promise<void> {
  const reason = await confirm({
    title: "Révoquer cet utilisateur approuvé ?",
    body: "Il sera repassé en 'rejected', toutes ses sessions sont invalidées. Tu peux le réapprouver plus tard.",
    okLabel: "Révoquer",
    okClass: "btn-danger",
    withReason: true,
  });
  if (reason === null) return;
  await api(`/admin/users/${id}/revoke`, {
    method: "POST",
    auth: true,
    body: reason.length > 0 ? { reason } : {},
  });
}
async function destroy(id: string): Promise<void> {
  const r = await confirm({
    title: "Supprimer définitivement ce compte ?",
    body: "Cette action efface l'utilisateur, ses appareils, sessions, événements et snapshots. Irréversible.",
    okLabel: "Supprimer",
    okClass: "btn-danger",
    withReason: false,
  });
  if (r === null) return;
  await api(`/admin/users/${id}`, { method: "DELETE", auth: true });
}

function wireDashboard(): void {
  $("refresh-btn").addEventListener("click", () => void loadUsers());

  // tab switcher
  for (const tab of $$(".tab")) {
    tab.addEventListener("click", () => {
      const f = (tab.dataset["filter"] ?? "pending") as Filter;
      currentFilter = f;
      for (const t of $$(".tab")) {
        t.setAttribute("aria-pressed", t.dataset["filter"] === f ? "true" : "false");
      }
      void loadUsers();
    });
  }

  // action dispatch
  $("users-list").addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLButtonElement)) return;
    const act = target.dataset["act"];
    const id = target.dataset["id"];
    if (act === undefined || id === undefined) return;
    target.disabled = true;
    let action: Promise<void>;
    switch (act) {
      case "approve":
        action = approve(id);
        break;
      case "reject":
        action = reject(id);
        break;
      case "revoke":
        action = revoke(id);
        break;
      case "delete":
        action = destroy(id);
        break;
      default:
        target.disabled = false;
        return;
    }
    void action
      .then(() => loadUsers())
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        window.alert(`Échec : ${message}`);
      })
      .finally(() => {
        target.disabled = false;
      });
  });
}

// --- Logout + theme + boot --------------------------------------------

function wireLogout(): void {
  $("logout-btn").addEventListener("click", async () => {
    try {
      await api("/admin/auth/logout", { method: "POST", auth: true });
    } catch {
      /* best-effort */
    }
    localStorage.removeItem(SESSION_KEY);
    setText("who", "");
    $("logout-btn").hidden = true;
    await decideStartView();
  });
}

function wireThemeToggle(): void {
  $("theme-toggle").addEventListener("click", () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* localStorage blocked */
    }
  });
}

function humanError(message: string): string {
  if (message === "invalid_login") return "Identifiants refusés.";
  if (message === "setup_locked")
    return "Le setup admin est déjà verrouillé : un compte existe.";
  if (message.includes("HTTP 429"))
    return "Trop de tentatives. Patiente quelques minutes.";
  return message;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    return (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c
    );
  });
}

// --- Boot -------------------------------------------------------------

wireSetup();
wireLogin();
wireDashboard();
wireLogout();
wireThemeToggle();
void decideStartView();
