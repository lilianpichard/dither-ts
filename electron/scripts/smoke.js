// Package smoke: start the built app, wait for its window, read a few facts out
// of the renderer, then shut it down. Only node's own http and WebSocket clients
// are used, so it runs wherever the package does. Needs a display; on a headless
// host wrap it in `xvfb-run -a`. Extra electron flags go in DITHER_SMOKE_ARGS
// (for example --no-sandbox where the setuid sandbox helper is unavailable).
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const RELEASE = path.join(ROOT, "release");
const BOOT_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;

/** The packaged binary, wherever electron-builder put it for this platform. */
function locateBinary() {
  const name = "dither-ts";
  const candidates =
    process.platform === "win32"
      ? [path.join(RELEASE, "win-unpacked", `${name}.exe`)]
      : process.platform === "darwin"
        ? fs
            .readdirSync(RELEASE)
            .filter((entry) => entry.startsWith("mac"))
            .map((entry) => path.join(RELEASE, entry, `${name}.app`, "Contents", "MacOS", name))
        : [path.join(RELEASE, "linux-unpacked", name)];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`no packaged app at ${candidates[0]}; run \`npm run dist-dir\` first`);
  }
  return found;
}

/** An unused port, so a stale app from an earlier run cannot be mistaken for it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The app's page target, once the renderer has navigated to the document. */
async function findPage(port, child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the app exited with code ${child.exitCode} before loading a window`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (target) => target.type === "page" && target.url.endsWith("index.html"),
      );
      if (page) return page;
    } catch {
      // Not listening yet.
    }
    await sleep(300);
  }
  throw new Error(`no app window appeared within ${BOOT_TIMEOUT_MS / 1000}s`);
}

/** Ask the renderer one question and hand back the answer. */
function ask(socket, id, expression) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out asking: ${expression}`)), 10_000);
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result.result.value);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression } }));
  });
}

/** What the smoke insists on: the app booted, locked down, and running its bundle. */
const CHECKS = [
  ["the renderer runs from the packaged asar", "location.protocol === 'file:'"],
  ["the app document is the one that was loaded", "location.pathname.endsWith('index.html')"],
  [
    "the bridge is exposed",
    "JSON.stringify(Object.keys(window.ditherDesktop || {}).sort()) === JSON.stringify(['open','pickDirectory','save','versions'])",
  ],
  [
    "the renderer has no node",
    "typeof window.require + typeof window.process === 'undefinedundefined'",
  ],
  ["no node globals leaked in", "typeof window.module === 'undefined'"],
  // The bundle mounts after the window opens, so this one is waited for.
  ["the app rendered", "document.getElementById('root').childElementCount > 0", true],
  [
    "the document carries its content security policy",
    "Boolean(document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]'))",
  ],
];

async function main() {
  const binary = locateBinary();
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dither-smoke-"));
  const logs = [];
  const child = spawn(
    binary,
    [
      ...(process.env.DITHER_SMOKE_ARGS ?? "").split(" ").filter(Boolean),
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
    ],
    { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => logs.push(String(chunk)));
  }

  const stop = async () => {
    if (child.exitCode !== null) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
    const gone = await Promise.race([
      new Promise((resolve) => child.once("exit", () => resolve(true))),
      sleep(STOP_TIMEOUT_MS).then(() => false),
    ]);
    if (!gone) {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }
  };

  let failures = 0;
  try {
    console.log(`smoke: ${path.relative(ROOT, binary)}`);
    const page = await findPage(port, child);
    if (typeof WebSocket !== "function") {
      throw new Error("this node has no global WebSocket, so the renderer cannot be inspected");
    }
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("devtools socket failed")), {
        once: true,
      });
    });
    let id = 0;
    for (const [label, expression, settle] of CHECKS) {
      let value = await ask(socket, ++id, expression);
      // A check the app has not got round to yet is not a failure.
      const deadline = Date.now() + (settle ? BOOT_TIMEOUT_MS : 0);
      while (value !== true && settle && Date.now() < deadline) {
        await sleep(250);
        value = await ask(socket, ++id, expression);
      }
      if (value !== true) {
        failures += 1;
        console.error(`smoke: FAILED ${label}`);
      } else {
        console.log(`smoke: ok ${label}`);
      }
    }
    socket.close();
  } catch (error) {
    failures += 1;
    console.error(`smoke: ${error.message}`);
    for (const line of logs.join("").split("\n").filter(Boolean).slice(-8)) {
      console.error(`smoke: app said: ${line}`);
    }
  } finally {
    await stop();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(failures === 0 ? "smoke: passed" : `smoke: ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`smoke: ${error.message}`);
  process.exitCode = 1;
});
