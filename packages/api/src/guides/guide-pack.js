// Instalação do pacote de guias da Lever (pack/index.js) num produto do cockpit.
//
// Cada guia do pacote tem `key` e `version`. No banco, o guia instalado guarda
// `pack` (a chave), `packVersion` e `packRev` (o `rev` logo depois de instalar).
//   · não existe → cria;
//   · existe na mesma versão → nada;
//   · existe em versão velha e ninguém mexeu (rev === packRev) → atualiza;
//   · existe em versão velha e alguém editou no Cockpit → NÃO sobrescreve,
//     relata (quem edita decide: apagar e reinstalar, ou ajustar à mão).
// A posição na trilha (`order`) vem da ordem do pacote dentro de cada sistema;
// guia instalado sem posição recebe a do pacote sem contar como edição.
// Os prints saem de pack/prints/<arquivo> para `guide_assets` com id derivado
// do conteúdo (o mesmo print não duplica entre instalações).

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GUIDES, GUIDE_ASSETS, cleanGuide } from "./guides.js";
import { GUIDE_PACK } from "./pack/index.js";
import { saveTemplates, templatesOf } from "../customers/onboarding-templates.js";

const PRINTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "pack", "prints");
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const defaultReader = (file) => readFile(join(PRINTS_DIR, file));

// Status de cada guia do pacote no produto (o que o botão vai fazer).
export async function packStatus(repo, saas, { pack = GUIDE_PACK } = {}) {
  const mine = (await repo.listWhere(GUIDES, { saas })).filter((g) => g.pack);
  return pack.map((p) => {
    const g = mine.find((x) => x.pack === p.key);
    const state = !g ? "faltando" : g.packVersion === p.version ? "atual"
      : Number(g.rev) === Number(g.packRev) ? "desatualizado" : "editado";
    return { key: p.key, title: p.title, version: p.version, state, guide: g?.id || "" };
  });
}

async function stepsWithAssets(repo, saas, steps, readImage, by, now) {
  const out = [];
  for (const st of steps) {
    const images = [];
    for (const im of st.images || []) {
      const buf = await readImage(im.file);
      const ext = String(im.file).split(".").pop().toLowerCase();
      const id = `ga_pack_${createHash("sha1").update(saas).update(im.file).update(buf).digest("hex").slice(0, 20)}`;
      if (!(await repo.get(GUIDE_ASSETS, id))) {
        await repo.create(GUIDE_ASSETS, { id, saas, mime: MIME[ext] || "image/png", size: buf.length, data: buf.toString("base64"), by, at: now.toISOString(), pack: im.file });
      }
      images.push({ id, caption: im.caption || "" });
    }
    out.push({ ...st, images });
  }
  return out;
}

// Posição de cada guia na trilha do seu sistema, pela ordem do pacote.
export function packOrder(pack = GUIDE_PACK) {
  const seen = {};
  return Object.fromEntries(pack.map((p) => {
    const k = p.product || "";
    seen[k] = (seen[k] || 0) + 1;
    return [p.key, p.order || seen[k]];
  }));
}

// Checklist de implantação → passo do guia da call do pacote. Liga os itens sem
// guia e os que apontavam para o rascunho de implantação (guide-starter.js),
// que o guia da call substitui.
export const PACK_CALL_KEY = "call-integracao";
export const PACK_CHECKLIST_LINKS = {
  "Formulário de integração respondido": "confirmar",
  "Acesso às contas dos marketplaces": "confirmar",
  "Kickoff com o cliente": "entrar",
  "Contas conectadas e configuração feita": "configurar",
  "Primeira entrega no ar (anúncios ou regras)": "primeira-entrega",
  "Treinamento do time do cliente": "acompanhamento",
  "Go-live confirmado com o cliente": "depois",
};

export async function linkPackChecklist(repo, saas) {
  const guides = await repo.listWhere(GUIDES, { saas });
  const call = guides.find((g) => g.pack === PACK_CALL_KEY);
  if (!call) return 0;
  const starters = new Set(guides.filter((g) => g.starter).map((g) => g.id));
  let linked = 0;
  const next = (await templatesOf(repo, saas)).map((t) => (t.kind !== "implantacao" ? t : {
    ...t,
    items: (t.items || []).map((it) => {
      const step = PACK_CHECKLIST_LINKS[it.title];
      if (!step || (it.guide && !starters.has(it.guide.id))) return it;
      linked++;
      return { ...it, guide: { id: call.id, step } };
    }),
  }));
  if (linked) await saveTemplates(repo, saas, next);
  return linked;
}

export async function installGuidePack(repo, saas, { by = "", now = new Date(), pack = GUIDE_PACK, readImage = defaultReader, status = "publicado" } = {}) {
  const report = { installed: [], updated: [], current: [], edited: [] };
  const states = await packStatus(repo, saas, { pack });
  const orders = packOrder(pack);
  for (const p of pack) {
    const st = states.find((x) => x.key === p.key);
    if (st.state === "atual" || st.state === "editado") {
      const cur = await repo.get(GUIDES, st.guide);
      if (cur && !Number(cur.order)) await repo.update(GUIDES, cur.id, { order: orders[p.key] });
      report[st.state === "atual" ? "current" : "edited"].push(p.key);
      continue;
    }
    const steps = await stepsWithAssets(repo, saas, p.steps, readImage, by, now);
    const body = cleanGuide({ title: p.title, summary: p.summary, audience: p.audience, product: p.product, order: orders[p.key], status: p.status || status, steps });
    const at = now.toISOString();
    if (st.state === "faltando") {
      const id = `gd_pk${createHash("sha1").update(saas).update(p.key).digest("hex").slice(0, 12)}`;
      await repo.create(GUIDES, {
        id, saas, ...body, rev: 1, pack: p.key, packVersion: p.version, packRev: 1,
        createdAt: at, createdBy: by, updatedAt: at, updatedBy: by, publishedAt: body.status === "publicado" ? at : "",
      });
      report.installed.push(p.key);
    } else {
      const cur = await repo.get(GUIDES, st.guide);
      const rev = Number(cur.rev || 1) + 1;
      await repo.update(GUIDES, cur.id, { ...body, rev, packVersion: p.version, packRev: rev, updatedAt: at, updatedBy: by });
      report.updated.push(p.key);
    }
  }
  report.linked = await linkPackChecklist(repo, saas);
  return report;
}
