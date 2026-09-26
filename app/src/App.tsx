import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Redo2, Undo2 } from "lucide-react";
import { cancelAll, renderImage } from "./worker/client";
import { stripKeys } from "./presets/store";
import { useApp } from "./store";
import { describeRenderStatus } from "./status";
import { requestOperations, scaleOperations } from "./image/settings";
import { MAX_HEAVY_PREVIEW_DIM, fitSize, isHeavyMethod } from "./video/jobs";
import CanvasViewport from "./components/CanvasViewport";
import ControlPanel from "./components/ControlPanel";
import { ImageDropzone } from "./components/ImageDropzone";
import ToolsPanel, { TOOL_IDS, type ToolId } from "./components/ToolsPanel";
import { ThemeToggle } from "./components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Card } from "@/components/ui/card";

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
  const undo = useApp((state) => state.undo);
  const redo = useApp((state) => state.redo);
  const canUndo = useApp((state) => state.past.length > 0);
  const canRedo = useApp((state) => state.future.length > 0);
  const [tool, setTool] = useState<ToolId>("presets");
  const fileSequence = useRef(0);
  const renderAbort = useRef<AbortController | null>(null);
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
        if (event.shiftKey) redo();
        else undo();
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
  }, [redo, undo]);

  return (
    <main className="flex min-h-svh flex-col lg:h-svh lg:overflow-hidden">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <span className="text-base font-semibold">dither-ts studio</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Alt+1-6 switches tools
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 />
          </Button>
          <ThemeToggle />
        </div>
      </header>
      {/* Toasts own failures; this region only speaks render status. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {status}
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-x-clip p-3 lg:min-h-0 lg:flex-row lg:overflow-hidden">
        <div className="order-2 flex min-w-0 flex-col lg:order-1">
          <ControlPanel onFile={(file) => void onFile(file)} />
        </div>
        <div className="order-1 flex min-w-0 flex-col lg:order-2 lg:min-h-0 lg:flex-1">
          {!source ? (
            <Card className="flex min-h-64 flex-col items-center justify-center lg:min-h-0 lg:flex-1">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Drop an image to start</EmptyTitle>
                  <EmptyDescription>
                    Controls and tools stack below the canvas on small screens.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <ImageDropzone onFile={(file) => void onFile(file)} className="w-full max-w-64" />
                </EmptyContent>
              </Empty>
            </Card>
          ) : (
            <CanvasViewport source={source} result={preview ?? result} />
          )}
        </div>
        <div className="order-3 flex min-w-0 flex-col">
          <ToolsPanel tool={tool} onTool={setTool} />
        </div>
      </div>
      <Toaster />
    </main>
  );
}
