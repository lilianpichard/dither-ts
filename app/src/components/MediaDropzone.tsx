import * as React from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { canOpenFiles } from "@/desktop/bridge";
import { openFailure, openMedia } from "@/desktop/files";
import { MEDIA_ACCEPT, mediaKindOf, type MediaKind } from "@/media/kind";
import { useTranslate } from "@/i18n";
import { cn } from "@/lib/utils";

interface MediaDropzoneProps {
  /** Called with the file and what it turned out to be. */
  onFile: (file: File, kind: MediaKind) => void;
  /** Currently loaded file name, shared across every picker instance. */
  fileName?: string;
  disabled?: boolean;
  busy?: boolean;
  /** Overrides for the default busy, drop and hint wording. */
  busyLabel?: string;
  label?: string;
  hint?: string;
  /** Miniature shown before the icon, e.g. a thumbnail of the loaded source. */
  leading?: React.ReactNode;
  className?: string;
}

/**
 * One dropzone for image and video alike. It detects which kind was dropped or
 * picked and hands it on, so there is no separate "video" entry point to know
 * about. Icon square + label + hint in one discreet row; bouncing icon and
 * highlighted border while dragging; spinner and busy label while working.
 * A real button, so it is keyboard accessible, and it shows the shared file
 * name once something is loaded.
 */
export function MediaDropzone({
  onFile,
  fileName,
  disabled = false,
  busy = false,
  busyLabel,
  label,
  hint,
  leading,
  className,
}: MediaDropzoneProps) {
  const t = useTranslate();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dragCount = React.useRef(0);
  const [dragging, setDragging] = React.useState(false);
  const inactive = disabled || busy;
  // The desktop shell has a real dialog; a browser still needs the file input.
  const native = React.useMemo(canOpenFiles, []);

  const handleFile = (file: File | undefined | null) => {
    if (!file || inactive) return;
    const kind = mediaKindOf(file);
    if (kind === null) {
      // The picker filters on accept, but a drop does not, and a silent no-op
      // looks like the app is broken.
      toast.error(t("error.notMedia", { name: file.name || "" }));
      return;
    }
    onFile(file, kind);
  };

  async function pick() {
    try {
      const file = await openMedia();
      if (file) handleFile(file);
    } catch (error) {
      toast.error(t("error.open", { reason: openFailure(error) }));
    }
  }

  return (
    <div
      className={cn("w-full", className)}
      onDragEnter={(e) => {
        e.preventDefault();
        if (inactive) return;
        dragCount.current += 1;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (inactive) return;
        dragCount.current = Math.max(0, dragCount.current - 1);
        if (dragCount.current === 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragCount.current = 0;
        setDragging(false);
        if (inactive) return;
        handleFile(e.dataTransfer.files?.[0]);
      }}
    >
      <button
        type="button"
        disabled={inactive}
        onClick={() => {
          if (native) void pick();
          else inputRef.current?.click();
        }}
        aria-label={busy ? (busyLabel ?? t("rail.loading")) : (label ?? t("rail.dropMedia"))}
        className={cn(
          "flex h-11.5 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-raised px-2.5 text-left transition-colors",
          dragging ? "border-ring bg-accent" : "hover:bg-accent",
          inactive && "cursor-not-allowed opacity-60 hover:bg-raised",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center text-muted-foreground",
            leading ? "w-11" : "size-4",
          )}
        >
          {leading ??
            (busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className={cn("size-3.5", dragging && "animate-bounce text-foreground")} />
            ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-bold text-foreground">
            {busy
              ? (busyLabel ?? t("rail.loading"))
              : dragging
                ? t("rail.dropping")
                : (fileName ?? label ?? t("rail.dropMedia"))}
          </span>
          {!busy && (
            <span className="block truncate text-label text-muted-foreground">
              {fileName ? t("rail.replace") : (hint ?? t("rail.clickOrDrop"))}
            </span>
          )}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        tabIndex={-1}
        aria-hidden
        className="hidden"
        disabled={inactive}
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}
