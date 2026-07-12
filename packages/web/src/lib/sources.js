// Rótulo legível da ORIGEM de uma visita/lead (utm.source + utm.placement).
// Tráfego pago da Meta chega de duas grafias históricas (source "meta" fixo da
// convenção do cockpit, ou fb/ig/an/msg da macro {{site_source_name}} de
// anúncio criado no Gerenciador) — o servidor normaliza pra source=meta +
// placement, e aqui vira "Meta · Instagram" etc. Orgânico derivado do referrer
// (google, instagram, site leverads) passa direto.
const META_PLACEMENT_LABEL = {
  fb: "Facebook",
  ig: "Instagram",
  an: "Audience Network",
  msg: "Messenger",
};

export function sourceLabel(u) {
  const s = u?.source || "";
  if (s === "meta") {
    const p = META_PLACEMENT_LABEL[u.placement] || u.placement;
    return p ? `Meta · ${p}` : "Meta";
  }
  // Legado gravado antes da normalização (evento/lead antigo com source cru).
  if (META_PLACEMENT_LABEL[s]) return `Meta · ${META_PLACEMENT_LABEL[s]}`;
  return s || "";
}
