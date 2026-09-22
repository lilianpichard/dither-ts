import { useRef, useState } from "react";
import { toast } from "sonner";
import { renderImage } from "../worker/client";
import { stripKeys } from "../presets/store";
import { useApp } from "../store";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

interface BatchItem {
  name: string;
  status: "queued" | "working" | "done" | "error";
  detail?: string;
}

function outputName(name: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.dither.png`;
}

export default function BatchPanel() {
  const params = useApp((s) => s.params);
  const effects = useApp((s) => s.effects);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const effectsRef = useRef(effects);
  effectsRef.current = effects;
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function run(files: File[]) {
    setRunning(true);
    const snapshot = paramsRef.current;
    const fx = stripKeys(effectsRef.current);
    const state: BatchItem[] = files.map((f) => ({ name: f.name, status: "queued" as const }));
    setItems(state);
    let failed = 0;
    for (let k = 0; k < files.length; k++) {
      setItems((prev) =>
        prev.map((it, i) => (i === k ? { ...it, status: "working" as const } : it)),
      );
      try {
        const bmp = await createImageBitmap(files[k]);
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext("2d")!.drawImage(bmp, 0, 0);
        const data = canvas.getContext("2d")!.getImageData(0, 0, bmp.width, bmp.height);
        const copy = new Uint8ClampedArray(data.data).buffer as ArrayBuffer;
        const res = await renderImage(
          {
            width: bmp.width,
            height: bmp.height,
            pixels: copy,
            color: snapshot.color,
            method: snapshot.method,
            threshold: snapshot.threshold,
            palette: snapshot.palette,
            pixelSize: snapshot.pixelSize,
            effects: fx,
            seed: 0,
          },
          [copy],
        );
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
        const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("encode failed");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = outputName(files[k].name);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        setItems((prev) =>
          prev.map((it, i) => (i === k ? { ...it, status: "done" as const } : it)),
        );
      } catch (err) {
        failed++;
        setItems((prev) =>
          prev.map((it, i) =>
            i === k ? { ...it, status: "error" as const, detail: String(err) } : it,
          ),
        );
      }
    }
    toast.success(failed ? `Batch finished with ${failed} errors` : "Batch finished");
    setRunning(false);
  }

  const done = items.filter((it) => it.status === "done" || it.status === "error").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Batch</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="w-64"
            disabled={running}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) void run(files);
              e.target.value = "";
            }}
          />
          {running && <Badge variant="secondary">Running batch…</Badge>}
        </div>
        {items.length > 0 && (
          <>
            <Progress value={items.length ? (done / items.length) * 100 : 0} />
            <ul className="flex flex-col gap-1 text-sm">
              {items.map((it, i) => (
                <li key={i}>
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
                  </Badge>{" "}
                  {it.name}
                  {it.detail ? ` (${it.detail})` : ""}
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
      </CardContent>
    </Card>
  );
}
