// Impressão digital do código da API EM EXECUÇÃO: sha256 do conteúdo de
// packages/api/src (caminhos ordenados), encurtado. O /api/health devolve isso
// e comparar com o mesmo cálculo na main local responde "o deploy do EasyPanel
// está atualizado?" com prova, sem depender de git dentro da imagem (o
// .dockerignore exclui o .git de propósito, pra não inchar o build context).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let cached = "";
export function srcFingerprint() {
  if (cached) return cached;
  try {
    const root = dirname(fileURLToPath(import.meta.url));
    const files = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) files.push(p);
      }
    };
    walk(root);
    files.sort();
    const h = createHash("sha256");
    for (const f of files) { h.update(f.slice(root.length)); h.update(readFileSync(f)); }
    cached = h.digest("hex").slice(0, 12);
  } catch { cached = "unknown"; }
  return cached;
}

// `node packages/api/src/build-info.js` imprime a impressão da árvore local —
// é o lado "main" da comparação com o /api/health do ar.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(srcFingerprint());
}
