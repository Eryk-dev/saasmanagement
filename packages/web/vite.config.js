import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.API_TARGET || "http://localhost:8787";

// O app é carregado por import() dinâmico em main.jsx (depois do bootstrap), e
// o Vite só avisa o navegador desse chunk na hora do import(). Injetar o
// modulepreload no index.html faz o download/compilação dos 2 MB começar
// junto com o HTML, em paralelo com o /api/bootstrap, em vez de depois dele.
function preloadAppChunk() {
  return {
    name: "cockpit-preload-app-chunk",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const chunk = Object.values(ctx.bundle || {}).find((c) => c.type === "chunk" && /\/src\/app\.jsx$/.test(c.facadeModuleId || ""));
        if (!chunk) return [];
        const tags = [{ tag: "link", attrs: { rel: "modulepreload", crossorigin: true, href: "/" + chunk.fileName }, injectTo: "head" }];
        for (const css of chunk.viteMetadata?.importedCss || []) {
          tags.push({ tag: "link", attrs: { rel: "preload", as: "style", href: "/" + css }, injectTo: "head" });
        }
        return tags;
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadAppChunk()],
  build: {
    rollupOptions: {
      output: {
        // React num chunk próprio: não muda entre deploys, então fica no cache
        // do navegador enquanto o app troca de hash.
        manualChunks: { react: ["react", "react-dom"] },
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
