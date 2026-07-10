// Dor (roteiro de criativo) de um lead — a ponte UTM → anúncio → código "[X]".
// O lead chega com utm.content = id do anúncio; o catálogo de atribuição resolve
// o nome, e o código entre colchetes no nome indica a dor (product.painMap dá o
// rótulo humano). Usado pelo drawer do lead e pelos cards do pipeline.
import React from "react";
import { api } from "./api.js";

// Código "[X]" em qualquer posição do nome do anúncio — espelho do painCode
// da API (routes.marketing.js); mantenha os dois em sincronia.
export function painCodeOf(adName) {
  const m = String(adName || "").match(/\[([^\]]{1,12})\]/);
  return m ? m[1].trim().toUpperCase() : null;
}

// Catálogo de atribuição (id → nome de campanha/conjunto/anúncio) — cache por
// SaaS no módulo: drawers e cards abrem o tempo todo, a Meta não muda tanto.
const attributionCache = {};
export function useAttribution(saas, enabled = true) {
  const [cat, setCat] = React.useState(attributionCache[saas] || null);
  React.useEffect(() => {
    if (!saas || !enabled || attributionCache[saas]) return;
    let alive = true;
    api.marketingAttribution(saas)
      .then((c) => { attributionCache[saas] = c; if (alive) setCat(c); })
      .catch(() => { /* sem catálogo → sem dor, sem erro */ });
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
