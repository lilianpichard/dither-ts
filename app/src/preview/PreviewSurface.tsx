import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "cn";
import { frameToCanvas, type Frame } from "./frame";
import { fitView, type View } from "./canvasFit";

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
  );
}

function ZoomButton({
  label,
  hint,
  onClick,
  children,
  className,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${hint})`}
      onClick={onClick}
      className={cn(
        "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-3",
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface PreviewSurfaceProps {
  /** The bitmap to paint. */
  display: Frame | null;
  /** The bitmap shown while compare is held; `null` hides the compare control. */
  compare: Frame | null;
  /**
   * The coordinate space for zoom and fit. Only its dimensions matter, so a
   * caller may pass a freshly built object each frame — which is what lets a
   * downscaled preview and a full-resolution result share one view.
   */
  geometry: Frame | null;
  /**
   * Changing this refits, for the cases the dimensions cannot express: loading a
   * different image or a different clip.
   */
  resetKey?: unknown;
  label: string;
}

/**
 * The app's single preview surface, shared by the still image and the video
 * timeline. Wheel zooms at the cursor, drag pans, double-click fits, and holding
 * compare (the button or C) swaps in `compare`. Pixel smoothing stays off so
 * dither dots remain exact at any zoom.
 *
 * Three invariants keep the view still while the work happens underneath it:
 * the view is expressed in `geometry` space, so a render landing changes no
 * geometry; the refit keys on geometry dimensions rather than object identity, so
 * a new frame object each time does not count as a new image; and the last frame
 * stays painted, so a re-render or a scrub never blanks the canvas.
 */
export default function PreviewSurface({
  display,
  compare,
  geometry,
  resetKey,
  label,
}: PreviewSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 1, ox: 0, oy: 0 });
  const [comparing, setComparing] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const geoW = geometry?.width ?? 0;
  const geoH = geometry?.height ?? 0;

  // A parameter change clears the result while the next render is in flight, and
  // a scrub leaves the previous frame up until the next one lands. Keep painting
  // it, but only while the geometry still matches: a change of subject must drop
  // the stale frame rather than leave it on screen.
  const heldRef = useRef<{ w: number; h: number; frame: Frame } | null>(null);
  const live =
    display ??
    (heldRef.current && heldRef.current.w === geoW && heldRef.current.h === geoH
      ? heldRef.current.frame
      : null);
  if (display) heldRef.current = { w: geoW, h: geoH, frame: display };

  const displayCanvas = useMemo(() => (live ? frameToCanvas(live) : null), [live]);
  const compareCanvas = useMemo(() => (compare ? frameToCanvas(compare) : null), [compare]);

  const canCompare = compareCanvas !== null;
  const active = comparing && canCompare ? compareCanvas : (displayCanvas ?? compareCanvas);

  const fitTo = useCallback(() => {
    if (!geoW || !geoH || size.w === 0) return;
    setView(fitView(size.w, size.h, geoW, geoH));
  }, [geoW, geoH, size]);

  // Explicit "show the whole thing" actions: the fit button, double-click and 0.
  const fit = useCallback(fitTo, [fitTo]);

  // Neither `display` nor `compare` takes part: a render replaces `display` on
  // every parameter tweak, and compare swaps which bitmap is painted. Either one
  // resetting the view would make it impossible to judge a change at a fixed
  // magnification.
  useEffect(() => {
    fitTo();
  }, [fitTo, resetKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Paint on every relevant change. The destination rect comes from the geometry
  // dimensions, not from `active`, so a downscaled frame fills exactly the same
  // area its full-resolution counterpart will.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active || !geoW || !geoH) return;
    canvas.width = Math.max(1, Math.floor(size.w));
    canvas.height = Math.max(1, Math.floor(size.h));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(active, view.ox, view.oy, geoW * view.scale, geoH * view.scale);
  }, [active, geoW, geoH, view, size]);

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      const v = viewRef.current;
      const rect = canvasRef.current?.getBoundingClientRect();
      const px = cx ?? (rect ? rect.width / 2 : size.w / 2);
      const py = cy ?? (rect ? rect.height / 2 : size.h / 2);
      const scale = Math.min(32, Math.max(0.02, v.scale * factor));
      const k = scale / v.scale;
      setView({ scale, ox: px - (px - v.ox) * k, oy: py - (py - v.oy) * k });
    },
    [size],
  );

  // Wheel zoom (non-passive so we can preventDefault).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Keyboard: + / - zoom, 0 fit, hold C to compare.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // Ctrl+C and Cmd+C are copy; treating them as compare would fight it.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") zoomAt(1.2);
      else if (e.key === "-") zoomAt(1 / 1.2);
      else if (e.key === "0") fit();
      else if ((e.key === "c" || e.key === "C") && !e.repeat && canCompare) setComparing(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "c" || e.key === "C") setComparing(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [zoomAt, fit, canCompare]);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const v = viewRef.current;
    dragRef.current = { x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setView((v) => ({ ...v, ox: d.ox + (e.clientX - d.x), oy: d.oy + (e.clientY - d.y) }));
  }

  // Cancel and lost capture both end the drag, otherwise the view keeps panning.
  function endDrag() {
    dragRef.current = null;
  }

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={fit}
      />
      <div className="absolute top-2 left-2 flex items-center gap-0.5 rounded-lg border border-border bg-raised/90 p-0.5 backdrop-blur-sm">
        <ZoomButton label="Zoom out" hint="-" onClick={() => zoomAt(1 / 1.25)}>
          <ZoomOut />
        </ZoomButton>
        <span className="w-9 text-center text-caption text-muted-foreground tabular-nums">
          {Math.round(view.scale * 100)}%
        </span>
        <ZoomButton label="Zoom in" hint="+" onClick={() => zoomAt(1.25)}>
          <ZoomIn />
        </ZoomButton>
        <ZoomButton label="Fit to view" hint="0" onClick={fit}>
          <Maximize />
        </ZoomButton>
        <button
          type="button"
          aria-label="Compare with original"
          aria-pressed={comparing && canCompare}
          disabled={!canCompare}
          title={canCompare ? "Hold to compare with original (C)" : "Nothing to compare against"}
          onPointerDown={() => canCompare && setComparing(true)}
          onPointerUp={() => setComparing(false)}
          onPointerLeave={() => setComparing(false)}
          onPointerCancel={() => setComparing(false)}
          // Pointer handlers alone leave this reachable by Tab but dead to a
          // keyboard, so Enter and Space hold the compare the same way.
          onKeyDown={(e) => {
            if ((e.key === " " || e.key === "Enter") && canCompare) {
              e.preventDefault();
              setComparing(true);
            }
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") setComparing(false);
          }}
          onBlur={() => setComparing(false)}
          className={cn(
            "flex size-6 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3",
            comparing && canCompare
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Eye />
        </button>
      </div>
    </div>
  );
}
