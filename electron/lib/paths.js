// Which files the dialogs may name, and every check a path has to pass before we
// read or write it. The renderer never names a path: a dialog does, we re-check
// what it handed back, and an output folder is addressed by an opaque handle.

const path = require("node:path");

/** Extensions the open dialog offers, mapped to the type we report to the app. */
const IMAGE_TYPES = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
});

const VIDEO_TYPES = Object.freeze({
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  avi: "video/x-msvideo",
});

/** The formats the app can write, so the save dialog can filter on them. */
const SAVE_FILTERS = Object.freeze([
  { name: "PNG image", extensions: ["png"] },
  { name: "JPEG image", extensions: ["jpg", "jpeg"] },
  { name: "GIF animation", extensions: ["gif"] },
  { name: "MP4 video", extensions: ["mp4"] },
  { name: "SVG drawing", extensions: ["svg"] },
  { name: "Text", extensions: ["txt"] },
  { name: "All files", extensions: ["*"] },
]);

/**
 * Device names windows refuses whatever follows the first dot: con.tar.gz is
 * still con. Refused on every platform, so a batch run behaves the same
 * everywhere; app/src/batch/naming.ts keeps the same list, and the two are
 * compared in test/paths.test.js.
 */
const RESERVED_DEVICES = Object.freeze([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

const RESERVED = new RegExp(`^(${RESERVED_DEVICES.join("|")})(\\.|$)`, "i");

/** The lower-cased extension without its dot, or "" when there is none. */
function extensionOf(name) {
  return path.extname(String(name)).replace(/^\./, "").toLowerCase();
}

/** The media type for a name, or null when the extension is not one we serve. */
function mediaTypeFor(name, kind) {
  const table = kind === "video" ? VIDEO_TYPES : IMAGE_TYPES;
  return table[extensionOf(name)] ?? null;
}

/** Dialog filters for one kind of media, built from the tables above. */
function openFilters(kind) {
  const table = kind === "video" ? VIDEO_TYPES : IMAGE_TYPES;
  const label = kind === "video" ? "Videos" : "Images";
  return [{ name: label, extensions: Object.keys(table) }];
}

/** The extension a save dialog should default to for a file name. */
function saveExtensionFor(name) {
  const ext = extensionOf(name);
  const known = [...Object.keys(IMAGE_TYPES), ...Object.keys(VIDEO_TYPES), "txt"];
  return ext && known.includes(ext) ? ext : "png";
}

/**
 * Reduce a renderer-supplied name to a bare file name. Anything that could
 * point somewhere else (separators, drive letters, dot segments, control bytes)
 * is rejected rather than cleaned, so a bad name never silently becomes another
 * file than the caller asked for.
 */
function safeFileName(name) {
  if (typeof name !== "string" || name.length === 0) throw new TypeError("empty file name");
  if (name.length > 255) throw new TypeError("file name is too long");
  // oxlint-disable-next-line no-control-regex -- control bytes are exactly what is being refused
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new TypeError("file name has control characters");
  if (name === "." || name === "..") throw new TypeError("file name is a directory reference");
  if (path.basename(name) !== name) throw new TypeError("file name must not contain a path");
  if (path.isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    throw new TypeError("file name must not contain a path");
  }
  if (RESERVED.test(name)) throw new TypeError("file name is reserved on Windows");
  return name;
}

/** Join a validated name onto a folder and prove the result stays inside it. */
function resolveWithin(dir, name) {
  const base = path.resolve(dir);
  const target = path.resolve(base, safeFileName(name));
  if (path.dirname(target) !== base) throw new TypeError("file name escapes the output folder");
  return target;
}

module.exports = {
  IMAGE_TYPES,
  VIDEO_TYPES,
  SAVE_FILTERS,
  RESERVED_DEVICES,
  extensionOf,
  mediaTypeFor,
  openFilters,
  saveExtensionFor,
  safeFileName,
  resolveWithin,
};
