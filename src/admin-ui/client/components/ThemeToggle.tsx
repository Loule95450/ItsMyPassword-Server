import { theme, toggleTheme } from "../lib/state.js";
import { t } from "../i18n/index.js";

export function ThemeToggle() {
  // touch the signal so we re-render when it changes
  void theme.value;
  return (
    <button
      type="button"
      class="theme-toggle"
      onClick={toggleTheme}
      aria-label={t("header.theme")}
      title={t("header.theme")}
    >
      <svg
        class="icon-sun"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="3.2" fill="currentColor" />
        <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <line x1="8" y1="1.6" x2="8" y2="3" />
          <line x1="8" y1="13" x2="8" y2="14.4" />
          <line x1="1.6" y1="8" x2="3" y2="8" />
          <line x1="13" y1="8" x2="14.4" y2="8" />
          <line x1="3.2" y1="3.2" x2="4.3" y2="4.3" />
          <line x1="11.7" y1="11.7" x2="12.8" y2="12.8" />
          <line x1="3.2" y1="12.8" x2="4.3" y2="11.7" />
          <line x1="11.7" y1="4.3" x2="12.8" y2="3.2" />
        </g>
      </svg>
      <svg
        class="icon-moon"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <path fill="currentColor" d="M8 1.6A6.4 6.4 0 1 0 14.4 8 5 5 0 0 1 8 1.6Z" />
      </svg>
    </button>
  );
}
