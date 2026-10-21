import { useEffect, useMemo, useRef, useState } from "react";
import {
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
import { resolveColorMode, useApp } from "../store";
import { exportPixelSize, previewPixelSize } from "./pixelSize";
import { useTranslate } from "../i18n";
import type { VideoPreview } from "../store";
import type { DitherMethod } from "../../../src/index.js";
import type { Frame } from "../preview/frame";
import { warnIfSlow } from "../lib/slowOperation";
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
import { saveBlob } from "../desktop/save";
import { describeAudioStatus, probeAudioCapture } from "./audio";
import { exportGif } from "./exportGif";
import { canExportMp4, exportMp4, type ExportFrame } from "./exportMp4";
import { frameOperations } from "./operations";
import { operatedFrameSize } from "../image/settings";
import { orderedAsyncPipeline } from "./pipeline";
import { playheadPercent, spanPercent } from "./ribbon";
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
import { useConsoleMeta } from "../components/consoleMeta";
import { Button } from "@/components/ui/button";
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
import { Toggle } from "@/components/ui/toggle";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";

interface CapturedInput {
  image: ImageData | null;
  release: () => void;
}

const PREVIEW_SCOPE = "timeline-preview";
/** Longer than an image render: a video export is many renders, not one. */
const SLOW_EXPORT_WARNING_MS = 8000;

/**
 * Identifies the loaded clip for the preview surface's `resetKey`, so a different
 * clip refits while every frame of the same clip leaves the view alone.
 */
function clipKeyOf(clip: LoadedClip): string {
  return `${clip.info.width}x${clip.info.height}@${clip.info.duration.toFixed(3)}`;
}

/**
 * The three sizes a clip is read at, side by side. They are cases rather than a
 * sentence because each one is a number the user compares against the other
 * two, and the comparison is the point.
 */
export function DimensionGrid({
  clip,
  method,
  fullRes,
}: {
  clip: LoadedClip;
  method: DitherMethod;
  fullRes: boolean;
}) {
  const t = useTranslate();
  const working = previewSize(clip.info, method);
  const output = fitSize(
    clip.info.width,
    clip.info.height,
    planMaxDim(method, fullRes ? MAX_FULL_RES_DIM : undefined),
  );
  const cells = [
    {
      key: "sourceDim",
      label: t("timeline.sourceDim"),
      width: clip.info.width,
      height: clip.info.height,
    },
    { key: "workingDim", label: t("timeline.workingDim"), ...working },
    { key: "exportDim", label: t("timeline.exportDim"), ...output },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {cells.map((cell) => (
        <div key={cell.key} className="rounded-lg border border-border bg-card p-2">
          <dt className="text-label text-muted-foreground uppercase">{cell.label}</dt>
          <dd className="mt-0.5 text-body-lg text-foreground">
            {cell.width}×{cell.height}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The clip as a band: the selected span is the filled part and the playhead the
 * marker on it, so a range is read at a glance before it is typed into a field.
 *
 * Everything is a fraction of the clip, which is what the ribbon helper is for:
 * a range that arrives inverted or past the end still has to draw a band rather
 * than nothing.
 */
export function TimelineRibbon({
  range,
  duration,
  time,
  onScrub,
  disabled = false,
}: {
  range: { start: number; end: number };
  duration: number;
  time: number;
  onScrub: (time: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslate();
  const span = spanPercent(range, duration);
  const playhead = playheadPercent(time, duration);
  return (
    <Card
      title={t("timeline.ribbon")}
      meta={t("timeline.selected", {
        start: range.start.toFixed(1),
        end: range.end.toFixed(1),
      })}
    >
      <div className="relative h-7 w-full overflow-hidden rounded-lg border border-border bg-canvas">
        <div
          aria-hidden
          className="absolute inset-y-0 border-x-2 border-primary bg-primary/20"
          style={{ left: `${span.left * 100}%`, width: `${span.width * 100}%` }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-foreground"
          style={{ left: `${playhead * 100}%` }}
        />
      </div>
      <Slider
        aria-label={t("timeline.scrub")}
        min={0}
        max={duration}
        step={0.05}
        value={[time]}
        disabled={disabled}
        onValueChange={([v]) => onScrub(v)}
      />
    </Card>
  );
}

export default function Timeline({ active = true }: { active?: boolean }) {
  const params = useApp((s) => s.params);
  const effects = useApp((s) => s.effects);
  const operations = useApp((s) => s.operations);
  const showVideo = useApp((s) => s.showVideo);
  const media = useApp((s) => s.media);
  const clearSeq = useApp((s) => s.clearSeq);
  const pendingVideo = useApp((s) => s.pendingVideo);
  const loadVideo = useApp((s) => s.loadVideo);
  const beginMediaLoad = useApp((s) => s.beginMediaLoad);
  const [clip, setClip] = useState<LoadedClip | null>(null);
  const duration = clip?.info.duration ?? 0;
  const [fileName, setFileName] = useState("");
  const [time, setTime] = useState(0);
  /** Mirrors `time` so effects can read the playhead without re-running on it. */
  const timeRef = useRef(0);
  timeRef.current = time;
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
  // On by default: an export capped at 720p/1080p is not worth exporting, and the
  // wait it saves is the thing the user is explicitly willing to trade away. The
  // switch stays for when a fast draft matters more than the resolution.
  const [fullRes, setFullRes] = useState(true);
  const exportAbort = useRef<AbortController | null>(null);
  const exportPool = useRef<ReturnType<typeof getPool> | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const loadAbort = useRef<AbortController | null>(null);
  const clipRef = useRef<LoadedClip | null>(null);
  const loadSeq = useRef(0);
  const previewSeq = useRef(0);
  /** The last frame published, so reopening the tab can reclaim the canvas. */
  const lastPreviewRef = useRef<VideoPreview | null>(null);
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

  async function onFile(file: File | undefined, token = beginMediaLoad()) {
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
      if (
        sequence !== loadSeq.current ||
        controller.signal.aborted ||
        token !== useApp.getState().mediaSeq
      ) {
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
      if (
        sequence === loadSeq.current &&
        !controller.signal.aborted &&
        token === useApp.getState().mediaSeq
      ) {
        setError(String(error));
      }
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
    // The render transfers its input buffer to the worker, which detaches it, so
    // the frame kept for compare has to be a separate copy that is never handed
    // over. Reusing `copy` here left the published compare frame detached.
    const comparePixels = new Uint8ClampedArray(raw.data);
    const ops = frameOperations(operations, clip.info, size);
    // The view space is the frame the worker returns, not the capture: a turn
    // swaps the sides, and fitting the capture's aspect around the turned
    // result is what used to squash it. Only the dimensions are read from here.
    const turned = operatedFrameSize(size.width, size.height, ops);
    const geometry: Frame = {
      width: turned.width,
      height: turned.height,
      pixels: comparePixels.buffer as ArrayBuffer,
    };
    const copy = new Uint8ClampedArray(comparePixels).buffer as ArrayBuffer;
    const res = await renderImage(
      {
        width: size.width,
        height: size.height,
        pixels: copy,
        color: params.color,
        colorMode: resolveColorMode(params),
        method: params.method,
        threshold: params.threshold,
        palette: params.palette,
        pixelSize: previewPixelSize(params, clip.info, size),
        effects: stripKeys(effects),
        operations: ops,
        seed: temporal ? Math.round(t * fps) : 0,
      },
      [copy],
      { signal: controller.signal, scope: PREVIEW_SCOPE },
    );
    if (mySeq !== previewSeq.current || controller.signal.aborted) return;
    // The shared preview surface owns the canvas, so publish the frame instead of
    // painting here. `geometry` is the preview size after the operations, constant
    // for a clip until they change: that keeps the surface's zoom still while
    // frames stream in, and makes 100% mean one preview pixel per screen pixel.
    // An image took the canvas while this frame was rendering: the clip is
    // still loaded, but the image owns the subject until the clip is chosen
    // again. Publishing here would silently steal it back.
    if (useApp.getState().media === "image") return;
    const published: VideoPreview = {
      display: { width: res.width, height: res.height, pixels: res.pixels },
      compare: geometry,
      geometry,
      clipKey: clipKeyOf(clip),
    };
    lastPreviewRef.current = published;
    showVideo(published);

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

  // Mirror the still image, which re-renders whenever the settings change. Without
  // this the preview ignored the method, palette, threshold, pixel size, colour
  // mode and effects entirely, and only caught up on the next scrub: picking
  // "original" looked like it did nothing. The play loop re-renders every frame
  // and reads these fresh, so stepping in is only needed while paused — seeking
  // mid-playback would fight the advancing element.
  //
  // Only when the video already owns the canvas. Loading an image clears the
  // preview and rewrites `operations` through fitToSource, and publishing again
  // here would let the video snatch the canvas straight back from the image.
  useEffect(() => {
    if (!clip || playingRef.current) return;
    if (!useApp.getState().videoPreview) return;
    void previewFrame(timeRef.current);
  }, [clip, params, effects, operations]);

  // The tab hides this panel rather than unmounting it, so the clip survives a
  // switch. Pause instead: the playback loop is a rAF chain, and left running it
  // would keep decoding and playing audio behind another tab. The playhead, the
  // clip and the published frame all stay where they are.
  useEffect(() => {
    if (active) {
      // Only republish when the clip still owns the canvas. An image loaded
      // while the tab was hidden clears that ownership, and this effect must
      // not hand the canvas back merely because the tab was reopened.
      if (lastPreviewRef.current && useApp.getState().media === "video") {
        showVideo(lastPreviewRef.current);
      }
      return;
    }
    clipRef.current?.element.pause();
    setPlaying(false);
    resetLivePreview();
  }, [active, showVideo]);

  // Real teardown only, now that the tab hides rather than unmounts. Hand the
  // canvas back so a frame is never left with no timeline behind it.
  useEffect(() => {
    return () => showVideo(null);
  }, [showVideo]);

  // A file picked outside this panel. The rail and the empty state both take an
  // image or a video, so a video arrives here through the store rather than
  // through a picker that only ever existed in this panel, and it runs the same
  // loader every other route takes.
  useEffect(() => {
    if (!pendingVideo) return;
    loadVideo(null);
    void onFile(pendingVideo.file, pendingVideo.seq);
  }, [pendingVideo, loadVideo, onFile]);

  // The canvas was emptied, so the clip goes with it. The counter is what the
  // store has to say about it: the canvas owner lives there, the clip lives
  // here, and a bump is the only thing the two share.
  useEffect(() => {
    if (clearSeq === 0) return;
    previewAbort.current?.abort();
    cancelAll(PREVIEW_SCOPE);
    previewSeq.current++;
    setPlaying(false);
    clipRef.current?.element.pause();
    clipRef.current?.revoke();
    clipRef.current = null;
    lastPreviewRef.current = null;
    loadAbort.current?.abort();
    setClip(null);
    setFileName("");
    setTime(0);
    setRange({ start: 0, end: 0 });
    resetLivePreview();
  }, [clearSeq]);

  // An image took the canvas, so this clip stops being the subject. The clip
  // itself stays loaded and exportable, which is why it is not discarded here:
  // what ends is the fight over the canvas.
  useEffect(() => {
    if (media !== "image" || clipRef.current === null) return;
    previewAbort.current?.abort();
    cancelAll(PREVIEW_SCOPE);
    previewSeq.current++;
    setPlaying(false);
    clipRef.current.element.pause();
    resetLivePreview();
  }, [media, cancelAll]);

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
    // Armed here so a quick export never nags, and cancelled in the finally so a
    // fast one never warns after the fact.
    const cancelSlowWarning = warnIfSlow(SLOW_EXPORT_WARNING_MS, t("error.slowExport"));
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
              colorMode: resolveColorMode(snapshot),
              method: snapshot.method,
              threshold: snapshot.threshold,
              palette: snapshot.palette,
              pixelSize: exportPixelSize(snapshot, currentClip.info, plan),
              effects: fx,
              operations: frameOps,
              seed: temporal ? index : 0,
            },
            [copy],
            undefined,
            // No deadline: a long frame is the cost of the resolution the user
            // asked for, and cutting it off threw the export away. The slow-path
            // toast below says a wait is coming instead.
            { signal: controller.signal },
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
      toast.success(t("timeline.exported", { name: `${stem}.dither.${kind}` }));
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
      cancelSlowWarning();
      if (exportAbort.current === controller) exportAbort.current = null;
      if (exportPool.current === pool) exportPool.current = null;
      setWorking(false);
    }
  }

  // The working badge shares previewSize with the preview path, so the label
  // cannot drift from the size actually rendered.
  const t = useTranslate();
  const live = announceProgress({
    label: t("timeline.exportLabel"),
    running: working,
    done: shown,
    total: 100,
  });
  const transportLine = transportStatus({ playing, time, duration, loop }, t);
  useConsoleMeta("timeline", clip ? t("timeline.clipLoaded") : t("timeline.noClip"));

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-3">
      {clip ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <Badge variant="secondary" className="min-w-0">
              <span className="truncate">{fileName}</span>
            </Badge>
            <span className="text-label text-muted-foreground uppercase">
              {t("timeline.dims", {
                width: clip.info.width,
                height: clip.info.height,
                duration: clip.info.duration,
              })}
            </span>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-3 pr-2.5">
              <TimelineRibbon
                range={range}
                duration={duration}
                time={time}
                onScrub={onScrub}
                disabled={working}
              />

              <div className="grid grid-rows-1 gap-3 @lg:grid-cols-2">
                {/* Centred along the card's own height, so the transport sits
                    against the middle of the settings card rather than at its
                    top. */}
                <Card title={t("timeline.transport")} className="justify-center">
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label={t("timeline.jumpStart")}
                      title={t("timeline.jumpStart")}
                      disabled={working}
                      onClick={() => onJump(-1)}
                    >
                      <SkipBack />
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label={t("timeline.stepBack")}
                      title={t("timeline.stepBack")}
                      disabled={working}
                      onClick={() => onStep(-1)}
                    >
                      <StepBack />
                    </Button>
                    <Button
                      variant={playing ? "accent" : "default"}
                      size="icon-lg"
                      aria-label={playing ? t("common.pause") : t("common.play")}
                      title={playing ? t("common.pause") : t("common.play")}
                      disabled={working}
                      onClick={() => void togglePlay()}
                    >
                      {playing ? <Pause /> : <Play />}
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label={t("timeline.stop")}
                      title={t("timeline.stop")}
                      disabled={working}
                      onClick={stopPlayback}
                    >
                      <Square />
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label={t("timeline.stepForward")}
                      title={t("timeline.stepForward")}
                      disabled={working}
                      onClick={() => onStep(1)}
                    >
                      <StepForward />
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label={t("timeline.jumpEnd")}
                      title={t("timeline.jumpEnd")}
                      disabled={working}
                      onClick={() => onJump(1)}
                    >
                      <SkipForward />
                    </Button>
                    <Toggle
                      variant="outline"
                      size="icon-sm"
                      pressed={loop}
                      aria-label={t("timeline.loop")}
                      title={t("timeline.loop")}
                      disabled={working}
                      onPressedChange={setLoop}
                    >
                      <Repeat />
                    </Toggle>
                  </div>
                  <p className="text-caption text-muted-foreground">{transportLine}</p>
                </Card>

                <Card title={t("timeline.settings")}>
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-2 @sm:grid-cols-3">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="range-in">{t("timeline.in")}</Label>
                        <Input
                          id="range-in"
                          type="number"
                          min={0}
                          max={duration}
                          step={0.1}
                          value={range.start}
                          onChange={(e) =>
                            setRange((r) =>
                              clampRange({ ...r, start: Number(e.target.value) }, duration),
                            )
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="range-out">{t("timeline.out")}</Label>
                        <Input
                          id="range-out"
                          type="number"
                          min={0}
                          max={duration}
                          step={0.1}
                          value={range.end}
                          onChange={(e) =>
                            setRange((r) =>
                              clampRange({ ...r, end: Number(e.target.value) }, duration),
                            )
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="fps">{t("timeline.fps")}</Label>
                        <Select value={String(fps)} onValueChange={(v) => setFps(Number(v))}>
                          <SelectTrigger id="fps">
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
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="flex items-center gap-2">
                        <Switch id="temporal" checked={temporal} onCheckedChange={setTemporal} />
                        <Label htmlFor="temporal">{t("timeline.temporal")}</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch id="full-res" checked={fullRes} onCheckedChange={setFullRes} />
                        <Label htmlFor="full-res">{t("timeline.fullRes")}</Label>
                      </div>
                    </div>
                    <DimensionGrid clip={clip} method={params.method} fullRes={fullRes} />
                  </div>
                </Card>
              </div>

              <p className="text-caption text-muted-foreground">{describeAudioStatus(audio, t)}</p>
            </div>
          </ScrollArea>
        </>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("timeline.empty")}</EmptyTitle>
            <EmptyDescription>{t("timeline.emptyHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {/* A load or preview failure has to be visible even when no clip could
          be decoded; the export footer only exists once a clip is loaded. */}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t("timeline.error")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {clip && (
        <>
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {live}
          </div>
          {/* The export row is pinned below the scroll, so the action stays put
              whatever the panel is doing above it. */}
          <div className="flex shrink-0 flex-col gap-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={working || !canExportMp4()}
                title={canExportMp4() ? undefined : t("timeline.noWebcodecs")}
                onClick={() => void runExport("mp4")}
              >
                {t("timeline.exportMp4")}
              </Button>
              <Button disabled={working} variant="secondary" onClick={() => void runExport("gif")}>
                {t("timeline.exportGif")}
              </Button>
              {working && (
                <Button variant="outline" onClick={cancelExport}>
                  {t("common.cancel")}
                </Button>
              )}
              {working && totalCount > 0 && (
                <Badge aria-hidden variant="secondary" className="ml-auto">
                  {doneCount}/{totalCount}
                  {eta ? ` · ${eta}` : ""}
                </Badge>
              )}
            </div>
            {working && (
              <Progress
                aria-label={t("timeline.progress")}
                value={Math.min(100, shown)}
                max={100}
              />
            )}
            {phase && !error && !working && (
              <Badge aria-hidden variant="secondary">
                {phase}
              </Badge>
            )}
          </div>
        </>
      )}
    </div>
  );
}
