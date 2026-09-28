// Prints do anúncio padrão da apresentação de CRIAÇÃO DE ANÚNCIOS (OEM).
//
// Pega os prints como eles vêm (PNG do Mac, JPEG do celular, o que for),
// redimensiona e grava em packages/api/src/assets/deck-oem com os nomes que o
// deck procura (proposal-oem-page.js → OEM_PRINTS). Rodar de novo troca os
// prints: é o caminho pra atualizar o anúncio de exemplo quando ele mudar.
//
//   node packages/api/scripts/2026-09-28-prints-deck-oem.mjs ~/Downloads/oem-prints
//
// A ORDEM DOS ARQUIVOS na pasta é o que define o destino (ordem alfabética, que
// é a ordem em que os prints foram tirados):
//   1 página do anúncio · 2-6 as cinco fotos · 7 ficha técnica · 8 e 9 a descrição
//   em duas partes (ela não cabe legível numa tela só)
// Arquivo a mais é ignorado; a menos, o deck mostra o espaço reservado daquele
// print e o resto continua de pé.
//
// Usa o `sips` do macOS (sem dependência nova no projeto). Peso alvo: o print da
// página e os textos em 1600/1400px de lado maior, as fotos em 900 — o slide
// mostra cada um em menos de 1000px de largura real.

import { readdir, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const run = promisify(execFile);
const DESTINO = fileURLToPath(new URL("../src/assets/deck-oem/", import.meta.url));

const ALVOS = [
  { nome: "anuncio.jpg", lado: 1600, o: "print da página do anúncio" },
  { nome: "foto-1.jpg", lado: 900, o: "foto principal (peça + aplicação)" },
  { nome: "foto-2.jpg", lado: 900, o: "foto em perspectiva" },
  { nome: "foto-3.jpg", lado: 900, o: "foto de frente" },
  { nome: "foto-4.jpg", lado: 900, o: "foto do conector" },
  { nome: "foto-5.jpg", lado: 900, o: "foto com as medidas" },
  { nome: "ficha.jpg", lado: 1400, o: "print da ficha técnica" },
  { nome: "descricao-1.jpg", lado: 1300, o: "print da descrição, primeira parte" },
  { nome: "descricao-2.jpg", lado: 1300, o: "print da descrição, segunda parte" },
];

const origem = process.argv[2];
if (!origem) {
  console.error("uso: node packages/api/scripts/2026-09-28-prints-deck-oem.mjs <pasta com os prints>");
  process.exit(1);
}

const arquivos = (await readdir(origem))
  .filter((f) => /\.(png|jpe?g|webp|heic|tiff?)$/i.test(f) && !f.startsWith("."))
  .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

if (!arquivos.length) {
  console.error(`nenhuma imagem em ${origem}`);
  process.exit(1);
}

await mkdir(DESTINO, { recursive: true });
for (const [i, alvo] of ALVOS.entries()) {
  const src = arquivos[i];
  if (!src) {
    console.log(`· ${alvo.nome} ficou de fora (faltou o ${i + 1}º arquivo: ${alvo.o})`);
    continue;
  }
  const out = DESTINO + alvo.nome;
  await run("/usr/bin/sips", [
    "-s", "format", "jpeg",
    "-s", "formatOptions", "82",
    "-Z", String(alvo.lado),
    "--out", out,
    path.join(origem, src),
  ]);
  const { size } = await stat(out);
  console.log(`✓ ${src} → ${alvo.nome} (${alvo.o}, ${Math.round(size / 1024)} kB)`);
}
console.log("\nprints prontos em packages/api/src/assets/deck-oem");
