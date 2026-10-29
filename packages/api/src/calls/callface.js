// Callface (telefonia com IA): a ligação que a SDR faz pelo botão "Ligar" do
// card (shared/callface-dial.js abre o discador deles com o número e o id do
// lead) volta pra cá pelo webhook de saída, ao encerrar, com resumo da IA,
// áudio, duração e quem ligou. Aqui ela vira um toque `call` na timeline do
// lead, que re-agenda o GPS como um contato registrado à mão.
//
// Painel: app.callface.ai → Integrações → Webhooks → Saída (um por organização):
// URL https://<host>/api/webhooks/callface + "Header secret", que a Callface
// manda no header X-Callface-Signature em toda requisição (inclusive o teste).
//
// O clique no botão NÃO registra nada de propósito: fechar o discador sem ligar
// não pode virar "call" na timeline, e a ligação real chega aqui com os dados.
// Tudo que chega fica em `callface_calls` (privada), mesmo sem lead casado, e
// a rota responde 200 sempre que a assinatura bate, pra Callface não reenviar.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { logActivity, onActivityCreated } from "../crm/lead-flow.js";
import { waMatchKey } from "../whatsapp/wa-store.js";
import { TERMINAL_KINDS, kindOf } from "../crm/stages.js";

const same = (a, b) => {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

// `secret` = o "Header secret" do painel. A tela diz que o próprio valor vem
// no header; por garantia também aceita HMAC-SHA256 do corpo cru (hex ou
// base64) com o mesmo segredo, caso a Callface assine em vez de ecoar.
export function makeCallface({ secret = "" } = {}) {
  return {
    configured: () => !!secret,
    verifySignature(header, rawBody) {
      if (!secret || !header) return false;
      const sent = String(header).trim().replace(/^(sha256=|Bearer\s+)/i, "");
      if (same(sent, secret)) return true;
      const body = rawBody || Buffer.alloc(0);
      return same(sent, createHmac("sha256", secret).update(body).digest("hex"))
        || same(sent, createHmac("sha256", secret).update(body).digest("base64"));
    },
  };
}

export const callface = makeCallface({ secret: process.env.CALLFACE_WEBHOOK_SECRET || "" });

// Rótulos do call_status. Só FINISHED está documentado; os demais são os nomes
// usuais de telefonia e o desconhecido sai em minúsculas como veio.
export const CALL_STATUS_LABEL = {
  FINISHED: "concluída", ANSWERED: "concluída", COMPLETED: "concluída",
  NO_ANSWER: "não atendida", NOANSWER: "não atendida", NOT_ANSWERED: "não atendida",
  BUSY: "ocupado", FAILED: "falhou", CANCELED: "cancelada", CANCELLED: "cancelada", VOICEMAIL: "caixa postal",
};
export const statusLabel = (status) => {
  const key = String(status || "").trim().toUpperCase();
  return CALL_STATUS_LABEL[key] || (key ? key.toLowerCase().replace(/_/g, " ") : "");
};

const str = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
const isoOf = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : ""; };

