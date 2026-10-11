import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { mediaKindOf, type MediaKind } from "@/media/kind";
import { useTranslate } from "@/i18n";

/** The four handlers a surface spreads onto the element that takes the drop. */
export interface MediaDropBindings {
  onDragEnter: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}

export interface MediaDrop {
  /** True while a file is being dragged over the surface. */
  dragging: boolean;
  /** Spread onto the element that takes the drop. */
  bindings: MediaDropBindings;
  /**
   * Validate and hand on a file from anywhere that is not a drop: the hidden
   * input, the native dialog. Goes through the same check a drop does.
   */
  handleFile: (file: File | undefined | null) => void;
}

/**
 * Drag and drop of a file, for every surface that takes one.
 *
 * The whole gesture lives here rather than in each surface: a drop aimed at a
 * child has to be counted in and out again, and the same counting is wrong in two
 * places. All a surface supplies is what the highlight looks like.
 *
 * `handleFile` only ever hands on a file the app knows how to open, so a rejection
 * is a toast rather than a silence that reads as a broken app.
 */
export function useMediaDrop(
  onFile: (file: File, kind: MediaKind) => void,
  enabled = true,
): MediaDrop {
  const t = useTranslate();
  const [dragging, setDragging] = useState(false);
  // Depth, not a boolean: a drag over a child fires enter on the child and leave
  // on the parent, and a boolean would clear while the pointer is still inside.
  const depth = useRef(0);
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const handleFile = useCallback(
    (file: File | undefined | null) => {
      if (!file || !enabledRef.current) return;
      const kind = mediaKindOf(file);
      if (kind === null) {
        toast.error(t("error.notMedia", { name: file.name || "" }));
        return;
      }
      onFileRef.current(file, kind);
    },
    [t],
  );

  // A drag that ends anywhere ends the highlight, including one that leaves the
  // window without a drop: the pointer can cross the edge of the app mid-drag.
  useEffect(() => {
    const end = () => {
      depth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragend", end);
    window.addEventListener("dragexit", end);
    return () => {
      window.removeEventListener("dragend", end);
      window.removeEventListener("dragexit", end);
    };
  }, []);

  const bindings: MediaDropBindings = {
    onDragEnter: (event) => {
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragLeave: (event) => {
      event.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDragOver: (event) => {
      // Without this the browser refuses the drop and opens the file itself.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    },
    onDrop: (event) => {
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      handleFile(event.dataTransfer?.files?.[0]);
    },
  };

  return { dragging, bindings, handleFile };
}
