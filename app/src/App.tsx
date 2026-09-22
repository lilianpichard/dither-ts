import { useEffect, useState } from "react";
import { toast } from "sonner";
import { renderImage } from "./worker/client";
import { stripKeys } from "./presets/store";
import { useApp } from "./store";
import { MAX_HEAVY_PREVIEW_DIM, fitSize, isHeavyMethod } from "./video/jobs";
import CanvasViewport from "./components/CanvasViewport";
import ControlPanel from "./components/ControlPanel";
import { ImageDropzone } from "./components/ImageDropzone";
import ToolsPanel, { TOOL_IDS, type ToolId } from "./components/ToolsPanel";
import { Toaster } from "@/components/ui/sonner";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Card } from "@/components/ui/card";

let jobSeq = 0;

async function fileToSource(file: File) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const copy = new Uint8ClampedArray(data.data);
  return {
    width: bmp.width,
    height: bmp.height,
    pixels: copy.buffer as ArrayBuffer,
    name: file.name,
  };
}

export default function App() {
  const source = useApp((s) => s.source);
  const params = useApp((s) => s.params);
  const effects = useApp((s) => s.effects);
  const result = useApp((s) => s.result);
  const setSource = useApp((s) => s.setSource);
  const setResult = useApp((s) => s.setResult);
  const setRendering = useApp((s) => s.setRendering);
  const setPreviewScaled = useApp((s) => s.setPreviewScaled);
  const [tool, setTool] = useState<ToolId>("presets");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setSource(await fileToSource(file));
  }

  useEffect(() => {
    if (!source) return;
    setRendering(true);
    const timer = setTimeout(async () => {
      const jobId = ++jobSeq;
      try {
        let w = source.width;
        let h = source.height;
        let pixels = source.pixels.slice(0);
        const capped = isHeavyMethod(params.method) && Math.max(w, h) > MAX_HEAVY_PREVIEW_DIM;
        if (capped) {
          const size = fitSize(w, h, MAX_HEAVY_PREVIEW_DIM);
          const full = document.createElement("canvas");
          full.width = w;
          full.height = h;
          full
            .getContext("2d")!
            .putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
          const small = document.createElement("canvas");
          small.width = size.width;
          small.height = size.height;
          small.getContext("2d")!.drawImage(full, 0, 0, size.width, size.height);
          const data = small.getContext("2d")!.getImageData(0, 0, size.width, size.height);
          w = size.width;
          h = size.height;
          pixels = new Uint8ClampedArray(data.data).buffer as ArrayBuffer;
        }
        setPreviewScaled(capped);
        const res = await renderImage(
          {
            width: w,
            height: h,
            pixels: pixels,
            color: params.color,
            method: params.method,
            threshold: params.threshold,
            palette: params.palette,
            pixelSize: params.pixelSize,
            effects: stripKeys(effects),
            seed: 0,
            // Stream every ~24 rows so the canvas reveals top-to-bottom.
            progressEvery: Math.max(1, Math.floor(h / 24)),
          },
          [pixels],
          (u) => {
            if (jobId !== jobSeq) return;
            setResult({
              width: u.width,
              height: u.height,
              pixels: u.pixels,
              ms: 0,
              jobId,
              partial: true,
            });
          },
        );
        if (jobId !== jobSeq) return; // stale: a newer job superseded this one
        setResult({ width: res.width, height: res.height, pixels: res.pixels, ms: res.ms, jobId });
      } catch (err) {
        if (jobId !== jobSeq) return;
        setRendering(false);
        toast.error(`Render failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [source, params, effects, setRendering, setResult, setPreviewScaled]);

  // Alt+1..5 switches the right-rail tool.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= TOOL_IDS.length) {
        e.preventDefault();
        setTool(TOOL_IDS[n - 1]);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  return (
    <main className="flex h-svh flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <span className="text-base font-semibold">dither-ts studio</span>
        <span className="text-xs text-muted-foreground">Alt+1-5 switches tools</span>
      </header>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        <ControlPanel onFile={(f) => void onFile(f)} />
        <div className="flex min-h-0 min-w-96 flex-1 flex-col">
          {!source ? (
            <Card className="flex min-h-0 flex-1 items-center justify-center">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Drop an image to start</EmptyTitle>
                  <EmptyDescription>
                    Every tool stays reachable on the right while you work.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <ImageDropzone onFile={(f) => void onFile(f)} className="w-64" />
                </EmptyContent>
              </Empty>
            </Card>
          ) : (
            <CanvasViewport source={source} result={result} />
          )}
        </div>
        <ToolsPanel tool={tool} onTool={setTool} />
      </div>
      <Toaster />
    </main>
  );
}
