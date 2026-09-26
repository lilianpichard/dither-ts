// The file-dialog half of the bridge: open media through a native dialog, write
// exported bytes to a place the user picked. `dialog` and the window lookup are
// the only injected dependencies, so every handler can be driven from a test
// against a real temp directory.

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { CHANNELS, OPEN_LIMITS, parseOpenRequest, parseSaveRequest } = require("./contract");
const paths = require("./paths");

/** The window a request must come from, and the parent every dialog hangs off. */
function trustedWindow(event, getWindow) {
  const win = typeof getWindow === "function" ? getWindow() : null;
  if (!event || !event.sender || !win || event.sender !== win.webContents) {
    throw new Error("bridge: refusing a request from an unknown window");
  }
  const frame = event.senderFrame;
  if (frame && frame.parent) throw new Error("bridge: refusing a request from a subframe");
  return win;
}

/** Write through a temp name so a failed run never leaves a truncated file. */
async function writeAtomic(target, bytes) {
  const staging = `${target}.dither-partial`;
  try {
    await fs.writeFile(staging, bytes);
    await fs.rename(staging, target);
  } catch (error) {
    await fs.rm(staging, { force: true }).catch(() => {});
    throw error;
  }
}

function megabytes(bytes) {
  return Math.round(bytes / (1024 * 1024));
}

/** What a chosen path is, before a single byte of it is read. */
async function inspectMedia(filePath, kind) {
  const resolved = path.resolve(filePath);
  const name = path.basename(resolved);
  const type = paths.mediaTypeFor(name, kind);
  if (!type) throw new Error(`unsupported ${kind}: ${name}`);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error(`not a file: ${name}`);
  if (stat.size === 0) throw new Error(`file is empty: ${name}`);
  return { name, type, source: resolved, size: stat.size };
}

/** Refuse a pick that is over-numerous or over-sized, naming what is at fault. */
function checkOpenLimits(picked, kind, multiple, limits) {
  const maxFiles = multiple ? limits.maxFiles : 1;
  if (picked.length > maxFiles) {
    throw new Error(
      multiple ? `pick no more than ${maxFiles} files at a time` : "pick one file at a time",
    );
  }
  const perFile = kind === "video" ? limits.maxVideoBytes : limits.maxImageBytes;
  let total = 0;
  for (const file of picked) {
    if (file.size > perFile) {
      throw new Error(`${file.name} is over the ${megabytes(perFile)} MB limit for a ${kind}`);
    }
    total += file.size;
  }
  if (total > limits.maxTotalBytes) {
    throw new Error(`that selection is over the ${megabytes(limits.maxTotalBytes)} MB limit`);
  }
}

function createBridge({ dialog, getWindow, homeDir, limits }) {
  // The one output folder the renderer may write into, by handle not by path.
  let folder = null;
  // Where the last save went, so the next dialog opens in the same place.
  let lastDir = null;
  const caps = { ...OPEN_LIMITS, ...limits };

  async function open(event, raw) {
    const win = trustedWindow(event, getWindow);
    const { kind, multiple } = parseOpenRequest(raw);
    const picked = await dialog.showOpenDialog(win, {
      title: kind === "video" ? "Open a video" : multiple ? "Open images" : "Open an image",
      properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: paths.openFilters(kind),
    });
    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true, files: [] };
    // Measure everything first, so a pick that is too big costs no reads at all.
    const measured = [];
    for (const filePath of picked.filePaths) measured.push(await inspectMedia(filePath, kind));
    checkOpenLimits(measured, kind, multiple, caps);
    const files = [];
    for (const file of measured) {
      files.push({ name: file.name, type: file.type, bytes: await fs.readFile(file.source) });
    }
    return { canceled: false, files };
  }

  async function pickDirectory(event) {
    const win = trustedWindow(event, getWindow);
    const picked = await dialog.showOpenDialog(win, {
      title: "Choose an output folder",
      properties: ["openDirectory", "createDirectory"],
    });
    const chosen = picked.filePaths[0];
    if (picked.canceled || !chosen) return { canceled: true, handle: null };
    // realpath first: the folder we remember is the one we later write into.
    const real = await fs.realpath(chosen);
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) throw new Error("not a folder");
    folder = { handle: crypto.randomUUID(), path: real };
    lastDir = real;
    return { canceled: false, handle: folder.handle };
  }

  async function saveToFolder(name, bytes, handle) {
    if (!folder || folder.handle !== handle) throw new Error("unknown output folder");
    const target = paths.resolveWithin(folder.path, name);
    await writeAtomic(target, bytes);
    return { canceled: false, path: null };
  }

  async function saveViaDialog(win, name, bytes) {
    const ext = paths.extensionOf(name);
    const fileName = ext ? name : `${name}.${paths.saveExtensionFor(name)}`;
    const chosen = await dialog.showSaveDialog(win, {
      title: "Save dithered output",
      defaultPath: path.join(lastDir ?? homeDir, fileName),
      filters: paths.SAVE_FILTERS,
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (chosen.canceled || !chosen.filePath) return { canceled: true, path: null };
    const target = path.resolve(chosen.filePath);
    const stat = await fs.stat(target).catch(() => null);
    if (stat && stat.isDirectory()) throw new Error("that path is a folder");
    lastDir = path.dirname(target);
    await writeAtomic(target, bytes);
    return { canceled: false, path: target };
  }

  async function save(event, raw) {
    const win = trustedWindow(event, getWindow);
    const { name, bytes, directory } = parseSaveRequest(raw);
    const fileName = paths.safeFileName(name);
    return directory === null
      ? saveViaDialog(win, fileName, bytes)
      : saveToFolder(fileName, bytes, directory);
  }

  const handlers = {
    [CHANNELS.open]: open,
    [CHANNELS.pickDirectory]: pickDirectory,
    [CHANNELS.save]: save,
  };

  return {
    handlers,
    /** Wire the three channels, and nothing else, onto ipcMain. */
    register(ipcMain) {
      for (const channel of Object.values(CHANNELS)) ipcMain.handle(channel, handlers[channel]);
      return Object.values(CHANNELS);
    },
  };
}

module.exports = { createBridge, trustedWindow, checkOpenLimits, writeAtomic };
