import { useEffect, useRef } from "react";
import { METHOD_NAMES, PALETTES } from "../../src/index.js";
import { renderImage } from "./worker/client";
import { stripKeys } from "./presets/store";
import { useApp } from "./store";
import PresetsPanel from "./presets/PresetsPanel";
import BatchPanel from "./batch/BatchPanel";
import EffectsPanel from "./effects/EffectsPanel";

let jobSeq = 0;

export default function App() {
  const source = useApp((s) => s.source);
  const params = useApp((s) => s.params);
  const effects = useApp((s) => s.effects);
  const result = useApp((s) => s.result);
  const rendering = useApp((s) => s.rendering);
  const setSource = useApp((s) => s.setSource);
  const setParams = useApp((s) => s.setParams);
  const setResult = useApp((s) => s.setResult);
  const setRendering = useApp((s) => s.setRendering);
  const origRef = useRef<HTMLCanvasElement>(null);
  const outRef = useRef<HTMLCanvasElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const copy = new Uint8ClampedArray(data.data);
    setSource({ width: bmp.width, height: bmp.height, pixels: copy.buffer as ArrayBuffer });
  }

  useEffect(() => {
    if (!source || !origRef.current) return;
    const c = origRef.current;
    c.width = source.width;
    c.height = source.height;
    const ctx = c.getContext("2d")!;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(source.pixels), source.width, source.height),
      0,
      0,
    );
  }, [source]);

  useEffect(() => {
    if (!source) return;
    setRendering(true);
    const timer = setTimeout(async () => {
      const jobId = ++jobSeq;
      const copy = source.pixels.slice(0);
      const res = await renderImage(
        {
          width: source.width,
          height: source.height,
          pixels: copy,
          color: params.color,
          method: params.method,
          threshold: params.threshold,
          palette: params.palette,
          pixelSize: params.pixelSize,
          effects: stripKeys(effects),
        },
        [copy],
      );
      if (jobId !== jobSeq) return; // stale: a newer job superseded this one
      setResult({ width: res.width, height: res.height, pixels: res.pixels, ms: res.ms, jobId });
    }, 250);
    return () => clearTimeout(timer);
  }, [source, params, effects, setRendering, setResult]);

  useEffect(() => {
    if (!result || !outRef.current) return;
    const c = outRef.current;
    c.width = result.width;
    c.height = result.height;
    const ctx = c.getContext("2d")!;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height),
      0,
      0,
    );
  }, [result]);

  return (
    <main>
      <h1>dither-ts</h1>
      <div className="row">
        <input type="file" accept="image/*" onChange={(e) => void onFile(e.target.files?.[0])} />
        <select value={params.method} onChange={(e) => setParams({ method: e.target.value })}>
          {METHOD_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={params.color}
            onChange={(e) => setParams({ color: e.target.checked })}
          />{" "}
          color
        </label>
        {params.color && (
          <select
            value={typeof params.palette === "string" ? params.palette : "custom"}
            onChange={(e) => {
              if (e.target.value !== "custom") setParams({ palette: e.target.value });
            }}
          >
            {Object.keys(PALETTES).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            {typeof params.palette !== "string" && (
              <option value="custom" disabled>
                Custom
              </option>
            )}
          </select>
        )}
        {!params.color && (
          <label>
            threshold{" "}
            <input
              type="range"
              min={1}
              max={254}
              value={params.threshold}
              onChange={(e) => setParams({ threshold: Number(e.target.value) })}
            />{" "}
            {params.threshold}
          </label>
        )}
        <label>
          pixel size{" "}
          <input
            type="range"
            min={1}
            max={8}
            value={params.pixelSize}
            onChange={(e) => setParams({ pixelSize: Number(e.target.value) })}
          />{" "}
          {params.pixelSize}
        </label>
      </div>
      <div className="row">
        <canvas ref={origRef} />
        <canvas ref={outRef} />
      </div>
      <p id="status">
        {!source
          ? "Choose an image to start."
          : rendering
            ? "Rendering…"
            : result
              ? `Done in ${result.ms.toFixed(1)} ms.`
              : "Ready."}
      </p>
      <PresetsPanel />
      <EffectsPanel />
      <BatchPanel />
    </main>
  );
}
