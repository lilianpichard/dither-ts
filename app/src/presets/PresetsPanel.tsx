import { useEffect, useRef, useState } from "react";
import { renderImage } from "../worker/client";
import { useApp } from "../store";
import { makeSample } from "./sample";
import { applyPreset, usePresets } from "./store";
import type { Preset } from "./schema";

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
  const [notice, setNotice] = useState("");
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
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
    setNotice(
      ok
        ? warnings.length
          ? `Imported with warnings: ${warnings.join("; ")}`
          : "Imported."
        : `Import failed: ${warnings.join("; ")}`,
    );
    if (importRef.current) importRef.current.value = "";
  }

  const sorted = [...items].sort((a, b) => Number(b.favorite) - Number(a.favorite));

  return (
    <section>
      <h2>Presets</h2>
      <div className="row">
        <input value={name} placeholder="Preset name" onChange={(e) => setName(e.target.value)} />
        <button
          onClick={() => {
            saveCurrent(name.trim() || "Untitled", params);
            setName("");
          }}
        >
          Save current
        </button>
        <button onClick={() => importRef.current?.click()}>Import JSON</button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void onImportFile(e.target.files?.[0])}
        />
      </div>
      {notice && <p id="status">{notice}</p>}
      <div className="row">
        {sorted.map((item) => (
          <figure key={item.id} style={{ margin: 0, width: 120 }}>
            <button
              style={{ padding: 0, border: "1px solid #888", cursor: "pointer" }}
              title={`Apply ${item.preset.name}`}
              onClick={() => applyPreset(item.preset)}
            >
              {thumbs.get(thumbKey(item.id, item.preset)) ? (
                <img
                  src={thumbs.get(thumbKey(item.id, item.preset))}
                  width={96}
                  height={96}
                  alt={item.preset.name}
                />
              ) : (
                <span
                  style={{ display: "inline-block", width: 96, height: 96, background: "#222" }}
                />
              )}
            </button>
            <figcaption style={{ fontSize: 12 }}>
              {item.favorite ? "★ " : ""}
              {item.preset.name}
            </figcaption>
            <div style={{ display: "flex", gap: 4, fontSize: 12 }}>
              <button title="Favorite" onClick={() => toggleFavorite(item.id)}>
                ★
              </button>
              <button
                title="Export JSON"
                onClick={() => {
                  const json = exportJson(item.id);
                  if (json) download(`${item.preset.name}.preset.json`, json);
                }}
              >
                ⤓
              </button>
              <button title="Duplicate" onClick={() => duplicate(item.id)}>
                ⧉
              </button>
              <button
                title="Rename"
                onClick={() => {
                  const next = window.prompt("Rename preset", item.preset.name);
                  if (next && next.trim()) rename(item.id, next.trim());
                }}
              >
                ✎
              </button>
              <button title="Delete" onClick={() => remove(item.id)}>
                ✕
              </button>
            </div>
          </figure>
        ))}
        {sorted.length === 0 && <p id="status">No presets yet — save the current settings.</p>}
      </div>
    </section>
  );
}
