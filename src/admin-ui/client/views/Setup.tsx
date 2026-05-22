import { useState } from "preact/hooks";

import { t } from "../i18n/index.js";
import { setStoredToken } from "../lib/api.js";
import { opaqueRegister } from "../lib/opaque.js";
import { view } from "../lib/state.js";
import { bootstrap } from "../App.js";

export function SetupView() {
  const [username, setUsername] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (pw1 !== pw2) {
      setError(t("setup.error.mismatch"));
      return;
    }
    if (pw1.length < 8) {
      setError(t("setup.error.tooShort"));
      return;
    }
    setBusy(true);
    try {
      const r = await opaqueRegister(
        username.trim(),
        pw1,
        "/admin/setup/register/start",
        "/admin/setup/register/finish",
      );
      setStoredToken(r.sessionToken);
      await bootstrap();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(humanError(message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="flex flex-col gap-6">
      <header class="flex flex-col gap-2">
        <span class="mono-tag">{t("setup.label")}</span>
        <h1
          class="m-0 text-4xl md:text-5xl font-semibold tracking-[-0.035em] headline-gradient leading-[1.05]"
          style="animation: var(--animate-breathe);"
        >
          {t("setup.title")}
        </h1>
        <p class="m-0 text-(--color-ink-2) max-w-prose">{t("setup.intro")}</p>
      </header>
      <form class="surface flex flex-col gap-5" onSubmit={submit}>
        <label class="flex flex-col gap-1.5">
          <span class="mono-tag">{t("setup.username")}</span>
          <input
            type="text"
            class="input"
            autoComplete="username"
            minLength={3}
            maxLength={64}
            required
            value={username}
            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
            disabled={busy}
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="mono-tag">{t("setup.password")}</span>
          <input
            type="password"
            class="input"
            autoComplete="new-password"
            minLength={8}
            required
            value={pw1}
            onInput={(e) => setPw1((e.target as HTMLInputElement).value)}
            disabled={busy}
          />
          <small class="text-xs text-(--color-ink-3) leading-relaxed">
            {t("setup.password.help")}
          </small>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="mono-tag">{t("setup.confirm")}</span>
          <input
            type="password"
            class="input"
            autoComplete="new-password"
            required
            value={pw2}
            onInput={(e) => setPw2((e.target as HTMLInputElement).value)}
            disabled={busy}
          />
        </label>
        {error !== null ? (
          <p class="callout callout-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div class="flex justify-end">
          <button type="submit" class="btn-primary" disabled={busy}>
            {busy ? t("setup.submitting") : t("setup.submit")}
          </button>
        </div>
      </form>
      <p class="text-xs text-(--color-ink-3)">{t("setup.lockedNote")}</p>
    </section>
  );
}

function humanError(message: string): string {
  if (message === "setup_locked") return t("error.setupLocked");
  if (message === "invalid_login") return t("error.invalidLogin");
  if (message.includes("HTTP 429")) return t("error.rateLimit");
  return message;
}

// Re-export to silence preact dev "unused import" warnings for `view`.
void view;
