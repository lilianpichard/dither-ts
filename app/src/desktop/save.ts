// Writing exported bytes. With the desktop shell the file goes where the user
// says; in a browser it is still the download flow, which is all we have there.

import { downloadUrl } from "../lib/download";
import { desktopBridge } from "./bridge";

/** Whether a save actually happened; a cancelled dialog is not a failure. */
export type SaveOutcome = "saved" | "cancelled";

export interface SaveOptions {
  /** Handle from pickOutputFolder, or null/undefined for a save dialog. */
  directory?: string | null;
}

/** Save a blob, natively when the shell is there and by download when it is not. */
export async function saveBlob(
  name: string,
  blob: Blob,
  options: SaveOptions = {},
): Promise<SaveOutcome> {
  const bridge = desktopBridge();
  if (!bridge) {
    downloadUrl(URL.createObjectURL(blob), name);
    return "saved";
  }
  const result = await bridge.save({
    name,
    bytes: new Uint8Array(await blob.arrayBuffer()),
    directory: options.directory ?? null,
  });
  return result.canceled ? "cancelled" : "saved";
}

/** Save generated text, such as the SVG and TXT exports. */
export function saveText(text: string, name: string, type: string): Promise<SaveOutcome> {
  return saveBlob(name, new Blob([text], { type }));
}

/** Ask the shell for an output folder; null when cancelled or unavailable. */
export async function pickOutputFolder(): Promise<string | null> {
  const bridge = desktopBridge();
  if (!bridge) return null;
  const result = await bridge.pickDirectory();
  return result.canceled ? null : result.handle;
}
