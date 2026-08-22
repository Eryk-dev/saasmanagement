// Copiloto da call (caminho B, Leo 22/08/2026): o closer compartilha o áudio da
// aba do Meet + microfone, o browser manda pedaços de ~15s pra cá, o transcritor
// (o MESMO da ligação do WhatsApp) vira texto quase ao vivo e, a cada poucos
// pedaços, a IA compara a conversa com o ROTEIRO da call e devolve: etapas do
// pitch já cobertas, objeção detectada com a resposta pronta e a sugestão da
// vez. O painel no drawer do lead consome via polling.
//
// Por que browser e não a Meet Media API: a Media API segue em Developer
// Preview e exige TODOS os participantes inscritos no programa — inviável com
// lead de fora. Quando ela virar GA, este módulo troca a captação e o resto
// (transcrição, cues, painel) fica igual.
//
// Sessão = 1 doc por lead (collection copilot_sessions, id cs_<leadId>): start
// zera, chunk acrescenta segmento, stop encerra e grava a transcrição inteira
// como toque na timeline (vale como registro da call mesmo sem gravação do
// Meet). Áudio NÃO é persistido — só o texto.
import { logActivity } from "./lead-flow.js";
import { transcriber as defaultTranscriber } from "./transcribe.js";

const CUE_EVERY = 3;          // 1 cue a cada 3 pedaços (~45s) — custo sob controle
const MAX_SEGMENTS = 400;     // ~100 min de call; acima disso, para de acumular
const STEREO_INSTRUCTIONS = "O áudio é ESTÉREO: o canal esquerdo é o VENDEDOR e o canal direito é o CLIENTE. " +
  "Prefixe cada fala com 'Vendedor:' ou 'Cliente:' conforme o canal de origem.";

const sessionId = (leadId) => `cs_${leadId}`;

// ── Leitura visual (frames da aba do Meet) ──────────────────────────────────
// Um print a cada ~25s vira uma leitura compacta: câmera ligada? quantas
// pessoas? atenção aparente? O frame NUNCA é salvo — só a leitura estruturada.
// Régua honesta: isso é presença e engajamento aparente, não "análise corporal
// científica"; o valor está nos sinais objetivos (câmera desligou, entrou mais
// gente = decisor, cliente sumiu da frente).
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const VISION_PROMPT = "Você vê um print da tela de uma call do Google Meet. Responda SÓ com JSON válido, sem markdown: " +
  '{"cameraLigada": bool (a câmera de ALGUM participante remoto aparece ligada?), "pessoas": número de pessoas visíveis em vídeo, ' +
  '"atencao": "alta"|"media"|"baixa"|"na" (postura e olhar de quem aparece; "na" se ninguém visível), ' +
  '"nota": "1 frase curta e objetiva sobre o que se vê (ex.: cliente atento, segunda pessoa entrou, câmera desligada)"}. ' +
  "Nunca invente o que não dá pra ver.";

