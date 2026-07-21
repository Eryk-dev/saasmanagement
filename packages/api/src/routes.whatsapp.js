// WhatsApp no cockpit (Cloud API): webhook (verificação + recebimento), inbox de
// conversas (tela dedicada) e envio. As mensagens vivem em wa_threads/wa_messages
// (ver wa-store.js) — canônico pro inbox e pro chat do drawer.
import { makeWhatsapp } from "./whatsapp.js";
import { recordMessage, updateStatus, listThreads, listMessages, markThreadRead, threadId, setLeadWhatsappOptOut, waInsights, waFormEngagement, findLeadByPhone, findThreadByPhone, linkThreadToLead } from "./wa-store.js";
import { applyHealthEvent, getWaHealth, waHealthSummary, recordWebhookDelivery, resolveWabaId } from "./wa-health.js";
import { runInboundCallFlow, startCallFlow, openAlerts, closeThreadAlerts, parsePermissionReply, greetingFor } from "./wa-call-flow.js";
import { transcriber as defaultTranscriber } from "./transcribe.js";
import { formatSummaryText } from "./call-summaries.js";
import { logActivity } from "./lead-flow.js";

// Mídia de uma mensagem recebida: a Cloud API manda só o ID (o binário se baixa
// depois, com o token). Devolve {kind, id, mime, filename} ou null.
function mediaOf(m) {
  const t = m?.type;
  const pick = (kind, obj, fn) => obj?.id ? { kind, id: obj.id, mime: obj.mime_type || "", filename: fn || "" } : null;
  if (t === "audio") return pick("audio", m.audio);
  if (t === "voice") return pick("audio", m.voice);       // nota de voz = áudio
  if (t === "image") return pick("image", m.image);
  if (t === "video") return pick("video", m.video);
  if (t === "sticker") return pick("image", m.sticker);
  if (t === "document") return pick("document", m.document, m.document?.filename);
  return null;
}

// Texto legível pra tipos que a Fase 1 ainda não renderiza (mídia/áudio).
function bodyOf(m) {
  if (m.text?.body) return m.text.body;
  // Resposta ao pedido de permissão de ligação (fluxo de qualificação).
  const perm = parsePermissionReply(m);
  if (perm) return perm === "accepted" ? "✅ topou receber a ligação" : "🚫 prefere não receber ligação";
  if (m.type === "image") return "📷 imagem";
  if (m.type === "audio" || m.type === "voice") return "🎤 áudio";
  if (m.type === "video") return "🎬 vídeo";
  if (m.type === "document") return "📎 documento" + (m.document?.filename ? ` · ${m.document.filename}` : "");
  if (m.type === "sticker") return "🀄 figurinha";
  if (m.type === "location") return "📍 localização";
  if (m.type === "button") return m.button?.text || "botão";
  if (m.type === "interactive") return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "resposta";
  return `[${m.type || "mensagem"}]`;
}

// Envia texto e grava a mensagem out (+ atualiza o thread). Lança em erro da Meta
// (o handler HTTP traduz a janela de 24h). `phone` = destino em qualquer formato.
async function sendAndRecord(repo, wa, { phone, text, author, phoneId, saas }) {
  const { messageId } = await wa.sendText(phone, text, { phoneId });
  await recordMessage(repo, { id: messageId, phone, direction: "out", text, status: "sent", author, waPhoneId: phoneId || "", saas });
  // Alguém respondeu esta conversa: o alerta quente dela está resolvido pra
  // todo mundo (o pop-up dos outros usuários fecha via SSE).
  try { await closeThreadAlerts(repo, threadId(phone), author); } catch { /* alerta não trava o envio */ }
  return messageId;
}

function outsideWindow(err) { return err.code === 131047 || err.code === 470; }
// 422 (e não 502) quando a Meta recusa o envio: o proxy da hospedagem substitui
// o CORPO de respostas 5xx pela página de erro dele, e aí o motivo real (número
// inválido, template reprovado, permissão) não chegaria em quem está enviando.
function sendErrorReply(reply, err) {
  return reply.code(outsideWindow(err) ? 409 : 422).send({
    error: outsideWindow(err)
      ? "Fora da janela de 24h: a Meta só aceita template aprovado — use o composer de template."
      : String(err.message || err).slice(0, 300),
  });
}

