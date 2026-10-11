/** The writers the export panel offers, and nothing more. */
export type ExportFormat = "png" | "jpg" | "svg" | "txt";

/**
 * The options a format actually has. Showing a control that changes nothing is
 * worse than not showing it: the user edits it and the output is identical.
 */
export type ExportOptions = "none" | "vector" | "text";

export interface ExportFormatDef {
  id: ExportFormat;
  /** Written with its own extension, so it reads the same in every language. */
  label: string;
  options: ExportOptions;
  /** Catalogue key for one line on what this writer does that others do not. */
  note: `export.note${Capitalize<ExportFormat>}`;
}

export const FORMATS: readonly ExportFormatDef[] = [
  { id: "png", label: "PNG", options: "none", note: "export.notePng" },
  { id: "jpg", label: "JPG", options: "none", note: "export.noteJpg" },
  { id: "svg", label: "SVG", options: "vector", note: "export.noteSvg" },
  { id: "txt", label: "TXT", options: "text", note: "export.noteTxt" },
];

export const DEFAULT_FORMAT: ExportFormat = FORMATS[0].id;

export interface ExportOutline {
  filename: string;
  mime: string;
  /** Only set for a lossy writer. */
  quality?: number;
  /** True when the writer has no alpha and needs a backing fill. */
  opaque: boolean;
}

/** What the chosen writer will produce, so the panel can say it before it runs. */
export function exportOutline(format: ExportFormat): ExportOutline {
  switch (format) {
    case "jpg":
      return { filename: "dither.jpg", mime: "image/jpeg", quality: 0.92, opaque: true };
    case "svg":
      return { filename: "dither.svg", mime: "image/svg+xml", opaque: false };
    case "txt":
      return { filename: "dither.txt", mime: "text/plain", opaque: false };
    default:
      return { filename: "dither.png", mime: "image/png", opaque: false };
  }
}

/** Which option group the panel draws for a format. */
export function optionsFor(format: ExportFormat): ExportOptions {
  return FORMATS.find((entry) => entry.id === format)?.options ?? "none";
}
