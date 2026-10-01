import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw } from "lucide-react";
import { canUpdate, checkForUpdate, onUpdateStatus, type UpdateState } from "../desktop/bridge";

/** What the control should say for the status the shell last reported. */
export function updateLabel(status: UpdateState | null, busy: boolean): string | null {
  if (busy) return "Checking";
  switch (status?.state) {
    case "available":
      return `Update ${status.version ?? ""}`.trim();
    case "downloading":
      return `Downloading ${status.percent}%`;
    case "ready":
      return "Restart to update";
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

  useEffect(() => onUpdateStatus(setStatus), []);

  const check = useCallback(async () => {
    setBusy(true);
    const result = await checkForUpdate();
    setBusy(false);
    if (!result) return;
    if (result.ok && result.version) toast.success(`dither-ts ${result.version} is current`);
    else if (!result.ok && result.message) toast.error(`update check failed: ${result.message}`);
  }, []);

  if (!canUpdate()) return null;
  const label = updateLabel(status, busy);

  return (
    <button
      type="button"
      aria-label="Check for updates"
      title={label ?? "Check for updates"}
      disabled={busy}
      onClick={() => void check()}
      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3"
    >
      {status?.state === "ready" ? <Download /> : <RefreshCw />}
    </button>
  );
}
