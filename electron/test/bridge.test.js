// The bridge handlers, driven against a real temp directory and a stub dialog.
// No GUI, no electron: the dialog and the window are all that stand in for the
// user, and the window is also what the trust check and the dialogs hang off.

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test, describe, before, after, beforeEach } = require("node:test");

const { CHANNELS, OPEN_LIMITS } = require("../lib/contract");
const { createBridge } = require("../lib/bridge");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A stand-in for electron's dialog, scripted one call at a time. */
function stubDialog() {
  const calls = [];
  let open = { canceled: true, filePaths: [] };
  let save = { canceled: true, filePath: undefined };
  return {
    calls,
    queueOpen(result) {
      open = result;
    },
    queueSave(result) {
      save = result;
    },
    async showOpenDialog(parent, options) {
      calls.push({ kind: "open", parent, options });
      return open;
    },
    async showSaveDialog(parent, options) {
      calls.push({ kind: "save", parent, options });
      return save;
    },
  };
}

/** The event ipcMain would deliver, from the one window we opened. */
function trustedEvent(sender) {
  return { sender, senderFrame: { parent: null } };
}

function harness(options = {}) {
  const dialog = stubDialog();
  const sender = { id: 1 };
  const win = { webContents: sender };
  const bridge = createBridge({
    dialog,
    getWindow: () => win,
    homeDir: options.homeDir ?? os.tmpdir(),
    limits: options.limits,
  });
  return { dialog, sender, win, bridge, event: trustedEvent(sender) };
}

