// What kind of media a dropped or picked file is. Pure, so the rail, the empty
// state, the desktop dialog and the video panel all agree on one answer.

/** Every kind of source the studio can render. */
export type MediaKind = "image" | "video";

/**
 * Extensions that identify a video when the browser reports no MIME type. A
 * dropped file carries whatever the OS guessed, and some containers (mkv, ogv)
 * come through empty often enough to matter.
 */
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov", "mkv", "ogv", "avi", "mpeg", "mpg"]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "avif",
  "tif",
  "tiff",
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Which kind this file is, or `null` when it is neither. The MIME type is the
 * authority because it is what `createImageBitmap` and the video element will
 * act on; the extension only fills in for a file the OS could not type.
 */
export function mediaKindOf(file: { type: string; name: string }): MediaKind | null {
  const declared = file.type.toLowerCase();
  if (declared.startsWith("image/")) return "image";
  if (declared.startsWith("video/")) return "video";
  const extension = extensionOf(file.name);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

/** The `accept` attribute for one control that takes either kind. */
export const MEDIA_ACCEPT = "image/*,video/*";
