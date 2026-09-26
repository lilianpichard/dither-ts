import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_CHARSET, exportSVG, exportTXT } from "../../../src/index.js";
import { renderImage } from "../worker/client";
import { useApp } from "../store";
import { announceProgress } from "../progress";
import { saveBlob, saveText, type SaveOutcome } from "../desktop/save";
import {
  buildExportRenderRequest,
  canExport,
  nextExportProgress,
  runExportAction,
} from "./request";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Download } from "lucide-react";
import { useConsoleMeta } from "../components/consoleMeta";

interface ExportImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

function rgbaToGray(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) | 0);
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return out;
}

export default function ExportPanel() {
  const source = useApp((s) => s.source);
  const params = useApp((s) => s.params);
  const effects = useApp((s) => s.effects);
  const operations = useApp((s) => s.operations);
  const result = useApp((s) => s.result);
  const rendering = useApp((s) => s.rendering);
  const [cell, setCell] = useState(8);
  const [charset, setCharset] = useState(DEFAULT_CHARSET);
  const [invert, setInvert] = useState(false);
  const [black, setBlack] = useState(false);
  const [format, setFormat] = useState<"png" | "jpg" | "svg" | "txt">("png");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const exportLock = useRef(false);
  const exportAbort = useRef<AbortController | null>(null);
  const exportReady = canExport(result, rendering, exporting);
  const live = announceProgress({
    label: "Export",
    running: exporting,
    done: exportProgress,
    total: 100,
  });

  useEffect(() => {
    return () => exportAbort.current?.abort();
  }, []);

  async function runExport(
    success: string,
    action: (image: ExportImage, signal: AbortSignal) => SaveOutcome | Promise<SaveOutcome>,
  ): Promise<void> {
    if (!source || !exportReady || exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    setExportProgress(0);
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      const request = buildExportRenderRequest(source, params, effects, operations);
      const response = await renderImage(
        request,
        [request.pixels],
        (update) => {
          if (controller.signal.aborted) return;
          setExportProgress((current) =>
            nextExportProgress(update.rowsDone, update.totalRows, current),
          );
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setExportProgress(100);
      let outcome: SaveOutcome = "saved";
      const completed = await runExportAction(
        {
          data: new Uint8ClampedArray(response.pixels.slice(0)),
          width: response.width,
          height: response.height,
        },
        controller.signal,
        async (image, signal) => {
          outcome = await action(image, signal);
        },
      );
      // A cancelled save dialog is not a success, so it stays quiet.
      if (!completed || outcome !== "saved") return;
      toast.success(success);
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (exportAbort.current === controller) exportAbort.current = null;
      exportLock.current = false;
      setExporting(false);
    }
  }

  function raster(mime: string, ext: string, quality?: number) {
    return runExport(`Exported dither.${ext}`, async (cur, signal) => {
      const canvas = document.createElement("canvas");
      canvas.width = cur.width;
      canvas.height = cur.height;
      const ctx = canvas.getContext("2d")!;
      if (mime === "image/jpeg") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cur.width, cur.height);
      }
      ctx.putImageData(new ImageData(cur.data, cur.width, cur.height), 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, mime, quality);
      });
      if (signal.aborted) return "cancelled";
      if (!blob) throw new Error("image encoding failed");
      return saveBlob(`dither.${ext}`, blob);
    });
  }

  function svg() {
    return runExport("Exported dither.svg", (cur) =>
      saveText(
        exportSVG(cur.data, cur.width, cur.height, { black }),
        "dither.svg",
        "image/svg+xml",
      ),
    );
  }

  function txt() {
    return runExport("Exported dither.txt", (cur) =>
      saveText(
        exportTXT(rgbaToGray(cur.data), cur.width, cur.height, {
          cell,
          charset: charset || DEFAULT_CHARSET,
          invert,
        }),
        "dither.txt",
        "text/plain",
      ),
    );
  }

  useConsoleMeta("export", exporting ? "Exporting" : exportReady ? "Ready" : "No output");

  // Board C05: a label above each control, formats as one segmented group.
  const formats = [
    { id: "png", label: "PNG", run: () => raster("image/png", "png") },
    { id: "jpg", label: "JPG", run: () => raster("image/jpeg", "jpg", 0.92) },
    { id: "svg", label: "SVG", run: () => void svg() },
    { id: "txt", label: "TXT", run: () => void txt() },
  ] as const;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5">
        <div className="flex flex-col gap-1.5">
          <Label>Formats</Label>
          <div className="flex gap-2" role="group" aria-label="Export format">
            {formats.map((f) => (
              <Button
                key={f.id}
                variant={format === f.id ? "accent" : "secondary"}
                className="w-19"
                disabled={!exportReady}
                onClick={() => {
                  setFormat(f.id);
                  void f.run();
                }}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="black-vector">Black vector</Label>
          <div className="flex h-7.5 items-center">
            <Switch id="black-vector" checked={black} onCheckedChange={setBlack} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label id="cell-label">Cell {cell}</Label>
          <Slider
            aria-labelledby="cell-label"
            className="w-22.5"
            min={2}
            max={16}
            step={1}
            value={[cell]}
            onValueChange={([v]) => setCell(v)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="charset">Charset</Label>
          <Input
            id="charset"
            value={charset}
            className="w-32"
            onChange={(e) => setCharset(e.target.value)}
            placeholder={DEFAULT_CHARSET}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invert">Invert</Label>
          <div className="flex h-7.5 items-center">
            <Switch id="invert" checked={invert} onCheckedChange={setInvert} />
          </div>
        </div>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {live}
      </div>
      {exporting && (
        <div aria-busy className="flex flex-col gap-1">
          <Badge aria-hidden variant="secondary">
            Exporting {Math.round(exportProgress)}%
          </Badge>
          <Progress aria-label="Export progress" value={exportProgress} max={100} />
        </div>
      )}
      {!exporting && !exportReady && (
        <Empty>
          <EmptyMedia>
            <Download className="size-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Nothing to export</EmptyTitle>
            <EmptyDescription>Render an image first to enable export.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
