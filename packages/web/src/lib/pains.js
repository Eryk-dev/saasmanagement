// Dor (roteiro de criativo) de um lead — a ponte UTM → anúncio → código "[X]".
// O lead chega com utm.content = id do anúncio; o catálogo de atribuição resolve
// o nome, e o código entre colchetes no nome indica a dor (product.painMap dá o
// rótulo humano). Usado pelo drawer do lead e pelos cards do pipeline.
import React from "react";
import { api } from "./api.js";

// Espelho do painCode da API, num módulo sem React pra ficar testável; quem
// importava painCodeOf daqui continua importando daqui (re-export com binding
// local, porque o leadPain abaixo usa a função).
import { painCodeOf } from "./pain-code.js";
export { painCodeOf };

// Catálogo de atribuição (id → nome de campanha/conjunto/anúncio). Cacheia a
// PROMESSA por SaaS: os ~50 cards do kanban montam no mesmo tick e todos
// compartilham UMA requisição (cachear só o resultado disparava uma rajada de
// GETs idênticos no primeiro render). Falha limpa o cache pra tentar de novo.
const attributionCache = {};
export function useAttribution(saas, enabled = true) {
  const [cat, setCat] = React.useState(null);
  React.useEffect(() => {
    if (!saas || !enabled) return;
    let alive = true;
    (attributionCache[saas] ??= api.marketingAttribution(saas).catch(() => { delete attributionCache[saas]; return null; }))
      .then((c) => { if (alive && c) setCat(c); });
    return () => { alive = false; };
  }, [saas, enabled]);
  return cat;
}

// Dor do lead: null quando não veio de anúncio mapeado.
export function leadPain(lead, cat, painMap) {
  const utm = lead?.utm || {};
  const ad = cat?.ads?.[String(utm.content)] || {};
  const adsetId = utm.term || ad.adsetId;
  const adset = cat?.adsets?.[String(adsetId)] || {};
  const campaignId = utm.campaign || ad.campaignId || adset.campaignId;
  // Alguns conjuntos antigos guardam [A-E] só no conjunto/campanha. O nível
  // mais específico continua vencendo quando o código existe no anúncio.
  const code = lead?.sourcePain ||
    painCodeOf(ad.name || utm.content) ||
    painCodeOf(adset.name || utm.term) ||
    painCodeOf(cat?.campaigns?.[String(campaignId)]?.name || utm.campaign);
  if (!code) return null;
  return { code, label: (painMap || {})[code] || code };
}
