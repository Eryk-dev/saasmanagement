import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.API_TARGET || "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls to the Fastify server so the browser stays same-origin in dev.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
});
