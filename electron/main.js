// Electron main process: window lifecycle, the renderer lockdown, and the file
// bridge. No business logic lives here; the app in dist/ does the work.
const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { createBridge } = require("./lib/bridge");
const { hardenSession, restrictWebContents, webPreferences } = require("./lib/security");

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
    webPreferences: webPreferences(PRELOAD),
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadFile(APP_DOCUMENT);
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
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
