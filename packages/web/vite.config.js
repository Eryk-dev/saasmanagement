import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.API_TARGET || "http://localhost:8787";

// O app entra por `import("./app.jsx")` DEPOIS do /api/bootstrap (main.jsx: os
// módulos leem window.SEED no import), então o Vite não sabe pré-carregar o
// chunk e o navegador só começava a baixar os ~580 KB (gzip) do app quando o
// bootstrap acabava. `modulepreload` baixa e compila sem EXECUTAR — a regra do
// SEED continua valendo — e o download sai do caminho crítico.
function preloadAppChunk() {
  return {
    name: "cockpit-preload-app-chunk",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const chunk = Object.values(ctx.bundle || {}).find((c) => c.type === "chunk" && /[\\/]src[\\/]app\.jsx$/.test(c.facadeModuleId || ""));
        if (!chunk) return html;
        const tags = [{ tag: "link", attrs: { rel: "modulepreload", href: `/${chunk.fileName}`, crossorigin: true }, injectTo: "head" }];
        for (const css of chunk.viteMetadata?.importedCss || []) tags.push({ tag: "link", attrs: { rel: "preload", as: "style", href: `/${css}` }, injectTo: "head" });
        return { html, tags };
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadAppChunk()],
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
