// The path policy on its own: which extensions count as media, what a file name
// is allowed to be, and the join that keeps a save inside its folder.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, describe } = require("node:test");

const {
  IMAGE_TYPES,
  VIDEO_TYPES,
  RESERVED_DEVICES,
  extensionOf,
  mediaTypeFor,
  openFilters,
  safeFileName,
  saveExtensionFor,
  resolveWithin,
} = require("../lib/paths");

const NAMING_TS = path.join(__dirname, "..", "..", "app", "src", "batch", "naming.ts");

const comPorts = () => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `com${n}`);
const lptPorts = () => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `lpt${n}`);

describe("extensionOf", () => {
  test("lower-cases the extension and drops the dot", () => {
    assert.equal(extensionOf("shot.PNG"), "png");
    assert.equal(extensionOf("clip.mp4"), "mp4");
    assert.equal(extensionOf("archive.tar.gz"), "gz");
  });

  test("is empty when there is no extension", () => {
    assert.equal(extensionOf("README"), "");
    assert.equal(extensionOf("trailing."), "");
    // A leading dot is part of the name, not the start of an extension.
    assert.equal(extensionOf(".gitignore"), "");
  });
});

describe("mediaTypeFor", () => {
  test("maps the extensions the open dialog offers", () => {
    assert.equal(mediaTypeFor("a.png", "image"), "image/png");
    assert.equal(mediaTypeFor("a.JPG", "image"), "image/jpeg");
    assert.equal(mediaTypeFor("a.mov", "video"), "video/quicktime");
  });

  test("is null for anything the dialog would not offer", () => {
    assert.equal(mediaTypeFor("a.txt", "image"), null);
    assert.equal(mediaTypeFor("a.png", "video"), null);
    assert.equal(mediaTypeFor("noext", "image"), null);
  });

  test("keeps the two tables apart", () => {
    for (const ext of Object.keys(IMAGE_TYPES)) assert.equal(typeof IMAGE_TYPES[ext], "string");
    for (const ext of Object.keys(VIDEO_TYPES)) {
      assert.ok(VIDEO_TYPES[ext].startsWith("video/"));
      assert.equal(IMAGE_TYPES[ext], undefined);
    }
  });
});

describe("openFilters", () => {
  test("offers exactly the extensions it can type", () => {
    assert.deepEqual(openFilters("image"), [
      { name: "Images", extensions: Object.keys(IMAGE_TYPES) },
    ]);
    assert.deepEqual(openFilters("video"), [
      { name: "Videos", extensions: Object.keys(VIDEO_TYPES) },
    ]);
  });

  test("offers both kinds in one dialog, labelled separately", () => {
    // The shared picker: one dialog, so the user sees which folder is which
    // instead of hunting through one flat list.
    assert.deepEqual(openFilters("media"), [
      { name: "Images", extensions: Object.keys(IMAGE_TYPES) },
      { name: "Videos", extensions: Object.keys(VIDEO_TYPES) },
    ]);
  });
});

describe("mediaTypeFor", () => {
  test("types either kind for the shared picker", () => {
    assert.equal(mediaTypeFor("a.png", "media"), "image/png");
    assert.equal(mediaTypeFor("a.mp4", "media"), "video/mp4");
    assert.equal(mediaTypeFor("a.zip", "media"), null);
  });
});

describe("saveExtensionFor", () => {
  test("keeps an extension the app can write", () => {
    assert.equal(saveExtensionFor("dither.svg"), "svg");
    assert.equal(saveExtensionFor("dither.txt"), "txt");
  });

  test("falls back to png for anything else", () => {
    assert.equal(saveExtensionFor("dither"), "png");
    assert.equal(saveExtensionFor("dither.bin"), "png");
  });
});

describe("safeFileName", () => {
  test("passes an ordinary name straight through", () => {
    for (const name of ["a.dither.png", "shot 1.jpeg", "..hidden", "a.tar.gz"]) {
      assert.equal(safeFileName(name), name);
    }
  });

  test("refuses anything that could point somewhere else", () => {
    const bad = [
      "",
      ".",
      "..",
      "../escape.png",
      "sub/dir.png",
      "sub\\dir.png",
      "/etc/passwd",
      "C:\\win.png",
      "a\u0000b.png",
      "a\nb.png",
      "<odd>.png",
      "a<b>.png",
      "a:b.png",
      "a|b.png",
      "a?b.png",
      "a*b.png",
      `x${"y".repeat(255)}.png`,
    ];
    for (const name of bad) assert.throws(() => safeFileName(name), TypeError, `accepted ${name}`);
  });

  test("refuses windows device names whatever follows the first dot", () => {
    // Windows reads the part before the first dot, so con.tar.gz is still con.
    for (const name of [
      "con",
      "con.png",
      "con.tar.gz",
      "con.png.txt",
      "NUL.txt",
      "com1",
      "com9.log",
      "lpt1.dither.png",
      "aux.png.txt",
      "PRN.png",
    ]) {
      assert.throws(() => safeFileName(name), /reserved on Windows/, `accepted ${name}`);
    }
  });

  test("allows names that merely start like a device name", () => {
    for (const name of ["console.png", "com10.png", "com.png", "nullable.png", "auxiliary.png"]) {
      assert.equal(safeFileName(name), name);
    }
  });

  test("refuses them on every platform, not just windows", () => {
    // A batch run has to name the same files everywhere, so the rule is not
    // conditional on the host: the list is applied the same way on all of them.
    assert.deepEqual(RESERVED_DEVICES, ["con", "prn", "aux", "nul", ...comPorts(), ...lptPorts()]);
    assert.equal(RESERVED_DEVICES.length, 22);
    for (const name of RESERVED_DEVICES) {
      assert.throws(() => safeFileName(`${name}.dither.png`), /reserved on Windows/);
    }
  });
});

describe("reserved names agree with the batch naming", () => {
  test("the two lists are the same, so a batch run is never refused", () => {
    const source = fs.readFileSync(NAMING_TS, "utf8");
    const block = source.match(/const RESERVED_DEVICES = \[([\s\S]*?)\];/);
    assert.ok(block, "naming.ts has no RESERVED_DEVICES list");
    const appSide = [...block[1].matchAll(/"([a-z0-9]+)"/g)].map((match) => match[1]);
    assert.deepEqual([...RESERVED_DEVICES].sort(), appSide.sort());
  });

  test("naming.ts refuses the same control bytes the shell does", () => {
    // The shell rejects control bytes outright, so the renderer replaces them.
    const source = fs.readFileSync(NAMING_TS, "utf8");
    assert.ok(source.includes("isControl"), "naming.ts must handle control bytes");
    assert.throws(() => safeFileName(`a${String.fromCharCode(1)}b.png`), /control characters/);
  });
});

describe("resolveWithin", () => {
  test("joins a plain name onto the folder", () => {
    const dir = path.resolve("/tmp/out");
    assert.equal(resolveWithin(dir, "a.png"), path.join(dir, "a.png"));
  });

  test("refuses a name that would leave the folder", () => {
    const dir = path.resolve("/tmp/out");
    for (const name of ["../a.png", "sub/a.png", "/etc/passwd"]) {
      assert.throws(() => resolveWithin(dir, name), TypeError);
    }
  });

  test("resolves a relative folder first, so a traversal still fails", () => {
    assert.throws(() => resolveWithin(path.join("out", ".."), "../a.png"), TypeError);
  });
});
