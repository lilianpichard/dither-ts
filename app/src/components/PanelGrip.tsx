import { GripVertical } from "lucide-react";
import { cn } from "cn";

/**
 * The handle a panel is dragged by. A real button, so it is reachable by
 * keyboard and carries an accessible name, and it says which edge the panel is
 * on so the drag has a meaning before it starts.
 */
export function PanelGrip({
  side,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
  label,
  hint,
}: {
  /** The edge the panel is docked to, named in the accessible name. */
  side: string;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  /** Accessible name, from the catalogue. */
  label: string;
  /** What the key does, for the tooltip. */
  hint: string;
}) {
  return (
    <button
      type="button"
      aria-label={`${label} (${side})`}
      title={`${label} (${hint})`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        "flex size-5 shrink-0 cursor-grab items-center justify-center rounded",
        "text-muted-foreground transition-colors hover:text-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
        "active:cursor-grabbing",
      )}
    >
      <GripVertical className="size-3" />
    </button>
  );
}
