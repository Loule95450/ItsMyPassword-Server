import { useState } from "preact/hooks";

import { t } from "../i18n/index.js";
import { setStoredToken } from "../lib/api.js";
import { opaqueLogin } from "../lib/opaque.js";
import { bootstrap } from "../App.js";

export function LoginView() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await opaqueLogin(username.trim(), password);
      setStoredToken(r.sessionToken);
      setPassword("");
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
        <span class="mono-tag">{t("login.label")}</span>
        <h1 class="m-0 text-4xl md:text-5xl font-semibold tracking-[-0.035em] headline-gradient leading-[1.05]">
          {t("login.title")}
        </h1>
        <p class="m-0 text-(--color-ink-2)">{t("login.intro")}</p>
      </header>
      <form class="surface flex flex-col gap-5" onSubmit={submit}>
        <label class="flex flex-col gap-1.5">
          <span class="mono-tag">{t("login.username")}</span>
          <input
            type="text"
            class="input"
            autoComplete="username"
            required
            value={username}
            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
            disabled={busy}
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="mono-tag">{t("login.password")}</span>
          <input
            type="password"
            class="input"
            autoComplete="current-password"
            required
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
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
            {busy ? t("login.submitting") : t("login.submit")}
          </button>
        </div>
      </form>
    </section>
  );
}

function humanError(message: string): string {
  if (message === "invalid_login") return t("error.invalidLogin");
  if (message.includes("HTTP 429")) return t("error.rateLimit");
  return message;
}
