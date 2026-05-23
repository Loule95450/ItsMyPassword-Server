/**
 * Admin SPA root. Three views — setup / login / dashboard — branched on
 * server state and on whether the browser holds a valid admin session.
 * Layout: top header (brand + connected-as + language + theme + logout),
 * a centered <main>, and an ambient DotGrid behind everything.
 */
import { useEffect } from "preact/hooks";

import { api, clearStoredToken, getStoredToken } from "./lib/api.js";
import { adminUsername, view } from "./lib/state.js";
import { t } from "./i18n/index.js";
import { DotGrid } from "./components/DotGrid.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { LanguageToggle } from "./components/LanguageToggle.js";
import { ConfirmModalHost } from "./components/ConfirmModal.js";
import { SetupView } from "./views/Setup.js";
import { LoginView } from "./views/Login.js";
import { DashboardView } from "./views/Dashboard.js";

export async function bootstrap(): Promise<void> {
  view.value = "loading";
  let state: { adminExists: boolean };
  try {
    state = await api("/admin/state");
  } catch {
    view.value = "login";
    return;
  }
  if (!state.adminExists) {
    view.value = "setup";
    adminUsername.value = null;
    return;
  }
  const token = getStoredToken();
  if (token === null) {
    view.value = "login";
    adminUsername.value = null;
    return;
  }
  try {
    const me = await api<{ username: string }>("/admin/me", { auth: true });
    adminUsername.value = me.username;
    view.value = "dashboard";
  } catch {
    clearStoredToken();
    adminUsername.value = null;
    view.value = "login";
  }
}

async function logout(): Promise<void> {
  try {
    await api("/admin/auth/logout", { method: "POST", auth: true });
  } catch {
    /* best-effort */
  }
  clearStoredToken();
  await bootstrap();
}

export function App() {
  useEffect(() => {
    void bootstrap();
  }, []);

  return (
    <>
      <DotGrid />
      <div class="relative z-10 flex flex-col min-h-screen">
        <header class="relative z-10 border-b border-(--color-ink-5)/60 bg-(--color-bg-0)/70 backdrop-blur-md">
          <div class="mx-auto max-w-3xl flex items-center justify-between px-6 h-14">
            <div class="flex items-center gap-3">
              <span class="relative inline-flex h-2 w-2 items-center justify-center">
                <span
                  class="absolute inset-0 rounded-full bg-(--color-accent)"
                  style="animation: var(--animate-pulse-dot);"
                />
                <span class="relative h-2 w-2 rounded-full bg-(--color-accent)" />
              </span>
              <strong class="text-sm tracking-tight text-(--color-ink-0)">
                Keyfount
              </strong>
              <span class="mono-tag border-l border-(--color-ink-5) pl-3">
                {t("brand.admin")}
              </span>
            </div>
            <div class="flex items-center gap-2">
              {adminUsername.value !== null ? (
                <span class="text-xs text-(--color-ink-3) hidden sm:inline">
                  {t("header.connectedAs", { username: adminUsername.value })}
                </span>
              ) : null}
              <LanguageToggle />
              <ThemeToggle />
              {adminUsername.value !== null ? (
                <button
                  type="button"
                  class="btn-ghost btn-sm"
                  onClick={() => void logout()}
                >
                  {t("header.logout")}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <main class="relative z-10 mx-auto max-w-3xl w-full px-6 py-12 flex-1">
          {view.value === "loading" ? (
            <section class="surface">
              <p class="text-(--color-ink-3) m-0">{t("common.loading")}</p>
            </section>
          ) : view.value === "setup" ? (
            <SetupView />
          ) : view.value === "login" ? (
            <LoginView />
          ) : (
            <DashboardView />
          )}
        </main>

        <footer class="relative z-10 py-8 text-center">
          <span class="mono-tag">{t("footer.tagline")}</span>
        </footer>
      </div>
      <ConfirmModalHost />
    </>
  );
}
