// The contract between preload and main: what crosses the bridge, what the
// renderer is allowed to see, and the policy the app document is served under.
// Runs without electron by stubbing the module preload.js imports.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test, describe, before, after } = require("node:test");

const {
  CHANNELS,
  UPDATE_CHANNEL,
  UPDATE_EVENT_CHANNEL,
  parseOpenRequest,
  parseSaveRequest,
  MAX_SAVE_BYTES,
} = require("../lib/contract");
const {
  CONTENT_SECURITY_POLICY,
  DOCUMENT_SECURITY_POLICY,
  INLINE_SCRIPT_SHA256,
  THEME_PROVIDER_SHA256,
  webPreferences,
} = require("../lib/security");
const { createBridge } = require("../lib/bridge");

const APP_HTML = path.join(__dirname, "..", "..", "app", "index.html");
const ELECTRON_PATH = require.resolve("electron");

/** Load preload.js against a stub electron, and hand back what it exposed. */
function loadPreload() {
  const exposed = [];
  const invoked = [];
  const subscriptions = [];
  require.cache[ELECTRON_PATH] = {
    id: ELECTRON_PATH,
    filename: ELECTRON_PATH,
    loaded: true,
    exports: {
      contextBridge: {
        exposeInMainWorld: (key, api) => exposed.push({ key, api }),
      },
      ipcRenderer: {
        invoke: async (channel, payload) => {
          invoked.push({ channel, payload });
          return { channel, payload };
        },
        on: (channel, handler) => {
          subscriptions.push({ channel, handler });
        },
        removeListener: (channel, handler) => {
          const at = subscriptions.findIndex((s) => s.channel === channel && s.handler === handler);
          if (at >= 0) subscriptions.splice(at, 1);
        },
      },
    },
  };
  const preload = require.resolve("../preload.js");
  delete require.cache[preload];
  try {
    require(preload);
  } finally {
    delete require.cache[preload];
    delete require.cache[ELECTRON_PATH];
  }
  return { exposed, invoked, subscriptions };
}

/** The policy the app document itself carries, read back out of index.html. */
function metaPolicy() {
  const html = fs.readFileSync(APP_HTML, "utf8");
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/);
  assert.ok(match, "index.html has no content security policy");
  return match[1];
}

