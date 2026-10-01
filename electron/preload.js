// Preload bridge: the only surface the renderer may touch. Four functions and
// the version triple, with no node, no fs and no raw ipcRenderer. The channel
// names are spelled out here rather than imported, because a sandboxed preload
// cannot require a sibling file; `test/contract.test.js` checks them against
// lib/contract.js so the two cannot drift apart.
const { contextBridge, ipcRenderer } = require("electron");

const OPEN_CHANNEL = "dither:open";
const PICK_DIRECTORY_CHANNEL = "dither:pick-directory";
const SAVE_CHANNEL = "dither:save";
const UPDATE_CHANNEL = "dither:update";
const UPDATE_EVENT_CHANNEL = "dither:update-event";

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
  /** Ask whether a newer release exists. Progress arrives on onUpdate. */
  checkUpdate: () => ipcRenderer.invoke(UPDATE_CHANNEL),
  /** Subscribe to update status. Returns an unsubscribe function. */
  onUpdate: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on(UPDATE_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(UPDATE_EVENT_CHANNEL, handler);
  },
});
