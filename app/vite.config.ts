import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Vite's dev server needs more than the production policy in index.html allows:
// an inline React refresh preamble, eval in the client, and a websocket for HMR.
// Swapped in for `vite dev` only, so a build keeps the strict tag.
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

function devCsp(): Plugin {
  return {
    name: "dither-dev-csp",
    apply: "serve",
    transformIndexHtml: {
      order: "post",
      handler: (html) =>
        html.replace(
          /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/,
          `$1${DEV_CSP}$2`,
        ),
    },
  };
}

export default defineConfig({
  // Relative asset paths: the same build serves over HTTP (dev/preview)
  // and file:// (Electron loadFile).
  base: "./",
  plugins: [react(), tailwindcss(), devCsp()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  worker: { format: "es" },
});
