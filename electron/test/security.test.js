// The lockdown: which URLs a window may reach, what it may open, which
// permissions it may ask for. All of it runs against stubs, so no window opens.

const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { test, describe } = require("node:test");

const {
  CONTENT_SECURITY_POLICY,
  hardenSession,
  isDocumentUrl,
  isAppUrl,
  restrictWebContents,
} = require("../lib/security");

const APP_URL = "file:///opt/dither-ts/electron/dist/index.html";

/** The document as main.js hands it over: a path turned into a file url. */
function documentUrl(absolutePath) {
  return pathToFileURL(absolutePath).href;
}

/** A webContents that records what was asked of it. */
function stubContents() {
  const listeners = new Map();
  return {
    listeners,
    windowOpen: null,
    on(event, handler) {
      listeners.set(event, handler);
    },
    off(event, handler) {
      if (listeners.get(event) === handler) listeners.delete(event);
    },
    setWindowOpenHandler(handler) {
      this.windowOpen = handler;
    },
    /** Fire an event the way electron would, and report if it was blocked. */
    fire(event, url) {
      let prevented = false;
      const event_ = { preventDefault: () => (prevented = true) };
      listeners.get(event)?.(event_, url);
      return prevented;
    },
  };
}

/** A session that records the permission and header handlers it was given. */
function stubSession() {
  const state = { permissionRequest: null, permissionCheck: null, headers: null };
  return {
    state,
    setPermissionRequestHandler(handler) {
      state.permissionRequest = handler;
    },
    setPermissionCheckHandler(handler) {
      state.permissionCheck = handler;
    },
    webRequest: {
      onHeadersReceived(handler) {
        state.headers = handler;
      },
    },
  };
}

describe("isAppUrl", () => {
  test("accepts the app document", () => {
    assert.equal(isAppUrl(APP_URL, APP_URL), true);
  });

  test("accepts the same document with a fragment or a query", () => {
    assert.equal(isAppUrl(`${APP_URL}#batch`, APP_URL), true);
    assert.equal(isAppUrl(`${APP_URL}?v=2`, APP_URL), true);
  });

  test("rejects another file, another host, and another scheme", () => {
    assert.equal(isAppUrl("file:///opt/dither-ts/electron/dist/other.html", APP_URL), false);
    assert.equal(isAppUrl("https://example.com/", APP_URL), false);
    assert.equal(isAppUrl("file://elsewhere/dist/index.html", APP_URL), false);
    assert.equal(isAppUrl("javascript:alert(1)", APP_URL), false);
    assert.equal(isAppUrl("", APP_URL), false);
  });

  test("rejects anything it cannot parse", () => {
    assert.equal(isAppUrl("not a url", "also not a url"), false);
  });
});

describe("isDocumentUrl", () => {
  test("accepts a url, in the form main.js builds from the document path", () => {
    assert.equal(isDocumentUrl(documentUrl("/opt/dither-ts/electron/dist/index.html")), true);
    assert.equal(isDocumentUrl(APP_URL), true);
  });

  test("rejects a filesystem path, which would silently refuse every navigation", () => {
    assert.equal(isDocumentUrl("/opt/dither-ts/electron/dist/index.html"), false);
    assert.equal(isDocumentUrl(""), false);
    assert.equal(isDocumentUrl(undefined), false);
  });
});