describe("bridge open", () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dither-open-"));
    await fs.writeFile(path.join(dir, "shot.PNG"), PNG);
    await fs.writeFile(path.join(dir, "clip.mp4"), Buffer.from([0, 0, 0, 0x18]));
    await fs.writeFile(path.join(dir, "notes.txt"), "plain");
    await fs.writeFile(path.join(dir, "blank.png"), Buffer.alloc(0));
    await fs.mkdir(path.join(dir, "folder.png"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("reads a chosen image and reports it as an image", async () => {
    const { bridge, dialog, event } = harness();
    dialog.queueOpen({ canceled: false, filePaths: [path.join(dir, "shot.PNG")] });
    const result = await bridge.handlers[CHANNELS.open](event, { kind: "image" });
    assert.equal(result.canceled, false);
    assert.equal(result.files.length, 1);
    assert.deepEqual(result.files[0].name, "shot.PNG");
    assert.equal(result.files[0].type, "image/png");
    assert.deepEqual([...result.files[0].bytes], [...PNG]);
  });

  test("returns only a base name, never the path it was read from", async () => {
    const { bridge, dialog, event } = harness();
    dialog.queueOpen({ canceled: false, filePaths: [path.join(dir, "shot.PNG")] });
    const result = await bridge.handlers[CHANNELS.open](event, { kind: "image" });
    assert.ok(
      !JSON.stringify(result, (key, value) => (key === "bytes" ? undefined : value)).includes(dir),
    );
  });

  test("asks for several files only when asked for several", async () => {
    const single = harness();
    single.dialog.queueOpen({ canceled: false, filePaths: [path.join(dir, "shot.PNG")] });
    await single.bridge.handlers[CHANNELS.open](single.event, { kind: "image" });
    assert.deepEqual(single.dialog.calls[0].options.properties, ["openFile"]);

    const many = harness();
    many.dialog.queueOpen({
      canceled: false,
      filePaths: [path.join(dir, "shot.PNG"), path.join(dir, "shot.PNG")],
    });
    const result = await many.bridge.handlers[CHANNELS.open](many.event, {
      kind: "image",
      multiple: true,
    });
    assert.deepEqual(many.dialog.calls[0].options.properties, ["openFile", "multiSelections"]);
    assert.equal(result.files.length, 2);
  });

  test("filters the dialog by the kind that was asked for", async () => {
    const image = harness();
    image.dialog.queueOpen({ canceled: false, filePaths: [path.join(dir, "shot.PNG")] });
    await image.bridge.handlers[CHANNELS.open](image.event, { kind: "image" });
    assert.deepEqual(image.dialog.calls[0].options.filters, [
      {
        name: "Images",
        extensions: [
          "png",
          "jpg",
          "jpeg",
          "webp",
          "gif",
          "bmp",
          "avif",
          "svg",
          "tif",
          "tiff",
          "ico",
        ],
      },
    ]);

    const video = harness();
    video.dialog.queueOpen({ canceled: false, filePaths: [path.join(dir, "clip.mp4")] });
    const result = await video.bridge.handlers[CHANNELS.open](video.event, { kind: "video" });
    assert.equal(video.dialog.calls[0].options.filters[0].name, "Videos");
    assert.equal(result.files[0].type, "video/mp4");
  });

  test("treats a cancelled dialog as an empty answer, not a failure", async () => {
    const { bridge, event } = harness();
    assert.deepEqual(await bridge.handlers[CHANNELS.open](event, { kind: "image" }), {
      canceled: true,
      files: [],
    });
  });

  test("refuses a file the dialog should never have offered", async () => {
    const { bridge, dialog, event } = harness();
    dialog.queueOpen({ canceled: false, filePaths: [path.join(dir, "notes.txt")] });
    await assert.rejects(
      bridge.handlers[CHANNELS.open](event, { kind: "image" }),
      /unsupported image/,
    );
  });

  test("refuses a directory that happens to end in an image extension", async () => {
    const { bridge, dialog, event } = harness();
    dialog.queueOpen({ canceled: false, filePaths: [path.join(dir, "folder.png")] });
    await assert.rejects(bridge.handlers[CHANNELS.open](event, { kind: "image" }), /not a file/);
  });

  test("refuses a path that is not there at all", async () => {
    const { bridge, dialog, event } = harness();
    dialog.queueOpen({ canceled: false, filePaths: [path.join(dir, "ghost.png")] });
    await assert.rejects(bridge.handlers[CHANNELS.open](event, { kind: "image" }));
  });

  test("refuses a request that did not come from the app window", async () => {
    const { bridge, dialog, event } = harness();
    dialog.queueOpen({ canceled: false, filePaths: [path.join(dir, "shot.PNG")] });
    await assert.rejects(
      bridge.handlers[CHANNELS.open]({ sender: { id: 2 }, senderFrame: null }, { kind: "image" }),
      /unknown window/,
    );
    // Nothing reached the dialog, so no file could have been read.
    assert.equal(dialog.calls.length, 0);
    // The app's own window still works.
    assert.equal((await bridge.handlers[CHANNELS.open](event, { kind: "image" })).canceled, false);
  });

  test("refuses a request once the window is gone", async () => {
    const dialog = stubDialog();
    const bridge = createBridge({ dialog, getWindow: () => null, homeDir: os.tmpdir() });
    await assert.rejects(
      bridge.handlers[CHANNELS.open](trustedEvent({ id: 1 }), { kind: "image" }),
      /unknown window/,
    );
    assert.equal(dialog.calls.length, 0);
  });

  test("refuses a request from a subframe", async () => {
    const { bridge, event } = harness();
    await assert.rejects(
      bridge.handlers[CHANNELS.open]({ ...event, senderFrame: { parent: {} } }, { kind: "image" }),
      /subframe/,
    );
  });

  test("refuses a malformed request before it reaches the dialog", async () => {
    const { bridge, dialog, event } = harness();
    for (const bad of [null, "image", { kind: "audio" }]) {
      await assert.rejects(bridge.handlers[CHANNELS.open](event, bad), TypeError);
    }
    assert.equal(dialog.calls.length, 0);
  });

  test("refuses an empty file", async () => {
    const { bridge, dialog, event } = harness();
    dialog.queueOpen({ canceled: false, filePaths: [path.join(dir, "blank.png")] });
    await assert.rejects(
      bridge.handlers[CHANNELS.open](event, { kind: "image" }),
      /file is empty: blank\.png/,
    );
  });

  test("hangs every dialog off the window the request came from", async () => {
    const { bridge, dialog, win, event } = harness();
    dialog.queueOpen({ canceled: false, filePaths: [path.join(dir, "shot.PNG")] });
    await bridge.handlers[CHANNELS.open](event, { kind: "image" });
    assert.equal(dialog.calls[0].parent, win);
  });
});

describe("bridge open limits", () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dither-limits-"));
  });

  /** A picture of a given size, so the caps can be tested without big files. */
  async function image(name, bytes) {
    const file = path.join(dir, name);
    await fs.writeFile(file, Buffer.alloc(bytes, 1));
    return file;
  }

  test("caps the size of one image, naming the file at fault", async () => {
    const big = await image("huge.png", 32);
    const { bridge, dialog, event } = harness({ limits: { maxImageBytes: 16 } });
    dialog.queueOpen({ canceled: false, filePaths: [big] });
    await assert.rejects(
      bridge.handlers[CHANNELS.open](event, { kind: "image" }),
      /huge\.png is over the 0 MB limit/,
    );
  });

  test("lets an image through when it is within the cap", async () => {
    const ok = await image("ok.png", 16);
    const { bridge, dialog, event } = harness({ limits: { maxImageBytes: 16 } });
    dialog.queueOpen({ canceled: false, filePaths: [ok] });
    assert.equal((await bridge.handlers[CHANNELS.open](event, { kind: "image" })).files.length, 1);
  });

  test("caps the selection as a whole, not just each file", async () => {
    const first = await image("a.png", 12);
    const second = await image("b.png", 12);
    const { bridge, dialog, event } = harness({
      limits: { maxImageBytes: 1024, maxTotalBytes: 16 },
    });
    dialog.queueOpen({ canceled: false, filePaths: [first, second] });
    await assert.rejects(
      bridge.handlers[CHANNELS.open](event, { kind: "image", multiple: true }),
      /selection is over the 0 MB limit/,
    );
  });

  test("caps a video by its own, larger, limit", async () => {
    const clip = path.join(dir, "clip.mp4");
    await fs.writeFile(clip, Buffer.alloc(32, 1));
    const { bridge, dialog, event } = harness({
      limits: { maxVideoBytes: 16, maxImageBytes: 1024 },
    });
    dialog.queueOpen({ canceled: false, filePaths: [clip] });
    await assert.rejects(
      bridge.handlers[CHANNELS.open](event, { kind: "video" }),
      /clip\.mp4 is over the 0 MB limit for a video/,
    );
  });

  test("caps how many files one selection may carry", async () => {
    const picks = await Promise.all([image("a.png", 4), image("b.png", 4), image("c.png", 4)]);
    const { bridge, dialog, event } = harness({ limits: { maxFiles: 2 } });
    dialog.queueOpen({ canceled: false, filePaths: picks });
    await assert.rejects(
      bridge.handlers[CHANNELS.open](event, { kind: "image", multiple: true }),
      /pick no more than 2 files at a time/,
    );
  });

  test("takes only one file when one was asked for", async () => {
    const picks = await Promise.all([image("a.png", 4), image("b.png", 4)]);
    const { bridge, dialog, event } = harness();
    dialog.queueOpen({ canceled: false, filePaths: picks });
    await assert.rejects(
      bridge.handlers[CHANNELS.open](event, { kind: "image" }),
      /pick one file at a time/,
    );
  });

  test("checks every file before reading any of them", async () => {
    const good = await image("a.png", 4);
    const huge = await image("b.png", 4096);
    const { bridge, dialog, event } = harness({ limits: { maxImageBytes: 16 } });
    dialog.queueOpen({ canceled: false, filePaths: [good, huge] });
    // The first file is fine, so a read-then-check order would have succeeded.
    await assert.rejects(
      bridge.handlers[CHANNELS.open](event, { kind: "image", multiple: true }),
      /b\.png is over/,
    );
  });

  test("ships caps that are ordered, bounded and not empty", () => {
    assert.ok(OPEN_LIMITS.maxFiles >= 1);
    assert.ok(OPEN_LIMITS.maxImageBytes > 0);
    assert.ok(OPEN_LIMITS.maxVideoBytes >= OPEN_LIMITS.maxImageBytes);
    assert.ok(OPEN_LIMITS.maxTotalBytes >= OPEN_LIMITS.maxVideoBytes);
    for (const value of Object.values(OPEN_LIMITS)) {
      assert.ok(Number.isSafeInteger(value) && value < Number.MAX_SAFE_INTEGER);
    }
  });
});

