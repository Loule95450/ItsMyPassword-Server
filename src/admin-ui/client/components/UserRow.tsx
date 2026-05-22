import { useState } from "preact/hooks";

import { t, locale } from "../i18n/index.js";
import type { UserRow, Status } from "../lib/state.js";
import { api } from "../lib/api.js";
import { confirmAction } from "./ConfirmModal.js";

interface Props {
  user: UserRow;
  onChange: () => void | Promise<void>;
}

export function UserRowItem({ user, onChange }: Props) {
  const [busy, setBusy] = useState(false);

  const dateFmt = (ts: number): string => new Date(ts).toLocaleString(locale.value);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      await onChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.alert(t("error.actionFailed", { message }));
    } finally {
      setBusy(false);
    }
  };

  const approve = (): void => {
    void run(() => api(`/admin/users/${user.id}/approve`, { method: "POST", auth: true }));
  };
  const reject = (): void => {
    void run(async () => {
      const reason = await confirmAction({
        title: t("confirm.reject.title"),
        body: t("confirm.reject.body"),
        okLabel: t("confirm.reject.ok"),
        okVariant: "danger",
        withReason: true,
      });
      if (reason === null) return;
      await api(`/admin/users/${user.id}/reject`, {
        method: "POST",
        auth: true,
        body: reason.length > 0 ? { reason } : {},
      });
    });
  };
  const revoke = (): void => {
    void run(async () => {
      const reason = await confirmAction({
        title: t("confirm.revoke.title"),
        body: t("confirm.revoke.body"),
        okLabel: t("confirm.revoke.ok"),
        okVariant: "danger",
        withReason: true,
      });
      if (reason === null) return;
      await api(`/admin/users/${user.id}/revoke`, {
        method: "POST",
        auth: true,
        body: reason.length > 0 ? { reason } : {},
      });
    });
  };
  const destroy = (): void => {
    void run(async () => {
      const ok = await confirmAction({
        title: t("confirm.delete.title"),
        body: t("confirm.delete.body"),
        okLabel: t("confirm.delete.ok"),
        okVariant: "danger",
        withReason: false,
      });
      if (ok === null) return;
      await api(`/admin/users/${user.id}`, { method: "DELETE", auth: true });
    });
  };

  return (
    <li class="row-entry m-4">
      <div class="flex flex-col gap-1.5 min-w-0">
        <div class="flex items-center gap-2.5 flex-wrap">
          <StatusPill status={user.status} />
          <code class="font-mono text-xs text-(--color-ink-3) break-all">
            {user.emailHashHex}
          </code>
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--color-ink-3)">
          <span>{t("row.requested", { date: dateFmt(user.createdAt) })}</span>
          {user.decidedAt !== null ? (
            <span>{t("row.decided", { date: dateFmt(user.decidedAt) })}</span>
          ) : null}
          {user.lastSeenAt !== null ? (
            <span>{t("row.lastSeen", { date: dateFmt(user.lastSeenAt) })}</span>
          ) : null}
          {user.rejectionReason !== undefined ? (
            <span>{t("row.reason", { reason: user.rejectionReason })}</span>
          ) : null}
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <Actions user={user} busy={busy} approve={approve} reject={reject} revoke={revoke} destroy={destroy} />
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: Status }) {
  if (status === "approved") return <span class="pill pill-success">{t("row.status.approved")}</span>;
  if (status === "rejected") return <span class="pill pill-danger">{t("row.status.rejected")}</span>;
  return <span class="pill pill-warn">{t("row.status.pending")}</span>;
}

function Actions({
  user,
  busy,
  approve,
  reject,
  revoke,
  destroy,
}: {
  user: UserRow;
  busy: boolean;
  approve: () => void;
  reject: () => void;
  revoke: () => void;
  destroy: () => void;
}) {
  if (user.status === "pending") {
    return (
      <>
        <button type="button" class="btn-ghost btn-sm" disabled={busy} onClick={reject}>
          {t("action.reject")}
        </button>
        <button type="button" class="btn-success btn-sm" disabled={busy} onClick={approve}>
          {t("action.approve")}
        </button>
      </>
    );
  }
  if (user.status === "approved") {
    return (
      <>
        <button type="button" class="btn-ghost btn-sm" disabled={busy} onClick={destroy}>
          {t("action.deleteWithEllipsis")}
        </button>
        <button type="button" class="btn-danger btn-sm" disabled={busy} onClick={revoke}>
          {t("action.revoke")}
        </button>
      </>
    );
  }
  return (
    <>
      <button type="button" class="btn-ghost btn-sm" disabled={busy} onClick={destroy}>
        {t("action.deleteWithEllipsis")}
      </button>
      <button type="button" class="btn-success btn-sm" disabled={busy} onClick={approve}>
        {t("action.approveAgain")}
      </button>
    </>
  );
}
