import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves this project from:
// https://philip0000000.github.io/csv-map-layer-visualizer/
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/csv-map-layer-visualizer/" : "/",
  plugins: [react()],
}));