describe("bridge output folder", () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dither-folder-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("hands back a handle, not the path", async () => {
    const { bridge, dialog, event } = harness();
    dialog.queueOpen({ canceled: false, filePaths: [dir] });
    const result = await bridge.handlers[CHANNELS.pickDirectory](event);
    assert.equal(result.canceled, false);
    assert.match(result.handle, /^[0-9a-f-]{36}$/);
    assert.ok(!JSON.stringify(result).includes(dir));
  });

  test("reports a cancelled folder as no handle", async () => {
    const { bridge, event } = harness();
    assert.deepEqual(await bridge.handlers[CHANNELS.pickDirectory](event), {
      canceled: true,
      handle: null,
    });
  });

  test("refuses something that is not a folder", async () => {
    const { bridge, dialog, event } = harness();
    const file = path.join(dir, "note.txt");
    await fs.writeFile(file, "x");
    dialog.queueOpen({ canceled: false, filePaths: [file] });
    await assert.rejects(bridge.handlers[CHANNELS.pickDirectory](event), /not a folder/);
  });

  test("remembers a symlinked folder by its real path", async () => {
    const real = await fs.mkdtemp(path.join(os.tmpdir(), "dither-real-"));
    const link = path.join(dir, "link");
    await fs.symlink(real, link);
    const { bridge, dialog, event } = harness();
    dialog.queueOpen({ canceled: false, filePaths: [link] });
    const { handle } = await bridge.handlers[CHANNELS.pickDirectory](event);
    dialog.queueSave({ canceled: true });
    await bridge.handlers[CHANNELS.save](event, {
      name: "through-the-link.png",
      bytes: new Uint8Array(PNG),
      directory: handle,
    });
    assert.deepEqual([...(await fs.readFile(path.join(real, "through-the-link.png")))], [...PNG]);
    await fs.rm(real, { recursive: true, force: true });
  });
});

