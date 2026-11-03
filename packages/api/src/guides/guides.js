// Guias (base de conhecimento interna, 03/11/2026): o passo a passo que o
// operador de integração, o CS e o suporte seguem, com texto, dica e os prints
// das telas. Um guia é de um produto do cockpit (`saas`) e pode falar de um
// sistema específico (`product`: LeverAds, LeverPrice).
//
//   guides        { id, saas, title, summary, audience, product, order, status, rev,
//                   steps: [{ id, title, body, tip, images: [{ id, caption }] }] }
//   guide_assets  os prints (base64, até 5 MB), servidos só com sessão pela
//                 rota /api/guides/assets/:id (a tela baixa e mostra em blob).
//
// Ler: quem tem a tela Guias, Clientes, Pipeline, Atividades ou Análise de
// Integração (o card da Integração abre o guia). Escrever: etiqueta admin ou
// "Editor de guias" (`guias`). Rascunho só aparece para quem edita.
//
// Os itens do checklist da integração apontam para um passo de guia
// (`item.guide = { id, step }`, onboarding-templates.js); o card da integração
// abre o guia naquele passo.

import { randomUUID } from "node:crypto";
import { saveTemplates, templatesOf } from "../customers/onboarding-templates.js";
import { STARTER_GUIDE, STARTER_ID, STARTER_LINKS } from "./guide-starter.js";

export const GUIDES = "guides";
export const GUIDE_ASSETS = "guide_assets";
export const AUDIENCES = ["integrador", "cs", "suporte"];
export const GUIDE_PRODUCTS = ["", "leverads", "leverprice"];
export const GUIDE_STATUS = ["rascunho", "publicado"];
export const MAX_STEPS = 40;
export const MAX_IMAGES = 6;
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const s = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
// Texto longo preserva as quebras de linha (o passo é lido em markdown simples).
const text = (v, max) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim().slice(0, max) : "");
const shortId = (p) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

export function canEditGuides(user) {
  if (!user) return true; // chave mestre (MCP, integrações)
  const roles = Array.isArray(user.roles) ? user.roles : [];
  return roles.includes("admin") || roles.includes("guias");
}

export function cleanSteps(list) {
  if (!Array.isArray(list)) throw fail(400, "Envie os passos em lista.");
  if (list.length > MAX_STEPS) throw fail(400, `Um guia tem no máximo ${MAX_STEPS} passos.`);
  const seen = new Set();
  return list.map((st, i) => {
    const title = s(st?.title, 160);
    if (!title) throw fail(400, `Passo ${i + 1} sem título.`);
    let id = s(st?.id, 40);
    if (!/^[a-z0-9_-]{2,40}$/i.test(id) || seen.has(id)) id = shortId("st");
    seen.add(id);
    const images = Array.isArray(st?.images) ? st.images : [];
    if (images.length > MAX_IMAGES) throw fail(400, `Passo ${i + 1}: no máximo ${MAX_IMAGES} prints.`);
    return {
      id, title, body: text(st?.body, 4000), tip: text(st?.tip, 400),
      images: images.map((im) => ({ id: s(im?.id, 60), caption: s(im?.caption, 160) })).filter((im) => /^ga_[a-z0-9_]+$/i.test(im.id)),
    };
  });
}

export function cleanGuide(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => body && Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has("title")) {
    out.title = s(body?.title, 120);
    if (!out.title) throw fail(400, "Dê um título ao guia.");
  }
  if (!partial || has("summary")) out.summary = text(body?.summary, 400);
  if (!partial || has("audience")) {
    const a = body?.audience ?? "integrador";
    if (!AUDIENCES.includes(a)) throw fail(400, `Público inválido: ${a}`);
    out.audience = a;
  }
  if (!partial || has("product")) {
    const p = body?.product ?? "";
    if (!GUIDE_PRODUCTS.includes(p)) throw fail(400, `Produto inválido: ${p}`);
    out.product = p;
  }
  if (!partial || has("status")) {
    const st = body?.status ?? "rascunho";
    if (!GUIDE_STATUS.includes(st)) throw fail(400, `Status inválido: ${st}`);
    out.status = st;
  }
  // Posição na trilha de leitura do sistema (1 = ler primeiro; 0 = sem ordem,
  // vai para o fim, por título).
  if (!partial || has("order")) {
    const n = Math.trunc(Number(body?.order));
    out.order = n >= 1 && n <= 999 ? n : 0;
  }
  if (!partial || has("steps")) out.steps = cleanSteps(body?.steps ?? []);
  return out;
}

