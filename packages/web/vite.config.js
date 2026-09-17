import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.API_TARGET || "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  build: {
    // As telas carregam sob demanda (React.lazy em app.jsx): o shell (chrome,
    // drawer do lead, libs) é um chunk, cada tela é outro. React/react-dom num
    // chunk próprio pra não trocar de hash a cada mudança de tela.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    // Proxy API calls to the Fastify server so the browser stays same-origin in dev.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      // Superfície pública de forms e propostas — testáveis pelo dev server.
      "/f": { target: API_TARGET, changeOrigin: true },
      "/p": { target: API_TARGET, changeOrigin: true },
      "/public": { target: API_TARGET, changeOrigin: true },
      "/embed.js": { target: API_TARGET, changeOrigin: true },
    },
  },
});
