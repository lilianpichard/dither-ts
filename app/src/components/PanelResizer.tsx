import { useRef } from "react";
import { PanelLeftClose, PanelLeftOpen, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "cn";

/**
 * Which side of the gap the sized panel sits on. The bar only knows the extent
 * it controls; this is what makes the drag feel right, because the pointer moves
 * toward the panel it grows and away from the one it shrinks.
 */
export type PanelSide = "left" | "right" | "top" | "bottom";

/** The axis a bar drags along, derived from which way the panel is laid out. */
function axisOf(side: PanelSide): "horizontal" | "vertical" {
  return side === "left" || side === "right" ? "horizontal" : "vertical";
}

/**
 * The sign that turns a pointer delta into a change in extent. The bar sits
 * between the panel and the canvas, so a left or top panel grows as the bar
 * moves toward the canvas (right or down) and a right or bottom panel grows as
 * it moves the other way.
 */
function signOf(side: PanelSide): 1 | -1 {
  return side === "right" || side === "bottom" ? -1 : 1;
}

/** New extent after dragging a boundary by `delta` pointer pixels. */
export function dragExtent(side: PanelSide, current: number, delta: number): number {
  return current + delta * signOf(side);
}

/**
 * Draggable boundary between two panels. Drag to resize, double-click (or the
 * handle) to collapse and restore. Sizes are clamped so a panel can never be
 * dragged past its minimum or squeezed to nothing by accident.
 *
 * `side` says where the sized panel is, which is what makes the drag direction
 * and the collapse handle agree with each other.
 */
export function PanelResizer({
  side,
  size,
  onResize,
  onToggle,
  min,
  max,
  label,
}: {
  /** Where the panel whose extent this bar controls sits. */
  side: PanelSide;
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
  const axis = axisOf(side);

  const clamp = (n: number) => Math.min(Math.max(n, min), Math.max(min, max));
  // A collapsed panel reports size 0, which is below the minimum it declares.
  // Assistive tech reads that as a broken value, so report the minimum and say
  // in words that it is collapsed.
  const collapsed = size <= 0;
  const announced = collapsed ? Math.round(min) : Math.round(size);

  const apply = (next: number) => {
    const bounded = clamp(next);
    live.current = bounded;
    onResize(bounded);
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={axis}
      aria-valuenow={announced}
      aria-valuemin={min}
      aria-valuemax={Math.round(max)}
      aria-valuetext={collapsed ? `${label}, collapsed` : `${label}, ${Math.round(size)} pixels`}
      tabIndex={0}
      title={`${label} - drag to resize, double-click to collapse`}
      onDoubleClick={onToggle}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 12;
        // The arrows read the same way as the drag, so a keyboard user gets the
        // same direction without having to know which side the panel is on: the
        // arrow pointing toward the panel grows it, the one away shrinks it.
        const toward =
          side === "left"
            ? "ArrowRight"
            : side === "right"
              ? "ArrowLeft"
              : side === "top"
                ? "ArrowDown"
                : "ArrowUp";
        const away =
          side === "left"
            ? "ArrowLeft"
            : side === "right"
              ? "ArrowRight"
              : side === "top"
                ? "ArrowUp"
                : "ArrowDown";
        if (e.key === toward) {
          e.preventDefault();
          apply(live.current + step);
        } else if (e.key === away) {
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
        last.current = axis === "horizontal" ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (last.current === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const now = axis === "horizontal" ? e.clientX : e.clientY;
        const delta = now - last.current;
        last.current = now;
        apply(dragExtent(side, live.current, delta));
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        last.current = null;
      }}
      className={cn(
        "group relative z-10 flex shrink-0 items-center justify-center bg-border",
        "hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        axis === "horizontal"
          ? "w-0.5 cursor-col-resize flex-col"
          : "h-0.5 w-full cursor-row-resize",
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
          axis === "horizontal" ? "-top-2.5 h-5 w-5" : "-left-2.5 h-5 w-5",
        )}
      >
        {axis === "horizontal" ? (
          // A rail on the left closes leftward, one on the right closes
          // rightward, so the handle points at the edge it will reach.
          side === "left" ? (
            collapsed ? (
              <PanelLeftOpen className="size-3" />
            ) : (
              <PanelLeftClose className="size-3" />
            )
          ) : collapsed ? (
            <PanelLeftClose className="size-3 rotate-180" />
          ) : (
            <PanelLeftOpen className="size-3 rotate-180" />
          )
        ) : collapsed ? (
          // Collapsed is whatever the panel was, so the offer is to bring it
          // back: down for a console that sank, up for one that rose.
          <ChevronDown className="size-3" />
        ) : (
          <ChevronUp className="size-3" />
        )}
      </button>
    </div>
  );
}