export function makeVisionReader({ fetch: f = globalThis.fetch, apiKey = process.env.OPENROUTER_API_KEY || "", model = process.env.COPILOT_VISION_MODEL || "google/gemini-2.5-flash-lite" } = {}) {
  const configured = () => !!apiKey;
  async function read(buffer, mime = "image/jpeg") {
    if (!configured()) throw new Error("visão não configurada — OPENROUTER_API_KEY ausente");
    const b64 = Buffer.isBuffer(buffer) ? buffer.toString("base64") : Buffer.from(buffer).toString("base64");
    const res = await f(OR_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model, temperature: 0,
        messages: [{ role: "user", content: [
          { type: "text", text: VISION_PROMPT },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
        ] }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`leitura visual falhou (${res.status}): ${body?.error?.message || "?"}`);
    const raw = String(body.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
    const j = JSON.parse(raw);
    return {
      cameraLigada: !!j.cameraLigada,
      pessoas: Math.max(0, Math.floor(Number(j.pessoas) || 0)),
      atencao: ["alta", "media", "baixa"].includes(j.atencao) ? j.atencao : "na",
      nota: String(j.nota || "").slice(0, 200),
    };
  }
  return { configured, read };
}

export function registerCopilotRoutes(app, repo, { transcriber = defaultTranscriber, anthropic = null, vision = makeVisionReader() } = {}) {
  function requireUser(req, reply) {
    if (req.authUser?.id) return req.authUser;
    reply.code(401).send({ error: "o copiloto é por pessoa — faça login no cockpit" });
    return null;
  }

  const transcriptOf = (s) => (s?.segments || []).map((x) => x.text).filter(Boolean).join("\n");

  // Cue: transcrição acumulada + checklist do roteiro → o que já foi coberto e
  // o próximo movimento. Best-effort: cue que falha não derruba o chunk.
  async function refreshCues(session, lead, product) {
    if (!anthropic?.configured?.() || typeof anthropic.copilotCue !== "function") return null;
    const transcript = transcriptOf(session);
    if (transcript.length < 80) return null; // cedo demais: nada útil pra analisar
    const v = session.visual;
    const { cue } = await anthropic.copilotCue({
      transcript,
      checklist: session.checklist || [],
      lead: { name: lead.name, company: lead.company, niche: lead.niche, stage: lead.stage },
      productName: product?.name || "LeverAds",
      visual: v ? `câmera ${v.cameraLigada ? "ligada" : "desligada"} · ${v.pessoas} pessoa(s) em vídeo · atenção ${v.atencao} · ${v.nota}` : "",
    });
    return cue || null;
  }

  // Abre (ou reinicia) a sessão do lead. O checklist vem do FRONT — é o mesmo
  // roteiro da call que o closer vê no drawer, uma fonte só.
  app.post("/api/leads/:id/copilot/start", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!transcriber?.configured?.()) return reply.code(424).send({ error: "transcrição não configurada — defina OPENROUTER_API_KEY no servidor" });
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const checklist = (Array.isArray(req.body?.checklist) ? req.body.checklist : [])
      .map((c, i) => ({ id: String(c?.id || `p${i + 1}`), label: String(c?.label || "").slice(0, 160) }))
      .filter((c) => c.label).slice(0, 24);
    const doc = {
      id: sessionId(lead.id), saas: lead.saas || "", lead: lead.id, user: user.id,
      startedAt: new Date().toISOString(), endedAt: "", checklist, segments: [], cues: null, seq: 0,
    };
    const existing = await repo.get("copilot_sessions", doc.id);
    if (existing) await repo.update("copilot_sessions", doc.id, doc);
    else await repo.create("copilot_sessions", doc);
    return { ok: true, id: doc.id };
  });

  // Um pedaço de áudio (~15s, webm/opus estéreo). Transcreve e acumula; a cada
  // CUE_EVERY pedaços roda a IA do cue na MESMA resposta (o próximo polling do
  // painel já vê o resultado).
  app.post("/api/leads/:id/copilot/chunk", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const session = await repo.get("copilot_sessions", sessionId(req.params.id));
    if (!session || session.endedAt) return reply.code(409).send({ error: "sessão do copiloto não está aberta — clique em iniciar de novo" });
    if ((session.segments || []).length >= MAX_SEGMENTS) return reply.code(413).send({ error: "sessão longa demais — pare e reinicie o copiloto" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "envie o áudio (multipart, campo file)" });
    const buf = await file.toBuffer();
    if (buf.length < 2000) return { ok: true, skipped: true }; // silêncio/pedaço vazio: nem gasta transcrição

    const lead = await repo.get("leads", req.params.id);
    let text = "";
    try {
      text = await transcriber.transcribe(buf, {
        mime: file.mimetype || "audio/webm",
        instructions: STEREO_INSTRUCTIONS,
        prompt: [lead?.name, lead?.company, "LeverAds", "Mercado Livre", "Shopee"].filter(Boolean).join(", "),
      });
    } catch (err) {
      req.log.warn({ err: err.message, lead: req.params.id }, "copiloto: transcrição do pedaço falhou (segue a call)");
      return reply.code(422).send({ error: `transcrição falhou: ${String(err.message || err).slice(0, 160)}` });
    }
    const segments = [...(session.segments || [])];
    if (text) segments.push({ t: new Date().toISOString(), text });
    const seq = (session.seq || 0) + 1;
    let cues = session.cues || null;
    // O 1º pedaço com fala já gera cue (feedback imediato); depois, 1 a cada 3.
    if (text && (seq === 1 || seq % CUE_EVERY === 0)) {
      try {
        const product = lead?.saas ? await repo.get("products", lead.saas) : null;
        const fresh = await refreshCues({ ...session, segments }, lead || {}, product);
        if (fresh) cues = { ...fresh, at: new Date().toISOString() };
      } catch (err) {
        req.log.warn({ err: err.message, lead: req.params.id }, "copiloto: cue falhou (transcrição segue)");
      }
    }
    await repo.update("copilot_sessions", session.id, { segments, seq, cues });
    return { ok: true, text, cues };
  });

  // Um frame da aba (~25s): leitura visual compacta gravada na sessão. O jpeg
  // morre aqui — nada de imagem no banco. Best-effort: falha não afeta o áudio.
  app.post("/api/leads/:id/copilot/frame", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!vision?.configured?.()) return { ok: true, skipped: true };
    const session = await repo.get("copilot_sessions", sessionId(req.params.id));
    if (!session || session.endedAt) return reply.code(409).send({ error: "sessão do copiloto não está aberta" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "envie o frame (multipart, campo file)" });
    const buf = await file.toBuffer();
    if (buf.length < 4000) return { ok: true, skipped: true };
    try {
      const visual = { ...(await vision.read(buf, file.mimetype || "image/jpeg")), at: new Date().toISOString() };
      await repo.update("copilot_sessions", session.id, { visual });
      return { ok: true, visual };
    } catch (err) {
      req.log.warn({ err: err.message, lead: req.params.id }, "copiloto: leitura visual falhou (áudio segue)");
      return { ok: false };
    }
  });

  // Estado pro painel (polling): transcrição (cauda) + cues + checklist.
  app.get("/api/leads/:id/copilot", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const s = await repo.get("copilot_sessions", sessionId(req.params.id));
    if (!s) return { active: false };
    const transcript = transcriptOf(s);
    return {
      active: !s.endedAt, startedAt: s.startedAt, endedAt: s.endedAt || "",
      checklist: s.checklist || [], cues: s.cues || null, visual: s.visual || null,
      transcriptTail: transcript.slice(-1600), chars: transcript.length,
    };
  });

  // Encerra e grava a transcrição inteira na timeline do lead — registro da
  // call que existe MESMO sem a gravação do Meet ter funcionado.
  app.post("/api/leads/:id/copilot/stop", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const s = await repo.get("copilot_sessions", sessionId(req.params.id));
    if (!s || s.endedAt) return { ok: true, already: true };
    const endedAt = new Date().toISOString();
    await repo.update("copilot_sessions", s.id, { endedAt });
    const transcript = transcriptOf(s);
    if (transcript.length > 200) {
      try {
        await logActivity(repo, {
          saas: s.saas || "", lead: s.lead, type: "system",
          text: `Transcrição do copiloto da call (ao vivo, pelo navegador)\n\n${transcript.slice(0, 30_000)}`,
          meta: { event: "copilot_transcript", startedAt: s.startedAt, endedAt, chars: transcript.length },
          author: user.id,
        });
      } catch { /* fail-open */ }
    }
    return { ok: true, chars: transcript.length };
  });
}
