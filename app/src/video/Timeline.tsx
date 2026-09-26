import { useEffect, useMemo, useRef, useState } from "react";
import {
  Film,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Square,
  StepBack,
  StepForward,
} from "lucide-react";
import { toast } from "sonner";
import { cancelAll, renderImage } from "../worker/client";
import { getPool } from "../worker/pool";
import { stripKeys } from "../presets/store";
import { useApp } from "../store";
import { announceProgress } from "../progress";
import { formatEta } from "../batch/queue";
import {
  captureAbortError,
  captureFrame,
  isAbortError,
  LOAD_TIMEOUT_MS,
  loadClip,
  type LoadedClip,
} from "./decode";
import { canOpenFiles } from "../desktop/bridge";
import { openFailure, openFiles } from "../desktop/files";
import { saveBlob } from "../desktop/save";
import { describeAudioStatus, probeAudioCapture } from "./audio";
import { exportGif } from "./exportGif";
import { canExportMp4, exportMp4, type ExportFrame } from "./exportMp4";
import { frameOperations } from "./operations";
import { orderedAsyncPipeline } from "./pipeline";
import { MAX_FULL_RES_DIM, clampRange, fitSize, planFrames, planMaxDim, previewSize } from "./jobs";
import {
  advancePlayback,
  jumpTime,
  shouldRenderLive,
  stepTime,
  transportStatus,
} from "./transport";
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

interface CapturedInput {
  image: ImageData | null;
  release: () => void;
}

const PREVIEW_SCOPE = "timeline-preview";
const EXPORT_RENDER_TIMEOUT_MS = 30_000;

