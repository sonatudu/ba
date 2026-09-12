import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BASE || "/",
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
