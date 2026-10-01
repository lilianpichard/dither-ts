// The update feed: what the renderer is told, and who is allowed to ask.
// electron-updater is stubbed, so no network and no signed build are involved.

const assert = require("node:assert/strict");
const { test, describe } = require("node:test");

const { createUpdater, toStatus, DEFAULT_POLICY, NO_FEED } = require("../lib/updater");
const { UPDATE_CHANNEL, UPDATE_EVENT_CHANNEL } = require("../lib/contract");

/** A recorder standing in for electron-updater. */
function stubUpdater(overrides = {}) {
  const listeners = new Map();
  const sent = [];
  const win = { webContents: { send: (channel, status) => sent.push({ channel, status }) } };
  return {
    listeners,
    sent,
    win,
    autoUpdater: {
      autoDownload: null,
      autoInstallOnAppQuit: null,
      allowDowngrade: null,
      checkForUpdates: async () => ({ updateInfo: { version: "9.9.9" } }),
      on(event, handler) {
        listeners.set(event, handler);
        return this;
      },
      emit(event, info) {
        const handler = listeners.get(event);
        assert.ok(handler, `no listener for ${event}`);
        return handler(info);
      },
      ...overrides,
    },
  };
}

const trustedEvent = (win) => ({ sender: win.webContents });

describe("update policy", () => {
  test("downloads automatically and installs on quit, without downgrading", () => {
    const stub = stubUpdater();
    createUpdater({ ...stub, app: { getVersion: () => "1.0.0" }, getWindow: () => stub.win });
    assert.equal(stub.autoUpdater.autoDownload, DEFAULT_POLICY.autoDownload);
    assert.equal(stub.autoUpdater.autoInstallOnAppQuit, DEFAULT_POLICY.autoInstallOnAppQuit);
    assert.equal(stub.autoUpdater.allowDowngrade, DEFAULT_POLICY.allowDowngrade);
  });

  test("still registers the channel when there is no feed behind it", () => {
    // The preload exposes checkUpdate in every build, so a channel nobody
    // handles turns a click into a raw ipc error rather than a sentence.
    const registered = new Map();
    const updater = createUpdater({ autoUpdater: null, app: {}, getWindow: () => null });
    updater.register({ handle: (channel, handler) => registered.set(channel, handler) });
    assert.deepEqual([...registered.keys()], [UPDATE_CHANNEL]);
    assert.equal(typeof registered.get(UPDATE_CHANNEL), "function");
  });

  test("answers with why, instead of leaving the renderer to guess", async () => {
    const win = { webContents: { send: () => {} } };
    const updater = createUpdater({ autoUpdater: null, app: {}, getWindow: () => win });
    assert.deepEqual(await updater.check(trustedEvent(win)), {
      ok: false,
      version: null,
      message: NO_FEED,
    });
  });

  test("carries a caller-supplied reason when the updater failed to load", async () => {
    const win = { webContents: { send: () => {} } };
    const updater = createUpdater({
      autoUpdater: null,
      app: {},
      getWindow: () => win,
      reason: "missing module",
    });
    assert.equal((await updater.check(trustedEvent(win))).message, "missing module");
  });

  test("touches no updater at all when there is none", () => {
    // No event wiring, so a null autoUpdater cannot throw inside the loop.
    assert.doesNotThrow(() => createUpdater({ autoUpdater: null, app: {}, ipcMain: {} }));
  });

  test("registers the one check channel and nothing else", () => {
    const stub = stubUpdater();
    const registered = new Map();
    const updater = createUpdater({
      autoUpdater: stub.autoUpdater,
      app: { getVersion: () => "1.0.0" },
      getWindow: () => stub.win,
    });
    updater.register({ handle: (channel, handler) => registered.set(channel, handler) });
    assert.deepEqual([...registered.keys()], [UPDATE_CHANNEL]);
    assert.equal(typeof registered.get(UPDATE_CHANNEL), "function");
  });
});

