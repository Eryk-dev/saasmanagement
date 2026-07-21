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

// MULTI-NÚMERO: `phoneNumberId` do env é o DEFAULT (single-tenant legado); toda
// operação aceita `{ phoneId }` pra usar o número do PRODUTO (product.waPhoneId,
// Ajustes → Integrações) — cada SaaS conversa pelo seu WhatsApp.
export function makeWhatsapp({ fetch: f = globalThis.fetch, token = "", phoneNumberId = "", verifyToken = "" } = {}) {
  const configured = (phoneId) => !!(token && (phoneId || phoneNumberId));

  async function post(payload, phoneId) {
    const pid = phoneId || phoneNumberId;
    if (!token || !pid) throw new Error("WhatsApp não configurado — defina WHATSAPP_TOKEN e o número (env ou waPhoneId do produto)");
    const res = await f(`${GRAPH}/${pid}/messages`, {
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
  async function sendText(to, text, { phoneId } = {}) {
    const b = await post({ to: digits(to), type: "text", text: { preview_url: true, body: String(text || "").slice(0, 4096) } }, phoneId);
    return { messageId: b.messages?.[0]?.id || "" };
  }

  // Template aprovado (reabre conversa fora das 24h). Fase 2 (precisa dos templates
  // aprovados na Meta); já deixo pronto no cliente.
  async function sendTemplate(to, name, lang = "pt_BR", components = [], { phoneId } = {}) {
    const b = await post({ to: digits(to), type: "template", template: { name, language: { code: lang }, ...(components.length ? { components } : {}) } }, phoneId);
    return { messageId: b.messages?.[0]?.id || "" };
  }

  // Pedido NATIVO de permissão de ligação (Calling API): uma mensagem
  // interactive com a saudação no corpo + botões permitir/recusar do próprio
  // WhatsApp. Exige "Allow voice calls" ligado no número e janela de 24h aberta
  // (fora dela é template aprovado). A resposta volta no webhook como
  // interactive call_permission_reply (wa-call-flow.js).
  async function sendCallPermission(to, bodyText, { phoneId } = {}) {
    const b = await post({
      to: digits(to), recipient_type: "individual", type: "interactive",
      interactive: {
        type: "call_permission_request",
        action: { name: "call_permission_request" },
        body: { text: String(bodyText || "Podemos te ligar?").slice(0, 1024) },
      },
    }, phoneId);
    return { messageId: b.messages?.[0]?.id || "" };
  }

  // Marca a mensagem recebida como lida (bolinha azul pro cliente). Best-effort.
  async function markRead(messageId, { phoneId } = {}) {
    if (!messageId) return;
    try { await post({ status: "read", message_id: messageId }, phoneId); } catch { /* opcional */ }
  }

  // ── Calling API (ligação pelo WhatsApp direto do cockpit) ──────────────────
  // Chamada INICIADA pelo negócio: manda a oferta SDP (não-trickle, com os ICE
  // candidates já dentro) e o WhatsApp do lead toca. O SDP answer volta pelo
  // webhook `calls` quando o lead atender. Exige "Allow voice calls" ligado no
  // número e a permissão de ligação aceita na conversa.
  async function initiateCall(to, sdp, { phoneId } = {}) {
    const pid = phoneId || phoneNumberId;
    if (!token || !pid) throw new Error("WhatsApp não configurado — defina WHATSAPP_TOKEN e o número");
    const res = await f(`${GRAPH}/${pid}/calls`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: digits(to), action: "connect", session: { sdp_type: "offer", sdp: String(sdp || "") } }),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = {}; }
    if (res.status >= 400 || body.error) {
      const err = new Error(`WhatsApp Calling -> ${res.status}: ${body.error?.message || text.slice(0, 300)}`);
      err.status = res.status; err.code = body.error?.code;
      throw err;
    }
    return { callId: body.calls?.[0]?.id || "" };
  }

  // Encerra (ou cancela o toque de) uma chamada iniciada por nós. Best-effort:
  // chamada que o lead já encerrou volta erro da Meta e tudo bem.
  async function terminateCall(callId, { phoneId } = {}) {
    if (!callId) return;
    await post({ call_id: callId, action: "terminate" }, phoneId);
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
  async function numberInfo({ phoneId } = {}) {
    const pid = phoneId || phoneNumberId;
    if (!configured(pid)) throw new Error("WhatsApp não configurado — defina WHATSAPP_TOKEN e o número (env ou waPhoneId do produto)");
    let body, lastErr;
    for (const fields of NUMBER_FIELD_SETS) {
      try {
        body = await get(`${pid}?fields=${fields}`);
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
      try { numbers = await accountNumbers(pid); } catch { /* não é WABA também */ }
      const wrong = new Error(numbers.length
        ? `O phone number id (${pid}) é o id da CONTA do WhatsApp, não do número. Troque por ${numbers.map((n) => `${n.id} (${n.display || n.name || "número"})`).join(" ou ")}.`
        : `O phone number id (${pid}) não é um número do WhatsApp (a Meta não reconhece o campo do número nesse id). Pegue o "Phone number ID" em WhatsApp Manager → API Setup.`);
      wrong.code = err.code || 100;
      wrong.wrongId = true;
      wrong.numbers = numbers;
      throw wrong;
    }
    return {
      phoneNumberId: pid,
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

  // Templates APROVADOS da conta (WABA) — alimentam o composer fora da janela
  // de 24h. Devolve o corpo e quantas variáveis numeradas ({{1}}…{{N}}) ele tem;
  // template com variável fora do corpo (header/botão) ou nomeada fica marcado
  // `supported:false` — o v1 do composer só preenche corpo numerado.
  async function listTemplates(wabaId) {
    const body = await get(`${wabaId}/message_templates?status=APPROVED&limit=100&fields=name,language,status,category,components`);
    return (body.data || []).map((t) => {
      const comps = t.components || [];
      const bodyC = comps.find((c) => String(c.type || "").toUpperCase() === "BODY");
      const bodyText = bodyC?.text || "";
      const nums = (bodyText.match(/\{\{\s*(\d+)\s*\}\}/g) || []).map((s) => Number(s.replace(/\D/g, "")));
      const otherVars = comps.some((c) => c !== bodyC && /\{\{/.test(JSON.stringify(c)));
      const named = /\{\{\s*[a-z_]/i.test(bodyText);
      return {
        name: t.name, language: t.language, category: t.category || "",
        body: bodyText, params: nums.length ? Math.max(...nums) : 0,
        supported: !!bodyText && !otherVars && !named,
      };
    }).filter((t) => t.body);
  }

  // Custo REAL das conversas no período (conversation_analytics da conta):
  // a Meta cobra por conversa de 24h; `cost` volta na moeda da conta (BRL).
  // start/end em SEGUNDOS unix. Soma todos os pontos da janela.
  // Custo real do período. A Meta trocou a cobrança de POR CONVERSA pra POR
  // MENSAGEM em 01/07/2025 e DESCONTINUOU o `conversation_analytics` (COST) —
  // ele passou a devolver 0 (era por isso que a faixa mostrava "R$ 0"). O
  // custo real agora sai do `pricing_analytics` (COST + VOLUME por mensagem
  // entregue). Mesmo somatório, campo novo. Resposta ainda não conferida com a
  // Graph real (sem token local) — o shape segue o padrão do analytics antigo.
  async function conversationCosts(wabaId, { start, end }) {
    const field = `pricing_analytics.start(${start}).end(${end}).granularity(DAILY).metric_types(["COST","VOLUME"])`;
    const body = await get(`${wabaId}?fields=${encodeURIComponent(field)}`);
    const points = (body.pricing_analytics?.data || []).flatMap((d) => d.data_points || []);
    let cost = 0, messages = 0;
    for (const p of points) {
      cost += Number(p.cost) || 0;
      // volume = mensagens cobráveis no modelo novo; nomes alternativos por
      // segurança até o shape real estar confirmado em produção.
      messages += Number(p.volume ?? p.message_count ?? p.messages) || 0;
    }
    return { cost: Math.round(cost * 100) / 100, messages, model: "PMP" };
  }

  // Mídia recebida (áudio/imagem/…): a Cloud API entrega em 2 passos — GET do
  // media id devolve uma URL curta (assinada, expira em minutos) + o mime; a URL
  // se baixa COM o token (é da lookaside.fbsbx, não abre no browser sem header).
  // Devolve o binário e o mime pra rota servir/cachear.
  async function fetchMedia(mediaId) {
    const meta = await get(`${mediaId}`); // { url, mime_type, file_size, ... }
    if (!meta?.url) throw new Error("a Meta não devolveu a URL da mídia (id expirado?)");
    const res = await f(meta.url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`download da mídia -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, mime: meta.mime_type || "application/octet-stream" };
  }

  // WABAs que o token enxerga (fallback pra achar o id da conta quando nenhum
  // webhook carimbou ainda): o debug_token lista os target_ids dos escopos de
  // WhatsApp do próprio token.
  async function tokenWabaIds() {
    const body = await get(`debug_token?input_token=${encodeURIComponent(token)}`);
    const scopes = body.data?.granular_scopes || [];
    const s = scopes.find((x) => x.scope === "whatsapp_business_management")
      || scopes.find((x) => x.scope === "whatsapp_business_messaging");
    return (s?.target_ids || []).map(String);
  }

  // Verificação do webhook (GET da Meta: hub.mode/hub.verify_token/hub.challenge).
  // Devolve o challenge se o token bate; null se não (rota responde 403).
  function verifyWebhook(mode, tok, challenge) {
    if (mode === "subscribe" && verifyToken && tok === verifyToken) return String(challenge == null ? "" : challenge);
    return null;
  }

  return { configured, sendText, sendTemplate, sendCallPermission, markRead, verifyWebhook, numberInfo, listTemplates, tokenWabaIds, initiateCall, terminateCall, conversationCosts, fetchMedia };
}

// Número em dígitos (E.164 sem +) pra enviar e pra casar o recebido com o lead.
// Número BR local (até 11 dígitos, sem o 55) ganha o DDI 55. Mesmo espírito do
// waDigits do form-page.js.
export function digits(v) {
  let d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d && d.length <= 11 && !d.startsWith("55")) d = "55" + d;
  return d;
}
