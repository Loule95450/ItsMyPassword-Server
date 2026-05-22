/**
 * i18n with reactive locale via signals — same pattern as the extension.
 * Locale is persisted in localStorage so the choice survives reloads.
 * Default detection: stored value → browser `navigator.languages` → fr.
 */
import { signal } from "@preact/signals";

import {
  DEFAULT_LOCALE,
  LOCALES,
  TRANSLATIONS,
  type Locale,
  type TranslationKey,
} from "./translations.js";

const STORAGE_KEY = "impw.admin.locale.v1";

function detectInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null && (LOCALES as readonly string[]).includes(saved)) {
      return saved as Locale;
    }
  } catch {
    /* localStorage blocked */
  }
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const short = candidate.slice(0, 2).toLowerCase();
    if ((LOCALES as readonly string[]).includes(short)) return short as Locale;
  }
  return DEFAULT_LOCALE;
}

export const locale = signal<Locale>(detectInitialLocale());

export function setLocale(next: Locale): void {
  locale.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* localStorage blocked */
  }
  document.documentElement.lang = next;
}

/** Reactive translation. Subscribe by reading `locale.value` inside a
 * component — Preact signals will re-render on change. */
export function t(key: TranslationKey, vars: Record<string, string | number> = {}): string {
  const table = TRANSLATIONS[locale.value];
  let s: string = table[key];
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

export { LOCALES, type Locale } from "./translations.js";
