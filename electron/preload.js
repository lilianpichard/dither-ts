// Preload bridge: the only surface the renderer may touch.
// Versions today; native file dialogs and FFmpeg hooks plug in here.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("ditherDesktop", {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
