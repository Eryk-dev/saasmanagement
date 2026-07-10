// Dor (roteiro de criativo) de um lead — a ponte UTM → anúncio → código "[X]".
// O lead chega com utm.content = id do anúncio; o catálogo de atribuição resolve
// o nome, e o código entre colchetes no nome indica a dor (product.painMap dá o
// rótulo humano). Usado pelo drawer do lead e pelos cards do pipeline.
import React from "react";
import { api } from "./api.js";

// Código "[X]" em qualquer posição do nome do anúncio — espelho do painCode
// da API (routes.marketing.js); mantenha os dois em sincronia. Código = 1-3
// alfanuméricos ("[TESTE]" não vira dor fantasma).
export function painCodeOf(adName) {
  const m = String(adName || "").match(/\[([A-Za-z0-9]{1,3})\]/);
  return m ? m[1].toUpperCase() : null;
}

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
  const content = lead?.utm?.content;
  if (!content) return null;
  const adName = cat?.ads?.[String(content)]?.name || String(content);
  const code = painCodeOf(adName);
  if (!code) return null;
  return { code, label: (painMap || {})[code] || code };
}
