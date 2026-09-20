// MP4 export: WebCodecs H.264 encoder straight into an mp4-muxer.
// No FFmpeg, no audio track in v1 (video-only output).

import { Muxer, ArrayBufferTarget } from "mp4-muxer";

export interface ExportFrame {
  data: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
}

export function canExportMp4(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window;
}

export async function exportMp4(
  frames: ExportFrame[],
  fps: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  if (!canExportMp4()) throw new Error("WebCodecs VideoEncoder not available in this browser");
  if (frames.length === 0) throw new Error("no frames to export");
  const { width, height } = frames[0];
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });
  encoder.configure({ codec: "avc1.640028", width, height, bitrate: width * height * fps * 0.12 });
  const frameDuration = 1_000_000 / fps;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const videoFrame = new VideoFrame(f.data, {
      format: "RGBA",
      codedWidth: f.width,
      codedHeight: f.height,
      timestamp: Math.round(i * frameDuration),
      duration: Math.round(frameDuration),
    });
    encoder.encode(videoFrame, { keyFrame: i % (fps * 2) === 0 });
    videoFrame.close();
    onProgress?.(i + 1, frames.length);
  }
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}
