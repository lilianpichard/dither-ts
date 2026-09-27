import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cancelAll, renderImage } from "../worker/client";
import { stripKeys } from "../presets/store";
import { resolveColorMode, useApp } from "../store";
import { requestOperations } from "../image/settings";
import { announceProgress } from "../progress";
import { outputName, uniqueOutputName } from "./naming";
import {
  batchOutcome,
  estimateEtaMs,
  formatEta,
  settleRemaining,
  settledCount,
  tally,
  type BatchItem,
} from "./queue";
import { canPickDirectory, defaultSink, pickDirectory, type OutputSink } from "./sink";
import { canOpenFiles } from "../desktop/bridge";
import { openFailure, openFiles } from "../desktop/files";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { X } from "lucide-react";
import { useConsoleMeta } from "../components/consoleMeta";

/** One worker scope for the whole run, so cancelling kills the file in flight. */
const BATCH_SCOPE = "batch";
/** Per-file durations kept for the ETA average; short enough to stay responsive. */
const ETA_SAMPLES = 6;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function BatchPanel() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState<OutputSink | null>(null);
  const [etaMs, setEtaMs] = useState<number | null>(null);
  const runRef = useRef<AbortController | null>(null);
  const canPickDir = useMemo(canPickDirectory, []);
  const canOpen = useMemo(canOpenFiles, []);
  const sink: OutputSink = useMemo(() => target ?? defaultSink(), [target]);

  useEffect(
    () => () => {
      runRef.current?.abort();
      cancelAll(BATCH_SCOPE);
    },
    [],
  );

  async function run(files: File[]) {
    if (runRef.current) return;
    // One snapshot of the settings: sliders must not move a run already going.
    const { params, effects, operations } = useApp.getState();
    const fx = stripKeys(effects);
    const controller = new AbortController();
    runRef.current = controller;
    const { signal } = controller;
    const used = new Set<string>();
    const samples: number[] = [];
    // A local list is the run's source of truth: React state lags a tick, and
    // the closing tally and per-file errors must not read a stale snapshot.
    const entries: BatchItem[] = files.map((f) => ({ name: f.name, status: "queued" }));
    let index = 0;
    setRunning(true);
    setEtaMs(null);
    setItems(entries);

    const mark = (k: number, status: BatchItem["status"], detail?: string): void => {
      entries[k] = { name: entries[k].name, status, detail };
      setItems([...entries]);
    };
    const statuses = (): BatchItem["status"][] => entries.map((it) => it.status);

    try {
      for (; index < files.length; index++) {
        if (signal.aborted) break;
        mark(index, "working");
        const started = performance.now();
        let bitmap: ImageBitmap | null = null;
        try {
          bitmap = await createImageBitmap(files[index]);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d")!;
          context.drawImage(bitmap, 0, 0);
          const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
          const copy = new Uint8ClampedArray(data.data).buffer as ArrayBuffer;
          const res = await renderImage(
            {
              width: bitmap.width,
              height: bitmap.height,
              pixels: copy,
              color: params.color,
              colorMode: resolveColorMode(params),
              method: params.method,
              threshold: params.threshold,
              palette: params.palette,
              pixelSize: params.pixelSize,
              effects: fx,
              // Batch files vary in size, so the crop is clamped per image.
              operations: requestOperations(operations, bitmap.width, bitmap.height),
              seed: 0,
            },
            [copy],
            { signal, scope: BATCH_SCOPE },
          );
          if (signal.aborted) break;
          const out = document.createElement("canvas");
          out.width = res.width;
          out.height = res.height;
          out
            .getContext("2d")!
            .putImageData(
              new ImageData(new Uint8ClampedArray(res.pixels), res.width, res.height),
              0,
              0,
            );
          const blob = await new Promise<Blob | null>((resolve) =>
            out.toBlob(resolve, "image/png"),
          );
          if (!blob) throw new Error("encode failed");
          if (signal.aborted) break;
          const name = uniqueOutputName(outputName(files[index].name), used);
          used.add(name);
          await sink.write(name, blob);
          // Counted as written before the next abort check: once the write has
          // resolved the file exists, so a cancel must not report it as skipped.
          mark(index, "done");
          samples.push(performance.now() - started);
          if (samples.length > ETA_SAMPLES) samples.shift();
        } catch (err) {
          if (signal.aborted) break;
          mark(index, "error", errorText(err));
        } finally {
          // Decoded bitmaps are not garbage collected on their own.
          bitmap?.close();
        }
        setEtaMs(estimateEtaMs(samples, files.length - settledCount(statuses())));
      }
    } finally {
      const cancelled = signal.aborted;
      if (cancelled) cancelAll(BATCH_SCOPE);
      entries.splice(0, entries.length, ...settleRemaining(entries, index));
      setItems([...entries]);
      if (runRef.current === controller) runRef.current = null;
      setRunning(false);
      setEtaMs(null);
      const outcome = batchOutcome(tally(statuses(), cancelled));
      if (outcome.tone === "success") toast.success(outcome.message);
      else if (outcome.tone === "error") toast.error(outcome.message);
      else toast.info(outcome.message);
    }
  }

  function cancel(): void {
    runRef.current?.abort();
  }

  async function onChooseFolder() {
    const picked = await pickDirectory();
    if (picked) setTarget(picked);
  }

  async function onAddImages() {
    try {
      const picked = await openFiles("image", { multiple: true });
      if (picked && picked.length) await run(picked);
    } catch (error) {
      toast.error(`Could not open those images: ${openFailure(error)}`);
    }
  }

  const done = settledCount(items.map((it) => it.status));
  const live = announceProgress({ label: "Batch", running, done, total: items.length });
  const eta = running && done < items.length ? formatEta(etaMs) : "";
  useConsoleMeta("batch", running ? `${done}/${items.length}` : `${items.length} items`);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {canOpen ? (
          <Button variant="secondary" disabled={running} onClick={() => void onAddImages()}>
            Add images
          </Button>
        ) : (
          <Input
            type="file"
            accept="image/*"
            multiple
            aria-label="Batch images"
            className="w-full max-w-64"
            disabled={running}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) void run(files);
              e.target.value = "";
            }}
          />
        )}
        {canPickDir && (
          <Button variant="secondary" disabled={running} onClick={() => void onChooseFolder()}>
            Output folder
          </Button>
        )}
        {target && (
          <Button
            variant="ghost"
            size="icon"
            disabled={running}
            aria-label="Save each file separately instead"
            onClick={() => setTarget(null)}
          >
            <X />
          </Button>
        )}
        <Badge aria-hidden variant="secondary">
          {running ? `${done}/${items.length}${eta ? ` · ${eta}` : ""}` : `Saving to ${sink.label}`}
        </Badge>
        {running && (
          <Button variant="destructive" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {live}
      </div>
      {items.length > 0 && (
        <>
          <Progress aria-label="Batch progress" value={done} max={items.length} />
          <ul aria-busy={running} className="flex flex-col gap-1">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-2">
                <Badge
                  variant={
                    it.status === "done"
                      ? "default"
                      : it.status === "error"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {it.status}
                </Badge>
                <span className="truncate text-body text-foreground">{it.name}</span>
                {it.detail && (
                  <span className="truncate text-caption text-muted-foreground">{it.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {items.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No batch yet</EmptyTitle>
            <EmptyDescription>
              Select multiple images to render each with the current settings.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
