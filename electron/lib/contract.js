// The whole renderer-facing surface: three channels and the shape of what may
// cross them. Deliberately free of electron imports so the contract can be read
// and tested on its own, and so the preload can mirror it without a build step.

const CHANNELS = Object.freeze({
  open: "dither:open",
  pickDirectory: "dither:pick-directory",
  save: "dither:save",
});

/** What the renderer is allowed to ask the open dialog for. */
const OPEN_KINDS = Object.freeze(["image", "video"]);

/** A rendered frame or clip, not a library: room for a long video. */
const MAX_SAVE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Caps on one open. A dialog only returns what the user picked, but the bytes
 * still have to cross the bridge and land in the renderer, so an over-sized or
 * over-numerous pick is refused up front rather than read.
 */
const OPEN_LIMITS = Object.freeze({
  maxFiles: 256,
  maxImageBytes: 256 * 1024 * 1024,
  maxVideoBytes: 1024 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate an open request; anything unexpected is a hard error, not a default. */
function parseOpenRequest(raw) {
  if (!isRecord(raw)) throw new TypeError("open: expected an object");
  if (typeof raw.kind !== "string" || !OPEN_KINDS.includes(raw.kind)) {
    throw new TypeError("open: kind must be one of " + OPEN_KINDS.join(", "));
  }
  return { kind: raw.kind, multiple: raw.multiple === true };
}

/** Accept any byte view the structured clone algorithm can hand us. */
function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("save: bytes must be an ArrayBuffer or a typed array");
}

/** Validate a save request; the file name itself is checked by paths.safeFileName. */
function parseSaveRequest(raw) {
  if (!isRecord(raw)) throw new TypeError("save: expected an object");
  if (typeof raw.name !== "string" || raw.name.length === 0) {
    throw new TypeError("save: name is required");
  }
  const bytes = toBytes(raw.bytes);
  if (bytes.byteLength === 0) throw new TypeError("save: refusing to write an empty file");
  if (bytes.byteLength > MAX_SAVE_BYTES) throw new TypeError("save: file is too large");
  let directory = null;
  if (raw.directory !== undefined && raw.directory !== null) {
    if (typeof raw.directory !== "string" || raw.directory.length === 0) {
      throw new TypeError("save: directory must be an output folder handle");
    }
    directory = raw.directory;
  }
  return { name: raw.name, bytes, directory };
}

module.exports = {
  CHANNELS,
  OPEN_KINDS,
  MAX_SAVE_BYTES,
  OPEN_LIMITS,
  isRecord,
  parseOpenRequest,
  parseSaveRequest,
};
