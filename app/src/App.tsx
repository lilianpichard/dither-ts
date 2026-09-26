import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cancelAll, renderImage } from "./worker/client";
import { stripKeys } from "./presets/store";
import { useApp } from "./store";
import { describeRenderStatus } from "./status";
import { requestOperations, scaleOperations } from "./image/settings";
import { MAX_HEAVY_PREVIEW_DIM, fitSize, isHeavyMethod } from "./video/jobs";
import CanvasViewport from "./components/CanvasViewport";
import ControlPanel from "./components/ControlPanel";
import ToolsPanel, { TOOL_IDS, type ToolId } from "./components/ToolsPanel";
import { TopBar } from "./components/TopBar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Toaster } from "@/components/ui/sonner";

const APP_RENDER_TIMEOUT = 30_000;
const APP_RENDER_SCOPE = "app-preview";
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
          { signal: controller.signal, timeout: APP_RENDER_TIMEOUT, scope: APP_RENDER_SCOPE },
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

  return (
    <main className="flex min-h-svh flex-col overflow-x-clip bg-background lg:h-svh lg:overflow-hidden">
      <TopBar />
      {/* Toasts own failures; this region only speaks render status. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {status}
      </div>
      <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        <ControlPanel onFile={(file) => void onFile(file)} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
          <section className="relative flex min-h-64 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-canvas lg:min-h-0 lg:flex-3">
            {source && shown ? (
              <>
                <CanvasViewport source={source} result={shown} />
                <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-label text-muted-foreground">
                  {shown.width}×{shown.height} · {params.method.toUpperCase()} · {params.threshold}{" "}
                  · {params.pixelSize}px
                </p>
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
          <ToolsPanel tool={tool} onTool={setTool} />
        </div>
      </div>
      <Toaster />
    </main>
  );
}
