import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BASE || "/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: true,
    hmr: {
      host: "127.0.0.1",
      port: 5173,
      protocol: "ws",
    },
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
