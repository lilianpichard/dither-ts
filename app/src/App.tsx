import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { cancelAll, renderImage } from "./worker/client";
import { stripKeys } from "./presets/store";
import { resolveColorMode, useApp } from "./store";
import { describeRenderStatus } from "./status";
import { requestOperations, scaleOperations } from "./image/settings";
import { MAX_HEAVY_PREVIEW_DIM, fitSize, isHeavyMethod } from "./video/jobs";
import PreviewSurface from "./preview/PreviewSurface";
import ControlPanel from "./components/ControlPanel";
import ToolsPanel, { TOOL_IDS, type ToolId } from "./components/ToolsPanel";
import { TopBar } from "./components/TopBar";
import { AnalyzingImage } from "./components/AnalyzingImage";
import { PanelResizer } from "./components/PanelResizer";
import { usePanelSize } from "./lib/panelSize";
import { SLOW_OPERATION_MS, warnIfSlow } from "./lib/slowOperation";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MEDIA_ACCEPT, mediaKindOf, type MediaKind } from "./media/kind";
import { cappedPixelSize } from "./video/pixelSize";
import { useTranslate } from "./i18n";
import { useLayout } from "./layout";
import { useDockDrag, type DockPanel } from "./useDockDrag";
import { DockTargets } from "./components/DockTargets";
import { PanelGrip } from "./components/PanelGrip";
import { dockLayout, type DockSide } from "./dock";
import { useGlobalErrors } from "./ErrorReporting";
import { mediaRejection, routeMedia } from "./media/route";
import { useMediaDrop } from "./media/useMediaDrop";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Toaster } from "@/components/ui/sonner";

const APP_RENDER_SCOPE = "app-preview";
const RAIL_MIN = 176;
const CONSOLE_MIN = 120;
const RAIL_DEFAULT = 256;
const CONSOLE_DEFAULT = 300;
// The space the shell keeps for the canvas, so a panel can never be dragged over
// the work. The rail claims a width, the console a height, and each panel's own
// maximum is the window minus the claim the other one makes on its axis.
const CANVAS_MIN_W = 420;
const CANVAS_MIN_H = 260;
// Long enough that no legitimate render reaches it: the slow warning already
// covers a render that is merely big. This only catches a worker that stopped
// answering, which would otherwise leave the overlay up forever.
const PREVIEW_TIMEOUT_MS = 180_000;
let jobSeq = 0;

async function fileToSource(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("this browser would not give the app a 2d context");
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const copy = new Uint8ClampedArray(data.data);
    return {
      width: bitmap.width,
      height: bitmap.height,
      pixels: copy.buffer as ArrayBuffer,
      name: file.name,
    };
  } finally {
    bitmap.close();
  }
}

