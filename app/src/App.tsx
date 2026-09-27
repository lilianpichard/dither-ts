import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
let jobSeq = 0;

async function fileToSource(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
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
      describeRenderStatus({
        hasSource: source !== null,
        rendering,
        ms: result?.ms ?? null,
        previewScaled,
      }),
    [source, rendering, result, previewScaled],
  );

  async function onFile(file: File | undefined) {
    if (!file) return;
    const sequence = ++fileSequence.current;
    try {
      const next = await fileToSource(file);
      if (sequence === fileSequence.current) setSource(next);
    } catch (error) {
      if (sequence === fileSequence.current) {
        toast.error(
          `Could not load image: ${error instanceof Error ? error.message : String(error)}`,
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
      const cancelSlowWarning = warnIfSlow(
        SLOW_OPERATION_MS,
        "Large image: dithering at full quality can take a while.",
      );
      try {
        let width = source.width;
        let height = source.height;
        let pixels = source.pixels.slice(0);
        let frameOperations = operations;
        const capped =
          isHeavyMethod(params.method) && Math.max(width, height) > MAX_HEAVY_PREVIEW_DIM;
        if (capped) {
          const size = fitSize(width, height, MAX_HEAVY_PREVIEW_DIM);
          const full = document.createElement("canvas");
          full.width = width;
          full.height = height;
          full
            .getContext("2d")!
            .putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
          const small = document.createElement("canvas");
          small.width = size.width;
          small.height = size.height;
          small.getContext("2d")!.drawImage(full, 0, 0, size.width, size.height);
          const data = small.getContext("2d")!.getImageData(0, 0, size.width, size.height);
          // Crop lives in source pixels, so it follows the preview downscale.
          frameOperations = scaleOperations(operations, size.width / width);
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
            pixelSize: params.pixelSize,
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
          { signal: controller.signal, scope: APP_RENDER_SCOPE },
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
        toast.error(`Render failed: ${error instanceof Error ? error.message : String(error)}`);
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
        <ControlPanel
          onFile={(file) => void onFile(file)}
          width={rail.size}
          collapsed={rail.collapsed}
        />
        <PanelResizer
          orientation="vertical"
          label="control rail"
          size={rail.size}
          onResize={rail.resize}
          onToggle={rail.toggle}
          min={RAIL_MIN}
          max={Math.max(RAIL_MIN, bounds.w - 420)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
          <section className="relative flex min-h-32 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-canvas">
            {source || video ? (
              <>
                <PreviewSurface
                  display={video ? video.display : shown}
                  compare={video ? video.compare : source}
                  geometry={video ? video.geometry : source}
                  resetKey={video ? video.clipKey : source}
                  label={video ? "Dithered video frame preview" : "Dithered image preview"}
                />
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
                    <p className="text-label uppercase">Processing</p>
                  </div>
                ) : null}
              </>
            ) : (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyTitle className="text-display uppercase">Drop image</EmptyTitle>
                  <EmptyDescription>Choose a file to start dithering.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  {/* Board C01: 262x42 raised button, label 10px/700. */}
                  <Button
                    size="xl"
                    variant="secondary"
                    className="w-65.5"
                    onClick={() => pickerRef.current?.click()}
                  >
                    Choose an image
                  </Button>
                  <input
                    ref={pickerRef}
                    type="file"
                    accept="image/*"
                    tabIndex={-1}
                    aria-hidden
                    className="hidden"
                    onChange={(e) => {
                      void onFile(e.target.files?.[0]);
                      e.currentTarget.value = "";
                    }}
                  />
                </EmptyContent>
              </Empty>
            )}
          </section>
          <PanelResizer
            orientation="horizontal"
            label="console"
            size={consolePanel.size}
            onResize={consolePanel.resize}
            onToggle={consolePanel.toggle}
            min={CONSOLE_MIN}
            max={Math.max(CONSOLE_MIN, bounds.h - 260)}
          />
          <ToolsPanel tool={tool} onTool={setTool} height={consolePanel.size} />
        </div>
      </div>
      <Toaster />
    </main>
  );
}
