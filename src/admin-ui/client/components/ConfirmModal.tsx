import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../i18n/index.js";

export interface ConfirmRequest {
  title: string;
  body: string;
  okLabel: string;
  okVariant: "danger" | "success";
  withReason: boolean;
  resolve: (reason: string | null) => void;
}

let openHandler: ((req: ConfirmRequest) => void) | null = null;

/** Imperative API mirroring window.confirm. Returns the reason string
 * (empty if `withReason` is false), or null on cancel. */
export function confirmAction(args: Omit<ConfirmRequest, "resolve">): Promise<string | null> {
  return new Promise((resolve) => {
    if (openHandler === null) {
      resolve(null);
      return;
    }
    openHandler({ ...args, resolve });
  });
}

export function ConfirmModalHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const [reason, setReason] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    openHandler = (r) => {
      setReason("");
      setReq(r);
    };
    return () => {
      openHandler = null;
    };
  }, []);

  useEffect(() => {
    if (req !== null && req.withReason) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [req]);

  if (req === null) return null;

  const submit = (): void => {
    req.resolve(req.withReason ? reason.trim() : "");
    setReq(null);
  };
  const cancel = (): void => {
    req.resolve(null);
    setReq(null);
  };

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-(--color-bg-0)/55 backdrop-blur"
      role="alertdialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div class="surface max-w-md w-full flex flex-col gap-4 shadow-2xl">
        <strong class="text-base text-(--color-ink-0)">{req.title}</strong>
        <p class="m-0 text-sm text-(--color-ink-2)">{req.body}</p>
        {req.withReason ? (
          <label class="flex flex-col gap-1.5">
            <span class="mono-tag">{t("confirm.reasonLabel")}</span>
            <input
              ref={inputRef}
              type="text"
              class="input"
              maxLength={256}
              value={reason}
              onInput={(e) => setReason((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") cancel();
              }}
            />
          </label>
        ) : null}
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-ghost btn-sm" onClick={cancel}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            class={`${req.okVariant === "danger" ? "btn-danger" : "btn-success"} btn-sm`}
            onClick={submit}
          >
            {req.okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
