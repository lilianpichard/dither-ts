import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslate } from "../i18n";
import { renderImage } from "../worker/client";
import { resolveColorMode, useApp } from "../store";
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
import type { Translate } from "../i18n";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago a preset was saved. The word order and the plural differ per
 * language, so each unit is its own message with ICU plurals: French has one
 * form for 0 and 1 and another beyond, which a hand-rolled "3h ago" gets wrong.
 */
export function describeAge(
  stamp: number | undefined,
  t: Translate,
  now: number = Date.now(),
): string {
  if (stamp === undefined || !Number.isFinite(stamp)) return t("presets.savedAt");
  const elapsed = Math.max(0, now - stamp);
  if (elapsed < MINUTE) return t("presets.justNow");
  if (elapsed < HOUR) return t("presets.agoMinutes", { count: Math.floor(elapsed / MINUTE) });
  if (elapsed < DAY) return t("presets.agoHours", { count: Math.floor(elapsed / HOUR) });
  return t("presets.agoDays", { count: Math.floor(elapsed / DAY) });
}

function summarize(warnings: string[]): string {
  const counts = new Map<string, number>();
  for (const note of warnings) {
    const key = note.trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([note, n]) => (n > 1 ? `${note} (x${n})` : note)).join("; ");
}

// Only the fields that change what a thumbnail looks like. Including the name
// meant a rename re-rendered every card and left the old data url behind
// forever, because the map was only ever added to.
function thumbKey(id: string, preset: Preset): string {
  const { name: _name, ...rest } = preset;
  return `${id}:${JSON.stringify(rest)}`;
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
      colorMode: resolveColorMode(preset.params),
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
  const context = canvas.getContext("2d");
  if (!context) throw new Error("this browser would not give the app a 2d context");
  context.putImageData(
    new ImageData(new Uint8ClampedArray(res.pixels), res.width, res.height),
    0,
    0,
  );
  const small = document.createElement("canvas");
  small.width = 96;
  small.height = 96;
  const smallContext = small.getContext("2d");
  if (!smallContext) throw new Error("this browser would not give the app a 2d context");
  smallContext.drawImage(canvas, 0, 0, 96, 96);
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
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const t = useTranslate();
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
  }, [load]);

  // Storage refusing a write is a store fact, and the wording belongs to the
  // catalogue, so the panel is where the two meet. Once per failure, never
  // again until it recovers.
  const persistFailed = usePresets((s) => s.persistFailed);
  useEffect(() => {
    if (persistFailed) toast.error(t("presets.storageFull"));
  }, [persistFailed, t]);

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

  // Drop the thumbnails of presets that are gone, so the map does not grow for
  // the life of the session. A key belongs to a live preset when it starts with
  // that preset's id and the separator.
  useEffect(() => {
    setThumbs((prev) => {
      const alive = (key: string) => items.some((item) => key.startsWith(`${item.id}:`));
      const kept = new Map([...prev].filter(([key]) => alive(key)));
      return kept.size === prev.size ? prev : kept;
    });
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
    const name = file.name.replace(/\.json$/i, "");
    const { added, warnings } = importJson(text, name);
    if (added === 0) {
      // A failed import is the one case that deserves a persistent block: the
      // reason is long and the user has to read it to fix the file.
      setNotice({
        ok: false,
        text: t("presets.importFailedNamed", { name, reason: summarize(warnings) }),
      });
      toast.error(t("presets.importFailed"));
    } else if (warnings.length) {
      // Deduplicated and attributed, so a note says which preset it came from.
      toast.success(t("presets.imported", { name }), { description: summarize(warnings) });
    } else {
      toast.success(t("presets.imported", { name }));
    }
    if (importRef.current) importRef.current.value = "";
  }

  function onInstallCatalog() {
    const { added } = installCatalog();
    if (added === 0) {
      toast.info(t("presets.alreadyThere"));
      return;
    }
    // Every bundled preset is a legacy file, so its migration notes are expected
    // housekeeping, not something to report. One line is the whole story.
    toast.success(t("presets.added", { count: added }));
  }

  const sorted = [...items].sort((a, b) => Number(b.favorite) - Number(a.favorite));
  useConsoleMeta("presets", t("presets.savedCount", { count: sorted.length }));

  return (
    <TooltipProvider>
      <div className="@container flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            placeholder={t("presets.name")}
            aria-label={t("presets.name")}
            className="w-37.5"
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            onClick={() => {
              saveCurrent(name.trim() || t("presets.untitled"), params);
              setName("");
              toast.success(t("presets.saved"));
            }}
          >
            {t("presets.saveCurrent")}
          </Button>
          <Button variant="secondary" onClick={() => importRef.current?.click()}>
            {t("presets.importJson")}
          </Button>
          <Button variant="secondary" onClick={onInstallCatalog}>
            {t("presets.addOriginals")}
          </Button>
          <Input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => void onImportFile(e.target.files?.[0])}
          />
        </div>
        {notice && !notice.ok && (
          <Alert variant="destructive">
            <AlertTitle>{t("presets.importFailed")}</AlertTitle>
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        )}
        {sorted.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("presets.empty")}</EmptyTitle>
              <EmptyDescription>{t("presets.emptyHint")}</EmptyDescription>
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
                  label: t("presets.favorite"),
                  icon: <Star className={item.favorite ? "fill-current" : undefined} />,
                  onClick: () => toggleFavorite(item.id),
                },
                {
                  key: "export",
                  label: t("presets.export"),
                  icon: <Download />,
                  onClick: () => {
                    const json = exportJson(item.id);
                    if (json) download(`${item.preset.name}.preset.json`, json);
                  },
                },
                {
                  key: "copy",
                  label: t("presets.duplicate"),
                  icon: <Copy />,
                  onClick: () => duplicate(item.id),
                },
                {
                  key: "rename",
                  label: t("presets.renameAction"),
                  icon: <Pencil />,
                  onClick: () => setRenaming({ id: item.id, value: item.preset.name }),
                },
                {
                  key: "delete",
                  label: t("presets.delete"),
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
                    className="h-13.5 w-18 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-canvas p-0 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                    title={t("presets.applyName", { name: item.preset.name })}
                    onClick={() => {
                      applyPreset(item.preset);
                      toast.success(t("presets.applied", { name: item.preset.name }));
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
                      {t("presets.summary", {
                        method: item.preset.params.method,
                        threshold: item.preset.params.threshold,
                        pixelSize: item.preset.params.pixelSize,
                      })}
                    </p>
                    <p className="mt-0.5 truncate text-label text-muted-foreground uppercase">
                      {item.favorite ? `${t("presets.favorite")} · ` : ""}
                      {describeAge(item.createdAt, t)}
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
                  <p className="sr-only">{t("presets.apply")}</p>
                </figure>
              );
            })}
          </div>
        )}
      </div>
      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="gap-0 p-6 sm:max-w-105">
          <DialogHeader className="gap-0">
            <DialogTitle>{t("presets.rename")}</DialogTitle>
          </DialogHeader>
          <Input
            className="mt-4"
            value={renaming?.value ?? ""}
            aria-label={t("presets.name")}
            onChange={(e) =>
              setRenaming((current) => (current ? { ...current, value: e.target.value } : current))
            }
          />
          <DialogFooter className="mx-0 mt-4 mb-0 gap-2 border-0 bg-transparent p-0">
            <DialogClose asChild>
              <Button variant="secondary" size="sm" className="w-20">
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button
              size="sm"
              className="w-20"
              disabled={!renaming?.value.trim()}
              onClick={() => {
                if (!renaming) return;
                rename(renaming.id, renaming.value.trim());
                setRenaming(null);
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="gap-0 p-6 sm:max-w-105">
          <DialogHeader className="gap-0">
            <DialogTitle>{t("presets.deleteTitle")}</DialogTitle>
            <DialogDescription className="mt-3">{t("presets.deleteHint")}</DialogDescription>
            <p className="mt-3 text-label text-accent-label uppercase">
              {deleting ? (items.find((i) => i.id === deleting)?.preset.name ?? "") : ""}
            </p>
          </DialogHeader>
          <div aria-hidden className="my-4 h-px bg-border" />
          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0">
            <DialogClose asChild>
              <Button variant="secondary" size="sm" className="w-20">
                {t("common.cancel")}
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
              {t("presets.delete")}
            </Button>
          </DialogFooter>
          <p className="text-caption text-muted-foreground">{t("presets.esc")}</p>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