// Id estável por ligação: o último segmento do call_link (…/calls/<call_id>);
// sem link, um hash de destino + data. É a chave de idempotência.
export function callfaceCallId(p) {
  const link = str(p?.callLink ?? p?.call_link);
  const seg = link.replace(/[?#].*$/, "").split("/").filter(Boolean).pop();
  if (seg && seg !== "calls") return "cf_" + seg.replace(/[^A-Za-z0-9_-]/g, "");
  const raw = `${str(p?.destination ?? p?.destination_number)}|${str(p?.at ?? p?.call_date)}`;
  return "cf_" + createHash("sha1").update(raw).digest("hex").slice(0, 24);
}

export function parseCallfacePayload(body) {
  const b = body && typeof body === "object" ? body : {};
  const p = {
    dealId: str(b.deal_id),
    contactId: str(b.contact_id),
    at: isoOf(b.call_date) || new Date().toISOString(),
    summary: str(b.summarization),
    transcription: Array.isArray(b.transcription) ? b.transcription : [],
    callLink: str(b.call_link),
    audioUrl: str(b.call_audio_url),
    durationSec: num(b.call_duration),
    userEmail: str(b.user_email).toLowerCase(),
    userName: str(b.user_name),
    destination: str(b.destination_number),
    status: str(b.call_status).toUpperCase(),
    closurePct: Number.isFinite(Number(b.deal_closure_percentage)) ? Number(b.deal_closure_percentage) : null,
    scheduling: b.scheduling && typeof b.scheduling === "object" ? b.scheduling : null,
  };
  p.callId = callfaceCallId(p);
  return p;
}

export const mmss = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Texto do toque: o resumo da IA quando veio; senão "Ligação pela Callface" com
// o estado e a duração, pra timeline dizer o que houve mesmo sem resumo.
export function callfaceActivityText(p) {
  if (p.summary) return p.summary;
  const parts = ["Ligação pela Callface"];
  const label = statusLabel(p.status);
  if (label) parts.push(label);
  if (p.durationSec) parts.push(mmss(p.durationSec));
  return parts.join(" · ");
}

// deal_id (= nosso id do lead, mandado na URL do discador) primeiro; senão o
// telefone, tolerante ao nono dígito (waMatchKey). Telefone repetido entre
// leads: prefere o aberto e, entre abertos, o mais recente.
export async function resolveCallfaceLead(repo, { dealId = "", destination = "" } = {}) {
  if (dealId) {
    const lead = await repo.get("leads", dealId);
    if (lead) return { lead, matchedBy: "deal_id" };
  }
  const key = waMatchKey(destination);
  if (!key) return { lead: null, matchedBy: "" };
  const leads = (await repo.list("leads")).filter((l) => l?.phone && waMatchKey(l.phone) === key);
  if (!leads.length) return { lead: null, matchedBy: "" };
  const products = new Map();
  const isOpen = async (l) => {
    if (!l.saas) return true;
    if (!products.has(l.saas)) products.set(l.saas, await repo.get("products", l.saas));
    return !TERMINAL_KINDS.has(kindOf(products.get(l.saas), l.stage));
  };
  const ranked = [];
  for (const l of leads) ranked.push({ l, open: await isOpen(l) });
  ranked.sort((a, b) => (Number(b.open) - Number(a.open)) || String(b.l.createdAt || "").localeCompare(String(a.l.createdAt || "")));
  return { lead: ranked[0].l, matchedBy: "phone" };
}

// Quem ligou: o usuário do cockpit com o MESMO e-mail da conta Callface.
// Sem casamento, o autor é "callface" e a timeline mostra o nome que veio.
export async function resolveCallfaceAuthor(repo, userEmail) {
  const email = str(userEmail).toLowerCase();
  if (!email) return "callface";
  const users = await repo.list("users");
  const u = users.find((x) => str(x.email).toLowerCase() === email);
  return u?.id || "callface";
}

export async function ingestCallfaceCall(repo, body, { log } = {}) {
  const p = parseCallfacePayload(body);
  // Teste do painel (ou payload vazio): nada pra casar, só confirma o recebimento.
  if (!p.callLink && !p.destination) return { ignored: "no call" };

  const existing = await repo.get("callface_calls", p.callId);
  if (existing) return { duplicate: true, call: p.callId, lead: existing.lead || null, activity: existing.activityId || null };

  const { lead, matchedBy } = await resolveCallfaceLead(repo, p);
  const author = await resolveCallfaceAuthor(repo, p.userEmail);

  let activity = null;
  if (lead) {
    activity = await logActivity(repo, {
      saas: lead.saas || "",
      lead: lead.id,
      type: "call",
      text: callfaceActivityText(p),
      author,
      at: p.at,
      // Transcrição NÃO vai no meta: é volumosa e a timeline carrega tudo do
      // lead; fica no registro privado callface_calls.
      meta: {
        provider: "callface", callId: p.callId, callLink: p.callLink, audioUrl: p.audioUrl,
        durationSec: p.durationSec, status: p.status, closurePct: p.closurePct, scheduling: p.scheduling,
        userEmail: p.userEmail, userName: p.userName, destination: p.destination, matchedBy,
      },
    });
    // logActivity não dispara o hook (só o CRUD genérico dispara): ligação real
    // é toque, então re-agenda o GPS, conta a tentativa e promove Novo → Qualificando.
    try { await onActivityCreated(repo, activity); }
    catch (err) { log?.warn?.({ err: err?.message, lead: lead.id }, "Callface: toque registrado, mas o GPS não re-agendou"); }
  } else {
    log?.warn?.({ dealId: p.dealId, destination: p.destination }, "Callface: ligação sem lead casado");
  }

  await repo.create("callface_calls", {
    id: p.callId,
    callLink: p.callLink, dealId: p.dealId, contactId: p.contactId, destination: p.destination,
    at: p.at, status: p.status, durationSec: p.durationSec, audioUrl: p.audioUrl,
    userEmail: p.userEmail, userName: p.userName, summary: p.summary, transcription: p.transcription,
    closurePct: p.closurePct, scheduling: p.scheduling,
    lead: lead?.id || "", saas: lead?.saas || "", activityId: activity?.id || "",
    author, matchedBy, receivedAt: new Date().toISOString(),
  });

  return { ok: true, call: p.callId, lead: lead?.id || null, activity: activity?.id || null, matchedBy };
}
