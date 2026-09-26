import * as React from "react";
import { CloudUpload, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { canOpenFiles } from "@/desktop/bridge";
import { openFailure, openImage } from "@/desktop/files";
import { cn } from "@/lib/utils";

interface ImageDropzoneProps {
  onFile: (file: File) => void;
  /** Currently loaded file name, shared across every picker instance. */
  fileName?: string;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  label?: string;
  hint?: string;
  className?: string;
}

/**
 * Compact image dropzone (click + drag & drop). Icon square + label +
 * hint in one discreet row; bouncing icon + highlighted border while
 * dragging; spinner + busy label while working. Keyboard accessible
 * (real <button>). Shows the shared loaded file name when provided.
 */
export function ImageDropzone({
  onFile,
  fileName,
  disabled = false,
  busy = false,
  busyLabel = "Loading…",
  label = "Choose an image",
  hint = "Click or drop a file",
  className,
}: ImageDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dragCount = React.useRef(0);
  const [dragging, setDragging] = React.useState(false);
  const inactive = disabled || busy;
  // The desktop shell has a real dialog; a browser still needs the file input.
  const native = React.useMemo(canOpenFiles, []);

  const handleFile = (file: File | undefined | null) => {
    if (!file || inactive) return;
    if (!file.type.startsWith("image/")) return;
    onFile(file);
  };

  async function pick() {
    try {
      const file = await openImage();
      if (file) handleFile(file);
    } catch (error) {
      toast.error(`Could not open that image: ${openFailure(error)}`);
    }
  }

  return (
    <div
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
        aria-label={busy ? busyLabel : label}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-dashed px-3 py-2 text-left transition-colors",
          dragging
            ? "border-ring bg-muted"
            : "border-border bg-muted/40 hover:border-ring/60 hover:bg-muted",
          inactive && "cursor-not-allowed opacity-60 hover:border-border hover:bg-muted/40",
          className,
        )}
      >
        <span className="shrink-0 rounded-md border border-border p-1.5">
          {busy ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <CloudUpload
              className={cn(
                "size-4 text-muted-foreground",
                dragging && "animate-bounce text-foreground",
              )}
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">
            {busy ? busyLabel : dragging ? "Drop the image" : (fileName ?? label)}
          </span>
          {!busy && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
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
