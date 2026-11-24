// VÍDEO EXPLICATIVO DO PRODUTO, ENVIADO PELO ROBÔ (decisão do Leo, 24/11/2026).
//
// Quando o lead pedia material ("tem um vídeo?", "me passa algum material",
// "me explica por aqui"), o robô dizia "peço pro time te mandar um vídeo curto"
// e parava; a SDR subia na mão, toda vez, um de dois arquivos: "LEVER OEM.mp4"
// ou "LEVER PRICE.mp4" (59 envios entre 20/10 e 24/11). Agora o robô manda.
//
// De onde vem o arquivo, sem binário no repositório: todo vídeo com esse nome
// que GENTE envia pelo Inbox fica registrado aqui (rememberVideo, chamado na
// rota de mídia) com o media id da Meta, que vale 30 dias. O poller renova o
// id antes de vencer (baixa da Meta e sobe de novo, renewVideos). Sem registro
// válido (nunca enviado, ou venceu), o robô cai no comportamento antigo: avisa
// o time e para; o próximo envio manual registra o vídeo de novo.
//
// O media id pertence ao NÚMERO que subiu o arquivo: só serve pra enviar do
// mesmo phoneId.
const DAY = 86_400_000;
export const VIDEO_VALID_MS = 27 * DAY; // a Meta expira em 30
export const VIDEO_RENEW_AFTER_MS = 18 * DAY;

const KIND_RX = { oem: /lever[\s_-]*oem/i, price: /lever[\s_-]*price/i };
export const videoKindOf = (filename) => Object.keys(KIND_RX).find((k) => KIND_RX[k].test(String(filename || ""))) || "";
// Qual vídeo cabe no roteiro do lead ("oem" | "price"); a gestão multi-contas
// ainda não tem vídeo próprio.
export const videoKindForScript = (script) => (script === "oem" || script === "price" ? script : "");
const cfgId = (saas, kind) => `sdr_video_${saas || "default"}_${kind}`;

// Gente enviou um dos vídeos pelo Inbox: guarda o media id mais novo.
export async function rememberVideo(repo, { saas, filename, mediaId, mime = "video/mp4", phoneId = "", messageId = "", now = new Date() } = {}) {
  const kind = videoKindOf(filename);
  if (!kind || !mediaId || !saas) return null;
  const id = cfgId(saas, kind);
  const next = { id, saas, kind, mediaId: String(mediaId), mime, filename: String(filename), phoneId: String(phoneId || ""), messageId: String(messageId || ""), at: new Date(now).toISOString() };
  const cur = await repo.get("app_config", id).catch(() => null);
  if (cur) await repo.update("app_config", id, next); else await repo.create("app_config", next);
  return next;
}

// O vídeo pronto pra enviar deste número, ou null.
export async function videoFor(repo, { saas, kind, phoneId = "", now = new Date() } = {}) {
  if (!kind) return null;
  const cur = await repo.get("app_config", cfgId(saas, kind)).catch(() => null);
  if (!cur?.mediaId) return null;
  const age = new Date(now).getTime() - Date.parse(cur.at || "");
  if (!Number.isFinite(age) || age > VIDEO_VALID_MS) return null;
  if (cur.phoneId && phoneId && String(cur.phoneId) !== String(phoneId)) return null;
  return { mediaId: cur.mediaId, mime: cur.mime || "video/mp4", filename: cur.filename || `LEVER ${kind.toUpperCase()}.mp4` };
}

// Renova os ids perto de vencer: baixa da Meta e sobe de novo no mesmo número.
// Id já vencido (ou download recusado): usa a cópia que o Inbox guarda do
// arquivo enviado (`wa_media`, pelo id da mensagem). Devolve quantos renovou.
// Falha não derruba nada: o envio manual seguinte registra o vídeo de novo.
export async function renewVideos(repo, wa, { saas, now = new Date(), log = console } = {}) {
  if (!wa?.uploadMedia) return 0;
  let renewed = 0;
  for (const kind of Object.keys(KIND_RX)) {
    const cur = await repo.get("app_config", cfgId(saas, kind)).catch(() => null);
    if (!cur?.mediaId) continue;
    const age = new Date(now).getTime() - Date.parse(cur.at || "");
    if (!Number.isFinite(age) || age < VIDEO_RENEW_AFTER_MS) continue;
    try {
      let file = null;
      if (age < 30 * DAY && wa.fetchMedia) file = await wa.fetchMedia(cur.mediaId).catch(() => null);
      if (!file && cur.messageId) {
        const cached = await repo.get("wa_media", cur.messageId).catch(() => null);
        if (cached?.data) file = { buf: Buffer.from(cached.data, "base64"), mime: cached.mime };
      }
      if (!file?.buf?.length) continue;
      const mediaId = await wa.uploadMedia(file.buf, { mime: file.mime || cur.mime || "video/mp4", filename: cur.filename, phoneId: cur.phoneId || undefined });
      if (!mediaId) continue;
      await repo.update("app_config", cur.id, { ...cur, mediaId: String(mediaId), at: new Date(now).toISOString() });
      renewed++;
    } catch (err) { log.warn?.({ kind, err: err.message }, "sdr-video: renovação do vídeo falhou"); }
  }
  return renewed;
}