describe("bridge save", () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dither-save-"));
  });

  test("writes the bytes the renderer sent and reports where", async () => {
    const { bridge, dialog, event } = harness();
    const target = path.join(dir, "dither.png");
    dialog.queueSave({ canceled: false, filePath: target });
    const result = await bridge.handlers[CHANNELS.save](event, {
      name: "dither.png",
      bytes: new Uint8Array(PNG),
    });
    assert.deepEqual(result, { canceled: false, path: target });
    assert.deepEqual([...(await fs.readFile(target))], [...PNG]);
  });

  test("filters the save dialog by what the app can write", async () => {
    const { bridge, dialog, event } = harness();
    dialog.queueSave({ canceled: true });
    await bridge.handlers[CHANNELS.save](event, { name: "dither.gif", bytes: new Uint8Array(PNG) });
    const names = dialog.calls[0].options.filters.map((filter) => filter.name);
    assert.ok(names.includes("GIF animation"));
    assert.ok(names.includes("All files"));
  });

  test("gives the dialog a default name and remembers the folder", async () => {
    const { bridge, dialog, event } = harness();
    dialog.queueSave({ canceled: true });
    await bridge.handlers[CHANNELS.save](event, { name: "dither", bytes: new Uint8Array(PNG) });
    assert.equal(path.basename(dialog.calls[0].options.defaultPath), "dither.png");

    await fs.mkdir(path.join(dir, "out"));
    dialog.queueSave({ canceled: false, filePath: path.join(dir, "out", "dither.png") });
    await bridge.handlers[CHANNELS.save](event, { name: "dither.png", bytes: new Uint8Array(PNG) });
    dialog.queueSave({ canceled: true });
    await bridge.handlers[CHANNELS.save](event, { name: "dither.png", bytes: new Uint8Array(PNG) });
    assert.equal(path.dirname(dialog.calls[2].options.defaultPath), path.join(dir, "out"));
  });

  test("writes nothing when the dialog is cancelled", async () => {
    const { bridge, event } = harness();
    const result = await bridge.handlers[CHANNELS.save](event, {
      name: "dither.png",
      bytes: new Uint8Array(PNG),
    });
    assert.deepEqual(result, { canceled: true, path: null });
    assert.deepEqual(await fs.readdir(dir), []);
  });

  test("replaces an existing file rather than appending to it", async () => {
    const { bridge, dialog, event } = harness();
    const target = path.join(dir, "dither.png");
    await fs.writeFile(target, Buffer.alloc(4096, 7));
    dialog.queueSave({ canceled: false, filePath: target });
    await bridge.handlers[CHANNELS.save](event, {
      name: "dither.png",
      bytes: new Uint8Array(PNG),
    });
    assert.deepEqual([...(await fs.readFile(target))], [...PNG]);
  });

  test("refuses to save over a folder", async () => {
    const { bridge, dialog, event } = harness();
    dialog.queueSave({ canceled: false, filePath: dir });
    await assert.rejects(
      bridge.handlers[CHANNELS.save](event, { name: "dither.png", bytes: new Uint8Array(PNG) }),
      /that path is a folder/,
    );
  });

  test("leaves no partial file behind when the write cannot finish", async () => {
    const { bridge, dialog, event } = harness();
    const target = path.join(dir, "dither.png");
    // A directory at the staging name makes the first write fail.
    await fs.mkdir(`${target}.dither-partial`);
    dialog.queueSave({ canceled: false, filePath: target });
    await assert.rejects(
      bridge.handlers[CHANNELS.save](event, { name: "dither.png", bytes: new Uint8Array(PNG) }),
    );
    assert.deepEqual((await fs.readdir(dir)).sort(), ["dither.png.dither-partial"]);
  });

  test("writes into a folder it was handed, and nowhere else", async () => {
    const { bridge, dialog, event } = harness();
    const out = await fs.mkdtemp(path.join(os.tmpdir(), "dither-out-"));
    dialog.queueOpen({ canceled: false, filePaths: [out] });
    const { handle } = await bridge.handlers[CHANNELS.pickDirectory](event);
    const result = await bridge.handlers[CHANNELS.save](event, {
      name: "shot.dither.png",
      bytes: new Uint8Array(PNG),
      directory: handle,
    });
    assert.deepEqual(result, { canceled: false, path: null });
    assert.deepEqual(await fs.readdir(out), ["shot.dither.png"]);
    await fs.rm(out, { recursive: true, force: true });
  });

  test("refuses a folder handle it never issued", async () => {
    const { bridge, event } = harness();
    await assert.rejects(
      bridge.handlers[CHANNELS.save](event, {
        name: "dither.png",
        bytes: new Uint8Array(PNG),
        directory: "00000000-0000-4000-8000-000000000000",
      }),
      /unknown output folder/,
    );
  });

  test("refuses a handle once a newer folder has been chosen", async () => {
    const { bridge, dialog, event } = harness();
    const first = await fs.mkdtemp(path.join(os.tmpdir(), "dither-first-"));
    const second = await fs.mkdtemp(path.join(os.tmpdir(), "dither-second-"));
    dialog.queueOpen({ canceled: false, filePaths: [first] });
    const stale = (await bridge.handlers[CHANNELS.pickDirectory](event)).handle;
    dialog.queueOpen({ canceled: false, filePaths: [second] });
    await bridge.handlers[CHANNELS.pickDirectory](event);
    await assert.rejects(
      bridge.handlers[CHANNELS.save](event, {
        name: "dither.png",
        bytes: new Uint8Array(PNG),
        directory: stale,
      }),
      /unknown output folder/,
    );
    await fs.rm(first, { recursive: true, force: true });
    await fs.rm(second, { recursive: true, force: true });
  });

  test("refuses a name that tries to leave the folder", async () => {
    const { bridge, dialog, event } = harness();
    const out = await fs.mkdtemp(path.join(os.tmpdir(), "dither-out-"));
    dialog.queueOpen({ canceled: false, filePaths: [out] });
    const { handle } = await bridge.handlers[CHANNELS.pickDirectory](event);
    for (const name of ["../escaped.png", "sub/dir.png", "/etc/passwd", "..", "C:\\win.png", ""]) {
      await assert.rejects(
        bridge.handlers[CHANNELS.save](event, {
          name,
          bytes: new Uint8Array(PNG),
          directory: handle,
        }),
        TypeError,
      );
    }
    assert.deepEqual(await fs.readdir(out), []);
    await fs.rm(out, { recursive: true, force: true });
  });

  test("keeps a name that merely looks dangerous", async () => {
    const { bridge, dialog, event } = harness();
    const out = await fs.mkdtemp(path.join(os.tmpdir(), "dither-out-"));
    const awkward = "<script>alert(1)<script>.png";
    dialog.queueOpen({ canceled: false, filePaths: [out] });
    const { handle } = await bridge.handlers[CHANNELS.pickDirectory](event);
    await bridge.handlers[CHANNELS.save](event, {
      name: awkward,
      bytes: new Uint8Array(PNG),
      directory: handle,
    });
    // Nothing is escaped or rewritten: the name is the one that was asked for.
    assert.deepEqual(await fs.readdir(out), [awkward]);
    await fs.rm(out, { recursive: true, force: true });
  });

  test("refuses a save from an unknown sender before writing anything", async () => {
    const { bridge, dialog } = harness();
    const out = await fs.mkdtemp(path.join(os.tmpdir(), "dither-out-"));
    dialog.queueSave({ canceled: false, filePath: path.join(out, "dither.png") });
    await assert.rejects(
      bridge.handlers[CHANNELS.save](
        { sender: null, senderFrame: null },
        {
          name: "dither.png",
          bytes: new Uint8Array(PNG),
        },
      ),
      /unknown window/,
    );
    assert.deepEqual(await fs.readdir(out), []);
    await fs.rm(out, { recursive: true, force: true });
  });
});
