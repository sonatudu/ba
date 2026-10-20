import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages sets BASE=/ba/. Android/Play must use relative URLs or the
  // WebView loads a blank shell (only the HTML privacy paragraph).
  base: process.env.BASE || "./",
  plugins: [
    {
      name: "no-crossorigin",
      transformIndexHtml(html) {
        return html.replace(/ crossorigin/g, "");
      },
    },
  ],
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
