import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { useTranslate } from "../i18n";
import { renderImage } from "../worker/client";
import { DEFAULT_CHARSET, exportTXT } from "../../../src/ascii.js";
import { resolveColorMode, useApp } from "../store";
import { announceProgress } from "../progress";
import { saveBlob, saveText, type SaveOutcome } from "../desktop/save";
import {
  buildExportRenderRequest,
  canExport,
  nextExportProgress,
  runExportAction,
} from "./request";
import { exportOutline, FORMATS, optionsFor, type ExportFormat } from "./formats";
import { paintExportImage } from "./canvas";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card } from "@/components/ui/card";
import { useConsoleMeta } from "../components/consoleMeta";

// An export renders the source at full resolution, so it runs well past the
// preview budget. Only a worker that stopped answering should trip this.
const EXPORT_TIMEOUT_MS = 600_000;

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

/**
 * Format picker, the options that format has, and the one button that writes the
 * file. The options sit next to a summary of what is about to be written rather
 * than in a row of their own: a control that does not apply to the chosen format
 * is a control the user tunes for nothing.
 */
export default function ExportPanel() {
  const t = useTranslate();
  const source = useApp((s) => s.source);
  const params = useApp((s) => s.params);
  const effects = useApp((s) => s.effects);
  const operations = useApp((s) => s.operations);
  const result = useApp((s) => s.result);
  const rendering = useApp((s) => s.rendering);
  const [format, setFormat] = useState<ExportFormat>(FORMATS[0].id);
  const [cell, setCell] = useState(8);
  const [charset, setCharset] = useState(DEFAULT_CHARSET);
  const [invert, setInvert] = useState(false);
  const [black, setBlack] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const exportLock = useRef(false);
  const exportAbort = useRef<AbortController | null>(null);
  const exportReady = canExport(result, rendering, exporting);
  const outline = exportOutline(format);
  const live = announceProgress({
    label: t("export.export"),
    running: exporting,
    done: exportProgress,
    total: 100,
  });

  useEffect(() => {
    return () => exportAbort.current?.abort();
  }, []);

  async function write(): Promise<void> {
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
        { signal: controller.signal, timeout: EXPORT_TIMEOUT_MS },
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
          outcome = await encode(image, signal);
        },
      );
      // A cancelled save dialog is not a success, so it stays quiet.
      if (!completed || outcome !== "saved") return;
      // The catalogue already holds one message per format.
      toast.success(t(`export.${format}`));
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

  /** Turn the rendered pixels into bytes, by whichever writer the format is. */
  async function encode(image: ExportImage, signal: AbortSignal): Promise<SaveOutcome> {
    if (format === "txt") {
      return saveText(
        exportTXT(rgbaToGray(image.data), image.width, image.height, {
          cell,
          charset: charset || DEFAULT_CHARSET,
          invert,
        }),
        outline.filename,
        outline.mime,
      );
    }
    if (format === "svg") {
      // The vector writer is only needed when its format is picked, so it loads
      // then rather than sitting in the entry chunk.
      const { exportSVG } = await import("../../../src/vector.js");
      return saveText(
        exportSVG(image.data, image.width, image.height, { black }),
        outline.filename,
        outline.mime,
      );
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("this browser would not give the app a 2d context");
    paintExportImage(
      ctx,
      new ImageData(image.data, image.width, image.height),
      image.width,
      image.height,
      Boolean(outline.opaque),
    );
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outline.mime, outline.quality);
    });
    if (signal.aborted) return "cancelled";
    if (!blob) throw new Error("image encoding failed");
    return saveBlob(outline.filename, blob);
  }

  useConsoleMeta(
    "export",
    exporting ? t("export.working") : exportReady ? t("export.ready") : t("export.nothing"),
  );

  // The colour mode is the one setting that changes what a file looks like and
  // has no visible home of its own, so the summary carries it.
  const colorMode = !params.color ? "off" : resolveColorMode(params);

  // There is nothing to export yet, so there is nothing to pick a format for
  // either. The picker stays out of the way rather than sitting behind an empty
  // state it would overflow into: one panel, one state.
  if (!exportReady && !exporting) {
    return (
      <div className="@container flex h-full min-h-0 flex-col">
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {live}
        </div>
        <Empty className="flex-1">
          <EmptyMedia>
            <Download className="size-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{t("export.empty")}</EmptyTitle>
            <EmptyDescription>{t("export.emptyHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-3">
      <FormatPicker format={format} onFormat={setFormat} />

      <div className="grid min-h-0 flex-1 grid-rows-1 gap-3 @lg:grid-cols-2">
        <ScrollArea className="min-h-0">
          <div className="flex flex-col gap-3 pr-2.5">
            <FormatOptions
              format={format}
              cell={cell}
              charset={charset}
              invert={invert}
              black={black}
              onCell={setCell}
              onCharset={setCharset}
              onInvert={setInvert}
              onBlack={setBlack}
            />
          </div>
        </ScrollArea>
        <Card title={t("export.output")} className="overflow-hidden">
          <dl className="flex min-h-0 flex-col gap-2 overflow-y-auto">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-label text-muted-foreground uppercase">{t("export.file")}</dt>
              <dd className="truncate font-mono text-body-lg text-foreground">
                {outline.filename}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-label text-muted-foreground uppercase">{t("rail.method")}</dt>
              <dd className="truncate text-body-lg text-foreground">{params.method}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-label text-muted-foreground uppercase">{t("rail.color")}</dt>
              <dd className="text-body-lg text-foreground">
                {t(
                  colorMode === "off"
                    ? "rail.colorOff"
                    : colorMode === "palette"
                      ? "rail.colorPalette"
                      : "rail.colorOriginal",
                )}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-label text-muted-foreground uppercase">{t("export.pixel")}</dt>
              <dd className="text-body-lg text-foreground">{params.pixelSize}</dd>
            </div>
            {source && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label text-muted-foreground uppercase">
                  {t("timeline.sourceDim")}
                </dt>
                <dd className="text-body-lg text-foreground">
                  {source.width}×{source.height}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {live}
      </div>
      {exporting && (
        <div aria-busy className="flex shrink-0 flex-col gap-1">
          <Progress aria-label={t("export.progress")} value={exportProgress} max={100} />
        </div>
      )}

      {exportReady || exporting ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border pt-3">
          <p className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
            {t("export.writeTo", { file: outline.filename })}
          </p>
          <Button
            variant="default"
            size="lg"
            disabled={exporting}
            onClick={() => void write()}
            className="shrink-0"
          >
            <Download />
            {t("export.run")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The options the chosen format has, and nothing else. A control that changes
 * nothing in the current format is worse than a missing one: the user tunes it
 * and the file comes out identical. So the panel asks this which block to draw
 * rather than showing all of them and disabling most.
 *
 * Its own component, taking every value and setter as a prop, so the markup for
 * one format can be rendered and read without driving the picker first.
 */
export function FormatOptions({
  format,
  cell,
  charset,
  invert,
  black,
  onCell,
  onCharset,
  onInvert,
  onBlack,
}: {
  format: ExportFormat;
  cell: number;
  charset: string;
  invert: boolean;
  black: boolean;
  onCell: (value: number) => void;
  onCharset: (value: string) => void;
  onInvert: (value: boolean) => void;
  onBlack: (value: boolean) => void;
}) {
  const t = useTranslate();
  const def = FORMATS.find((entry) => entry.id === format) ?? FORMATS[0];
  return (
    <Card title={t("export.options")}>
      {optionsFor(format) === "text" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label id="cell-label">{t("export.cellCount", { value: cell })}</Label>
            <Slider
              aria-labelledby="cell-label"
              min={2}
              max={16}
              step={1}
              value={[cell]}
              onValueChange={([v]) => onCell(v)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="charset">{t("export.charset")}</Label>
            <Input
              id="charset"
              value={charset}
              onChange={(e) => onCharset(e.target.value)}
              placeholder={DEFAULT_CHARSET}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="invert" checked={invert} onCheckedChange={onInvert} />
            <Label htmlFor="invert">{t("export.invert")}</Label>
          </div>
        </div>
      )}
      {optionsFor(format) === "vector" && (
        <div className="flex items-center gap-2">
          <Switch id="black-vector" checked={black} onCheckedChange={onBlack} />
          <Label htmlFor="black-vector">{t("export.blackVector")}</Label>
        </div>
      )}
      {/* The one line a format with no options still has to say for itself. */}
      <p className="text-caption text-muted-foreground">{t(def.note)}</p>
    </Card>
  );
}

/**
 * The format as one segmented choice. Its own component, taking the current
 * format and the setter, so the group can be read without a render behind it.
 */
export function FormatPicker({
  format,
  onFormat,
}: {
  format: ExportFormat;
  onFormat: (format: ExportFormat) => void;
}) {
  const t = useTranslate();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      value={format}
      // A pick that selects nothing is not a choice, so an empty value is
      // ignored rather than clearing the format.
      onValueChange={(value) => value && onFormat(value as ExportFormat)}
      aria-label={t("export.formats")}
      className="w-full"
    >
      {/* No aria-label on the items: the visible extension is the name, and the
          toast message for a format is not something to read out before it has
          run. */}
      {FORMATS.map((entry) => (
        <ToggleGroupItem key={entry.id} value={entry.id} className="flex-1">
          {entry.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