export default function Timeline() {
  const params = useApp((s) => s.params);
  const effects = useApp((s) => s.effects);
  const operations = useApp((s) => s.operations);
  const [clip, setClip] = useState<LoadedClip | null>(null);
  const duration = clip?.info.duration ?? 0;
  const [fileName, setFileName] = useState("");
  const [time, setTime] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [fps, setFps] = useState(12);
  const [temporal, setTemporal] = useState(false);
  const [working, setWorking] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [phase, setPhase] = useState("");
  const [etaMs, setEtaMs] = useState<number | null>(null);
  const [shown, setShown] = useState(0); // interpolated 0..100 progress
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [fullRes, setFullRes] = useState(false);
  const exportAbort = useRef<AbortController | null>(null);
  const exportPool = useRef<ReturnType<typeof getPool> | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const loadAbort = useRef<AbortController | null>(null);
  const clipRef = useRef<LoadedClip | null>(null);
  const loadSeq = useRef(0);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const previewSeq = useRef(0);
  const loopRef = useRef(false);
  const playingRef = useRef(false);
  const previewAt = useRef<number | null>(null);
  const liveTarget = useRef<number | null>(null);
  const liveShown = useRef<number | null>(null);
  const liveInFlight = useRef(false);
  const liveRender = useRef<() => Promise<void>>(async () => {});
  loopRef.current = loop;
  playingRef.current = playing;
  const audio = useMemo(() => probeAudioCapture(), []);
  // Blank unless there is a real estimate left, so the badge never trails a
  // dangling separator. Same wording as the batch panel.
  const eta = doneCount < totalCount ? formatEta(etaMs) : "";

  useEffect(
    () => () => {
      previewAbort.current?.abort();
      cancelAll(PREVIEW_SCOPE);
      exportAbort.current?.abort();
      exportPool.current?.invalidate();
      loadAbort.current?.abort();
      loadSeq.current++;
      clipRef.current?.element.pause();
      clipRef.current?.revoke();
      clipRef.current = null;
    },
    [],
  );

  function cancelExport(): void {
    exportAbort.current?.abort();
    exportPool.current?.invalidate();
  }

  async function onPickVideo(): Promise<void> {
    try {
      const file = (await openFiles("video"))?.[0];
      if (file) await onFile(file);
    } catch (error) {
      toast.error(`Could not open that video: ${openFailure(error)}`);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    cancelExport();
    previewAbort.current?.abort();
    cancelAll(PREVIEW_SCOPE);
    previewSeq.current++;
    setPlaying(false);
    clipRef.current?.element.pause();
    resetLivePreview();
    loadAbort.current?.abort();
    const sequence = ++loadSeq.current;
    const controller = new AbortController();
    loadAbort.current = controller;
    setError("");
    try {
      const loaded = await loadClip(file, {
        signal: controller.signal,
        timeout: LOAD_TIMEOUT_MS,
      });
      if (sequence !== loadSeq.current || controller.signal.aborted) {
        loaded.revoke();
        return;
      }
      const previous = clipRef.current;
      clipRef.current = loaded;
      setClip(loaded);
      if (previous && previous !== loaded) previous.revoke();
      setFileName(file.name);
      setTime(0);
      setRange({ start: 0, end: loaded.info.duration });
    } catch (error) {
      if (sequence === loadSeq.current && !controller.signal.aborted) setError(String(error));
    } finally {
      if (loadAbort.current === controller) loadAbort.current = null;
    }
  }

  async function drawFrame(t: number, live: boolean, controller: AbortController, mySeq: number) {
    if (!clip) return;
    // Preview size only, so a long clip is not gated by the export frame cap.
    const size = previewSize(clip.info, params.method);
    const raw = await captureFrame(clip, t, size.width, size.height, {
      signal: controller.signal,
      live,
    });
    if (controller.signal.aborted) return;
    const copy = new Uint8ClampedArray(raw.data).buffer as ArrayBuffer;
    const res = await renderImage(
      {
        width: size.width,
        height: size.height,
        pixels: copy,
        color: params.color,
        method: params.method,
        threshold: params.threshold,
        palette: params.palette,
        pixelSize: params.pixelSize,
        effects: stripKeys(effects),
        operations: frameOperations(operations, clip.info, size),
        seed: temporal ? Math.round(t * fps) : 0,
      },
      [copy],
      { signal: controller.signal, scope: PREVIEW_SCOPE },
    );
    const c = frameRef.current;
    if (!c || mySeq !== previewSeq.current || controller.signal.aborted) return;
    c.width = res.width;
    c.height = res.height;
    c.getContext("2d")!.putImageData(
      new ImageData(new Uint8ClampedArray(res.pixels), res.width, res.height),
      0,
      0,
    );
    // The frame is current again, so any earlier preview error is stale.
    if (!working) setError("");
  }

  async function previewFrame(t: number) {
    if (!clip) return;
    previewAbort.current?.abort();
    cancelAll(PREVIEW_SCOPE);
    const controller = new AbortController();
    previewAbort.current = controller;
    const mySeq = ++previewSeq.current;
    try {
      await drawFrame(t, false, controller, mySeq);
    } catch (error) {
      if (!isAbortError(error)) setError(String(error));
    }
  }

  /**
   * One coalesced playback preview. An in-flight render is left to finish
   * rather than cancelled, so a slow method still reaches the canvas; the
   * newest playhead position is picked up afterwards.
   */
  async function renderLivePreview(): Promise<void> {
    const target = liveTarget.current;
    if (target === null || liveInFlight.current) return;
    liveInFlight.current = true;
    const controller = new AbortController();
    previewAbort.current = controller;
    const mySeq = ++previewSeq.current;
    previewAt.current = performance.now();
    try {
      await drawFrame(target, true, controller, mySeq);
      liveShown.current = target;
    } catch (error) {
      if (!isAbortError(error)) setError(String(error));
    } finally {
      liveInFlight.current = false;
      if (previewAbort.current === controller) previewAbort.current = null;
      // A slow method is already past the cadence floor, so it chains straight
      // on to the newest target; a fast one waits for the next due tick.
      if (shouldRenderLive(gate(performance.now()))) void liveRender.current();
    }
  }
  const previewRef = useRef<(t: number) => Promise<void>>(async () => {});
  previewRef.current = previewFrame;
  liveRender.current = renderLivePreview;

  // Paint the opening frame as soon as a clip lands. This is an effect rather
  // than a call at the end of the load because the canvas is only mounted once
  // there is a clip, and a first frame drawn before that would be dropped.
  useEffect(() => {
    if (!clip) return;
    void previewRef.current(0);
  }, [clip]);

  /** Forget the coalescing state so the next run starts on a fresh frame. */
  function resetLivePreview(): void {
    liveTarget.current = null;
    liveShown.current = null;
    previewAt.current = null;
  }

  /** Snapshot of the coalescing state, read fresh at every decision point. */
  function gate(now: number, target = liveTarget.current) {
    return {
      playing: playingRef.current,
      inFlight: liveInFlight.current,
      lastAt: previewAt.current,
      now,
      shown: liveShown.current,
      target,
    };
  }

  function onScrub(t: number) {
    // Scrubbing seeks the element, which would fight a running playback.
    setPlaying(false);
    clipRef.current?.element.pause();
    resetLivePreview();
    setTime(t);
    if (clip) void previewFrame(t);
  }

  async function togglePlay(): Promise<void> {
    if (!clip) return;
    if (playing) {
      clip.element.pause();
      setPlaying(false);
      resetLivePreview();
      return;
    }
    if (clip.element.ended) clip.element.currentTime = 0;
    // A fresh run wants its first frame at once, not after a throttle window.
    resetLivePreview();
    try {
      await clip.element.play();
      setPlaying(true);
    } catch (playError) {
      setPlaying(false);
      setError(String(playError));
    }
  }

  function onStep(direction: 1 | -1): void {
    if (!clip) return;
    clip.element.pause();
    setPlaying(false);
    resetLivePreview();
    const next = stepTime(time, direction, 1 / fps, clip.info.duration);
    setTime(next);
    // A deliberate step seeks for real; previewFrame waits for the seek.
    void previewFrame(next);
  }

  function onJump(direction: 1 | -1): void {
    if (!clip) return;
    const next = jumpTime(direction, clip.info.duration);
    setTime(next);
    // Playback may still be running, but the jump is deliberate: seek and wait
    // rather than grabbing whatever frame happens to be on screen mid-seek.
    void previewFrame(next);
  }

  function stopPlayback(): void {
    if (!clip) return;
    clip.element.pause();
    setPlaying(false);
    resetLivePreview();
    const start = jumpTime(-1, clip.info.duration);
    setTime(start);
    void previewFrame(start);
  }

  // Playback tick: mirror the element's playhead into the scrub slider and
  // offer the newest position to the coalescing preview, which decides when a
  // render is actually worth starting.
  useEffect(() => {
    if (!playing || !clip) return;
    const element = clip.element;
    let frame = 0;
    let stopped = false;
    const tick = (): void => {
      if (stopped) return;
      const now = performance.now();
      const step = advancePlayback(element.currentTime, clip.info.duration, loopRef.current);
      // Show the playhead before branching: stopping at the end must still put
      // the readout on the end, not where the last tick happened to land.
      if (Number.isFinite(step.time)) setTime(step.time);
      if (step.wrapped) element.currentTime = step.time;
      liveTarget.current = step.time;
      if (step.finished) {
        setPlaying(false);
        // Settle on the end frame with a live grab, so the canvas is not left
        // a frame short of the time the slider now reports.
        if (!liveInFlight.current) void liveRender.current();
        return;
      }
      if (shouldRenderLive(gate(now, step.time))) void liveRender.current();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [playing, clip]);

  async function runExport(kind: "mp4" | "gif") {
    if (!clip || working) return;
    const currentClip = clip;
    // Export owns the element from here, so playback stops and seeks are ours.
    setPlaying(false);
    currentClip.element.pause();
    resetLivePreview();
    const controller = new AbortController();
    let pool: ReturnType<typeof getPool> | null = null;
    exportAbort.current = controller;
    setWorking(true);
    setError("");
    try {
      const snapshot = { ...params };
      const fx = stripKeys(useApp.getState().effects);
      const ops = useApp.getState().operations;
      const plan = planFrames(currentClip.info, range, fps, snapshot.method, {
        maxDim: fullRes ? MAX_FULL_RES_DIM : undefined,
      });
      const frameOps = frameOperations(ops, currentClip.info, plan);
      const total = plan.times.length;
      setTotalCount(total);
      setDoneCount(0);
      setEtaMs(null);
      setShown(0);
      pool = getPool();
      const renderPool = pool;
      exportPool.current = renderPool;

      async function* captureFrames(): AsyncGenerator<CapturedInput> {
        for (let i = 0; i < total; i++) {
          if (controller.signal.aborted) throw captureAbortError();
          setPhase(`capture ${i + 1}/${total}`);
          let image: ImageData | null = await captureFrame(
            currentClip,
            plan.times[i],
            plan.width,
            plan.height,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) throw captureAbortError();
          setDoneCount((current) => Math.max(current, i + 1));
          setShown((current) => Math.max(current, ((i + 1) / total) * 50));
          const input: CapturedInput = {
            image,
            release: () => {
              image = null;
              input.image = null;
            },
          };
          yield input;
        }
      }

      const recent: number[] = [];
      let completed = 0;
      const rendered = orderedAsyncPipeline(
        captureFrames(),
        renderPool.size * 2,
        async (input, index) => {
          if (controller.signal.aborted) throw captureAbortError();
          const raw = input.image;
          if (!raw) throw captureAbortError();
          const jobStart = performance.now();
          const copy = new Uint8ClampedArray(raw.data).buffer as ArrayBuffer;
          const response = await renderPool.render(
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
              operations: frameOps,
              seed: temporal ? index : 0,
            },
            [copy],
            undefined,
            { signal: controller.signal, timeout: EXPORT_RENDER_TIMEOUT_MS },
          );
          const elapsed = performance.now() - jobStart;
          recent.push(elapsed);
          if (recent.length > 8) recent.shift();
          completed++;
          setDoneCount((current) => Math.max(current, completed));
          setShown((current) => Math.max(current, 50 + (completed / total) * 50));
          if (recent.length >= 2) {
            const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
            setEtaMs(average * Math.max(0, total - completed));
          }
          setPhase(`frame ${completed}/${total}`);
          return {
            data: new Uint8ClampedArray(response.pixels),
            width: response.width,
            height: response.height,
          };
        },
        {
          signal: controller.signal,
          releaseInput: (input) => input.release(),
          releaseOutput: (frame: ExportFrame) => {
            frame.data = new Uint8ClampedArray(0);
          },
        },
      );

      setPhase("encoding…");
      setEtaMs(null);
      const stem = fileName.replace(/\.[^.]+$/, "") || "clip";
      const onProgress = (done: number, count: number): void => {
        if (controller.signal.aborted) return;
        setDoneCount((current) => Math.max(current, done));
        setTotalCount(count || total);
        setShown((current) => Math.max(current, count > 0 ? 50 + (done / count) * 50 : 50));
      };
      const blob =
        kind === "mp4"
          ? await exportMp4(rendered, plan.fps, onProgress, {
              signal: controller.signal,
              controller,
              total,
            })
          : await exportGif(rendered, plan.fps, snapshot.palette, onProgress, {
              signal: controller.signal,
              controller,
              total,
              monochrome: !snapshot.color,
            });

      if (controller.signal.aborted) throw captureAbortError();
      const outcome = await saveBlob(`${stem}.dither.${kind}`, blob);
      // A cancelled save dialog leaves nothing behind, so the phase resets.
      if (outcome !== "saved") {
        setPhase("");
        return;
      }
      setPhase("done");
      toast.success(`Exported ${stem}.dither.${kind}`);
    } catch (error) {
      if (isAbortError(error)) {
        pool?.invalidate();
        setError("");
        setPhase("");
      } else {
        pool?.invalidate();
        setError(String(error));
        setPhase("");
      }
    } finally {
      if (exportAbort.current === controller) exportAbort.current = null;
      if (exportPool.current === pool) exportPool.current = null;
      setWorking(false);
    }
  }

  const live = announceProgress({
    label: "Video export",
    running: working,
    done: shown,
    total: 100,
  });

  // The working badge shares previewSize with the preview path, so the label
  // cannot drift from the size actually rendered.
  const workingDim = clip ? previewSize(clip.info, params.method) : null;
  const exportDim = clip
    ? fitSize(
        clip.info.width,
        clip.info.height,
        planMaxDim(params.method, fullRes ? MAX_FULL_RES_DIM : undefined),
      )
    : null;
  const transportLine = transportStatus({ playing, time, duration, loop });

  return (
    <Card className="overflow-y-auto lg:h-full">
      <CardHeader>
        <CardTitle>Video timeline</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {canOpenFiles() ? (
            <Button
              variant="secondary"
              disabled={working}
              aria-label="Choose a video"
              onClick={() => void onPickVideo()}
            >
              <Film /> Choose video
            </Button>
          ) : (
            <>
              <Label htmlFor="video-file" className="sr-only">
                Video file
              </Label>
              <Input
                id="video-file"
                type="file"
                accept="video/*"
                className="w-full max-w-64"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </>
          )}
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
                <Label id="scrub-label">Scrub {time.toFixed(2)}s</Label>
                <Slider
                  aria-labelledby="scrub-label"
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
                  onChange={(e) =>
                    setRange((r) => clampRange({ ...r, start: Number(e.target.value) }, duration))
                  }
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
                  onChange={(e) =>
                    setRange((r) => clampRange({ ...r, end: Number(e.target.value) }, duration))
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="fps">FPS</Label>
                <Select value={String(fps)} onValueChange={(v) => setFps(Number(v))}>
                  <SelectTrigger id="fps" className="w-20">
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
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch id="full-res" checked={fullRes} onCheckedChange={setFullRes} />
                <Label htmlFor="full-res">Full resolution</Label>
              </div>
              {exportDim && workingDim && (
                <Badge variant="secondary">
                  Source {clip.info.width}×{clip.info.height} · Working {workingDim.width}×
                  {workingDim.height} · Export {exportDim.width}×{exportDim.height}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                aria-label="Jump to start"
                disabled={working}
                onClick={() => onJump(-1)}
              >
                <SkipBack />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Step back one frame"
                disabled={working}
                onClick={() => onStep(-1)}
              >
                <StepBack />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={playing ? "Pause" : "Play"}
                disabled={working}
                onClick={() => void togglePlay()}
              >
                {playing ? <Pause /> : <Play />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Stop and rewind"
                disabled={working}
                onClick={stopPlayback}
              >
                <Square />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Step forward one frame"
                disabled={working}
                onClick={() => onStep(1)}
              >
                <StepForward />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Jump to end"
                disabled={working}
                onClick={() => onJump(1)}
              >
                <SkipForward />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Loop playback"
                aria-pressed={loop}
                disabled={working}
                onClick={() => setLoop((current) => !current)}
              >
                <Repeat />
              </Button>
              <Badge variant="secondary">{transportLine}</Badge>
            </div>
            <canvas
              ref={frameRef}
              role="img"
              aria-label="Dithered video frame preview"
              className="max-w-full rounded border"
            />
            <p className="text-muted-foreground text-sm">{describeAudioStatus(audio)}</p>
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
                <Button variant="outline" onClick={cancelExport}>
                  Cancel
                </Button>
              )}
              {working && totalCount > 0 && (
                <div aria-busy className="flex flex-wrap items-center gap-3">
                  <Progress
                    aria-label="Video export progress"
                    value={Math.min(100, shown)}
                    max={100}
                    className="w-48"
                  />
                  <Badge aria-hidden variant="secondary">
                    {doneCount}/{totalCount}
                    {eta ? ` · ${eta}` : ""}
                  </Badge>
                </div>
              )}
              {phase && !error && !working && (
                <Badge aria-hidden variant="secondary">
                  {phase}
                </Badge>
              )}
            </div>
            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {live}
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
