// Where a batch run puts its files. A user-picked folder is used when the File
// System Access API or the desktop shell can provide one; otherwise every file
// goes through the browser's download flow, which is the only option browsers
// still offer.

import { desktopBridge } from "../desktop/bridge";
import { pickOutputFolder, saveBlob } from "../desktop/save";
import { downloadUrl } from "../lib/download";

/** The one global lib.dom does not declare, with the shape we rely on. */
type DirectoryPicker = (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandle>;

/** Minimal writable-directory surface; permission APIs are Chromium-only too. */
export interface DirectoryHandle {
  kind: "directory";
  name: string;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{
    createWritable(): Promise<{
      write(blob: Blob): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
}

/** A place to put one finished file. */
export interface OutputSink {
  /** Shown to the user so they know where output is going. */
  label: string;
  write(name: string, blob: Blob): Promise<void>;
}

function picker(): DirectoryPicker | null {
  const host = globalThis as { showDirectoryPicker?: DirectoryPicker };
  return typeof host.showDirectoryPicker === "function" ? host.showDirectoryPicker : null;
}

/** True when the browser can write into a directory the user picks. */
export function supportsDirectoryPicker(): boolean {
  return picker() !== null;
}

/**
 * Ask for an output directory. A cancelled picker is not an error: it returns
 * null so the caller keeps the per-file fallback.
 */
async function pickHandle(): Promise<DirectoryHandle | null> {
  const show = picker();
  if (!show) return null;
  try {
    return (await show({ mode: "readwrite" })) as DirectoryHandle;
  } catch {
    // AbortError on cancel, SecurityError without a user gesture: fall back.
    return null;
  }
}

async function ensureWritable(dir: DirectoryHandle): Promise<void> {
  if (!dir.queryPermission || !dir.requestPermission) return;
  const options = { mode: "readwrite" as const };
  if ((await dir.queryPermission(options)) === "granted") return;
  if ((await dir.requestPermission(options)) !== "granted") {
    throw new Error(`no write permission for ${dir.name}`);
  }
}

/** Writes into a user-picked directory, overwriting any earlier run. */
export function directorySink(dir: DirectoryHandle): OutputSink {
  return {
    label: dir.name,
    async write(name, blob) {
      await ensureWritable(dir);
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(blob);
      } finally {
        // A half-written file is worse than none, so always close it out.
        await writable.close();
      }
    },
  };
}

/** Browser download flow: one save per file, with no folder of our choosing. */
export function downloadSink(): OutputSink {
  return {
    label: "Downloads",
    async write(name, blob) {
      downloadUrl(URL.createObjectURL(blob), name);
    },
  };
}

/** The desktop shell's own save dialog, one file per confirmation. */
function nativeSink(): OutputSink | null {
  if (!desktopBridge()) return null;
  return {
    label: "your chosen file",
    async write(name, blob) {
      await saveBlob(name, blob);
    },
  };
}

/** Writes into a folder the shell handed us, addressed by an opaque handle. */
export function desktopSink(handle: string): OutputSink {
  return {
    label: "your chosen folder",
    async write(name, blob) {
      await saveBlob(name, blob, { directory: handle });
    },
  };
}

/** True when the user can be asked for an output folder at all. */
export function canPickDirectory(): boolean {
  return supportsDirectoryPicker() || desktopBridge() !== null;
}

/** The sink a run uses when no folder was chosen: native dialog or downloads. */
export function defaultSink(): OutputSink {
  return nativeSink() ?? downloadSink();
}

/**
 * Ask for an output folder, preferring the browser API and falling back to the
 * desktop shell. A cancelled choice returns null, not an error.
 */
export async function pickDirectory(): Promise<OutputSink | null> {
  const handle = await pickHandle();
  if (handle) return directorySink(handle);
  const folder = await pickOutputFolder();
  return folder ? desktopSink(folder) : null;
}
