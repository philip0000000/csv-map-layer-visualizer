import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves this project from:
// https://philip0000000.github.io/csv-map-layer-visualizer/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "desktop" ? "./" : mode === "production" ? "/csv-map-layer-visualizer/" : "/",
  worker: {
    format: "es",
  },
  build: {
    rollupOptions: {
      input: mode === "desktop"
        ? { app: "index.html" }
        : {
            app: "index.html",
            sqliteWasmPrototype: "sqlite-wasm-prototype.html",
          },
    },
  },
}));
