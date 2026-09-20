import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths: the same build serves over HTTP (dev/preview)
  // and file:// (Electron loadFile).
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
});
