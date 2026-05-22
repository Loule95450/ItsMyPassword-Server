import { LOCALES, locale, setLocale, t } from "../i18n/index.js";

const LABELS: Record<(typeof LOCALES)[number], string> = {
  fr: "FR",
  en: "EN",
};

export function LanguageToggle() {
  return (
    <div
      class="inline-flex items-center gap-0 rounded-full border border-(--color-ink-5) p-0.5"
      role="group"
      aria-label={t("header.language")}
    >
      {LOCALES.map((loc) => {
        const active = locale.value === loc;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => setLocale(loc)}
            class={`inline-flex h-7 px-2.5 items-center justify-center rounded-full text-[11px] font-mono tracking-[0.18em] transition-colors duration-150 ${
              active
                ? "bg-(--color-bg-1) text-(--color-ink-0)"
                : "text-(--color-ink-3) hover:text-(--color-ink-1)"
            }`}
            aria-pressed={active}
          >
            {LABELS[loc]}
          </button>
        );
      })}
    </div>
  );
}
