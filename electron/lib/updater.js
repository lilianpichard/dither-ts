// Auto-update wiring. electron-updater is injected so the policy can be
// asserted without a network or a signed build. A build with no feed behind it
// still registers the channel and answers, because a channel nobody handles is
// what makes the renderer show an ipc error instead of a sentence.

const { UPDATE_CHANNEL, UPDATE_EVENT_CHANNEL } = require("./contract");

// Download and install once ready, then let the user restart. Quitting without
// asking would discard whatever they were working on.
const DEFAULT_POLICY = Object.freeze({
  autoDownload: true,
  autoInstallOnAppQuit: true,
  allowDowngrade: false,
});

/** What a build with no feed behind it says when asked. */
const NO_FEED = "Updates only run in a packaged build.";

/** Map an updater event to the small shape the renderer renders. */
function toStatus(event, info) {
  switch (event) {
    case "checking-for-update":
      return { state: "checking" };
    case "update-available":
      return { state: "available", version: info?.version ?? null };
    case "update-not-available":
      return { state: "current", version: info?.version ?? null };
    case "download-progress":
      return {
        state: "downloading",
        percent: Math.round(info?.percent ?? 0),
        transferred: info?.transferred ?? 0,
        total: info?.total ?? 0,
      };
    case "update-downloaded":
      return { state: "ready", version: info?.version ?? null };
    default:
      return null;
  }
}

function describeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { state: "failed", message };
}

/**
 * @param autoUpdater electron-updater's autoUpdater, or null when there is no
 *   feed to read. Either way the channel is registered.
 */
function createUpdater({ autoUpdater, app, ipcMain, getWindow, policy, reason }) {
  const rules = { ...DEFAULT_POLICY, ...policy };
  const blocked = autoUpdater ? null : (reason ?? NO_FEED);

  // An unpackaged run has no app-update.yml, so every check fails with a
  // message nobody can act on. Report it once instead of on every launch.
  let reported = null;

  function publish(status) {
    if (!status) return;
    const win = typeof getWindow === "function" ? getWindow() : null;
    win?.webContents?.send(UPDATE_EVENT_CHANNEL, status);
  }

  if (autoUpdater) {
    autoUpdater.autoDownload = rules.autoDownload;
    autoUpdater.autoInstallOnAppQuit = rules.autoInstallOnAppQuit;
    autoUpdater.allowDowngrade = rules.allowDowngrade;
    for (const event of [
      "checking-for-update",
      "update-available",
      "update-not-available",
      "download-progress",
      "update-downloaded",
    ]) {
      autoUpdater.on(event, (info) => publish(toStatus(event, info)));
    }
    autoUpdater.on("error", (error) => {
      if (reported) return;
      reported = describeError(error);
      publish(reported);
    });
  }

  async function check(event) {
    const win = typeof getWindow === "function" ? getWindow() : null;
    // Same sender rule as the file bridge: only the main window may ask.
    if (!win || !event || event.sender !== win.webContents) {
      throw new Error("updater: refusing a request from an unknown window");
    }
    if (blocked) return { ok: false, version: null, message: blocked };
    publish({ state: "checking" });
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, version: result?.updateInfo?.version ?? app?.getVersion?.() ?? null };
    } catch (error) {
      // electron-updater answers with a code on its errors; keep it, the
      // renderer shows the message rather than guessing.
      const described = describeError(error);
      publish(described);
      return { ok: false, ...described };
    }
  }

  return {
    check,
    /** Wire the single check channel, and nothing else. */
    register(target = ipcMain) {
      target.handle(UPDATE_CHANNEL, check);
      return [UPDATE_CHANNEL];
    },
  };
}

module.exports = { DEFAULT_POLICY, NO_FEED, createUpdater, toStatus };