/** The hash of the inline theme bootstrap, as a browser would compute it. */
function inlineScriptHash() {
  const html = fs.readFileSync(APP_HTML, "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "index.html has no inline script");
  // The hash covers the script's text exactly as it sits between the tags.
  const text = match[1].replace(/\r\n/g, "\n");
  const digest = crypto.createHash("sha256").update(text, "utf8");
  return `sha256-${digest.digest("base64")}`;
}

/** One policy's directives, trimmed and in a stable order. */
function directives(policy) {
  return policy
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort();
}

/** The value of one directive in a policy string. */
function directive(policy, name) {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  assert.ok(found, `no ${name} directive`);
  return found.slice(name.length + 1);
}

describe("channel surface", () => {
  test("is three namespaced file channels and nothing else", () => {
    assert.deepEqual(Object.keys(CHANNELS).sort(), ["open", "pickDirectory", "save"]);
    const names = Object.values(CHANNELS);
    assert.equal(new Set(names).size, names.length);
    for (const name of names) assert.match(name, /^dither:[a-z][a-z-]*$/);
  });

  test("the update pair is namespaced and distinct from the file channels", () => {
    for (const name of [UPDATE_CHANNEL, UPDATE_EVENT_CHANNEL]) {
      assert.match(name, /^dither:[a-z][a-z-]*$/);
    }
    assert.notEqual(UPDATE_CHANNEL, UPDATE_EVENT_CHANNEL);
    assert.ok(!Object.values(CHANNELS).includes(UPDATE_CHANNEL));
    assert.ok(!Object.values(CHANNELS).includes(UPDATE_EVENT_CHANNEL));
  });

  test("registers exactly the file channels on ipcMain", () => {
    const registered = new Map();
    const bridge = createBridge({ dialog: {}, getWindow: () => null, homeDir: "/tmp" });
    bridge.register({ handle: (channel, handler) => registered.set(channel, handler) });
    assert.deepEqual([...registered.keys()].sort(), Object.values(CHANNELS).sort());
    for (const channel of Object.values(CHANNELS)) {
      assert.equal(typeof registered.get(channel), "function");
    }
  });
});

describe("preload", () => {
  let loaded;
  before(() => {
    loaded = loadPreload();
  });
  after(() => {
    loaded = undefined;
  });

  test("exposes one global, under the name the app adapter looks for", () => {
    assert.equal(loaded.exposed.length, 1);
    assert.equal(loaded.exposed[0].key, "ditherDesktop");
  });

  test("exposes versions, the three file calls, the update pair, and nothing else", () => {
    assert.deepEqual(Object.keys(loaded.exposed[0].api).sort(), [
      "checkUpdate",
      "onUpdate",
      "open",
      "pickDirectory",
      "save",
      "versions",
    ]);
    assert.deepEqual(Object.keys(loaded.exposed[0].api.versions).sort(), [
      "chrome",
      "electron",
      "node",
    ]);
  });

  test("hands out no way to reach ipcRenderer or the filesystem", () => {
    const api = loaded.exposed[0].api;
    for (const forbidden of [
      "ipcRenderer",
      "require",
      "process",
      "send",
      "on",
      "once",
      "invoke",
      "removeListener",
    ]) {
      assert.equal(api[forbidden], undefined, `${forbidden} must not be exposed`);
    }
    const objects = Object.entries(api).filter(([, value]) => typeof value === "object");
    assert.deepEqual(
      objects.map(([key]) => key),
      ["versions"],
    );
  });

  test("routes every call to the channel the main process registers", async () => {
    const api = loaded.exposed[0].api;
    loaded.invoked.length = 0;
    const open = await api.open({ kind: "image" });
    const directory = await api.pickDirectory();
    const save = await api.save({ name: "a.png", bytes: new Uint8Array([1]) });
    const update = await api.checkUpdate();
    assert.deepEqual(
      loaded.invoked.map((call) => call.channel),
      [CHANNELS.open, CHANNELS.pickDirectory, CHANNELS.save, UPDATE_CHANNEL],
    );
    assert.deepEqual(
      [open.channel, directory.channel, save.channel, update.channel],
      [CHANNELS.open, CHANNELS.pickDirectory, CHANNELS.save, UPDATE_CHANNEL],
    );
  });

  test("subscribes to update status only, and unsubscribes on request", () => {
    const api = loaded.exposed[0].api;
    loaded.subscriptions.length = 0;
    const seen = [];
    const stop = api.onUpdate((status) => seen.push(status));
    assert.equal(loaded.subscriptions.length, 1);
    assert.equal(loaded.subscriptions[0].channel, UPDATE_EVENT_CHANNEL);
    // The raw ipc event must not reach the renderer.
    loaded.subscriptions[0].handler({ senderId: "secret" }, { state: "ready", version: "1.2.0" });
    assert.deepEqual(seen, [{ state: "ready", version: "1.2.0" }]);
    assert.equal(typeof stop, "function");
    stop();
    assert.equal(loaded.subscriptions.length, 0);
  });

  test("reports the real runtime versions", () => {
    const { versions } = loaded.exposed[0].api;
    assert.equal(versions.node, process.versions.node);
    assert.equal(versions.electron, process.versions.electron);
  });
});

describe("request validation", () => {
  test("accepts an image, a video, or either in one dialog, and nothing else", () => {
    assert.deepEqual(parseOpenRequest({ kind: "image" }), { kind: "image", multiple: false });
    assert.deepEqual(parseOpenRequest({ kind: "video", multiple: true }), {
      kind: "video",
      multiple: true,
    });
    assert.deepEqual(parseOpenRequest({ kind: "media" }), { kind: "media", multiple: false });
    for (const bad of [null, "image", [], {}, { kind: "audio" }, { kind: 1 }]) {
      assert.throws(() => parseOpenRequest(bad), TypeError);
    }
  });

  test("only ever treats multiple as a plain true", () => {
    assert.equal(parseOpenRequest({ kind: "image", multiple: "yes" }).multiple, false);
    assert.equal(parseOpenRequest({ kind: "image", multiple: 1 }).multiple, false);
  });

  test("accepts any byte view a save may carry", () => {
    const name = { name: "a.png" };
    assert.equal(parseSaveRequest({ ...name, bytes: new Uint8Array([1]) }).bytes.byteLength, 1);
    assert.equal(parseSaveRequest({ ...name, bytes: new ArrayBuffer(4) }).bytes.byteLength, 4);
    const view = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
    assert.equal(parseSaveRequest({ ...name, bytes: view }).bytes.byteLength, 2);
  });

  test("refuses a save it could not write faithfully", () => {
    const cases = [
      null,
      {},
      { name: "", bytes: new Uint8Array([1]) },
      { name: 7, bytes: new Uint8Array([1]) },
      { name: "a.png" },
      { name: "a.png", bytes: "text" },
      { name: "a.png", bytes: new Uint8Array(0) },
      { name: "a.png", bytes: new Uint8Array(1), directory: 5 },
    ];
    for (const bad of cases) assert.throws(() => parseSaveRequest(bad), TypeError);
  });

  test("caps how much one save may carry", () => {
    // A one-byte view that claims to be over the cap: no two gigabyte allocation.
    const bytes = new Uint8Array(1);
    Object.defineProperty(bytes, "byteLength", { value: MAX_SAVE_BYTES + 1 });
    assert.throws(() => parseSaveRequest({ name: "a.mp4", bytes }), /too large/);
  });
});

describe("content security policy", () => {
  test("hashes the inline theme bootstrap that index.html actually ships", () => {
    assert.equal(inlineScriptHash(), INLINE_SCRIPT_SHA256);
  });

  test("carries that same hash in the document and in the response header", () => {
    assert.ok(metaPolicy().includes(`'${INLINE_SCRIPT_SHA256}'`));
    assert.ok(CONTENT_SECURITY_POLICY.includes(`'${INLINE_SCRIPT_SHA256}'`));
  });

  test("allows the theme provider's own inline script by hash too", () => {
    assert.match(THEME_PROVIDER_SHA256, /^sha256-[A-Za-z0-9+/]+=*$/);
    const script = directive(CONTENT_SECURITY_POLICY, "script-src");
    assert.ok(script.includes(`'${THEME_PROVIDER_SHA256}'`));
    assert.ok(metaPolicy().includes(`'${THEME_PROVIDER_SHA256}'`));
  });

  test("quotes every hash source, since a bare one parses as a host", () => {
    // An unquoted sha256-... is read as a host source and silently ignored, so
    // the inline scripts are blocked instead. Each hash must sit inside quotes.
    for (const policy of [CONTENT_SECURITY_POLICY, metaPolicy()]) {
      const hashes = policy.match(/sha256-[A-Za-z0-9+/=]+/g) ?? [];
      assert.ok(hashes.length >= 2, "both inline scripts are allowed by hash");
      for (const hash of hashes) {
        assert.ok(policy.includes(`'${hash}'`), `${hash} must be quoted`);
      }
    }
  });

  test("keeps the document and the header in step directive for directive", () => {
    assert.deepEqual(directives(metaPolicy()), directives(DOCUMENT_SECURITY_POLICY));
    // The document leaves frame-ancestors out, so the header is the same list
    // with exactly that one directive added.
    assert.deepEqual(
      directives(CONTENT_SECURITY_POLICY),
      [...directives(DOCUMENT_SECURITY_POLICY), "frame-ancestors 'none'"].sort(),
    );
  });

  test("allows inline script only by hash, and nothing from anywhere else", () => {
    const script = directive(CONTENT_SECURITY_POLICY, "script-src");
    assert.ok(script.includes("'self'"));
    assert.ok(script.includes(INLINE_SCRIPT_SHA256));
    assert.ok(!script.includes("unsafe-inline"));
    assert.ok(!script.includes("unsafe-eval"));
    assert.ok(!script.includes("*"));
    // Inline style is still needed: Radix and the sliders position with it.
    assert.ok(directive(CONTENT_SECURITY_POLICY, "style-src").includes("'unsafe-inline'"));
    assert.ok(CONTENT_SECURITY_POLICY.includes("object-src 'none'"));
    assert.ok(CONTENT_SECURITY_POLICY.includes("frame-ancestors 'none'"));
    assert.ok(CONTENT_SECURITY_POLICY.includes("base-uri 'none'"));
    assert.ok(CONTENT_SECURITY_POLICY.includes("form-action 'none'"));
  });
});

describe("window settings", () => {
  test("runs the renderer sandboxed, isolated and without node", () => {
    const prefs = webPreferences("/app/preload.js");
    assert.equal(prefs.preload, "/app/preload.js");
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.webSecurity, true);
    assert.equal(prefs.allowRunningInsecureContent, false);
    // A dropped file must not navigate the window away from the app.
    assert.equal(prefs.navigateOnDragDrop, false);
  });
});

