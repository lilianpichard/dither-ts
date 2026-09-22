import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { renderImage } from "../worker/client";
import { stripKeys } from "../presets/store";
import { useApp } from "../store";
import { captureFrame, loadClip, type LoadedClip } from "./decode";
import { exportGif } from "./exportGif";
import { canExportMp4, exportMp4, type ExportFrame } from "./exportMp4";
import { planFrames } from "./jobs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

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
  const [doneCount, setDoneCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [phase, setPhase] = useState("");
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
      setTotalCount(plan.times.length);
      setDoneCount(0);
      const frames: ExportFrame[] = [];
      for (let i = 0; i < plan.times.length; i++) {
        if (cancelRef.current) throw new Error("cancelled");
        setPhase(`frame ${i + 1}/${plan.times.length}`);
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
        setDoneCount(i + 1);
      }
      setPhase("encoding…");
      const stem = fileName.replace(/\.[^.]+$/, "") || "clip";
      if (kind === "mp4") {
        const blob = await exportMp4(frames, plan.fps, (d, t) => {
          setDoneCount(d);
          setTotalCount(t);
        });
        download(URL.createObjectURL(blob), `${stem}.dither.mp4`);
      } else {
        const blob = exportGif(frames, plan.fps, snapshot.palette, (d, t) => {
          setDoneCount(d);
          setTotalCount(t);
        });
        download(URL.createObjectURL(blob), `${stem}.dither.gif`);
      }
      setPhase("done");
      toast.success(`Exported ${stem}.dither.${kind}`);
    } catch (e) {
      setError(String(e));
      setPhase("");
    }
    setWorking(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Video timeline</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="file"
            accept="video/*"
            className="w-64"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {clip && (
            <Badge variant="secondary">
              {clip.info.width}×{clip.info.height}, {clip.info.duration.toFixed(1)}s
            </Badge>
          )}
        </div>
        {!clip ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No video loaded</EmptyTitle>
              <EmptyDescription>Choose a video file to scrub and export frames.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label>Scrub {time.toFixed(2)}s</Label>
                <Slider
                  className="w-48"
                  min={0}
                  max={clip.info.duration}
                  step={0.05}
                  value={[time]}
                  onValueChange={([v]) => onScrub(v)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="range-in">In</Label>
                <Input
                  id="range-in"
                  type="number"
                  className="w-20"
                  min={0}
                  max={clip.info.duration}
                  step={0.1}
                  value={range.start}
                  onChange={(e) => setRange((r) => ({ ...r, start: Number(e.target.value) }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="range-out">Out</Label>
                <Input
                  id="range-out"
                  type="number"
                  className="w-20"
                  min={0}
                  max={clip.info.duration}
                  step={0.1}
                  value={range.end}
                  onChange={(e) => setRange((r) => ({ ...r, end: Number(e.target.value) }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label>FPS</Label>
                <Select value={String(fps)} onValueChange={(v) => setFps(Number(v))}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[5, 8, 12, 15, 24, 30].map((f) => (
                      <SelectItem key={f} value={String(f)}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="temporal" checked={temporal} onCheckedChange={setTemporal} />
                <Label htmlFor="temporal">Temporal noise</Label>
              </div>
            </div>
            <canvas ref={frameRef} className="max-w-full rounded border" />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={working || !canExportMp4()}
                title={canExportMp4() ? "" : "WebCodecs unavailable"}
                onClick={() => void runExport("mp4")}
              >
                Export MP4
              </Button>
              <Button disabled={working} variant="secondary" onClick={() => void runExport("gif")}>
                Export GIF
              </Button>
              {working && (
                <Button variant="outline" onClick={() => (cancelRef.current = true)}>
                  Cancel
                </Button>
              )}
              {working && totalCount > 0 && (
                <Progress value={(doneCount / totalCount) * 100} className="w-48" />
              )}
              {phase && !error && <Badge variant="secondary">{phase}</Badge>}
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Export failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
