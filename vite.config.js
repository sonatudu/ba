import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages sets BASE=/ba/. Android/Play must use relative URLs or the
  // WebView loads a blank shell (only the HTML privacy paragraph).
  base: process.env.BASE || "./",
  plugins: [
    {
      name: "webview-classic-script",
      transformIndexHtml: {
        order: "post",
        handler(html) {
          return html
            .replace(/ crossorigin(="[^"]*")?/g, "")
            .replace(/<script type="module" src=/g, "<script defer src=");
        },
      },
    },
  ],
  build: {
    // Android WebView often skips type=module (CORS on https://localhost).
    // One classic IIFE file runs the same as a normal <script defer>.
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "assets/ba.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    cors: true,
    watch: {
      ignored: ["**/android/**", "**/dist/**", "**/.idea/**", "**/node_modules/**"],
    },
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