describe("release hardening", () => {
  const build = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  ).build;

  test("packages the shell and the app, and nothing else", () => {
    assert.equal(build.asar, true);
    assert.deepEqual(build.files, ["main.js", "preload.js", "lib/**/*", "dist/**/*"]);
  });

  test("gives the packaged binary one predictable name", () => {
    // The smoke check locates the executable by name, on every platform.
    assert.equal(build.executableName, "dither-ts");
  });

  test("names a release provider, so the updater has a feed to read", () => {
    const providers = Array.isArray(build.publish) ? build.publish : [build.publish];
    assert.equal(providers.length, 1);
    const [provider] = providers;
    assert.equal(provider.provider, "github");
    assert.equal(provider.owner, "lilianpichard");
    assert.equal(provider.repo, "dither-ts");
    assert.equal(provider.releaseType, "release");
  });

  test("ships an icon on every platform rather than the electron default", () => {
    assert.equal(build.icon, "build/icon.png");
    assert.equal(build.mac.icon, "build/icon.png");
    assert.equal(build.win.icon, "build/icon.png");
    assert.equal(build.linux.icon, "build/icons");
    // electron-builder cannot cut an .ico or an .icns without a real source,
    // so the one icon file has to exist and be big enough to downscale from.
    const icon = path.join(__dirname, "..", build.icon);
    assert.ok(fs.existsSync(icon), "icon.png is missing");
    const bytes = fs.readFileSync(icon);
    // PNG signature plus the IHDR width and height, both big-endian.
    assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(bytes.readUInt32BE(16), 1024);
    assert.equal(bytes.readUInt32BE(20), 1024);
  });

  test("signs nothing, on any platform", () => {
    // Paid signing was dropped on purpose: an unsigned build installs anywhere,
    // and the price of that is a Gatekeeper and a SmartScreen warning. What
    // this test holds is the honesty of it, because a config that claims to
    // notarise with no certificate behind it is a config that lies.
    assert.equal(
      build.mac.hardenedRuntime,
      undefined,
      "mac asks for a signing material it does not have",
    );
    assert.equal(build.mac.notarize, undefined, "mac asks to notarise with no Apple credentials");
    assert.equal(build.mac.entitlements, undefined);
    assert.equal(build.mac.entitlementsInherit, undefined);
    assert.equal(build.win.signtoolOptions, undefined, "win names a certificate it does not have");
  });

  test("still builds the three platforms, which signing was never needed for", () => {
    // Dropping signing costs the auto-updater on macOS, because Squirrel.Mac
    // refuses to patch an unsigned app. Everything else about packaging stands,
    // and this is the list that has to survive the decision.
    assert.deepEqual(build.mac.target, ["dmg", "zip"]);
    assert.deepEqual(build.win.target, ["nsis"]);
    assert.deepEqual(build.linux.target, ["AppImage", "deb"]);
  });

  test("leaves no signing file behind for a reader to find", () => {
    // A dangling reference would mean a future reader wires a certificate into
    // a project that decided not to have one.
    const build_ = path.join(__dirname, "..", "build");
    const entries = fs.readdirSync(build_);
    assert.ok(!entries.some((entry) => entry.includes("entitlements")), entries.join(", "));
  });

  test("offers linux a package-manager artifact, not only an appimage", () => {
    assert.ok(build.linux.target.includes("AppImage"));
    assert.ok(build.linux.target.includes("deb"));
    assert.ok(build.linux.maintainer);
    assert.ok(build.linux.desktop.entry.MimeType.includes("image/png"));
    // Every size electron-builder looks for has to be on disk.
    for (const size of [16, 32, 48, 64, 128, 256, 512]) {
      const entry = path.join(__dirname, "..", build.linux.icon, `${size}x${size}.png`);
      assert.ok(fs.existsSync(entry), `${size}x${size} icon is missing`);
    }
  });

  test("tags the version in the artifact name, so a release cannot overwrite", () => {
    assert.match(build.artifactName, /\$\{version\}/);
    assert.match(build.artifactName, /\$\{arch\}/);
  });

  test("keeps the copyright and the author with the package", () => {
    assert.match(build.copyright, /Lilian Pichard/);
    assert.equal(build.extraMetadata.author, "Lilian Pichard");
    assert.match(build.extraMetadata.homepage, /^https:\/\//);
  });

  test("flips every electron fuse to its hardened value", () => {
    const fuses = build.electronFuses;
    // ELECTRON_RUN_ASNODE and NODE_OPTIONS are ways in; both stay off.
    assert.equal(fuses.runAsNode, false);
    assert.equal(fuses.enableNodeOptionsEnvironmentVariable, false);
    // --inspect on the main process is a debugger nobody asked for.
    assert.equal(fuses.enableNodeCliInspectArguments, false);
    // The app may only be loaded from a verified asar, with cookies encrypted.
    assert.equal(fuses.onlyLoadAppFromAsar, true);
    assert.equal(fuses.enableEmbeddedAsarIntegrityValidation, true);
    assert.equal(fuses.enableCookieEncryption, true);
    // Electron ships one snapshot for every process; asking for a second one
    // that is not in the build is a startup crash, not a hardening win.
    assert.equal(fuses.loadBrowserProcessSpecificV8Snapshot, false);
    // file:// keeps its privileges on purpose: the app is served from inside
    // the asar over file://, and with them off it cannot load its own files
    // (ERR_FILE_NOT_FOUND) or start its render workers. Electron's guidance is
    // to disable this only for apps that do not serve over file://.
    assert.equal(fuses.grantFileProtocolExtraPrivileges, true);
  });

  test("names every fuse so an electron upgrade cannot silently add one", () => {
    const fuses = build.electronFuses;
    const known = [
      "runAsNode",
      "enableCookieEncryption",
      "enableNodeOptionsEnvironmentVariable",
      "enableNodeCliInspectArguments",
      "enableEmbeddedAsarIntegrityValidation",
      "onlyLoadAppFromAsar",
      "loadBrowserProcessSpecificV8Snapshot",
      "grantFileProtocolExtraPrivileges",
    ];
    for (const fuse of known) {
      assert.equal(typeof fuses[fuse], "boolean", `${fuse} must be set explicitly`);
    }
  });
});

describe("package smoke", () => {
  const root = path.join(__dirname, "..", "..");
  const scripts = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  ).scripts;

  test("is wired to a build and a check", () => {
    assert.match(scripts.smoke, /dist-dir/);
    assert.match(scripts.smoke, /scripts\/smoke\.js/);
    assert.ok(fs.existsSync(path.join(__dirname, "..", "scripts", "smoke.js")));
  });

  test("is not shipped inside the package", () => {
    const files = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"))
      .build.files;
    assert.ok(!files.some((entry) => entry.includes("scripts")));
  });

  test("runs in CI, under a display when there is one", () => {
    const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    assert.ok(workflow.includes("npm --prefix electron run smoke"));
    // A headless runner needs a virtual display before the app can open a window.
    assert.ok(workflow.includes("xvfb-run"));
  });

  test("keeps the check itself free of extra dependencies", () => {
    const smoke = fs.readFileSync(path.join(__dirname, "..", "scripts", "smoke.js"), "utf8");
    const required = smoke.match(/require\("([^"]+)"\)/g) ?? [];
    for (const entry of required) {
      assert.match(entry, /require\("node:[a-z_/]+"\)/, `unexpected require: ${entry}`);
    }
  });
});
