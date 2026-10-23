// Configuração do e-mail (Configurações → Integrações → E-mail). A chave do
// Resend fica na coleção PRIVADA `integration_secrets` (doc "email"): o CRUD
// genérico não a enxerga e a tela só recebe `{ configured, last4 }`.

const DOC = "email";
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const domainOf = (email) => String(email || "").split("@")[1]?.toLowerCase() || "";

export async function readEmailSecret(repo) {
  return (await repo.get("integration_secrets", DOC).catch(() => null)) || null;
}

// Pronto pra usar? Resend com chave e remetente válido.
export const resendUsable = (cfg) => !!(cfg && cfg.provider === "resend" && cfg.apiKey && EMAIL_RE.test(cfg.fromEmail || ""));

// O que a tela pode ver: nunca a chave.
export function publicEmailConfig(cfg) {
  const key = String(cfg?.apiKey || "");
  return {
    provider: cfg?.provider || "",
    configured: !!key,
    last4: key ? key.slice(-4) : "",
    fromName: cfg?.fromName || "",
    fromEmail: cfg?.fromEmail || "",
    replyTo: cfg?.replyTo || "",
    webhookConfigured: !!cfg?.webhookSecret,
    domain: domainOf(cfg?.fromEmail),
    updatedAt: cfg?.updatedAt || null,
    updatedBy: cfg?.updatedBy || null,
  };
}

// Grava a config. `apiKey` vazio/ausente mantém a chave atual (o campo da tela é só escrita).
export async function saveEmailConfig(repo, body = {}, { by = "api", now = new Date() } = {}) {
  const cur = (await readEmailSecret(repo)) || {};
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : cur.apiKey || "";
  const fromEmail = String(body.fromEmail ?? cur.fromEmail ?? "").trim().toLowerCase();
  const fromName = String(body.fromName ?? cur.fromName ?? "").trim().slice(0, 80);
  const replyTo = String(body.replyTo ?? cur.replyTo ?? "").trim().toLowerCase();
  // Segredo do webhook (whsec_…): vazio mantém o atual; "-" remove.
  const webhookSecret = body.webhookSecret === "-" ? "" : typeof body.webhookSecret === "string" && body.webhookSecret.trim() ? body.webhookSecret.trim() : cur.webhookSecret || "";
  const errors = [];
  if (!apiKey) errors.push("Informe a chave de API do Resend");
  else if (!/^re_[A-Za-z0-9_]{8,}$/.test(apiKey)) errors.push("A chave do Resend começa com re_");
  if (!EMAIL_RE.test(fromEmail)) errors.push("Informe o e-mail do remetente (ex.: contato@seudominio.com.br)");
  if (replyTo && !EMAIL_RE.test(replyTo)) errors.push("O e-mail de resposta é inválido");
  if (webhookSecret && !/^whsec_[A-Za-z0-9+/=]{16,}$/.test(webhookSecret)) errors.push("O segredo do webhook do Resend começa com whsec_");
  if (errors.length) throw Object.assign(new Error(errors[0]), { statusCode: 400, errors });
  const doc = { provider: "resend", apiKey, fromEmail, fromName, replyTo, webhookSecret, updatedAt: now.toISOString(), updatedBy: by };
  if (cur.id) await repo.update("integration_secrets", DOC, doc);
  else await repo.create("integration_secrets", { id: DOC, ...doc });
  return doc;
}

export async function removeEmailConfig(repo) {
  if (await readEmailSecret(repo)) await repo.remove("integration_secrets", DOC);
}
