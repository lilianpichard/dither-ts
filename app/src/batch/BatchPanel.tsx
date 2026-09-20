import { useRef, useState } from "react";
import { renderImage } from "../worker/client";
import { useApp } from "../store";

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
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function run(files: File[]) {
    setRunning(true);
    const snapshot = paramsRef.current;
    const state: BatchItem[] = files.map((f) => ({ name: f.name, status: "queued" as const }));
    setItems(state);
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
        setItems((prev) =>
          prev.map((it, i) =>
            i === k ? { ...it, status: "error" as const, detail: String(err) } : it,
          ),
        );
      }
    }
    setRunning(false);
  }

  return (
    <section>
      <h2>Batch</h2>
      <div className="row">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) void run(files);
            e.target.value = "";
          }}
        />
        {running && <span id="status">Running batch…</span>}
      </div>
      {items.length > 0 && (
        <ul>
          {items.map((it, i) => (
            <li key={i}>
              {it.name}: {it.status}
              {it.detail ? ` (${it.detail})` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
