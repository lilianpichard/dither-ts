import { useEffect, useRef, useState } from "react";
import { renderImage } from "../worker/client";
import { stripKeys } from "../presets/store";
import { useApp } from "../store";
import { captureFrame, loadClip, type LoadedClip } from "./decode";
import { exportGif } from "./exportGif";
import { canExportMp4, exportMp4, type ExportFrame } from "./exportMp4";
import { planFrames } from "./jobs";

function download(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

export default function Timeline() {
  const params = useApp((s) => s.params);
  const effects = useApp((s) => s.effects);
  const [clip, setClip] = useState<LoadedClip | null>(null);
  const [fileName, setFileName] = useState("");
  const [time, setTime] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [fps, setFps] = useState(12);
  const [temporal, setTemporal] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const cancelRef = useRef(false);
  const frameRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => () => clip?.revoke(), [clip]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      clip?.revoke();
      const loaded = await loadClip(file);
      setClip(loaded);
      setFileName(file.name);
      setTime(0);
      setRange({ start: 0, end: loaded.info.duration });
    } catch (e) {
      setError(String(e));
    }
  }

  async function previewFrame(t: number) {
    if (!clip) return;
    const plan = planFrames(
      clip.info,
      range.end > 0 ? range : { start: 0, end: clip.info.duration },
      fps,
      params.method,
    );
    const raw = await captureFrame(clip, t, plan.width, plan.height);
    const copy = new Uint8ClampedArray(raw.data).buffer as ArrayBuffer;
    const res = await renderImage(
      {
        width: plan.width,
        height: plan.height,
        pixels: copy,
        color: params.color,
        method: params.method,
        threshold: params.threshold,
        palette: params.palette,
        pixelSize: params.pixelSize,
        effects: stripKeys(effects),
        seed: temporal ? Math.round(t * fps) : 0,
      },
      [copy],
    );
    const c = frameRef.current;
    if (!c) return;
    c.width = res.width;
    c.height = res.height;
    c.getContext("2d")!.putImageData(
      new ImageData(new Uint8ClampedArray(res.pixels), res.width, res.height),
      0,
      0,
    );
  }

  function onScrub(t: number) {
    setTime(t);
    if (clip) void previewFrame(t).catch((e: unknown) => setError(String(e)));
  }

  async function runExport(kind: "mp4" | "gif") {
    if (!clip || working) return;
    setWorking(true);
    setError("");
    cancelRef.current = false;
    try {
      const snapshot = { ...params };
      const fx = stripKeys(useApp.getState().effects);
      const plan = planFrames(clip.info, range, fps, snapshot.method);
      const frames: ExportFrame[] = [];
      for (let i = 0; i < plan.times.length; i++) {
        if (cancelRef.current) throw new Error("cancelled");
        setProgress(`frame ${i + 1}/${plan.times.length}`);
        const raw = await captureFrame(clip, plan.times[i], plan.width, plan.height);
        const copy = new Uint8ClampedArray(raw.data).buffer as ArrayBuffer;
        const res = await renderImage(
          {
            width: plan.width,
            height: plan.height,
            pixels: copy,
            color: snapshot.color,
            method: snapshot.method,
            threshold: snapshot.threshold,
            palette: snapshot.palette,
            pixelSize: snapshot.pixelSize,
            effects: fx,
            seed: temporal ? i : 0,
          },
          [copy],
        );
        frames.push({
          data: new Uint8ClampedArray(res.pixels),
          width: res.width,
          height: res.height,
        });
      }
      setProgress("encoding…");
      const stem = fileName.replace(/\.[^.]+$/, "") || "clip";
      if (kind === "mp4") {
        const blob = await exportMp4(frames, plan.fps, (d, t) => setProgress(`encode ${d}/${t}`));
        download(URL.createObjectURL(blob), `${stem}.dither.mp4`);
      } else {
        const blob = exportGif(frames, plan.fps, snapshot.palette, (d, t) =>
          setProgress(`encode ${d}/${t}`),
        );
        download(URL.createObjectURL(blob), `${stem}.dither.gif`);
      }
      setProgress("done");
    } catch (e) {
      setError(String(e));
      setProgress("");
    }
    setWorking(false);
  }

  return (
    <section>
      <h2>Video timeline</h2>
      <div className="row">
        <input type="file" accept="video/*" onChange={(e) => void onFile(e.target.files?.[0])} />
        {clip && (
          <span id="status">
            {clip.info.width}×{clip.info.height}, {clip.info.duration.toFixed(1)}s
          </span>
        )}
      </div>
      {clip && (
        <>
          <div className="row">
            <label>
              scrub{" "}
              <input
                type="range"
                min={0}
                max={clip.info.duration}
                step={0.05}
                value={time}
                onChange={(e) => onScrub(Number(e.target.value))}
              />{" "}
              {time.toFixed(2)}s
            </label>
            <label>
              in{" "}
              <input
                type="number"
                min={0}
                max={clip.info.duration}
                step={0.1}
                value={range.start}
                onChange={(e) => setRange((r) => ({ ...r, start: Number(e.target.value) }))}
              />
            </label>
            <label>
              out{" "}
              <input
                type="number"
                min={0}
                max={clip.info.duration}
                step={0.1}
                value={range.end}
                onChange={(e) => setRange((r) => ({ ...r, end: Number(e.target.value) }))}
              />
            </label>
            <label>
              fps{" "}
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                {[5, 8, 12, 15, 24, 30].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={temporal}
                onChange={(e) => setTemporal(e.target.checked)}
              />{" "}
              temporal noise
            </label>
          </div>
          <div className="row">
            <canvas ref={frameRef} />
          </div>
          <div className="row">
            <button
              disabled={working || !canExportMp4()}
              title={canExportMp4() ? "" : "WebCodecs unavailable"}
              onClick={() => void runExport("mp4")}
            >
              Export MP4
            </button>
            <button disabled={working} onClick={() => void runExport("gif")}>
              Export GIF
            </button>
            {working && <button onClick={() => (cancelRef.current = true)}>Cancel</button>}
            {(progress || error) && (
              <span id="status">
                {progress} {error}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
