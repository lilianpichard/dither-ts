import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw } from "lucide-react";
import { canUpdate, checkForUpdate, onUpdateStatus, type UpdateState } from "../desktop/bridge";
import { useTranslate } from "../i18n";

/** What the control should say for the status the shell last reported. */
export function updateLabel(
  status: UpdateState | null,
  busy: boolean,
  t: (
    id:
      | "update.check"
      | "update.checking"
      | "update.available"
      | "update.downloading"
      | "update.ready",
    values?: Record<string, string | number>,
  ) => string,
): string | null {
  if (busy) return t("update.checking");
  switch (status?.state) {
    case "available":
      return t("update.available", { version: status.version ?? "" }).trim();
    case "downloading":
      return t("update.downloading", { percent: status.percent });
    case "ready":
      return t("update.ready");
    default:
      return null;
  }
}

/**
 * Update control for the desktop shell. The shell downloads in the background
 * and installs on quit, so this only has to start a check and report progress.
 * On the web there is no feed, and nothing renders.
 */
export function UpdateCheck() {
  const [status, setStatus] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useTranslate();

  useEffect(() => onUpdateStatus(setStatus), []);

  const check = useCallback(async () => {
    setBusy(true);
    const result = await checkForUpdate();
    setBusy(false);
    if (!result) return;
    if (result.ok && result.version)
      toast.success(t("update.current", { version: result.version }));
    else if (!result.ok && result.message)
      toast.error(t("update.failed", { message: result.message }));
  }, []);

  if (!canUpdate()) return null;
  const label = updateLabel(status, busy, t);

  return (
    <button
      type="button"
      aria-label={t("update.check")}
      title={label ?? t("update.check")}
      disabled={busy}
      onClick={() => void check()}
      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3"
    >
      {status?.state === "ready" ? <Download /> : <RefreshCw />}
    </button>
  );
}
