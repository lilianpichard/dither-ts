import { DOCK_ZONES, allowedSides, zoneBox } from "../dock";
import type { Rect } from "../dock";
import type { DockPanel } from "../useDockDrag";

interface DockTargetsProps {
  panel: DockPanel;
  /**
   * The canvas rectangle, so the zones are only drawn once the work has been
   * measured. Below a measured canvas the zones would sit at the top left of the
   * window, which is a highlight the user cannot act on.
   */
  rect: Rect | null;
  /** The panel being dragged, so only its own edges are offered. */
  dragging: boolean;
  zone: string | null;
}

/** The drop zones shown while a panel is dragged to an edge of the canvas. */
export function DockTargets({ panel, rect, dragging, zone }: DockTargetsProps) {
  if (!dragging || !rect) return null;
  // Only the edges the panel can actually take are drawn: offering an edge that
  // would be refused on the drop is a promise the shell does not keep.
  const sides = allowedSides(panel);
  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
      {DOCK_ZONES.filter((target) => sides.includes(target.side)).map((target) => {
        const box = zoneBox(target.side);
        return (
          <div
            key={target.side}
            data-testid={`dock-${target.side}`}
            className={[
              "absolute rounded-lg border-2 transition-colors",
              zone === target.side ? "border-primary bg-primary/20" : "border-border bg-card/40",
            ].join(" ")}
            style={{
              left: `${box.left * 100}%`,
              top: `${box.top * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}
