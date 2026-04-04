import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "chrome110",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-unicode11"],
          highlight: ["highlight.js/lib/core"],
          lucide: ["lucide-react"],
        },
      },
    },
  },
}));
