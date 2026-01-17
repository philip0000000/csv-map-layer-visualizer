import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves this project from:
  // https://philip0000000.github.io/csv-map-layer-visualizer/
  base: "/csv-map-layer-visualizer/",
  plugins: [react()],
});