export default function App() {
  useGlobalErrors();
  const t = useTranslate();
  const source = useApp((state) => state.source);
  const params = useApp((state) => state.params);
  const effects = useApp((state) => state.effects);
  const operations = useApp((state) => state.operations);
  const result = useApp((state) => state.result);
  const preview = useApp((state) => state.preview);
  const rendering = useApp((state) => state.rendering);
  const previewScaled = useApp((state) => state.previewScaled);
  const setSource = useApp((state) => state.setSource);
  const setResult = useApp((state) => state.setResult);
  const setPreview = useApp((state) => state.setPreview);
  const setRendering = useApp((state) => state.setRendering);
  const setPreviewScaled = useApp((state) => state.setPreviewScaled);
  const loadVideo = useApp((state) => state.loadVideo);
  const [tool, setTool] = useState<ToolId>("presets");
  const fileSequence = useRef(0);
  const renderAbort = useRef<AbortController | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  // Panel extents are user-owned: draggable, collapsible, remembered.
  const rail = usePanelSize("dither-ts.panel.rail", RAIL_DEFAULT);
  const consolePanel = usePanelSize("dither-ts.panel.console", CONSOLE_DEFAULT);
  const shellRef = useRef<HTMLElement>(null);
  const [bounds, setBounds] = useState({ w: 1280, h: 800 });

  // The resizers clamp against the real shell box, so a panel can never be
  // dragged wider than the window or taller than the space the canvas needs.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const read = () => setBounds({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const status = useMemo(
    () =>
      describeRenderStatus(
        {
          hasSource: source !== null,
          rendering,
          ms: result?.ms ?? null,
          previewScaled,
        },
        t,
      ),
    [source, rendering, result, previewScaled, t],
  );

  /**
   * One entry for both kinds. The rail, the empty-state picker and the desktop
   * dialog all land here, and the routing is pure so there is exactly one place
   * that decides which kind a file is and who takes the canvas.
   */
  async function onFile(file: File, kind: MediaKind) {
    if (kind === "video") {
      routeMedia(file, kind, { setSource, loadVideo });
      return;
    }
    if (!file) return;
    const sequence = ++fileSequence.current;
    try {
      const next = await fileToSource(file);
      if (sequence === fileSequence.current) setSource(next);
    } catch (error) {
      if (sequence === fileSequence.current) {
        toast.error(
          t("error.loadImage", {
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }

  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    const jobId = ++jobSeq;
    renderAbort.current = controller;
    setRendering(true);
    setPreviewScaled(false);
    const timer = setTimeout(async () => {
      if (controller.signal.aborted) return;
      // Armed per job and disarmed on the way out, so a slow render only ever
      // produces one notice and a fast one produces none.
      const cancelSlowWarning = warnIfSlow(SLOW_OPERATION_MS, t("error.slowLarge"));
      try {
        let width = source.width;
        let height = source.height;
        let pixels = source.pixels.slice(0);
        let frameOperations = operations;
        // The heavy scans are capped for the preview only. Everything that
        // describes the source in its own pixels follows the downscale, so the
        // crop already does; the pixel size has to as well, or the export comes
        // back with blocks a different share of the frame than this preview.
        let framePixelSize = params.pixelSize;
        const capped =
          isHeavyMethod(params.method) && Math.max(width, height) > MAX_HEAVY_PREVIEW_DIM;
        if (capped) {
          const size = fitSize(width, height, MAX_HEAVY_PREVIEW_DIM);
          const full = document.createElement("canvas");
          full.width = width;
          full.height = height;
          const fullCtx = full.getContext("2d");
          if (!fullCtx) throw new Error("this browser would not give the app a 2d context");
          fullCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
          const small = document.createElement("canvas");
          small.width = size.width;
          small.height = size.height;
          const smallCtx = small.getContext("2d");
          if (!smallCtx) throw new Error("this browser would not give the app a 2d context");
          smallCtx.drawImage(full, 0, 0, size.width, size.height);
          const data = smallCtx.getImageData(0, 0, size.width, size.height);
          // Crop and block size both live in source pixels, so both follow it.
          frameOperations = scaleOperations(operations, size.width / width);
          framePixelSize = cappedPixelSize(params, size, source);
          width = size.width;
          height = size.height;
          pixels = new Uint8ClampedArray(data.data).buffer as ArrayBuffer;
        }
        if (controller.signal.aborted || renderAbort.current !== controller) return;
        setPreviewScaled(capped);
        const response = await renderImage(
          {
            width,
            height,
            pixels,
            color: params.color,
            colorMode: resolveColorMode(params),
            method: params.method,
            threshold: params.threshold,
            palette: params.palette,
            pixelSize: framePixelSize,
            effects: stripKeys(effects),
            operations: requestOperations(frameOperations, width, height),
            seed: 0,
            progressEvery: height > 400 ? Math.max(1, Math.floor(height / 16)) : 0,
          },
          [pixels],
          (update) => {
            if (
              controller.signal.aborted ||
              renderAbort.current !== controller ||
              jobId !== jobSeq
            ) {
              return;
            }
            setPreview({
              width: update.width,
              height: update.height,
              pixels: update.pixels,
              ms: 0,
              jobId,
              partial: true,
            });
          },
          { signal: controller.signal, scope: APP_RENDER_SCOPE, timeout: PREVIEW_TIMEOUT_MS },
        );
        if (controller.signal.aborted || renderAbort.current !== controller || jobId !== jobSeq) {
          return;
        }
        setResult({
          width: response.width,
          height: response.height,
          pixels: response.pixels,
          ms: response.ms,
          jobId,
        });
      } catch (error) {
        if (controller.signal.aborted || renderAbort.current !== controller || jobId !== jobSeq) {
          return;
        }
        setResult(null);
        setPreviewScaled(false);
        toast.error(
          t("error.render", { reason: error instanceof Error ? error.message : String(error) }),
        );
      } finally {
        cancelSlowWarning();
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
      cancelAll(APP_RENDER_SCOPE);
      if (renderAbort.current === controller) {
        renderAbort.current = null;
        setRendering(false);
      }
    };
  }, [source, params, effects, operations, setRendering, setResult, setPreview, setPreviewScaled]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) useApp.getState().redo();
        else useApp.getState().undo();
        return;
      }
      if (!event.altKey) return;
      const n = Number(event.key);
      if (n >= 1 && n <= TOOL_IDS.length) {
        event.preventDefault();
        setTool(TOOL_IDS[n - 1]);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const shown = preview ?? result;
  // The video timeline publishes its current frame, and one canvas serves both
  // subjects: whichever has published last owns the preview.
  const video = useApp((state) => state.videoPreview);
  // Dimensions for the meta line, so it describes the frame actually on screen
  // rather than a still image that may not be loaded at all.
  const meta = video ? video.display : (shown ?? source);
  // The arrangement is shared state, because a layout held locally is one that
  // only takes effect when its owner remounts. Sizes stay with the panels.
  const railSide = useLayout((state) => state.railSide);
  const consoleSide = useLayout((state) => state.consoleSide);
  // A panel can be dragged until the other one is at its own minimum, which is
  // the whole window minus what the neighbour needs. The constant is the space
  // the shell already reserves for the canvas, so the two agree by construction.
  const railMaxBounds = Math.max(RAIL_MIN, bounds.w - CANVAS_MIN_W);
  const consoleMaxBounds = Math.max(CONSOLE_MIN, bounds.h - CANVAS_MIN_H);
  // Committing a dock. The rule that decides which edges a panel may take
  // lives with the zones, so the highlight and the drop can never disagree
  // about it, and a refused drop leaves the store untouched.
  const commitDock = useCallback((panel: DockPanel, side: string) => {
    const layout = useLayout.getState();
    const next = dockLayout(layout, panel, side as DockSide);
    if (next === layout) return;
    if (panel === "rail") useLayout.getState().setRailSide(next.railSide);
    else useLayout.getState().setConsoleSide(next.consoleSide);
  }, []);
  const { drag, start: startDock, move: moveDock, end: endDock } = useDockDrag(commitDock);
  const canvasRef = useRef<HTMLElement>(null);
  // The canvas takes a drop as well as the rail, so a file dragged anywhere onto
  // the work loads. The same hook the rail uses, so the two cannot drift.
  const { dragging: canvasDrag, bindings: canvasDrop } = useMediaDrop(onFile);
  const clearMedia = useApp((s) => s.clearMedia);
  // The rectangle is measured here rather than read live, because a panel that
  // resized mid-drag would otherwise change which edge the pointer is over.
  const startDrag = useCallback(
    (panel: DockPanel) => (event: React.PointerEvent) => {
      const box = canvasRef.current?.getBoundingClientRect();
      if (!box) return;
      startDock(panel, event, {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      });
    },
    [startDock],
  );
  const onGripKeyDown = useCallback(
    (panel: DockPanel) => (event: React.KeyboardEvent) => {
      // Arrow keys dock without dragging, so the layout is reachable by
      // keyboard and does not require a pointer to hold and aim.
      const sides =
        panel === "rail"
          ? (["left", "right"] as const)
          : (["top", "right", "bottom", "left"] as const);
      const current =
        panel === "rail" ? useLayout.getState().railSide : useLayout.getState().consoleSide;
      const index = (sides as readonly string[]).indexOf(current);
      const delta =
        event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? -1
            : 0;
      if (delta === 0) return;
      event.preventDefault();
      commitDock(panel, sides[(index + delta + sides.length) % sides.length]);
    },
    [],
  );
  const railGrip = (
    <PanelGrip
      side={railSide}
      label={t("dock.title")}
      hint={t("dock.hint")}
      onPointerDown={startDrag("rail")}
      onPointerMove={moveDock}
      onPointerUp={endDock}
      onKeyDown={onGripKeyDown("rail")}
    />
  );

  // Where the console hangs, which decides the direction of the flex row it
  // shares with the canvas and whether its extent is a width or a height. The
  // boundary bar sits on the far side of the console from the canvas, so it is
  // drawn the same whichever edge the console moved to.
  const consoleRow = consoleSide === "left" || consoleSide === "right";
  const consoleBefore = consoleSide === "top" || consoleSide === "left";
  const consoleBarSide =
    consoleSide === "right"
      ? "left"
      : consoleSide === "left"
        ? "right"
        : consoleSide === "top"
          ? "bottom"
          : "top";

  const consoleGrip = (
    <PanelGrip
      side={consoleSide}
      label={t("dock.title")}
      hint={t("dock.hint")}
      onPointerDown={startDrag("console")}
      onPointerMove={moveDock}
      onPointerUp={endDock}
      onKeyDown={onGripKeyDown("console")}
    />
  );

  const consoleDock = (
    <>
      <PanelResizer
        side={consoleBarSide}
        label="console"
        size={consolePanel.size}
        onResize={consolePanel.resize}
        onToggle={consolePanel.toggle}
        min={CONSOLE_MIN}
        max={consoleMaxBounds}
      />
      <ToolsPanel
        tool={tool}
        onTool={setTool}
        width={consoleRow ? consolePanel.size : undefined}
        height={consoleRow ? "100%" : consolePanel.size}
        grip={consoleGrip}
      />
    </>
  );

  return (
    // relative is load-bearing, not decoration: Tailwind's `sr-only` is
    // `position: absolute`, and every screen-reader-only live region (one per
    // preset card, plus the status region) resolves its containing block from
    // here. Without a positioned ancestor they resolve against the initial
    // containing block, escape this element's `overflow-hidden`, and stretch the
    // document, which is what let the page scroll once the gallery had cards.
    <main ref={shellRef} className="relative flex h-full flex-col overflow-hidden bg-background">
      <TopBar />
      {/* Toasts own failures; this region only speaks render status. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {status}
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {railSide === "left" && (
          <>
            <ControlPanel
              onFile={(file, kind) => void onFile(file, kind)}
              width={rail.size}
              collapsed={rail.collapsed}
              grip={railGrip}
            />
            <PanelResizer
              side="left"
              label="control rail"
              size={rail.size}
              onResize={rail.resize}
              onToggle={rail.toggle}
              min={RAIL_MIN}
              max={railMaxBounds}
            />
          </>
        )}
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 gap-3 p-3",
            consoleRow ? "flex-row" : "flex-col",
          )}
        >
          {/* The console docks to any of the four edges: the flex direction
              follows the pair it belongs to, and the bar sits between it and the
              canvas so a console that moved keeps its own boundary. */}
          {consoleBefore && consoleDock}
          <section
            ref={canvasRef}
            className={cn(
              "relative flex min-h-32 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-canvas",
              canvasDrag && "border-primary",
            )}
            {...canvasDrop}
          >
            {canvasDrag && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/10"
              >
                <p className="text-title text-accent-label uppercase">
                  {t("preview.drop")}
                  <span className="block text-label text-muted-foreground normal-case">
                    {t("preview.dropHint")}
                  </span>
                </p>
              </div>
            )}
            <DockTargets
              panel={drag?.panel ?? "rail"}
              rect={drag?.rect ?? null}
              dragging={drag !== null}
              zone={drag?.zone ?? null}
            />
            {source || video ? (
              <>
                {/* A frame too big to paint is one bad source, not a dead app. */}
                <ErrorBoundary
                  fallback={(message, retry) => (
                    <div role="alert" className="flex h-full items-center justify-center p-4">
                      <div className="max-w-sm text-center">
                        <p className="text-label text-destructive">{message}</p>
                        <button type="button" onClick={retry} className="mt-2 text-label underline">
                          Try again
                        </button>
                      </div>
                    </div>
                  )}
                >
                  <PreviewSurface
                    display={video ? video.display : shown}
                    compare={video ? video.compare : source}
                    geometry={video ? video.geometry : source}
                    resetKey={video ? video.clipKey : source}
                    label={video ? t("preview.video") : t("preview.image")}
                    onClear={() => clearMedia()}
                    canClear={source !== null || video !== null}
                  />
                </ErrorBoundary>
                {meta ? (
                  <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-label text-muted-foreground">
                    {meta.width}×{meta.height} · {params.method.toUpperCase()} · {params.threshold}{" "}
                    · {params.pixelSize}px
                  </p>
                ) : null}

                {rendering ? (
                  // An overlay, not a replacement: swapping the subtree out would
                  // unmount the viewport and throw away the zoom and pan on every
                  // parameter tweak, so the canvas keeps the previous frame up
                  // until the new one is ready to paint over it.
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <AnalyzingImage className="size-16" />
                    <p className="text-label uppercase">{t("status.rendering")}</p>
                  </div>
                ) : null}
              </>
            ) : (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyTitle className="text-display uppercase">{t("empty.canvas")}</EmptyTitle>
                  <EmptyDescription>{t("empty.canvasHint")}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  {/* Board C01: 262x42 raised button, label 10px/700. */}
                  <Button
                    size="xl"
                    variant="secondary"
                    className="w-65.5"
                    onClick={() => pickerRef.current?.click()}
                  >
                    {t("rail.chooseImage")}
                  </Button>
                  <input
                    ref={pickerRef}
                    type="file"
                    accept={MEDIA_ACCEPT}
                    tabIndex={-1}
                    aria-hidden
                    className="hidden"
                    onChange={(e) => {
                      const next = e.target.files?.[0];
                      const kind = next ? mediaKindOf(next) : null;
                      if (next && kind) void onFile(next, kind);
                      else if (next) toast.error(mediaRejection(next, t));
                      e.currentTarget.value = "";
                    }}
                  />
                </EmptyContent>
              </Empty>
            )}
          </section>
          {!consoleBefore && consoleDock}
        </div>
        {railSide === "right" && (
          <>
            <PanelResizer
              side="right"
              label="control rail"
              size={rail.size}
              onResize={rail.resize}
              onToggle={rail.toggle}
              min={RAIL_MIN}
              max={railMaxBounds}
            />
            <ControlPanel
              onFile={(file, kind) => void onFile(file, kind)}
              width={rail.size}
              collapsed={rail.collapsed}
              grip={railGrip}
            />
          </>
        )}
      </div>
      <Toaster />
    </main>
  );
}
