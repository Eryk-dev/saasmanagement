import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(fileURLToPath(import.meta.url));

// Preview de tela: sobe UMA tela do cockpit com o dublê da API no lugar de
// lib/api.js, pra conferir desenho contra a prancha sem banco nem servidor.
// Não faz parte do build de produção (vite.config.js segue intocado).
export default defineConfig({
  root: path.resolve(raiz, "preview"),
  plugins: [react()],
  resolve: {
    // O regex casa o especificador INTEIRO: alias de RegExp troca só o
    // trecho casado, então /\/lib\/api\.js$/ deixaria o "../" na frente.
    alias: [{ find: /^.*\/lib\/api\.js$/, replacement: path.resolve(raiz, "preview/api-mock.js") }],
  },
  server: {
    port: 5199, strictPort: true, open: false,
    fs: { allow: [path.resolve(raiz, ".."), path.resolve(raiz, "../..")] },
  },
});
