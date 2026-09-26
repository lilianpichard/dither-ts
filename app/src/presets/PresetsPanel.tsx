import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { renderImage } from "../worker/client";
import { useApp } from "../store";
import { requestOperations } from "../image/settings";
import { makeSample } from "./sample";
import { applyPreset, usePresets } from "./store";
import type { Preset } from "./schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, Download, Pencil, Star, Trash2 } from "lucide-react";
import { useConsoleMeta } from "../components/consoleMeta";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now" / "12m ago" / "3h ago" / "5d ago", matching the card's meta line. */
export function describeAge(stamp: number | undefined, now: number = Date.now()): string {
  if (stamp === undefined || !Number.isFinite(stamp)) return "Saved";
  const elapsed = Math.max(0, now - stamp);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}

function thumbKey(id: string, preset: Preset): string {
  return `${id}:${JSON.stringify(preset)}`;
}

async function renderThumb(preset: Preset): Promise<string> {
  const sample = makeSample();
  const copy = sample.pixels.slice(0);
  const res = await renderImage(
    {
      width: sample.width,
      height: sample.height,
      pixels: copy,
      color: preset.params.color,
      method: preset.params.method,
      threshold: preset.params.threshold,
      palette:
        typeof preset.params.palette === "string"
          ? preset.params.palette
          : preset.params.palette.custom,
      pixelSize: Math.max(1, preset.params.pixelSize),
      effects: preset.effects,
      // A preset crop is authored for its own image: fit it to the sample.
      operations: requestOperations(preset.operations, sample.width, sample.height),
      seed: 0,
    },
    [copy],
  );
  const canvas = document.createElement("canvas");
  canvas.width = res.width;
  canvas.height = res.height;
  canvas
    .getContext("2d")!
    .putImageData(new ImageData(new Uint8ClampedArray(res.pixels), res.width, res.height), 0, 0);
  const small = document.createElement("canvas");
  small.width = 96;
  small.height = 96;
  small.getContext("2d")!.drawImage(canvas, 0, 0, 96, 96);
  return small.toDataURL();
}

