// Webhook do Resend (docs/PLANO-DISPAROS.md, fase 5): o Resend avisa entrega,
// devolução e reclamação de spam. Devolução permanente marca o e-mail do lead
// como inválido (`emailInvalid`, os envios pulam); reclamação descadastra
// (`emailOptOut`, como o link de descadastro). O resto só é aceito.
// Assinatura no padrão Svix: HMAC-SHA256 de `${svix-id}.${svix-timestamp}.${corpo}`
// com o segredo `whsec_…` (base64), em `svix-signature` ("v1,<assinatura> …").

import crypto from "node:crypto";
import { logActivity } from "../crm/lead-flow.js";

const TOLERANCE_SEC = 5 * 60;

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function verifySvix(rawBody, headers, secret, { now = Date.now() } = {}) {
  const id = headers?.["svix-id"];
  const ts = headers?.["svix-timestamp"];
  const sig = headers?.["svix-signature"];
  if (!id || !ts || !sig || !secret) return false;
  if (!Number.isFinite(Number(ts)) || Math.abs(now / 1000 - Number(ts)) > TOLERANCE_SEC) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return String(sig).split(" ").some((part) => {
    const [version, value] = part.split(",");
    return version === "v1" && safeEqual(value, expected);
  });
}

// Aplica o evento nos leads com aquele e-mail. Devolve quantos mudaram.
export async function applyResendEvent(repo, event, { now = new Date() } = {}) {
  const type = String(event?.type || "");
  const data = event?.data || {};
  const to = (Array.isArray(data.to) ? data.to : [data.to]).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
  if (!to.length) return 0;
  let patch = null;
  let note = "";
  if (type === "email.bounced") {
    // Devolução temporária (caixa cheia, servidor fora) não invalida o endereço.
    if (/transient|temporary|soft/i.test(String(data.bounce?.type || ""))) return 0;
    const reason = String(data.bounce?.message || data.bounce?.subType || "devolvido").slice(0, 200);
    patch = { emailInvalid: true, emailInvalidAt: now.toISOString(), emailInvalidReason: reason };
    note = `e-mail devolvido (${reason}): os envios de e-mail pulam este lead`;
  } else if (type === "email.complained") {
    patch = { emailOptOut: true, emailOptOutAt: now.toISOString(), emailOptOutReason: "marcou como spam" };
    note = "marcou o e-mail como spam: descadastrado dos envios de e-mail";
  } else {
    return 0;
  }
  const flag = type === "email.bounced" ? "emailInvalid" : "emailOptOut";
  let changed = 0;
  for (const lead of await repo.list("leads")) {
    if (!lead.email || !to.includes(String(lead.email).trim().toLowerCase())) continue;
    if (lead[flag] === true) continue; // já marcado: não regrava nem repete a nota na timeline
    await repo.update("leads", lead.id, patch);
    await logActivity(repo, { saas: lead.saas || "", lead: lead.id, type: "system", text: note, meta: { event: type.replace(".", "_"), emailId: data.email_id || "" }, author: "resend", at: now.toISOString() }).catch(() => null);
    changed++;
  }
  return changed;
}
