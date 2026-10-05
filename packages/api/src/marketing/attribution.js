// Helpers compartilhados da atribuição de marketing. A dor pode estar marcada
// no nome do anúncio, do conjunto OU da campanha: contas antigas da Meta usam
// as três convenções, então olhar só o anúncio perde a origem de parte dos leads.

// Código "[X]" em qualquer posição do nome. O limite de 1-3 caracteres evita
// que rótulos operacionais como "[TESTE]" virem uma dor inexistente. PRICE é
// uma linha de produto explícita e também precisa participar do roteamento.
export function painCode(name) {
  const m = String(name || "").match(/\[(PRICE|[A-Za-z0-9]{1,3})\]/i);
  return m ? m[1].toUpperCase() : null;
}

// O nível mais específico vence. Se o anúncio não carrega o código, cai para
// conjunto e campanha, que é como vários criativos legados estão nomeados.
export function attributionPain(row) {
  return painCode(row?.adName) || painCode(row?.adsetName) || painCode(row?.campaignName) || "";
}

// UTM vinda da página pública: só chaves conhecidas, strings curtas. Vai no lead
// (atribuição por campanha em /api/marketing) e na submission (auditoria).
// Click-ids de cada plataforma (fbclid/gclid/ttclid) + referrer externo entram
// no mesmo objeto — atribuição não fica restrita à Meta.
// `ref`/`refby` = indicação: o id do CLIENTE que indicou (link que ele
// encaminha) e o do colaborador que colheu. Ficam no utm pra auditoria da
// submissão; quem vira vínculo de verdade no lead é o referrals.js, que valida
// os dois contra o banco.
const UTM_KEYS = ["source", "medium", "campaign", "content", "term", "placement", "fbclid", "gclid", "ttclid", "referrer", "ref", "refby"];

export function sanitizeUtm(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const k of UTM_KEYS) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, k === "referrer" ? 300 : 200);
  }
  return Object.keys(out).length ? out : null;
}

// Anúncio criado direto no Gerenciador costuma vir com utm_source =
// {{site_source_name}} (fb/ig/an/msg = plataforma), enquanto a convenção do
// cockpit usa utm_source=meta fixo — duas grafias pra MESMA coisa (tráfego pago
// da Meta) sujavam a leitura por origem. Normaliza: source vira "meta" e a
// plataforma sobrevive em utm.placement (a convenção nova do cockpit também
// manda utm_placement={{site_source_name}}).
const META_PLATFORM_CODES = new Set(["fb", "ig", "an", "msg"]);

export function normalizeMetaSource(utm) {
  if (!utm || !META_PLATFORM_CODES.has(utm.source)) return utm;
  return { ...utm, source: "meta", placement: utm.placement || utm.source };
}

// Origem derivada do REFERRER quando a visita chega sem UTM: é o que enxerga
// bio do Instagram (l.instagram.com), busca do Google e a própria home do site
// (que manda o visitante pro form). Rótulos estáveis pros conhecidos; o resto
// fica com o hostname limpo.
export function referrerSource(referrer) {
  let host = "";
  try { host = new URL(String(referrer)).hostname.toLowerCase(); } catch { return ""; }
  host = host.replace(/^(www|m|l|lm|out)\./, "");
  if (host.includes("google.")) return "google";
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("facebook.com") || host === "fb.com") return "facebook";
  if (host.includes("bing.")) return "bing";
  if (host.includes("leverads.com.br")) return "site leverads";
  return host.slice(0, 60);
}
