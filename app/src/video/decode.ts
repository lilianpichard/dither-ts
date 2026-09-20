// Video decode through a plain <video> element: metadata plus
// seek-and-capture frame extraction. No FFmpeg needed for decode.

import type { ClipInfo } from "./jobs";

export interface LoadedClip {
  url: string;
  element: HTMLVideoElement;
  info: ClipInfo;
  revoke: () => void;
}

function eventPromise(
  el: HTMLVideoElement,
  name: "loadedmetadata" | "seeked" | "error",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      el.removeEventListener(name, ok);
      el.removeEventListener("error", bad);
      resolve();
    };
    const bad = () => {
      el.removeEventListener(name, ok);
      el.removeEventListener("error", bad);
      reject(new Error(`video ${name} failed`));
    };
    el.addEventListener(name, ok);
    el.addEventListener("error", bad);
  });
}

/** Load a file into a muted, preloading video element. */
export async function loadClip(file: File): Promise<LoadedClip> {
  const url = URL.createObjectURL(file);
  const element = document.createElement("video");
  element.muted = true;
  element.preload = "auto";
  element.src = url;
  try {
    await eventPromise(element, "loadedmetadata");
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return {
    url,
    element,
    info: { duration: element.duration, width: element.videoWidth, height: element.videoHeight },
    revoke: () => URL.revokeObjectURL(url),
  };
}

/** Seek to `time` and capture an RGBA frame at working size. */
export async function captureFrame(
  clip: LoadedClip,
  time: number,
  width: number,
  height: number,
): Promise<ImageData> {
  const { element } = clip;
  element.currentTime = Math.min(time, Math.max(0, clip.info.duration - 0.04));
  await eventPromise(element, "seeked");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(element, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
