import { useEffect } from "preact/hooks";

import { t } from "../i18n/index.js";
import { api } from "../lib/api.js";
import {
  counts,
  filter,
  loadingUsers,
  users,
  usersError,
  type Filter,
  type UserRow,
} from "../lib/state.js";
import { UserRowItem } from "../components/UserRow.js";

async function loadCounts(): Promise<void> {
  const [p, a, r, all] = await Promise.all([
    api<{ total: number }>("/admin/users?status=pending&limit=1", { auth: true }),
    api<{ total: number }>("/admin/users?status=approved&limit=1", { auth: true }),
    api<{ total: number }>("/admin/users?status=rejected&limit=1", { auth: true }),
    api<{ total: number }>("/admin/users?status=all&limit=1", { auth: true }),
  ]);
  counts.value = { pending: p.total, approved: a.total, rejected: r.total, all: all.total };
}

async function loadList(f: Filter): Promise<void> {
  loadingUsers.value = true;
  usersError.value = null;
  try {
    const [data] = await Promise.all([
      api<{ users: UserRow[] }>(
        `/admin/users?status=${encodeURIComponent(f)}&limit=200`,
        { auth: true },
      ),
      loadCounts(),
    ]);
    users.value = data.users;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    usersError.value = t("dashboard.errorLoading", { message });
  } finally {
    loadingUsers.value = false;
  }
}

export function DashboardView() {
  useEffect(() => {
    void loadList(filter.value);
  }, []);

  const onTab = (f: Filter): void => {
    filter.value = f;
    void loadList(f);
  };

  return (
    <section class="flex flex-col gap-6">
      <header class="flex items-baseline justify-between gap-4">
        <div class="flex flex-col gap-1">
          <span class="mono-tag">{t("dashboard.label")}</span>
          <h1 class="m-0 text-4xl md:text-5xl font-semibold tracking-[-0.035em] headline-gradient leading-[1.05]">
            {t("dashboard.title")}
          </h1>
          <p class="m-0 text-(--color-ink-2)">{t("dashboard.intro")}</p>
        </div>
        <button
          type="button"
          class="btn-ghost btn-sm"
          onClick={() => void loadList(filter.value)}
        >
          {t("common.refresh")}
        </button>
      </header>

      <nav class="flex flex-wrap gap-1.5" role="tablist">
        {(["pending", "approved", "rejected", "all"] as const).map((f) => {
          const active = filter.value === f;
          return (
            <button
              key={f}
              type="button"
              class="tab"
              aria-pressed={active}
              onClick={() => onTab(f)}
            >
              {t(`dashboard.tab.${f}` as const)}{" "}
              <span class={`pill ${PILL_CLASS[f]}`}>{counts.value[f]}</span>
            </button>
          );
        })}
      </nav>

      <section class="surface p-0 overflow-hidden">
        <ul class="flex flex-col">
          {usersError.value !== null ? (
            <li class="callout callout-danger m-4">{usersError.value}</li>
          ) : loadingUsers.value && users.value.length === 0 ? (
            <li class="p-6 text-(--color-ink-3) text-sm">{t("common.loading")}</li>
          ) : users.value.length === 0 ? (
            <li class="p-6 text-(--color-ink-3) text-sm text-center">
              {t("dashboard.empty")}
            </li>
          ) : (
            users.value.map((u) => (
              <UserRowItem key={u.id} user={u} onChange={() => loadList(filter.value)} />
            ))
          )}
        </ul>
      </section>
    </section>
  );
}

const PILL_CLASS: Record<Filter, string> = {
  pending: "pill-warn",
  approved: "pill-success",
  rejected: "pill-danger",
  all: "pill-neutral",
};