describe("the app document url", () => {
  test("matches the url the window actually loaded", () => {
    const doc = "/opt/dither-ts/electron/dist/index.html";
    const url = documentUrl(doc);
    // The exact spelling depends on the platform (Windows resolves the same
    // path to a drive letter), so compare against the URL the loader builds.
    assert.equal(url, pathToFileURL(doc).href);
    assert.equal(isAppUrl(url, url), true);
    assert.equal(isAppUrl(`${url}#batch`, url), true);
  });

  test("survives a path that needs escaping", () => {
    const doc = "/opt/My Apps/dither ts/dist/index.html";
    const url = documentUrl(doc);
    assert.ok(url.includes("My%20Apps"), url);
    assert.equal(isAppUrl(url, url), true);
    // The unescaped form is a different document and stays blocked.
    assert.equal(isAppUrl(doc, url), false);
  });

  test("matches the document as it sits inside the packaged asar", () => {
    const doc = "/opt/dither-ts/resources/app.asar/dist/index.html";
    const url = documentUrl(doc);
    assert.equal(isAppUrl(url, url), true);
    assert.equal(isAppUrl("file:///opt/dither-ts/resources/app.asar/dist/other.html", url), false);
  });

  test("a path instead of a url is refused outright, not quietly", () => {
    const contents = stubContents();
    assert.throws(
      () => restrictWebContents(contents, "/opt/dither-ts/electron/dist/index.html"),
      /must be a url/,
    );
    // Nothing was attached, so a bad policy cannot half-apply.
    assert.equal(contents.listeners.size, 0);
    assert.equal(contents.windowOpen, null);
  });
});

describe("restrictWebContents", () => {
  test("blocks navigation away from the app", () => {
    const contents = stubContents();
    restrictWebContents(contents, APP_URL);
    assert.equal(contents.fire("will-navigate", "https://example.com/"), true);
    assert.equal(contents.fire("will-navigate", "file:///etc/passwd"), true);
  });

  test("lets the app navigate to itself", () => {
    const contents = stubContents();
    restrictWebContents(contents, APP_URL);
    assert.equal(contents.fire("will-navigate", APP_URL), false);
    assert.equal(contents.fire("will-redirect", `${APP_URL}#export`), false);
  });

  test("denies every window it is asked to open", () => {
    const contents = stubContents();
    restrictWebContents(contents, APP_URL);
    assert.deepEqual(contents.windowOpen({ url: "https://example.com/" }), { action: "deny" });
    assert.deepEqual(contents.windowOpen({ url: APP_URL }), { action: "deny" });
  });

  test("refuses to adopt a webview", () => {
    const contents = stubContents();
    restrictWebContents(contents, APP_URL);
    assert.equal(contents.fire("will-attach-webview", undefined), true);
  });

  test("can be undone, which is what a closed window needs", () => {
    const contents = stubContents();
    const undo = restrictWebContents(contents, APP_URL);
    assert.equal(contents.listeners.size, 3);
    undo();
    assert.equal(contents.listeners.size, 0);
  });
});

describe("hardenSession", () => {
  test("denies every permission request", () => {
    const session = stubSession();
    hardenSession(session);
    const asked = [];
    session.state.permissionRequest({}, "media", (granted) => asked.push(granted));
    assert.deepEqual(asked, [false]);
  });

  test("denies every permission check too", () => {
    const session = stubSession();
    hardenSession(session);
    assert.equal(session.state.permissionCheck({}, "media"), false);
    assert.equal(session.state.permissionCheck({}, "clipboard-read"), false);
  });

  test("stamps the policy on responses without dropping other headers", () => {
    const session = stubSession();
    const applied = hardenSession(session);
    assert.equal(applied, CONTENT_SECURITY_POLICY);
    let received = null;
    session.state.headers({ responseHeaders: { "Content-Type": ["text/html"] } }, (result) => {
      received = result.responseHeaders;
    });
    assert.deepEqual(received["Content-Type"], ["text/html"]);
    assert.deepEqual(received["Content-Security-Policy"], [CONTENT_SECURITY_POLICY]);
  });

  test("stamps the policy on a response that had no headers at all", () => {
    const session = stubSession();
    hardenSession(session);
    let received = null;
    session.state.headers({ responseHeaders: undefined }, (result) => {
      received = result.responseHeaders;
    });
    assert.deepEqual(received, { "Content-Security-Policy": [CONTENT_SECURITY_POLICY] });
  });
});
