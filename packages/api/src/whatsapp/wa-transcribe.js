// Transcrição de nota de voz recebida no WhatsApp, num lugar só: o webhook
// (resposta a lembrete de call) e o cérebro do SDR (decisão da IA) chamam a
// mesma função. Antes o webhook classificava "🎤 áudio" como "não entendi" e
// abria alerta pra gente ouvir (11 alertas em 2 semanas, raio-x 30/09), e só
// o cérebro transcrevia. O texto fica gravado na mensagem (wa_messages.
// transcript), então a segunda chamada é grátis; em voo, a segunda espera a
// primeira (sem transcrever duas vezes).
const inflight = new Map();

export async function transcribeInbound(repo, { wa, transcriber, message, lead = null, log = console } = {}) {
  const m = message;
  if (!m?.id) return "";
  if (m.transcript) return m.transcript;
  if (m.media?.kind !== "audio" || !transcriber?.configured?.()) return "";
  if (inflight.has(m.id)) return inflight.get(m.id);
  const job = (async () => {
    try {
      const fresh = await repo.get("wa_messages", m.id).catch(() => null);
      if (fresh?.transcript) return fresh.transcript;
      let buf = null, mime = m.media.mime || "audio/ogg";
      const cached = await repo.get("wa_media", m.id).catch(() => null);
      if (cached?.data) { buf = Buffer.from(cached.data, "base64"); mime = cached.mime || mime; }
      else if (wa?.fetchMedia && m.media.id) {
        ({ buf, mime } = await wa.fetchMedia(m.media.id));
        if (buf && buf.length <= 16 * 1024 * 1024) {
          try { await repo.create("wa_media", { id: m.id, mime, size: buf.length, data: buf.toString("base64"), at: new Date().toISOString() }); }
          catch { /* cache é bônus */ }
        }
      }
      if (!buf || buf.length < 1024 || buf.length > 25 * 1024 * 1024) return "";
      const text = await transcriber.transcribe(buf, {
        filename: `wa-${m.id}.ogg`, mime,
        prompt: ["LeverAds", lead?.name, lead?.company].filter(Boolean).join(", "),
      });
      if (text) await repo.update("wa_messages", m.id, { transcript: text }).catch(() => {});
      return text || "";
    } catch (err) {
      log.warn?.({ msg: m.id, err: err.message }, "transcrição do áudio falhou");
      return "";
    } finally {
      inflight.delete(m.id);
    }
  })();
  inflight.set(m.id, job);
  return job;
}
