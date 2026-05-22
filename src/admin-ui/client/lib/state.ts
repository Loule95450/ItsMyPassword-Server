/**
 * App-wide reactive state. Mirrors the extension's `popup/state.ts`
 * pattern — a handful of Preact signals that components subscribe to.
 */
import { signal } from "@preact/signals";

export type View = "loading" | "setup" | "login" | "dashboard";

export const view = signal<View>("loading");
export const adminUsername = signal<string | null>(null);

export type Filter = "pending" | "approved" | "rejected" | "all";
export const filter = signal<Filter>("pending");

export type Status = "pending" | "approved" | "rejected";

export interface UserRow {
  id: string;
  emailHashHex: string;
  status: Status;
  createdAt: number;
  decidedAt: number | null;
  lastSeenAt: number | null;
  rejectionReason?: string;
}

export interface UserCounts {
  pending: number;
  approved: number;
  rejected: number;
  all: number;
}

export const users = signal<UserRow[]>([]);
export const counts = signal<UserCounts>({ pending: 0, approved: 0, rejected: 0, all: 0 });
export const loadingUsers = signal<boolean>(false);
export const usersError = signal<string | null>(null);

// Theme — same pattern as the website's inline boot script.
const THEME_KEY = "theme";
function detectTheme(): "dark" | "light" {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* localStorage blocked */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
export const theme = signal<"dark" | "light">(detectTheme());
export function toggleTheme(): void {
  const next = theme.value === "dark" ? "light" : "dark";
  theme.value = next;
  document.documentElement.classList.toggle("dark", next === "dark");
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
}
