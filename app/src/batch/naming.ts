// Output naming for a batch run. Pure string work: the panel and the sink both
// need the same name for the same source file, and a run must not overwrite
// itself when a folder holds `a.png`, `a.jpg` and `a.webp`.
// Every name produced here has to be one the desktop shell will actually write,
// so the device names it refuses are handled here too.

export const OUTPUT_SUFFIX = ".dither.png";

/** Characters no common filesystem accepts, replaced so a save cannot fail. */
const ILLEGAL = new Set('<>:"/\\|?*');

/**
 * Device names windows refuses whatever follows the first dot: con.tar.gz is
 * still con. Refused on every platform, so a run behaves the same everywhere.
 * Kept identical to electron/lib/paths.js, which test/paths.test.js compares.
 */
const RESERVED_DEVICES = [
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
];

const RESERVED = new RegExp(`^(${RESERVED_DEVICES.join("|")})(?:\\.|$)`, "i");

/** Control bytes are refused by the shell too, so they never reach a name. */
function isControl(code: number): boolean {
  return code < 0x20 || code === 0x7f;
}

/**
 * Long enough for the suffix and a -9999 collision fallback inside the 255
 * characters every common filesystem accepts, which the shell also enforces.
 */
const MAX_STEM = 255 - ".dither.png".length - "-9999".length;

function sanitizeStem(stem: string): string {
  let clean = "";
  for (const char of stem) {
    clean += ILLEGAL.has(char) || isControl(char.codePointAt(0) ?? 0) ? "_" : char;
  }
  clean = clean.slice(0, MAX_STEM).replace(/[. ]+$/, "");
  return clean.length > 0 ? clean : "image";
}

/** A leading underscore keeps a device name recognisable and writable. */
function escapeDeviceName(name: string): string {
  return RESERVED.test(name) ? `_${name}` : name;
}

/**
 * `photo.png` → `photo.dither.png`. A leading dot is part of the name, not an
 * extension, so `.gitignore` keeps its whole stem. `con.png` → `_con.dither.png`,
 * because the shell refuses the device name outright.
 */
export function outputName(name: string): string {
  const trimmed = name.trim() || "image";
  const dot = trimmed.lastIndexOf(".");
  const stem = sanitizeStem(dot > 0 ? trimmed.slice(0, dot) : trimmed);
  return escapeDeviceName(`${stem}${OUTPUT_SUFFIX}`);
}

/** The first free `name`, or `stem-2`, `stem-3`… once `name` is taken. */
export function uniqueOutputName(name: string, used: ReadonlySet<string>): string {
  // Escaped up front, so the numbered fallbacks below stay writable too.
  const safe = escapeDeviceName(name);
  if (!used.has(safe)) return safe;
  const stem = safe.slice(0, safe.length - OUTPUT_SUFFIX.length) || "image";
  for (let attempt = 2; attempt < 10_000; attempt++) {
    const candidate = `${stem}-${attempt}${OUTPUT_SUFFIX}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${stem}-${used.size}${OUTPUT_SUFFIX}`;
}