// Ordem de leitura: comuns primeiro, depois cada sistema; dentro dele, a
// posição na trilha e o título.
export function compareGuides(a, b) {
  const pa = GUIDE_PRODUCTS.indexOf(a.product || ""), pb = GUIDE_PRODUCTS.indexOf(b.product || "");
  if (pa !== pb) return pa - pb;
  const oa = Number(a.order) || 1000, ob = Number(b.order) || 1000;
  if (oa !== ob) return oa - ob;
  return String(a.title).localeCompare(String(b.title), "pt-BR");
}

// Lista do produto. Quem não edita vê só os publicados.
export async function listGuides(repo, { saas = "", editor = false } = {}) {
  const rows = await repo.listWhere(GUIDES, saas ? { saas } : {});
  return rows
    .filter((g) => editor || g.status === "publicado")
    .sort(compareGuides);
}

export async function getGuide(repo, id, { editor = false } = {}) {
  const g = await repo.get(GUIDES, id);
  if (!g || (!editor && g.status !== "publicado")) throw fail(404, "Guia não encontrado.");
  return g;
}

export async function createGuide(repo, body, { by = "", now = new Date() } = {}) {
  const saas = s(body?.saas, 40);
  if (!saas || !(await repo.get("products", saas))) throw fail(400, "Produto do cockpit inválido.");
  const at = now.toISOString();
  return repo.create(GUIDES, {
    id: shortId("gd"), saas, ...cleanGuide(body), rev: 1,
    createdAt: at, createdBy: by, updatedAt: at, updatedBy: by,
    publishedAt: body?.status === "publicado" ? at : "",
    ...(s(body?.starter, 40) ? { starter: s(body.starter, 40) } : {}),
  });
}

// `rev` evita que duas pessoas editando o mesmo guia se apaguem: quem salva com
// a versão velha recebe 409 e recarrega.
export async function updateGuide(repo, id, body, { by = "", now = new Date() } = {}) {
  const cur = await repo.get(GUIDES, id);
  if (!cur) throw fail(404, "Guia não encontrado.");
  if (body?.rev !== undefined && Number(body.rev) !== Number(cur.rev || 1)) {
    throw fail(409, "Alguém salvou este guia enquanto você editava. Recarregue para ver a versão nova.");
  }
  const patch = cleanGuide(body, { partial: true });
  if (!Object.keys(patch).length) return cur;
  const at = now.toISOString();
  if (patch.status === "publicado" && cur.status !== "publicado") patch.publishedAt = at;
  return repo.update(GUIDES, id, { ...patch, rev: Number(cur.rev || 1) + 1, updatedAt: at, updatedBy: by });
}

// Apaga o guia e os prints que só ele usava.
export async function deleteGuide(repo, id) {
  const cur = await repo.get(GUIDES, id);
  if (!cur) throw fail(404, "Guia não encontrado.");
  await repo.remove(GUIDES, id);
  const mine = new Set((cur.steps || []).flatMap((st) => (st.images || []).map((im) => im.id)));
  if (mine.size) {
    const others = await repo.listWhere(GUIDES, { saas: cur.saas });
    for (const g of others) for (const st of g.steps || []) for (const im of st.images || []) mine.delete(im.id);
    for (const assetId of mine) await repo.remove(GUIDE_ASSETS, assetId).catch(() => {});
  }
  return { ok: true };
}

export async function saveGuideAsset(repo, { saas, mime, buf, by = "", now = new Date() }) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mime || "")) throw fail(400, "Envie uma imagem PNG, JPG, WEBP ou GIF.");
  if (!buf?.length) throw fail(400, "Imagem vazia.");
  if (buf.length > MAX_ASSET_BYTES) throw fail(413, "Imagem acima de 5 MB: recorte ou comprima o print.");
  const id = shortId("ga");
  await repo.create(GUIDE_ASSETS, { id, saas, mime, size: buf.length, data: buf.toString("base64"), by, at: now.toISOString() });
  return { id };
}

// Guia inicial de implantação (guide-starter.js): cria o rascunho uma vez por
// produto e liga os itens do checklist "Implantação inicial" aos passos dele
// (só os itens ainda sem guia). Rodar de novo não duplica nada.
export async function createStarterGuide(repo, saas, { by = "", now = new Date() } = {}) {
  const existing = (await repo.listWhere(GUIDES, { saas })).find((g) => g.starter === STARTER_ID);
  const guide = existing || await createGuide(repo, { ...STARTER_GUIDE, saas }, { by, now });
  const templates = await templatesOf(repo, saas);
  let linked = 0;
  const next = templates.map((t) => (t.kind !== "implantacao" ? t : {
    ...t,
    items: (t.items || []).map((it) => {
      const step = STARTER_LINKS[it.title];
      if (!step || it.guide) return it;
      linked++;
      return { ...it, guide: { id: guide.id, step } };
    }),
  }));
  if (linked) await saveTemplates(repo, saas, next);
  return { guide, created: !existing, linked };
}
