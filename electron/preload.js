// Preload bridge: the only surface the renderer may touch. Three functions and
// the version triple, with no node, no fs and no raw ipcRenderer. The channel
// names are spelled out here rather than imported, because a sandboxed preload
// cannot require a sibling file; `test/contract.test.js` checks them against
// lib/contract.js so the two cannot drift apart.
const { contextBridge, ipcRenderer } = require("electron");

const OPEN_CHANNEL = "dither:open";
const PICK_DIRECTORY_CHANNEL = "dither:pick-directory";
const SAVE_CHANNEL = "dither:save";

contextBridge.exposeInMainWorld("ditherDesktop", {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  /** Ask the main process to show an open dialog and read what was chosen. */
  open: (request) => ipcRenderer.invoke(OPEN_CHANNEL, request),
  /** Ask for an output folder; the reply is a handle, not a path. */
  pickDirectory: () => ipcRenderer.invoke(PICK_DIRECTORY_CHANNEL),
  /** Write exported bytes, either to the chosen folder or to a save dialog. */
  save: (request) => ipcRenderer.invoke(SAVE_CHANNEL, request),
});
