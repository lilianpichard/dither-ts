import { useRef } from "react";
import { PanelLeftClose, PanelLeftOpen, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "cn";

/**
 * Draggable boundary between two panels. Drag to resize, double-click (or the
 * chevron) to collapse and restore. Sizes are clamped here so a panel can never
 * be dragged past its minimum or squeezed to nothing by accident.
 */
export function PanelResizer({
  orientation,
  size,
  onResize,
  onToggle,
  min,
  max,
  label,
}: {
  /** "vertical" = a vertical bar that controls a horizontal extent (rail width). */
  orientation: "vertical" | "horizontal";
  size: number;
  onResize: (next: number) => void;
  onToggle: () => void;
  min: number;
  max: number;
  label: string;
}) {
  const last = useRef<number | null>(null);
  // pointermove and held arrow keys both fire faster than React re-renders, so
  // the handlers must read a live value rather than the `size` prop, or the
  // drag stalls and the clamp is never reached.
  const live = useRef(size);
  live.current = size;

  const vertical = orientation === "vertical";
  const clamp = (n: number) => Math.min(Math.max(n, min), Math.max(min, max));

  const apply = (next: number) => {
    const bounded = clamp(next);
    live.current = bounded;
    onResize(bounded);
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      title={`${label} — drag to resize, double-click to collapse`}
      onDoubleClick={onToggle}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 12;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          apply(live.current + step);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          apply(live.current - step);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = vertical ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (last.current === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const now = vertical ? e.clientX : e.clientY;
        const delta = now - last.current;
        last.current = now;
        apply(live.current + delta);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        last.current = null;
      }}
      className={cn(
        "group relative z-10 flex shrink-0 items-center justify-center bg-border",
        "hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        vertical ? "w-0.5 cursor-col-resize flex-col" : "h-0.5 w-full cursor-row-resize",
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={size > 0 ? `Collapse ${label}` : `Expand ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          "absolute flex items-center justify-center rounded-full border border-border bg-card text-muted-foreground",
          "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground",
          vertical ? "-top-2.5 h-5 w-5" : "-left-2.5 h-5 w-5",
        )}
      >
        {vertical ? (
          size > 0 ? (
            <PanelLeftClose className="size-3" />
          ) : (
            <PanelLeftOpen className="size-3" />
          )
        ) : size > 0 ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronUp className="size-3" />
        )}
      </button>
    </div>
  );
}
