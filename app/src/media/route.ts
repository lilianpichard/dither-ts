// What to do with a picked file, decided in one place. The rail, the empty
// state and the desktop dialog all hand their file here, so an image and a
// video take the same road and neither has a private way in.

import type { MediaKind } from "./kind";
import { mediaKindOf } from "./kind";

/** The store actions routing needs. Injected so this stays pure. */
export interface MediaActions {
  /** Drop the still. Passing null clears it, which is what a video requires. */
  setSource: (source: null) => void;
  /** Hand a video to the timeline, which claims the canvas once it decodes. */
  loadVideo: (file: File) => void;
}

/** Why a file could not be routed, for the caller to report. */
export function mediaRejection(file: File): string | null {
  return mediaKindOf(file) === null
    ? `${file.name || "That file"} is not an image or a video.`
    : null;
}

/**
 * Route a picked file by its kind. A video drops the still on its way in, so
 * the two can never both be the subject: whichever arrived last owns the
 * canvas, and opening a panel cannot hand it back.
 */
export function routeMedia(file: File, kind: MediaKind, actions: MediaActions): void {
  if (kind === "video") {
    actions.setSource(null);
    actions.loadVideo(file);
    return;
  }
  // An image is the subject now. The store's setSource clears the video frame
  // and hands the canvas over, so nothing further is needed here.
}
