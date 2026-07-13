// Helpers compartilhados dos disparos (campanhas + sequências): interpolação de
// tokens por lead, token de descadastro e base pública do link. Ficam aqui pra o
// motor de sequências (drip-runner) e as rotas usarem a MESMA regra do e-mail.
import { createHash } from "node:crypto";

// Token de descadastro: leadId + assinatura curta (não adivinhável, sem guardar
// nada). Salt = a chave mestra (ou um default em dev).
const UNSUB_SALT = process.env.COCKPIT_API_KEY || "cockpit-unsub-salt";
export const unsubSig = (leadId) => createHash("sha256").update(`${leadId}:${UNSUB_SALT}`).digest("hex").slice(0, 16);
export const unsubToken = (leadId) => `${leadId}.${unsubSig(leadId)}`;

// Base pública pro link de descadastro. Com `req` usa o host da request; sem
// (ex.: o poller de fundo) cai no COCKPIT_PUBLIC_URL. Inline pra não acoplar em
// routes.js (evita ciclo de import).
export function baseUrl(req) {
  if (process.env.COCKPIT_PUBLIC_URL) return process.env.COCKPIT_PUBLIC_URL.replace(/\/+$/, "");
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.["host"] || "localhost";
  return `${/^(localhost|127\.)/.test(String(host)) ? "http" : "https"}://${host}`;
}

// Tokens do lead pra interpolar a mensagem ({{nome}} etc.). Espelho enxuto do
// scriptTokens do SPA — só os campos que o compositor oferece.
export function leadTokens(lead) {
  return {
    nome: String(lead?.name || "").trim().split(/\s+/)[0] || "",
    empresa: lead?.company || "",
    nicho: lead?.niche || "",
    contas: lead?.accounts || "",
    anuncios: lead?.listings || "",
  };
}

// Troca {{token}} pelos dados do lead; token desconhecido fica visível (pra o
// operador notar o erro de digitação no preview).
export const interpolate = (text, toks) => String(text || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (toks && toks[k] != null ? toks[k] : `{{${k}}}`));

// Corpo do e-mail com o rodapé de descadastro anexado.
export const emailBodyWithUnsub = (bodyT, toks, unsubUrl) => `${interpolate(bodyT, toks)}\n\n—\nPara não receber mais estes e-mails: ${unsubUrl}`;
