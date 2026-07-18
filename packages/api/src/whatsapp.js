// WhatsApp Cloud API (Meta) — inbox no cockpit: envia e recebe mensagens pelo
// número dedicado da WhatsApp Business Account. Single-tenant, credenciais no env
// (WHATSAPP_TOKEN = token permanente de system user com whatsapp_business_messaging;
// WHATSAPP_PHONE_NUMBER_ID = id do número; WHATSAPP_VERIFY_TOKEN = segredo do
// webhook). Factory com fetch injetável (mesmo padrão do meta.js/google.js).
//
// O número usado aqui é DEDICADO à API — não dá pra usar o app do WhatsApp nele.
// Fora da janela de 24h desde a última mensagem do cliente, a Meta só deixa
// enviar TEMPLATE aprovado (sendTemplate); texto livre volta erro (Fase 2).
const GRAPH = "https://graph.facebook.com/v23.0";

export function makeWhatsapp({ fetch: f = globalThis.fetch, token = "", phoneNumberId = "", verifyToken = "" } = {}) {
  const configured = () => !!(token && phoneNumberId);

  async function post(payload) {
    if (!configured()) throw new Error("WhatsApp não configurado — defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID");
    const res = await f(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = {}; }
    if (res.status >= 400 || body.error) {
      const err = new Error(`WhatsApp API -> ${res.status}: ${body.error?.message || text.slice(0, 300)}`);
      err.status = res.status; err.code = body.error?.code;
      throw err;
    }
    return body;
  }

  // Texto livre pro `to` (número do lead). Só funciona dentro da janela de 24h.
  async function sendText(to, text) {
    const b = await post({ to: digits(to), type: "text", text: { preview_url: true, body: String(text || "").slice(0, 4096) } });
    return { messageId: b.messages?.[0]?.id || "" };
  }

  // Template aprovado (reabre conversa fora das 24h). Fase 2 (precisa dos templates
  // aprovados na Meta); já deixo pronto no cliente.
  async function sendTemplate(to, name, lang = "pt_BR", components = []) {
    const b = await post({ to: digits(to), type: "template", template: { name, language: { code: lang }, ...(components.length ? { components } : {}) } });
    return { messageId: b.messages?.[0]?.id || "" };
  }

  // Marca a mensagem recebida como lida (bolinha azul pro cliente). Best-effort.
  async function markRead(messageId) {
    if (!messageId) return;
    try { await post({ status: "read", message_id: messageId }); } catch { /* opcional */ }
  }

  async function get(path) {
    const res = await f(`${GRAPH}/${path}`, { headers: { authorization: `Bearer ${token}` } });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = {}; }
    if (res.status >= 400 || body.error) {
      const err = new Error(`WhatsApp API -> ${res.status}: ${body.error?.message || text.slice(0, 300)}`);
      err.status = res.status; err.code = body.error?.code;
      throw err;
    }
    return body;
  }

  // Números da CONTA (WABA). Só é chamado no diagnóstico abaixo: se o id
  // configurado for o da conta, esta edge devolve os números dela — com o id
  // que deveria estar no WHATSAPP_PHONE_NUMBER_ID.
  async function accountNumbers(wabaId) {
    const body = await get(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`);
    return (body.data || []).map((n) => ({
      id: String(n.id || ""),
      display: n.display_phone_number || "",
      name: n.verified_name || "",
    })).filter((n) => n.id);
  }

  // Campos do número, do mais completo pro mínimo. A Meta troca/deprecia campo
  // entre versões (messaging_limit_tier → whatsapp_business_manager_messaging_limit)
  // e UM campo inválido derruba a resposta INTEIRA — então cada conjunto é uma
  // tentativa, e o último é o que sempre existiu. Assim campo novo nunca quebra
  // a confirmação do número, que é o que a tela precisa antes de tudo.
  const NUMBER_FIELD_SETS = [
    "display_phone_number,verified_name,quality_rating,whatsapp_business_manager_messaging_limit,throughput,platform_type",
    "display_phone_number,verified_name,quality_rating,messaging_limit_tier,throughput",
    "display_phone_number,verified_name,quality_rating",
  ];

  // Qual número está de fato conectado (GET no phone number id). Serve de prova
  // viva de que token + WHATSAPP_PHONE_NUMBER_ID batem e apontam pro número
  // certo — é o que a tela de WhatsApp mostra no topo depois de trocar o número.
  async function numberInfo() {
    if (!configured()) throw new Error("WhatsApp não configurado — defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID");
    let body, lastErr;
    for (const fields of NUMBER_FIELD_SETS) {
      try {
        body = await get(`${phoneNumberId}?fields=${fields}`);
        break;
      } catch (e) {
        lastErr = e;
        // Campo que esta versão não conhece: tenta o conjunto menor. Qualquer
        // outro erro (token, id, permissão) é definitivo e sai pelo catch.
        if (/nonexisting field/i.test(String(e.message || ""))) continue;
        break;
      }
    }
    if (!body) {
      const err = lastErr || new Error("WhatsApp API: resposta vazia");
      // Nem o conjunto MÍNIMO passou: "(#100) Tried accessing nonexisting field
      // (display_phone_number)" = o id NÃO é de um número. O engano clássico é
      // usar o id da CONTA (WABA), que no painel da Meta fica logo acima do id
      // do número. Em vez de repassar o erro cru da Graph, pergunta à conta
      // quais são os números dela e devolve o id certo pra trocar no env.
      if (!/nonexisting field/i.test(String(err.message || ""))) throw err;
      let numbers = [];
      try { numbers = await accountNumbers(phoneNumberId); } catch { /* não é WABA também */ }
      const wrong = new Error(numbers.length
        ? `O WHATSAPP_PHONE_NUMBER_ID (${phoneNumberId}) é o id da CONTA do WhatsApp, não do número. Troque por ${numbers.map((n) => `${n.id} (${n.display || n.name || "número"})`).join(" ou ")} e reinicie a API.`
        : `O WHATSAPP_PHONE_NUMBER_ID (${phoneNumberId}) não é um número do WhatsApp (a Meta não reconhece o campo do número nesse id). Pegue o "Phone number ID" em WhatsApp Manager → API Setup e ponha no env.`);
      wrong.code = err.code || 100;
      wrong.wrongId = true;
      wrong.numbers = numbers;
      throw wrong;
    }
    return {
      phoneNumberId,
      display: body.display_phone_number || "",
      name: body.verified_name || "",
      quality: body.quality_rating || "",
      // Teto de conversas INICIADAS por dia (o campo trocou de nome entre
      // versões da Graph) e vazão de envio por segundo.
      tier: String(body.whatsapp_business_manager_messaging_limit || body.messaging_limit_tier || ""),
      throughput: body.throughput?.level || "",
      platform: body.platform_type || "",
    };
  }

  // Verificação do webhook (GET da Meta: hub.mode/hub.verify_token/hub.challenge).
  // Devolve o challenge se o token bate; null se não (rota responde 403).
  function verifyWebhook(mode, tok, challenge) {
    if (mode === "subscribe" && verifyToken && tok === verifyToken) return String(challenge == null ? "" : challenge);
    return null;
  }

  return { configured, sendText, sendTemplate, markRead, verifyWebhook, numberInfo };
}

// Número em dígitos (E.164 sem +) pra enviar e pra casar o recebido com o lead.
// Número BR local (até 11 dígitos, sem o 55) ganha o DDI 55. Mesmo espírito do
// waDigits do form-page.js.
export function digits(v) {
  let d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d && d.length <= 11 && !d.startsWith("55")) d = "55" + d;
  return d;
}