export function registerWhatsappRoutes(app, repo, { whatsapp, anthropic = null, transcriber = defaultTranscriber } = {}) {
  const wa = whatsapp || makeWhatsapp({
    token: process.env.WHATSAPP_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  });

  // ── Número POR PRODUTO ──────────────────────────────────────────────────────
  // Cada SaaS conversa pelo SEU WhatsApp: `product.waPhoneId` (Ajustes →
  // Integrações). Resolução do número de saída, nesta ordem:
  //   1. o número por onde a conversa CHEGOU (thread.waPhoneId) — resposta nunca
  //      troca de número no meio da conversa;
  //   2. o número do produto do lead/thread;
  //   3. produto SEM waPhoneId: se ALGUM produto tem número próprio (multi-número
  //      ativo), BLOQUEIA (null) — a UniqueKids sem número nunca fala pelo da
  //      LeverAds; se NENHUM tem (legado single-tenant), segue o default do env
  //      (undefined = o client usa o WHATSAPP_PHONE_NUMBER_ID);
  //   4. sem produto nenhum (thread avulsa) → default do env.
  // A migração ensureWaPhoneId (boot) carimba o env no leverads, dono histórico —
  // a partir dela o multi-número está ativo e a regra 3 passa a bloquear.
  async function resolvePhoneId({ saas = "", thread = null } = {}) {
    if (thread?.waPhoneId) return thread.waPhoneId;
    const sid = saas || thread?.saas || "";
    if (!sid) return undefined;
    const products = await repo.list("products");
    const p = products.find((x) => x.id === sid);
    if (p?.waPhoneId) return p.waPhoneId;
    return products.some((x) => x.waPhoneId) ? null : undefined;
  }
  const noNumberReply = (reply, saas) => reply.code(503).send({
    error: `WhatsApp sem número pra este produto${saas ? ` (${saas})` : ""} — defina o phone number id em Ajustes → Integrações`,
  });
  // Produto dono de um número recebido no webhook (etiqueta conversa nova).
  async function productByPhoneId(pid) {
    if (!pid) return null;
    return (await repo.list("products")).find((x) => String(x.waPhoneId || "") === String(pid)) || null;
  }

  // ── Webhook (rota ABERTA: a Meta chama sem key; sob /api/webhooks/) ──────────
  app.get("/api/webhooks/whatsapp", async (req, reply) => {
    const q = req.query || {};
    const ch = wa.verifyWebhook(q["hub.mode"], q["hub.verify_token"], q["hub.challenge"]);
    if (ch === null) return reply.code(403).send("forbidden");
    return reply.type("text/plain").send(ch);
  });

  app.post("/api/webhooks/whatsapp", async (req, reply) => {
    try {
      for (const e of req.body?.entry || []) {
        for (const ch of e.changes || []) {
          const v = ch.value || {};
          const field = ch.field || "";
          // Carimba que a Meta entregou aqui, e por qual número: é o que separa
          // "webhook não configurado" de "chegou e nós erramos", e o
          // phone_number_id do metadata é o id certo pro env.
          if (v.metadata?.phone_number_id) {
            try {
              await recordWebhookDelivery(repo, {
                phoneNumberId: v.metadata.phone_number_id,
                display: v.metadata.display_phone_number || "",
                wabaId: e.id || "", // id da CONTA — a listagem de templates precisa dele
              });
            } catch { /* diagnóstico não pode derrubar a entrega */ }
          }
          // Mensagens + status (field "messages"). O status "failed" com código de
          // não-entregável marca o número como inválido (dentro do updateStatus).
          // Webhook de CHAMADA (field "calls") pode trazer `statuses` junto —
          // não pode cair aqui, por isso o field exclui.
          if (field !== "calls" && (v.messages || v.statuses || field === "messages")) {
            const contactName = v.contacts?.[0]?.profile?.name || "";
            // Por QUAL número a mensagem entrou: fica na thread (a resposta sai
            // pelo mesmo número) e etiqueta conversa nova com o produto dono.
            const inPhoneId = v.metadata?.phone_number_id || "";
            const owner = await productByPhoneId(inPhoneId).catch(() => null);
            for (const m of v.messages || []) {
              const stored = await recordMessage(repo, {
                id: m.id, phone: m.from, direction: "in", text: bodyOf(m),
                at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : undefined,
                from: m.from, status: "received", contactName,
                waPhoneId: inPhoneId, saasHint: owner?.id || "", media: mediaOf(m),
              });
              // Fluxo de permissão de ligação: 1º contato de lead conhecido →
              // pede pra ligar; resposta com fluxo aberto → alerta quente
              // (pop-up pro SDR). Re-entrega da Meta (dedup) não roda de novo.
              if (stored) {
                try { await runInboundCallFlow(repo, wa, { message: m, resolvePhoneId }); }
                catch (err) { req.log?.warn?.({ err: err.message }, "fluxo de ligação falhou"); }
              }
            }
            for (const st of v.statuses || []) {
              await updateStatus(repo, st.id, st.status, st.errors?.[0] || "");
            }
          } else if (field === "calls" || v.calls) {
            // Ligação pelo cockpit (Calling API). Lições das chamadas REAIS de
            // 20/07: o SDP answer chega ~1-2s após o connect (é o caminho de
            // mídia/ringback, o telefone AINDA está tocando) — SDP ≠ atendeu.
            // O `duration` do terminate é o tempo CONECTADO (vem null quando
            // ninguém atendeu). Então: tocar e atender são estados separados,
            // e cada evento entra num journal (events[]) pra calibrar os nomes
            // que a Meta usa nas próximas chamadas.
            const journal = (call, e, extra = {}) => [...(call.events || []), { e, at: new Date().toISOString(), ...extra }].slice(-24);
            const isAnswerEv = (s) => /accept|answer|pick|in_progress|ongoing/.test(s);
            for (const st of v.statuses || []) {
              const call = st.id ? await repo.get("wa_calls", st.id) : null;
              if (!call) continue;
              const ev = String(st.status || "").toLowerCase();
              const patch = { lastEvent: ev, events: journal(call, `status:${ev}`), updatedAt: new Date().toISOString() };
              // Status de bridge SEM sdp (connected/accepted/in_progress) = o
              // lead atendeu de verdade.
              if ((isAnswerEv(ev) || /connect/.test(ev)) && !call.answeredAt && call.status !== "ended") {
                patch.status = "accepted";
                patch.answeredAt = new Date().toISOString();
              }
              await repo.update("wa_calls", call.id, patch);
            }
            for (const c of v.calls || []) {
              const call = c.id ? await repo.get("wa_calls", c.id) : null;
              if (!call) { req.log?.info?.({ call: c.id, event: c.event || c.status }, "evento de chamada sem registro"); continue; }
              const ev = String(c.event || c.status || "").toLowerCase();
              const patch = { lastEvent: ev || call.lastEvent || "", events: journal(call, `call:${ev}`, c.session?.sdp ? { sdp: true } : {}), updatedAt: new Date().toISOString() };
              if (c.session?.sdp) {
                // Caminho de mídia pronto (ringback) — segue TOCANDO até um
                // evento de atendimento de verdade.
                patch.sdpAnswer = c.session.sdp;
              } else if (isAnswerEv(ev) && !call.answeredAt) {
                patch.status = "accepted";
                patch.answeredAt = new Date().toISOString();
              }
              if (/reject|declin|busy/.test(ev)) {
                patch.status = "rejected"; patch.endedAt = new Date().toISOString();
              } else if (/terminat|ended|hangup|complet|failed|timeout|no_answer|noanswer|missed/.test(ev)) {
                patch.endedAt = new Date().toISOString();
                // duration da Meta = tempo CONECTADO; >0 prova que atendeu
                // (mesmo sem evento de accept no meio).
                const metaDur = Number(c.duration) || 0;
                if (metaDur > 0) {
                  patch.duration = metaDur;
                  if (!call.answeredAt) patch.answeredAt = new Date(Date.now() - metaDur * 1000).toISOString();
                  patch.status = "ended";
                } else {
                  patch.status = call.answeredAt || call.status === "accepted" ? "ended" : "missed";
                }
              }
              await repo.update("wa_calls", call.id, patch);
              // Encerrou/recusou/não atendeu: vira uma linha no histórico da
              // conversa (dedup pelo id derivado — a Meta re-entrega webhook).
              if (patch.endedAt) {
                const answeredAt = patch.answeredAt || call.answeredAt;
                const secs = Number(patch.duration) || (answeredAt ? Math.round((new Date(patch.endedAt) - new Date(answeredAt)) / 1000) : 0);
                const dur = secs >= 60 ? `${Math.round(secs / 60)} min` : secs > 0 ? `${secs}s` : "";
                const label = patch.status === "rejected" ? "📞 ligação recusada"
                  : patch.status === "missed" ? "📞 ligação não atendida"
                  : `📞 ligação pelo cockpit${dur ? ` · ${dur}` : ""}`;
                await recordMessage(repo, { id: `${call.id}:log`, phone: call.phone, direction: "out", text: label, status: "sent", author: call.author || "cockpit", waPhoneId: call.waPhoneId || "", saas: call.saas || "" });
              }
            }
          } else if (field === "user_preferences") {
            // Opt-out/opt-in de marketing nativo ("parar promoções") → suprime o
            // lead dos disparos/drip. Só a categoria marketing importa.
            for (const p of v.user_preferences || []) {
              if (String(p.category || "").toLowerCase() !== "marketing") continue;
              await setLeadWhatsappOptOut(repo, p.wa_id || p.wa_id_hash || "", String(p.value || "").toLowerCase() === "stop");
            }
          } else if (field.startsWith("phone_number_quality") || field.startsWith("message_template_") || field.startsWith("account_")) {
            // Saúde do número / templates / conta → snapshot pra proteger o número.
            await applyHealthEvent(repo, field, v);
          }
        }
      }
    } catch (err) { req.log?.warn?.({ err: err.message }, "whatsapp webhook falhou"); }
    return reply.code(200).send({ ok: true }); // sempre 200: erro não faz a Meta re-tentar em loop
  });

  // ── Inbox (tela dedicada) ───────────────────────────────────────────────────
  // Número conectado (consulta a Meta na hora). Fora do bootstrap de propósito:
  // é uma chamada de rede, e o SEED recarrega a cada mudança de rev.
  // SEMPRE 200, com o resultado dentro do corpo: o proxy da hospedagem troca o
  // corpo de qualquer 5xx pela página de erro dele, então status de erro faria
  // a UI receber HTML no lugar da mensagem da Meta (foi o que aconteceu).
  app.get("/api/whatsapp/number", async (req) => {
    // Número DO PRODUTO ativo (?saas=): cada SaaS mostra o seu no topo do inbox.
    const saas = String(req.query?.saas || "");
    const phoneId = await resolvePhoneId({ saas });
    if (phoneId === null) return { ok: false, reason: "no_number_for_saas", saas };
    if (!wa.configured(phoneId)) return { ok: false, reason: "not_configured" };
    // Última entrega da Meta no nosso webhook (e por qual número): responde
    // "chegou alguma coisa aqui?" sem depender do envio estar certo.
    const webhook = (await getWaHealth(repo)).webhook || {};
    try {
      return { ok: true, webhook, ...(await wa.numberInfo({ phoneId })) };
    } catch (err) {
      // Ler os dados do número exige whatsapp_business_management no token;
      // ENVIAR exige whatsapp_business_messaging. Token só com messaging cai
      // aqui e mesmo assim envia normalmente — daí o reason separado.
      const message = String(err.message || err).slice(0, 300);
      const missingPermission = err.code === 200 || err.code === 10 || /permission/i.test(message);
      // Id trocado (o da conta no lugar do número): a mensagem já vem com o id
      // certo, e `numbers` deixa a UI mostrar a troca pronta pra copiar.
      if (err.wrongId) return { ok: false, reason: "wrong_id", error: message, code: err.code || 0, numbers: err.numbers || [], webhook };
      return { ok: false, reason: missingPermission ? "no_read_permission" : "meta_error", error: message, code: err.code || 0, webhook };
    }
  });

  // Números do inbox (esperando resposta, tempo de resposta, janelas abertas)
  // + a saúde do número que os webhooks contaram. Junto num payload só: é uma
  // faixa de contexto no topo da tela, não vale duas chamadas.
  // Custo real do período (conversation_analytics) com cache de 10 min — é a
  // Graph de management, não vale bater a cada tick do SSE.
  let costCache = { at: 0, days: 0, value: null };
  async function periodCost(days) {
    // Cache também o negativo (sem permissão etc.) pra não martelar a Graph.
    if (costCache.at && costCache.days === days && Date.now() - costCache.at < 10 * 60_000) return costCache.value;
    let value = null;
    try {
      const wabaId = await resolveWabaId(repo, wa);
      if (wabaId) {
        const end = Math.floor(Date.now() / 1000);
        const start = end - days * 24 * 3600;
        value = await wa.conversationCosts(wabaId, { start, end });
      }
    } catch { /* sem permissão/limite: a faixa esconde o item */ }
    costCache = { at: Date.now(), days, value };
    return value;
  }

  app.get("/api/whatsapp/insights", async (req) => {
    const days = Math.min(365, Math.max(1, Number(req.query?.days) || 30));
    const [stats, health, form, costs] = await Promise.all([
      waInsights(repo, { days }),
      getWaHealth(repo),
      waFormEngagement(repo, { days }).catch(() => null),
      wa.configured() ? periodCost(days) : null,
    ]);
    return { ...stats, health: waHealthSummary(health), form, costs };
  });

  app.get("/api/whatsapp/threads", async () => ({ threads: await listThreads(repo) }));

  // Mensagens por qualquer grafia do número (o drawer pede pelo telefone do
  // lead, COM o nono dígito; a conversa pode viver no wa_id sem ele).
  app.get("/api/whatsapp/threads/:id", async (req) => {
    const thread = await findThreadByPhone(repo, req.params.id);
    return { messages: await listMessages(repo, thread?.id || req.params.id), thread: thread?.id || threadId(req.params.id) };
  });

  // Mídia recebida (áudio/imagem/vídeo/documento): baixa da Meta na 1ª vez e
  // guarda em `wa_media` (base64) pra não re-bater na Graph a cada play — e
  // porque o id da Meta EXPIRA (~30 dias), então cachear preserva o áudio. O
  // player do inbox busca isto autenticado e toca via blob (a rota exige a
  // sessão da tela `whatsapp`; ver ROUTE_SCREENS). `:id` = id da mensagem.
  app.get("/api/whatsapp/media/:id", async (req, reply) => {
    const msg = await repo.get("wa_messages", req.params.id);
    if (!msg?.media?.id) return reply.code(404).send({ error: "mensagem sem mídia" });
    const cached = await repo.get("wa_media", msg.id).catch(() => null);
    if (cached?.data) {
      reply.header("cache-control", "private, max-age=86400");
      return reply.type(cached.mime || msg.media.mime || "application/octet-stream").send(Buffer.from(cached.data, "base64"));
    }
    if (!wa.configured(msg.waPhoneId || undefined)) return reply.code(503).send({ error: "WhatsApp não configurado no servidor" });
    let buf, mime;
    try { ({ buf, mime } = await wa.fetchMedia(msg.media.id)); }
    catch (err) {
      // id expirado / erro da Graph: mídia antiga pode não vir mais.
      return reply.code(502).send({ error: String(err.message || err).slice(0, 200) });
    }
    // Cacheia (teto de 16MB pra não estourar o doc; áudio de voz é KBs).
    if (buf.length <= 16 * 1024 * 1024) {
      try {
        await repo.create("wa_media", { id: msg.id, mime: mime || msg.media.mime || "", size: buf.length, data: buf.toString("base64"), at: new Date().toISOString() });
      } catch { /* cache é bônus; segue servindo */ }
    }
    reply.header("cache-control", "private, max-age=86400");
    return reply.type(mime || msg.media.mime || "application/octet-stream").send(buf);
  });

  // Encerrar/reabrir a conversa (status do INBOX, separado da etapa do funil).
  // Encerrada sai da lista viva e das contagens; mensagem nova reabre sozinha.
  app.post("/api/whatsapp/threads/:id/close", async (req, reply) => {
    const thread = await findThreadByPhone(repo, req.params.id);
    if (!thread) return reply.code(404).send({ error: "Not found" });
    const closed = req.body?.closed !== false;
    await repo.update("wa_threads", thread.id, {
      status: closed ? "closed" : "open",
      closedAt: closed ? new Date().toISOString() : "",
      closedBy: closed ? (req.authUser?.id || "cockpit") : "",
      closeReason: closed ? String(req.body?.reason || "manual") : "",
    });
    return { ok: true, status: closed ? "closed" : "open" };
  });

  // Vincular conversa órfã a um lead, na mão. Cobre quem escreveu de um número
  // diferente do que digitou no form (o casamento automático só age quando há
  // um único candidato) e quem chegou no WhatsApp sem passar pelo form.
  app.post("/api/whatsapp/threads/:id/link", async (req, reply) => {
    const thread = await findThreadByPhone(repo, req.params.id);
    if (!thread) return reply.code(404).send({ error: "conversa não encontrada" });
    const leadId = String(req.body?.leadId || "");
    if (!leadId) { // desvincular
      await repo.update("wa_threads", thread.id, { leadId: null });
      return { ok: true, leadId: null };
    }
    const lead = await repo.get("leads", leadId);
    if (!lead) return reply.code(404).send({ error: "lead não encontrado" });
    const r = await linkThreadToLead(repo, thread.id, lead);
    return { ok: true, ...r };
  });

  app.post("/api/whatsapp/threads/:id/read", async (req) => {
    const thread = await findThreadByPhone(repo, req.params.id);
    const tid = thread?.id || req.params.id;
    const lastIn = await markThreadRead(repo, tid);
    if (lastIn && wa.configured()) {
      wa.markRead(lastIn, { phoneId: thread?.waPhoneId || undefined }).catch(() => {});
    }
    return { ok: true };
  });

  // ── Fluxo de permissão de ligação ───────────────────────────────────────────
  // Alertas quentes ABERTOS (lead respondeu com o fluxo aberto): o pop-up global
  // do cockpit lê daqui a cada tick do SSE. Enriquecido com o lead pra mostrar
  // nome/etapa sem segunda chamada.
  app.get("/api/whatsapp/alerts", async () => {
    const [alerts, leads] = await Promise.all([openAlerts(repo), repo.list("leads")]);
    const byId = new Map(leads.map((l) => [l.id, l]));
    return {
      alerts: alerts
        .map((a) => {
          const lead = a.leadId ? byId.get(a.leadId) : null;
          return { ...a, name: lead?.name || a.name || "", company: lead?.company || "", stage: lead?.stage || "" };
        })
        .sort((x, y) => String(y.at || "").localeCompare(String(x.at || ""))),
    };
  });

  // "Resolvido" sem responder (ex.: vai ligar por fora). Fecha pra todo mundo.
  app.post("/api/whatsapp/alerts/:id/done", async (req, reply) => {
    const a = await repo.get("wa_alerts", req.params.id);
    if (!a) return reply.code(404).send({ error: "Not found" });
    await repo.update("wa_alerts", a.id, { status: "done", doneAt: new Date().toISOString(), doneBy: req.authUser?.id || "cockpit" });
    return { ok: true };
  });

  // Pedido MANUAL de permissão de ligação (prospecção ativa, conversa antiga,
  // lead que entrou por fora do form). Mesma mensagem do fluxo; dentro da janela
  // de 24h — fora dela a Meta recusa e o erro chega legível (409).
  app.post("/api/whatsapp/threads/:id/call-permission", async (req, reply) => {
    const phone = threadId(req.params.id);
    if (!phone) return reply.code(400).send({ error: "número inválido" });
    // Conversa por qualquer grafia do número (com/sem o nono dígito) — o envio
    // sai pro wa_id que a pessoa realmente usa, na MESMA conversa.
    const thread = await findThreadByPhone(repo, phone);
    const lead = thread?.leadId ? await repo.get("leads", thread.leadId) : await findLeadByPhone(repo, phone);
    const saas = thread?.saas || lead?.saas || String(req.body?.saas || "");
    const product = (await repo.list("products")).find((p) => p.id === saas) || null;
    const phoneId = await resolvePhoneId({ saas, thread });
    if (phoneId === null) return noNumberReply(reply, saas);
    if (!wa.configured(phoneId)) return reply.code(503).send({ error: "WhatsApp não configurado no servidor" });
    try {
      const r = await startCallFlow(repo, wa, {
        thread: thread || { id: phone, phone, saas, leadId: lead?.id || null, waPhoneId: "" },
        product, lead, phoneId,
        author: req.authUser?.id || "cockpit",
        // Manual é sempre o texto de "agora" (tem gente na tela pra ligar já),
        // mesmo fora do horário do fluxo automático.
        text: String(req.body?.text || "").trim() || greetingFor(product, lead, { business: true }),
      });
      return { ok: true, interactive: r.interactive, messageId: r.messageId };
    } catch (err) { return sendErrorReply(reply, err); }
  });

  // ── Templates aprovados (reabrir conversa fora da janela de 24h) ────────────
  // Lista com cache curto: a Meta é consultada no máximo a cada 5 min. O id da
  // conta (WABA) vem, nesta ordem: env WHATSAPP_WABA_ID → carimbo do webhook
  // (entry.id, gravado na saúde) → debug_token do próprio token.
  let tplCache = { at: 0, wabaId: "", items: null };
  async function approvedTemplates() {
    const wabaId = await resolveWabaId(repo, wa);
    if (!wabaId) {
      const err = new Error("não achei o id da conta do WhatsApp (WABA) — mande uma mensagem pro número (o webhook carimba o id) ou defina WHATSAPP_WABA_ID no servidor");
      err.status = 404;
      throw err;
    }
    if (tplCache.items && tplCache.wabaId === wabaId && Date.now() - tplCache.at < 5 * 60_000) return tplCache.items;
    const items = await wa.listTemplates(wabaId);
    tplCache = { at: Date.now(), wabaId, items };
    return items;
  }

  // Templates que o composer consegue enviar (corpo com variáveis numeradas).
  app.get("/api/whatsapp/templates", async (req, reply) => {
    if (!wa.configured()) return reply.code(503).send({ error: "WhatsApp não configurado no servidor" });
    try {
      const all = await approvedTemplates();
      return { templates: all.filter((t) => t.supported), unsupported: all.length - all.filter((t) => t.supported).length };
    } catch (err) {
      return reply.code(err.status === 404 ? 404 : 422).send({ error: String(err.message || err).slice(0, 300) });
    }
  });

  // Cria um template e SUBMETE pra aprovação da Meta. Nasce PENDING; a Meta
  // revisa (minutos a horas) e, aprovado, entra no composer sozinho. Nome só
  // com [a-z0-9_] (regra da Meta); UTILITY (relação/transação) x MARKETING
  // (promo/reengajamento) muda a régua de revisão e o custo.
  app.post("/api/whatsapp/templates", async (req, reply) => {
    if (!wa.configured()) return reply.code(503).send({ error: "WhatsApp não configurado no servidor" });
    const name = String(req.body?.name || "").trim().toLowerCase()
      .replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
    const body = String(req.body?.body || "").trim();
    const category = ["UTILITY", "MARKETING"].includes(String(req.body?.category || "").toUpperCase())
      ? String(req.body.category).toUpperCase() : "UTILITY";
    const language = String(req.body?.language || "pt_BR").trim() || "pt_BR";
    const example = Array.isArray(req.body?.example) ? req.body.example.map((x) => String(x ?? "")) : [];
    if (!name) return reply.code(400).send({ error: "dá um nome pro template (ex.: call_no_show)" });
    if (!body) return reply.code(400).send({ error: "escreve o corpo da mensagem" });
    const nVars = (body.match(/\{\{\s*\d+\s*\}\}/g) || []).length;
    if (nVars > 0 && example.filter((x) => x.trim()).length < nVars) {
      return reply.code(400).send({ error: `dá um exemplo pra cada variável ({{1}}…): a Meta reprova template sem exemplo` });
    }
    try {
      const wabaId = await resolveWabaId(repo, wa);
      if (!wabaId) return reply.code(404).send({ error: "não achei o id da conta do WhatsApp (WABA) — mande uma mensagem pro número ou defina WHATSAPP_WABA_ID" });
      const r = await wa.createTemplate(wabaId, { name, category, language, body, example });
      tplCache = { at: 0, wabaId: "", items: null }; // fura o cache (aparece quando aprovar)
      return { ok: true, ...r };
    } catch (err) {
      return reply.code(err.status === 404 ? 404 : 422).send({ error: String(err.message || err).slice(0, 400) });
    }
  });

  // Envia um template aprovado pela conversa e grava o texto RENDERIZADO no
  // histórico (o que o lead recebeu, com as variáveis preenchidas). É o único
  // jeito que a Meta aceita de reabrir conversa fora da janela de 24h.
  app.post("/api/whatsapp/threads/:id/send-template", async (req, reply) => {
    const phone = threadId(req.params.id);
    if (!phone) return reply.code(400).send({ error: "número inválido" });
    const name = String(req.body?.name || "").trim();
    const params = Array.isArray(req.body?.params) ? req.body.params.map((p) => String(p ?? "").trim()) : [];
    if (!name) return reply.code(400).send({ error: "escolha o template" });
    const thread = await findThreadByPhone(repo, phone);
    const phoneId = await resolvePhoneId({ thread });
    if (phoneId === null) return noNumberReply(reply, thread?.saas || "");
    if (!wa.configured(phoneId)) return reply.code(503).send({ error: "WhatsApp não configurado no servidor" });
    let tpl;
    try {
      const lang = String(req.body?.language || "");
      tpl = (await approvedTemplates()).find((t) => t.name === name && (!lang || t.language === lang));
    } catch (err) { return reply.code(422).send({ error: String(err.message || err).slice(0, 300) }); }
    if (!tpl) return reply.code(404).send({ error: "esse template não está entre os aprovados da Meta (a lista atualiza em até 5 min)" });
    if (params.slice(0, tpl.params).filter(Boolean).length < tpl.params) {
      return reply.code(400).send({ error: `preencha ${tpl.params === 1 ? "a variável" : `as ${tpl.params} variáveis`} do template` });
    }
    const components = tpl.params > 0
      ? [{ type: "body", parameters: params.slice(0, tpl.params).map((t) => ({ type: "text", text: t })) }]
      : [];
    const rendered = tpl.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || "");
    try {
      const { messageId } = await wa.sendTemplate(thread?.phone || phone, tpl.name, tpl.language, components, { phoneId });
      await recordMessage(repo, {
        id: messageId, phone: thread?.phone || phone, direction: "out", text: rendered,
        status: "sent", author: req.authUser?.id || "cockpit", waPhoneId: phoneId || "", saas: thread?.saas || "",
      });
      try { await closeThreadAlerts(repo, threadId(phone), req.authUser?.id || "cockpit"); } catch { /* alerta não trava o envio */ }
      return { ok: true, messageId };
    } catch (err) { return sendErrorReply(reply, err); }
  });

  // ── Ligação pelo cockpit (Calling API + WebRTC no browser) ──────────────────
  // O browser gera a oferta SDP (não-trickle), a gente inicia a chamada na Meta
  // e o WhatsApp do lead toca. O answer chega pelo webhook `calls` e o browser
  // busca via GET do estado (poll de 1s enquanto toca). Permissão aceita na
  // conversa é OBRIGATÓRIA (a Meta recusa sem ela; o gate aqui dá erro legível).
  app.post("/api/whatsapp/threads/:id/call", async (req, reply) => {
    const phone = threadId(req.params.id);
    const sdp = String(req.body?.sdp || "");
    if (!phone) return reply.code(400).send({ error: "número inválido" });
    if (!sdp.includes("v=0")) return reply.code(400).send({ error: "oferta SDP inválida" });
    const thread = await findThreadByPhone(repo, phone);
    if (thread?.callFlow?.permission !== "accepted") {
      return reply.code(409).send({ error: "esse lead ainda não aceitou receber ligação — peça a permissão na conversa primeiro" });
    }
    const phoneId = await resolvePhoneId({ thread });
    if (phoneId === null) return noNumberReply(reply, thread?.saas || "");
    if (!wa.configured(phoneId)) return reply.code(503).send({ error: "WhatsApp não configurado no servidor" });
    try {
      const { callId } = await wa.initiateCall(thread?.phone || phone, sdp, { phoneId });
      if (!callId) return reply.code(422).send({ error: "a Meta não devolveu o id da chamada" });
      await repo.create("wa_calls", {
        id: callId, thread: thread?.id || phone, phone: thread?.phone || phone,
        leadId: thread?.leadId || null, saas: thread?.saas || "", waPhoneId: phoneId || "",
        status: "ringing", author: req.authUser?.id || "cockpit", startedAt: new Date().toISOString(),
      });
      return { ok: true, callId };
    } catch (err) { return sendErrorReply(reply, err); }
  });

  // Estado da chamada (poll do browser): traz o sdpAnswer quando o lead atende.
  app.get("/api/whatsapp/calls/:id", async (req, reply) => {
    const call = await repo.get("wa_calls", req.params.id);
    if (!call) return reply.code(404).send({ error: "Not found" });
    return call;
  });

  // Encerrar/cancelar a chamada pelo cockpit (o webhook confirma depois).
  app.post("/api/whatsapp/calls/:id/end", async (req, reply) => {
    const call = await repo.get("wa_calls", req.params.id);
    if (!call) return reply.code(404).send({ error: "Not found" });
    try { await wa.terminateCall(call.id, { phoneId: call.waPhoneId || undefined }); }
    catch { /* lead pode já ter desligado — o estado local vale */ }
    const patch = { status: call.status === "ringing" ? "canceled" : "ended", endedAt: call.endedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    await repo.update("wa_calls", call.id, patch);
    return { ok: true, ...patch };
  });

  // Gravação da ligação (multipart, campo `file`): o browser grava os DOIS
  // lados em canais separados (nós na esquerda, o lead na direita) e sobe o
  // arquivo ao desligar. Aqui vira transcrição e, com lead na conversa, o
  // MESMO resumo estratégico das calls de Meet (activity `call_summary`, que o
  // drawer e o roteiro já sabem ler).
  //
  // O áudio NÃO fica guardado: transcreveu, o texto basta e o banco não incha.
  // Falha de transcrição nunca é erro do cockpit — a ligação já aconteceu.
  app.post("/api/whatsapp/calls/:id/recording", async (req, reply) => {
    const call = await repo.get("wa_calls", req.params.id);
    if (!call) return reply.code(404).send({ error: "Not found" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "envie o áudio (multipart, campo file)" });
    const buf = await file.toBuffer();
    // Teto da própria API de transcrição (25MB) — ~2h de opus estéreo.
    if (buf.length > 25 * 1024 * 1024) return reply.code(413).send({ error: "gravação acima de 25MB" });
    if (buf.length < 8 * 1024) return { ok: true, skipped: "gravação curta demais" };
    if (!transcriber.configured()) {
      return reply.code(503).send({ error: "transcrição não configurada no servidor (OPENROUTER_API_KEY ou OPENAI_API_KEY)" });
    }

    const lead = call.leadId ? await repo.get("leads", call.leadId).catch(() => null) : null;
    const product = call.saas ? await repo.get("products", call.saas).catch(() => null) : null;
    let transcript = "";
    try {
      transcript = await transcriber.transcribe(buf, {
        filename: `wa-call-${call.id}.webm`, mime: file.mimetype || "audio/webm",
        // Nomes próprios do negócio no prompt: é onde o Whisper mais erra.
        prompt: [product?.name || "LeverAds", lead?.name, lead?.company].filter(Boolean).join(", "),
      });
    } catch (err) {
      app.log?.warn?.({ call: call.id, err: err.message }, "transcrição da ligação falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
    if (!transcript) return { ok: true, skipped: "sem fala reconhecida" };

    await repo.update("wa_calls", call.id, {
      transcript, transcriptAt: new Date().toISOString(),
      transcriptChars: transcript.length, durationSec: Number(req.query?.secs) || call.durationSec || 0,
    });

    // Resumo estratégico: mesma régua da call de Meet. Sem lead na conversa (ou
    // sem IA) fica só a transcrição, que já é o pedido.
    let summarized = false;
    if (lead && anthropic?.configured?.()) {
      try {
        const brt = (d) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        const { summary } = await anthropic.summarizeCall({
          transcript,
          lead: { name: lead.name, company: lead.company, niche: lead.niche, stage: lead.stage },
          productName: product?.name || "LeverAds",
          callDate: brt(call.startedAt || Date.now()),
          today: brt(new Date()),
        });
        await logActivity(repo, {
          saas: lead.saas || call.saas || "",
          lead: lead.id,
          type: "system",
          text: formatSummaryText(summary),
          meta: {
            event: "call_summary",
            kind: "call",
            // De onde veio: ligação do WhatsApp pelo cockpit, não Meet. Os
            // campos de dedup do Meet (callSummaryFor) NÃO são tocados, senão
            // a call de venda no Meet deixaria de ser resumida.
            source: "whatsapp_call",
            waCallId: call.id,
            temperatura: summary.temperatura || "",
            summary,
          },
          author: req.authUser?.id || "cockpit",
        });
        summarized = true;
      } catch (err) {
        app.log?.warn?.({ call: call.id, err: err.message }, "resumo da ligação falhou (transcrição salva)");
      }
    }
    return { ok: true, chars: transcript.length, summarized };
  });

  // Enviar pela conversa (inbox) — id é o número em dígitos, funciona com ou sem
  // lead. O número de saída segue a conversa (thread) / o produto.
  app.post("/api/whatsapp/threads/:id/send", async (req, reply) => {
    const phone = threadId(req.params.id);
    const text = String(req.body?.text || "").trim();
    if (!phone) return reply.code(400).send({ error: "número inválido" });
    if (!text) return reply.code(400).send({ error: "mensagem vazia" });
    // Grafia com/sem o nono dígito cai na MESMA conversa (e envia pro wa_id
    // que a pessoa usa de verdade — senão nasceria uma segunda thread).
    const thread = await findThreadByPhone(repo, phone);
    const phoneId = await resolvePhoneId({ thread });
    if (phoneId === null) return noNumberReply(reply, thread?.saas || "");
    if (!wa.configured(phoneId)) return reply.code(503).send({ error: "WhatsApp não configurado no servidor" });
    try {
      const messageId = await sendAndRecord(repo, wa, { phone: thread?.phone || phone, text, author: req.authUser?.id || "cockpit", phoneId, saas: thread?.saas || "" });
      return { ok: true, messageId };
    } catch (err) { return sendErrorReply(reply, err); }
  });

  // Enviar MÍDIA pela conversa (multipart, campo `file`): sobe o arquivo no
  // número (uploadMedia) e envia como áudio/imagem/vídeo/documento. Grava a
  // mensagem out COM a referência da mídia e cacheia o binário em `wa_media`
  // pra tocar no nosso próprio inbox (a bolha usa a mesma MediaBubble).
  // Formatos: o WhatsApp aceita ogg(opus)/mp3/m4a/aac/amr em áudio; se o
  // navegador mandar webm (Chrome grava assim) e a Meta recusar, o erro sobe
  // legível — a UI avisa.
  const MEDIA_KIND = (mime) => {
    const m = String(mime || "").toLowerCase();
    if (m.startsWith("audio/")) return "audio";
    if (m.startsWith("image/")) return "image";
    if (m.startsWith("video/")) return "video";
    return "document";
  };
  app.post("/api/whatsapp/threads/:id/media", async (req, reply) => {
    const phone = threadId(req.params.id);
    if (!phone) return reply.code(400).send({ error: "número inválido" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "envie o arquivo (multipart, campo file)" });
    const buf = await file.toBuffer();
    if (!buf.length) return reply.code(400).send({ error: "arquivo vazio" });
    if (buf.length > 16 * 1024 * 1024) return reply.code(413).send({ error: "arquivo acima de 16MB (limite do WhatsApp)" });
    const thread = await findThreadByPhone(repo, phone);
    const phoneId = await resolvePhoneId({ thread });
    if (phoneId === null) return noNumberReply(reply, thread?.saas || "");
    if (!wa.configured(phoneId)) return reply.code(503).send({ error: "WhatsApp não configurado no servidor" });

    const mime = file.mimetype || "application/octet-stream";
    const kind = MEDIA_KIND(mime);
    const filename = file.filename || (kind === "audio" ? "audio.ogg" : "arquivo");
    const to = thread?.phone || phone;
    let mediaId, messageId;
    try {
      mediaId = await wa.uploadMedia(buf, { mime, filename, phoneId });
      ({ messageId } = await wa.sendMedia(to, { kind, mediaId, filename, caption: String(req.body?.caption || "") }, { phoneId }));
    } catch (err) { return sendErrorReply(reply, err); }

    const label = { audio: "🎤 áudio", image: "📷 imagem", video: "🎬 vídeo", document: "📎 " + filename }[kind];
    await recordMessage(repo, {
      id: messageId, phone: to, direction: "out", text: label, status: "sent",
      author: req.authUser?.id || "cockpit", waPhoneId: phoneId || "", saas: thread?.saas || "",
      media: { kind, id: mediaId, mime, filename },
    });
    // Cacheia o binário sob o id da MENSAGEM pra tocar no nosso inbox (o mediaId
    // da Meta expira; guardamos a cópia como no recebimento).
    if (messageId && buf.length <= 16 * 1024 * 1024) {
      try { await repo.create("wa_media", { id: messageId, mime, size: buf.length, data: buf.toString("base64"), at: new Date().toISOString() }); }
      catch { /* cache é bônus */ }
    }
    try { await closeThreadAlerts(repo, threadId(phone), req.authUser?.id || "cockpit"); } catch { /* não trava */ }
    return { ok: true, messageId, kind };
  });

  // Enviar pelo drawer do lead (resolve o telefone E o número do produto do lead).
  app.post("/api/leads/:id/whatsapp", async (req, reply) => {
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const phone = lead.phone || req.body?.to || "";
    const text = String(req.body?.text || "").trim();
    if (!phone) return reply.code(400).send({ error: "lead sem telefone" });
    if (!text) return reply.code(400).send({ error: "mensagem vazia" });
    // O telefone do lead (com o nono dígito) e o wa_id da Meta (sem) são a
    // MESMA conversa — resolve a existente e envia pro número que ela usa.
    const thread = await findThreadByPhone(repo, phone);
    const phoneId = await resolvePhoneId({ saas: lead.saas || "", thread });
    if (phoneId === null) return noNumberReply(reply, lead.saas || "");
    if (!wa.configured(phoneId)) return reply.code(503).send({ error: "WhatsApp não configurado no servidor (WHATSAPP_TOKEN + número)" });
    try {
      const messageId = await sendAndRecord(repo, wa, { phone: thread?.phone || phone, text, author: req.authUser?.id || "cockpit", phoneId, saas: lead.saas || "" });
      return { ok: true, messageId };
    } catch (err) { return sendErrorReply(reply, err); }
  });

  return wa;
}
