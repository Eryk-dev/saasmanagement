// Mailer — ponto ÚNICO de envio de e-mail (disparos, sequências, NPS, relatório
// mensal, resposta de ticket chamam sempre `mailer.send(...)`).
// Provedor: Resend quando configurado em Configurações → Integrações (chave na
// coleção privada `integration_secrets`); senão a conta Google do sistema
// (Gmail API, escopo gmail.send), como antes. Envios pelo Resend saem com um
// respiro mínimo entre eles (limite de 2 req/s da conta).

import { makeResend } from "./resend.js";
import { readEmailSecret, resendUsable } from "./email-config.js";

export function makeMailer({ google, repo, resend = makeResend(), minIntervalMs = 550, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastAt = 0;
  const pace = async () => {
    const wait = lastAt + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastAt = now();
  };
  async function active() {
    const cfg = repo ? await readEmailSecret(repo) : null;
    if (resendUsable(cfg)) return { provider: "resend", cfg };
    if (google?.gmailReady && (await google.gmailReady())) return { provider: "gmail" };
    return { provider: "" };
  }
  return {
    // "resend" | "gmail" | "" (nenhum pronto).
    async provider() { return (await active()).provider; },
    async ready() { return !!(await active()).provider; },
    // { to, subject, text|html, fromName?, headers? } → { id } | lança em falha.
    async send(msg) {
      const a = await active();
      if (a.provider === "resend") {
        await pace();
        const name = String(msg.fromName || a.cfg.fromName || "").replace(/[<>"]/g, "").trim();
        return resend.send({
          apiKey: a.cfg.apiKey, from: name ? `${name} <${a.cfg.fromEmail}>` : a.cfg.fromEmail,
          to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, headers: msg.headers,
          replyTo: a.cfg.replyTo || undefined,
        });
      }
      if (a.provider === "gmail") return google.sendGmail(msg);
      throw new Error("mailer: nenhum provedor de e-mail configurado (Configurações → Integrações → E-mail)");
    },
  };
}
