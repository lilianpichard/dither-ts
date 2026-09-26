import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "cn";
import type { ImageSource, RenderResult } from "../store";

interface View {
  scale: number;
  ox: number;
  oy: number;
}

function imageToCanvas(pixels: ArrayBuffer, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
  return c;
}

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
        "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none [&_svg]:size-3",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Zoomable canvas viewport with hold-to-compare. Single canvas shows the
 * result; holding compare (button or C) swaps in the source. Wheel zooms
 * at the cursor, drag pans, double-click fits. Pixel smoothing stays off
 * so dither dots remain exact at any zoom.
 */
export default function CanvasViewport({
  source,
  result,
}: {
  source: ImageSource | null;
  result: RenderResult | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 1, ox: 0, oy: 0 });
  const [comparing, setComparing] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const sourceCanvas = useMemo(
    () => (source ? imageToCanvas(source.pixels, source.width, source.height) : null),
    [source],
  );
  const resultCanvas = useMemo(
    () => (result ? imageToCanvas(result.pixels, result.width, result.height) : null),
    [result],
  );
  const active = comparing ? (sourceCanvas ?? resultCanvas) : (resultCanvas ?? sourceCanvas);

  const fit = useCallback(() => {
    if (!active || size.w === 0) return;
    // Leave room for the meta line that sits along the bottom edge.
    const scale = Math.min(size.w / active.width, (size.h - 28) / active.height);
    setView({
      scale,
      ox: (size.w - active.width * scale) / 2,
      oy: (size.h - active.height * scale) / 2,
    });
  }, [active, size]);

  // Refit when the image or the box changes.
  useEffect(() => {
    fit();
  }, [fit]);

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

  // Paint on every relevant change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    canvas.width = Math.max(1, Math.floor(size.w));
    canvas.height = Math.max(1, Math.floor(size.h));
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(active, view.ox, view.oy, active.width * view.scale, active.height * view.scale);
  }, [active, view, size]);

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
      if (e.key === "+" || e.key === "=") zoomAt(1.2);
      else if (e.key === "-") zoomAt(1 / 1.2);
      else if (e.key === "0") fit();
      else if ((e.key === "c" || e.key === "C") && !e.repeat) setComparing(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "c" || e.key === "C") setComparing(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [zoomAt, fit]);

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
        aria-label="Dithered image preview"
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
          aria-pressed={comparing}
          title="Hold to compare with original (C)"
          onPointerDown={() => setComparing(true)}
          onPointerUp={() => setComparing(false)}
          onPointerLeave={() => setComparing(false)}
          onPointerCancel={() => setComparing(false)}
          className={cn(
            "flex size-6 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none [&_svg]:size-3",
            comparing
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
