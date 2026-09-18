import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.API_TARGET || "http://localhost:8787";

// O app entra por `import("./app.jsx")` (main.jsx pede o chunk em paralelo com
// o /api/bootstrap desde 17/09), mas o Vite não pré-carrega import dinâmico:
// `modulepreload` no index.html faz o navegador baixar e compilar o shell antes
// mesmo do index.js rodar, sem EXECUTAR (nenhum módulo lê window.SEED no import).
function preloadAppChunk() {
  return {
    name: "cockpit-preload-app-chunk",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        // Com as telas em chunks separados o shell deixa de ter "fachada" única
        // (facadeModuleId vazio): acha pelo módulo que ele contém.
        const isApp = (id) => /[\\/]src[\\/]app\.jsx$/.test(id || "");
        const chunk = Object.values(ctx.bundle || {}).find((c) => c.type === "chunk" && (isApp(c.facadeModuleId) || (c.moduleIds || []).some(isApp)));
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
      "/s/": { target: API_TARGET, changeOrigin: true }, // portal do Suporte

      "/public": { target: API_TARGET, changeOrigin: true },
      "/embed.js": { target: API_TARGET, changeOrigin: true },
    },
  },
});
