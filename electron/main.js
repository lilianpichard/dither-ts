// Electron main process: window lifecycle, the renderer lockdown, the file
// bridge and the update feed. No business logic lives here; the app in dist/
// does the work.
const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Dev runs load straight from source, so the packaged executable's icon is not
// there to fall back on. Point the window (and the macOS dock) at the source
// icon when it exists; in a packaged build the OS-level icon takes over.
function appIconPath() {
  const candidate = path.join(__dirname, "build", "icon.png");
  return fs.existsSync(candidate) ? candidate : undefined;
}

const { createBridge } = require("./lib/bridge");
const { hardenSession, restrictWebContents, webPreferences } = require("./lib/security");
const { createUpdater } = require("./lib/updater");

const APP_DOCUMENT = path.join(__dirname, "dist", "index.html");
// The navigation policy compares urls, so it is given the document as one.
const APP_DOCUMENT_URL = pathToFileURL(APP_DOCUMENT).href;
const PRELOAD = path.join(__dirname, "preload.js");
let mainWindow = null;

// The bridge trusts this window and nothing else, and hangs its dialogs off it.
function activeWindow() {
  return mainWindow;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    icon: appIconPath(),
    webPreferences: webPreferences(PRELOAD),
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadFile(APP_DOCUMENT);
}

/**
 * electron-updater only works on a packaged, signed build. A dev run has no
 * app-update.yml, so it gets the channel with an answer that says so. The
 * channel is registered either way: the preload exposes checkUpdate whatever
 * the build is, and calling a channel with no handler comes back as an ipc
 * error the renderer can only show raw.
 */
function updaterFor() {
  if (!app.isPackaged) {
    return createUpdater({ autoUpdater: null, app, getWindow: activeWindow }).register(ipcMain);
  }
  try {
    // eslint-disable-next-line global-require
    const { autoUpdater } = require("electron-updater");
    return createUpdater({ autoUpdater, app, getWindow: activeWindow }).register(ipcMain);
  } catch (error) {
    console.warn(`[updater] unavailable: ${error.message}`);
    return createUpdater({
      autoUpdater: null,
      app,
      getWindow: activeWindow,
      reason: error.message,
    }).register(ipcMain);
  }
}

app.enableSandbox();

// One attachment covers every window, including any electron opens for itself.
app.on("web-contents-created", (_event, contents) =>
  restrictWebContents(contents, APP_DOCUMENT_URL),
);

app.whenReady().then(() => {
  hardenSession(session.defaultSession);
  createBridge({ dialog, getWindow: activeWindow, homeDir: app.getPath("downloads") }).register(
    ipcMain,
  );
  updaterFor();
  // The packaged binary carries its own icon; in dev, restore the project icon
  // on the macOS dock instead of the Electron default.
  if (process.platform === "darwin" && app.dock) {
    const icon = appIconPath();
    if (icon) app.dock.setIcon(icon);
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
