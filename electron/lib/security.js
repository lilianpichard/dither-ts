// Lockdown for the renderer: one content security policy, no navigation away
// from the app, no new windows, no device permissions. Every function takes its
// electron objects as arguments so the policy can be asserted without a window.

/**
 * The production policy. Two inline scripts are allowed, both by hash only: the
 * theme bootstrap in app/index.html, and the one next-themes renders into the app
 * root. React never executes the second one, but chromium still holds it against
 * the policy, so leaving it out fills the console with violations on every start.
 * `test/contract.test.js` recomputes the first hash from index.html, so editing
 * that script without updating it here fails the tests.
 */
const INLINE_SCRIPT_SHA256 = "sha256-ZKcBg24qTGcXBK/iOLaJAGANYkkgaozWOfC2jbdrBTY=";
const THEME_PROVIDER_SHA256 = "sha256-NYTXKnI17CvCoEQFteL070w4ynkOEgG7nkOg0Gu+5ZI=";

const DIRECTIVES = [
  "default-src 'self'",
  // Hash sources are quoted; a bare one parses as a host and is ignored.
  `script-src 'self' '${INLINE_SCRIPT_SHA256}' '${THEME_PROVIDER_SHA256}'`,
  // Radix and the sliders position themselves with inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
];

/** The policy for the app document, which app/index.html also carries. */
const DOCUMENT_SECURITY_POLICY = DIRECTIVES.join("; ");

/** The same policy as a response header, where frame-ancestors does apply. */
const CONTENT_SECURITY_POLICY = [...DIRECTIVES, "frame-ancestors 'none'"].join("; ");

/**
 * The renderer settings for every window: no node, isolated context, sandboxed
 * preload, and no way for a drop or a link to take the window somewhere else.
 */
function webPreferences(preloadPath) {
  return {
    preload: preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    navigateOnDragDrop: false,
    spellcheck: false,
  };
}

/** True when a value is a url the policy could compare a navigation against. */
function isDocumentUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** True when a URL is the app document itself, ignoring any fragment. */
function isAppUrl(url, appUrl) {
  try {
    const target = new URL(url);
    const app = new URL(appUrl);
    return (
      target.protocol === app.protocol &&
      target.host === app.host &&
      target.pathname === app.pathname
    );
  } catch {
    return false;
  }
}

/** Keep one webContents on the app document: no navigation, no popups, no webview. */
function restrictWebContents(contents, appUrl) {
  // A bare path here would quietly refuse every navigation, including the app's.
  if (!isDocumentUrl(appUrl)) throw new TypeError("app document must be a url, not a path");
  const block = (event, url) => {
    if (!isAppUrl(url, appUrl)) event.preventDefault();
  };
  const denyWebview = (event) => event.preventDefault();
  contents.on("will-navigate", block);
  contents.on("will-redirect", block);
  contents.on("will-attach-webview", denyWebview);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  return () => {
    contents.off("will-navigate", block);
    contents.off("will-redirect", block);
    contents.off("will-attach-webview", denyWebview);
  };
}

/** Deny every device permission and stamp the policy onto every response. */
function hardenSession(session) {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CONTENT_SECURITY_POLICY],
      },
    });
  });
  return CONTENT_SECURITY_POLICY;
}

module.exports = {
  INLINE_SCRIPT_SHA256,
  THEME_PROVIDER_SHA256,
  DOCUMENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY,
  webPreferences,
  isDocumentUrl,
  isAppUrl,
  restrictWebContents,
  hardenSession,
};