export default function PresetsPanel() {
  const items = usePresets((s) => s.items);
  const load = usePresets((s) => s.load);
  const saveCurrent = usePresets((s) => s.saveCurrent);
  const remove = usePresets((s) => s.remove);
  const rename = usePresets((s) => s.rename);
  const toggleFavorite = usePresets((s) => s.toggleFavorite);
  const duplicate = usePresets((s) => s.duplicate);
  const importJson = usePresets((s) => s.importJson);
  const installCatalog = usePresets((s) => s.installCatalog);
  const exportJson = usePresets((s) => s.exportJson);
  const params = useApp((s) => s.params);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [deleting, setDeleting] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const item of items) {
        const key = thumbKey(item.id, item.preset);
        if (thumbs.has(key)) continue;
        try {
          const url = await renderThumb(item.preset);
          if (cancelled) return;
          setThumbs((prev) => new Map(prev).set(key, url));
        } catch {
          // Thumbnail failure must not break the gallery.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  function download(filename: string, text: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    // The file stem names the preset: legacy files carry no name of their own.
    const { added, warnings } = importJson(text, file.name.replace(/\.json$/i, ""));
    const ok = added > 0;
    const msg = ok
      ? warnings.length
        ? `Imported with warnings: ${warnings.join("; ")}`
        : "Preset imported."
      : `Import failed: ${warnings.join("; ")}`;
    setNotice({ ok, text: msg });
    if (ok) toast.success("Preset imported");
    else toast.error("Preset import failed");
    if (importRef.current) importRef.current.value = "";
  }

  function onInstallCatalog() {
    const { added, warnings } = installCatalog();
    if (added === 0) {
      toast.info("Original presets are already in the gallery");
      return;
    }
    // Every bundled preset is a legacy file, so warnings are expected here.
    setNotice({
      ok: true,
      text: `Added ${added} original presets. Migration notes: ${warnings.join("; ")}`,
    });
    toast.success(`Added ${added} original presets`);
  }

  const sorted = [...items].sort((a, b) => Number(b.favorite) - Number(a.favorite));
  useConsoleMeta("presets", sorted.length === 1 ? "1 saved" : `${sorted.length} saved`);

  return (
    <TooltipProvider>
      <div className="@container flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            placeholder="Preset name"
            aria-label="Preset name"
            className="w-37.5"
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            onClick={() => {
              saveCurrent(name.trim() || "Untitled", params);
              setName("");
              toast.success("Preset saved");
            }}
          >
            Save current
          </Button>
          <Button variant="secondary" onClick={() => importRef.current?.click()}>
            Import JSON
          </Button>
          <Button variant="secondary" onClick={onInstallCatalog}>
            Add originals
          </Button>
          <Input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => void onImportFile(e.target.files?.[0])}
          />
        </div>
        {notice && (
          <Alert variant={notice.ok ? "default" : "destructive"}>
            <AlertTitle>{notice.ok ? "Import" : "Import failed"}</AlertTitle>
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        )}
        {sorted.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No presets yet</EmptyTitle>
              <EmptyDescription>Save the current settings to start the gallery.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">
            {sorted.map((item) => {
              const key = thumbKey(item.id, item.preset);
              const url = thumbs.get(key);
              const actions: {
                key: string;
                label: string;
                icon: React.ReactNode;
                onClick: () => void;
              }[] = [
                {
                  key: "favorite",
                  label: "Favorite",
                  icon: <Star className={item.favorite ? "fill-current" : undefined} />,
                  onClick: () => toggleFavorite(item.id),
                },
                {
                  key: "export",
                  label: "Export",
                  icon: <Download />,
                  onClick: () => {
                    const json = exportJson(item.id);
                    if (json) download(`${item.preset.name}.preset.json`, json);
                  },
                },
                {
                  key: "copy",
                  label: "Duplicate",
                  icon: <Copy />,
                  onClick: () => duplicate(item.id),
                },
                {
                  key: "rename",
                  label: "Rename",
                  icon: <Pencil />,
                  onClick: () => {
                    const next = window.prompt("Rename preset", item.preset.name);
                    if (next && next.trim()) rename(item.id, next.trim());
                  },
                },
                {
                  key: "delete",
                  label: "Delete",
                  icon: <Trash2 />,
                  onClick: () => setDeleting(item.id),
                },
              ];
              return (
                <figure
                  key={item.id}
                  className="m-0 flex min-w-0 gap-2 rounded-lg border border-border bg-raised p-2"
                >
                  <button
                    type="button"
                    className="h-13.5 w-18 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-canvas p-0 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                    title={`Apply ${item.preset.name}`}
                    onClick={() => {
                      applyPreset(item.preset);
                      toast.success(`Applied ${item.preset.name}`);
                    }}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt={item.preset.name}
                        className="size-full object-cover"
                        style={{ imageRendering: "pixelated" }}
                      />
                    ) : (
                      <Skeleton className="size-full" />
                    )}
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <h3 className="truncate text-card-title text-foreground">{item.preset.name}</h3>
                    <p className="mt-0.5 line-clamp-2 text-label text-muted-foreground uppercase">
                      {item.preset.params.method} · threshold {item.preset.params.threshold} · pixel{" "}
                      {item.preset.params.pixelSize}
                    </p>
                    <p className="mt-0.5 truncate text-label text-muted-foreground uppercase">
                      {item.favorite ? "Favorite · " : ""}
                      {describeAge(item.createdAt)}
                    </p>
                    <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
                      {actions.map((a) => (
                        <Tooltip key={a.key}>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon-xs"
                              variant={
                                a.key === "favorite" && item.favorite ? "accent" : "secondary"
                              }
                              aria-label={`${a.label} ${item.preset.name}`}
                              onClick={a.onClick}
                            >
                              {a.icon}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{a.label}</TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                  <p className="sr-only">Click the card to apply</p>
                </figure>
              );
            })}
          </div>
        )}
      </div>
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="gap-0 p-6 sm:max-w-105">
          <DialogHeader className="gap-0">
            <DialogTitle>Delete preset?</DialogTitle>
            <DialogDescription className="mt-3">
              This removes the preset permanently.
            </DialogDescription>
            <p className="mt-3 text-label text-accent-label uppercase">
              {deleting ? (items.find((i) => i.id === deleting)?.preset.name ?? "") : ""}
            </p>
          </DialogHeader>
          <div aria-hidden className="my-4 h-px bg-border" />
          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0">
            <DialogClose asChild>
              <Button variant="secondary" size="sm" className="w-20">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              className="w-20"
              onClick={() => {
                if (deleting) remove(deleting);
                setDeleting(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
          <p className="text-caption text-muted-foreground">Esc to close</p>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
