// Reading user-picked files. The app works with `File` objects everywhere, so
// the bridge's bytes are wrapped back into one; without the bridge the caller
// keeps using its own <input type="file">.

import { desktopBridge, type DesktopFile } from "./bridge";

/** As the shell understands it: "media" is the picker that offers both. */
export type MediaKind = "image" | "video" | "media";

/** The bridge's bytes go straight in: a Blob part reads the view, not its buffer. */
function toFile(file: DesktopFile): File {
  return new File([file.bytes], file.name, { type: file.type });
}

/**
 * Open a native dialog. Returns null when there is no bridge (the caller should
 * fall back to a file input), an empty list when the user cancelled, and the
 * chosen files otherwise.
 */
export async function openFiles(
  kind: MediaKind,
  options: { multiple?: boolean } = {},
): Promise<File[] | null> {
  const bridge = desktopBridge();
  if (!bridge) return null;
  const result = await bridge.open({ kind, multiple: options.multiple === true });
  if (result.canceled) return [];
  return result.files.map(toFile);
}

/** Open one image, or null when cancelled or unavailable. */
export async function openImage(): Promise<File | null> {
  const files = await openFiles("image");
  return files?.[0] ?? null;
}

/**
 * Open one file of either kind, or null when cancelled or unavailable. This is
 * the single picker the shared dropzone and the empty state both use, so the
 * user never has to know which panel a video goes in.
 */
export async function openMedia(): Promise<File | null> {
  const files = await openFiles("media");
  return files?.[0] ?? null;
}

/** The message to show when the shell could not read what was picked. */
export function openFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
