// Cliente do Resend (https://resend.com/docs/api-reference): envio e domínios.
// Sem SDK — fetch nativo, como o resto das integrações. Limite de ritmo do
// Resend (2 req/s por padrão): 429 espera o `retry-after` e tenta de novo.

const API = "https://api.resend.com";
const RETRY_WAITS_MS = [1000, 2000, 4000];

export function makeResend({ fetch: f = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  async function call(apiKey, method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await f(`${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${apiKey}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let json = {};
      try { json = text ? JSON.parse(text) : {}; } catch { /* corpo não-JSON */ }
      if (res.status === 429 && attempt < RETRY_WAITS_MS.length) {
        const after = Number(res.headers?.get?.("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : RETRY_WAITS_MS[attempt]);
        continue;
      }
      if (res.status >= 400) {
        const err = new Error(`Resend: ${json.message || json.error || text.slice(0, 200) || res.status}`);
        err.status = res.status;
        err.code = json.name || ""; // ex.: restricted_api_key (chave "Sending access")
        throw err;
      }
      return json;
    }
  }
  return {
    // { apiKey, from, to, subject, text|html, headers?, replyTo? } → { id }
    async send({ apiKey, from, to, subject, text, html, headers, replyTo }) {
      const out = await call(apiKey, "POST", "/emails", {
        from, to: Array.isArray(to) ? to : [to], subject,
        ...(html ? { html } : { text: text || "" }),
        ...(headers && Object.keys(headers).length ? { headers } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      });
      return { id: out.id || "" };
    },
    // Domínios da conta: [{ name, status }] — "verified" libera o envio.
    async domains(apiKey) {
      const out = await call(apiKey, "GET", "/domains");
      return (out.data || []).map((d) => ({ id: d.id, name: d.name, status: d.status, region: d.region || "" }));
    },
  };
}