describe("status mapping", () => {
  test("maps every event the renderer knows how to draw", () => {
    assert.deepEqual(toStatus("checking-for-update"), { state: "checking" });
    assert.deepEqual(toStatus("update-available", { version: "1.2.0" }), {
      state: "available",
      version: "1.2.0",
    });
    assert.deepEqual(toStatus("update-not-available", { version: "1.0.0" }), {
      state: "current",
      version: "1.0.0",
    });
    assert.deepEqual(toStatus("download-progress", { percent: 42.7, transferred: 10, total: 20 }), {
      state: "downloading",
      percent: 43,
      transferred: 10,
      total: 20,
    });
    assert.deepEqual(toStatus("update-downloaded", { version: "1.2.0" }), {
      state: "ready",
      version: "1.2.0",
    });
  });

  test("ignores events it has nothing to say about", () => {
    assert.equal(toStatus("something-else"), null);
  });

  test("a missing info object still yields a drawable status", () => {
    assert.deepEqual(toStatus("update-available"), { state: "available", version: null });
    assert.deepEqual(toStatus("download-progress"), {
      state: "downloading",
      percent: 0,
      transferred: 0,
      total: 0,
    });
  });
});

describe("status delivery", () => {
  test("pushes each updater event down the single event channel", () => {
    const stub = stubUpdater();
    createUpdater({
      autoUpdater: stub.autoUpdater,
      app: { getVersion: () => "1.0.0" },
      getWindow: () => stub.win,
    });
    stub.autoUpdater.emit("update-available", { version: "1.2.0" });
    stub.autoUpdater.emit("update-downloaded", { version: "1.2.0" });
    assert.deepEqual(stub.sent, [
      { channel: UPDATE_EVENT_CHANNEL, status: { state: "available", version: "1.2.0" } },
      { channel: UPDATE_EVENT_CHANNEL, status: { state: "ready", version: "1.2.0" } },
    ]);
  });

  test("drops the status rather than throwing when no window is open", () => {
    const stub = stubUpdater();
    createUpdater({
      autoUpdater: stub.autoUpdater,
      app: { getVersion: () => "1.0.0" },
      getWindow: () => null,
    });
    assert.doesNotThrow(() => stub.autoUpdater.emit("update-available", { version: "1.2.0" }));
    assert.deepEqual(stub.sent, []);
  });

  test("reports an updater error once, not on every retry", () => {
    const stub = stubUpdater();
    createUpdater({
      autoUpdater: stub.autoUpdater,
      app: { getVersion: () => "1.0.0" },
      getWindow: () => stub.win,
    });
    stub.autoUpdater.emit("error", new Error("no app-update.yml"));
    stub.autoUpdater.emit("error", new Error("no app-update.yml"));
    assert.equal(stub.sent.length, 1);
    assert.equal(stub.sent[0].status.state, "failed");
    assert.match(stub.sent[0].status.message, /app-update\.yml/);
  });
});

describe("check", () => {
  test("answers with the version it found", async () => {
    const stub = stubUpdater();
    const updater = createUpdater({
      autoUpdater: stub.autoUpdater,
      app: { getVersion: () => "1.0.0" },
      getWindow: () => stub.win,
    });
    assert.deepEqual(await updater.check(trustedEvent(stub.win)), { ok: true, version: "9.9.9" });
  });

  test("only the main window may ask", async () => {
    const stub = stubUpdater();
    const updater = createUpdater({
      autoUpdater: stub.autoUpdater,
      app: { getVersion: () => "1.0.0" },
      getWindow: () => stub.win,
    });
    await assert.rejects(() => updater.check({ sender: {} }), /unknown window/);
    await assert.rejects(() => updater.check(undefined), /unknown window/);
  });

  test("turns a failed check into an answer, not a rejection", async () => {
    const stub = stubUpdater({
      checkForUpdates: async () => {
        throw new Error("net::ERR_INTERNET_DISCONNECTED");
      },
    });
    const updater = createUpdater({
      autoUpdater: stub.autoUpdater,
      app: { getVersion: () => "1.0.0" },
      getWindow: () => stub.win,
    });
    const result = await updater.check(trustedEvent(stub.win));
    assert.equal(result.ok, false);
    assert.match(result.message, /INTERNET_DISCONNECTED/);
    // The renderer learns about it without having asked too.
    assert.ok(stub.sent.some((entry) => entry.status.state === "failed"));
  });
});
