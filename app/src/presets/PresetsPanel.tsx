import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { renderImage } from "../worker/client";
import { useApp } from "../store";
import { makeSample } from "./sample";
import { applyPreset, usePresets } from "./store";
import type { Preset } from "./schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Copy, Download, Pencil, Star, Trash2, Upload } from "lucide-react";

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
    const { ok, warnings } = importJson(text);
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

  const sorted = [...items].sort((a, b) => Number(b.favorite) - Number(a.favorite));

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle>Presets</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={name}
              placeholder="Preset name"
              className="w-52"
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
              <Upload /> Import JSON
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
            <div className="flex flex-wrap gap-3">
              {sorted.map((item) => (
                <figure key={item.id} className="m-0 w-28">
                  <button
                    className="cursor-pointer rounded border p-0"
                    title={`Apply ${item.preset.name}`}
                    onClick={() => {
                      applyPreset(item.preset);
                      toast.success(`Applied ${item.preset.name}`);
                    }}
                  >
                    {thumbs.get(thumbKey(item.id, item.preset)) ? (
                      <img
                        src={thumbs.get(thumbKey(item.id, item.preset))}
                        width={96}
                        height={96}
                        alt={item.preset.name}
                        className="rounded"
                      />
                    ) : (
                      <Skeleton className="h-24 w-24" />
                    )}
                  </button>
                  <figcaption className="truncate text-xs">
                    {item.favorite ? "★ " : ""}
                    {item.preset.name}
                  </figcaption>
                  <div className="flex gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant={item.favorite ? "default" : "ghost"}
                          onClick={() => toggleFavorite(item.id)}
                        >
                          <Star />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Favorite</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            const json = exportJson(item.id);
                            if (json) download(`${item.preset.name}.preset.json`, json);
                          }}
                        >
                          <Download />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export JSON</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" onClick={() => duplicate(item.id)}>
                          <Copy />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Duplicate</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            const next = window.prompt("Rename preset", item.preset.name);
                            if (next && next.trim()) rename(item.id, next.trim());
                          }}
                        >
                          <Pencil />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Rename</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" onClick={() => setDeleting(item.id)}>
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  </div>
                </figure>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete preset?</DialogTitle>
            <DialogDescription>This removes the preset permanently.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) remove(deleting);
                setDeleting(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
