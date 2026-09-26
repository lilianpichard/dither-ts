// Typed view of the Electron preload bridge. The same app also runs as a plain
// web page, so the bridge is always optional: callers ask for it and fall back
// to the browser's own file input and download flow when it is not there.

/** Versions reported by the shell, for diagnostics only. */
export interface DesktopVersions {
  node: string;
  chrome: string;
  electron: string;
}

/** One file the main process read, with the media type it decided on. */
export interface DesktopFile {
  name: string;
  type: string;
  /** Structured clone always hands over a plain buffer, so a view is a valid part. */
  bytes: Uint8Array<ArrayBuffer>;
}

export interface OpenRequest {
  kind: "image" | "video";
  multiple?: boolean;
}

export interface OpenResult {
  canceled: boolean;
  files: DesktopFile[];
}

export interface SaveRequest {
  name: string;
  bytes: Uint8Array;
  /** Handle from pickDirectory, or null to go through a save dialog. */
  directory?: string | null;
}

export interface SaveResult {
  canceled: boolean;
  path: string | null;
}

export interface DirectoryResult {
  canceled: boolean;
  handle: string | null;
}

/** The exposed bridge, in the shape the renderer is allowed to call. */
export interface DesktopBridge {
  versions: DesktopVersions;
  open(request: OpenRequest): Promise<OpenResult>;
  pickDirectory(): Promise<DirectoryResult>;
  save(request: SaveRequest): Promise<SaveResult>;
}

declare global {
  interface Window {
    ditherDesktop?: unknown;
  }
}

/** A candidate is only the bridge if every channel is callable. */
function isBridge(value: unknown): value is DesktopBridge {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DesktopBridge>;
  return (
    typeof candidate.open === "function" &&
    typeof candidate.pickDirectory === "function" &&
    typeof candidate.save === "function"
  );
}

/** The bridge when the app is running in the desktop shell, otherwise null. */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const exposed = window.ditherDesktop;
  return isBridge(exposed) ? exposed : null;
}

/** True when native file dialogs are available, so inputs can be replaced. */
export function canOpenFiles(): boolean {
  return desktopBridge() !== null;
}
