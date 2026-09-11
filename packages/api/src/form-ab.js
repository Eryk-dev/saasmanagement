// Teste A/B de FORMULÁRIO (não de headline — esse já existe em welcome.variants).
//
// Manda uma fatia do tráfego pago pros formulários novos, decidindo na CHEGADA
// em /f/:id. Fazer assim, e não trocando a URL dos anúncios, tem três ganhos:
// nenhuma campanha precisa ser editada, a atribuição continua idêntica (mesma
// URL, mesmo utm_content), e desligar é virar uma flag — não republicar anúncio.
//
// A divisão das campanhas vem do código de dor no NOME do anúncio, que já é a
// convenção da casa (attribution.js): `[OEM]` são as de OEM, `[A]`-`[E]` e os
// sem código são as de Lever Ads.
//
// Config em app_config `form_ab`, então percentual e destino mudam sem deploy:
//   { enabled, pct, onlyForms: [ids], byPain: { OEM: "fo_oem_v2" }, fallback: "fo_ads_v2" }

import { createHash } from "node:crypto";

export const FORM_AB_FLAG = "form_ab";

// Bucket estável 0-99. Determinístico de propósito: o mesmo visitante recarregando
// a página tem que cair no MESMO lado, senão o teste mede ruído de navegação em
// vez de formulário — e o lead veria o form mudar debaixo dele.
export function bucketFor(seed) {
  if (!seed) return null; // sem semente estável, não sorteia (ver pickForm)
  return createHash("sha256").update(String(seed)).digest().readUInt16BE(0) % 100;
}

// Semente, em ordem de estabilidade:
//   1) cookie já gravado (sobrevive a reload e a troca de aba)
//   2) fbclid — todo clique de Meta traz, e é único por clique
//   3) nada: NÃO sorteia. Preferimos mandar pro controle a dividir tráfego que
//      não conseguimos medir de volta.
export function seedFrom({ cookie, fbclid } = {}) {
  return cookie || fbclid || "";
}

// Decide o formulário a servir. Devolve null = fica no atual (controle).
export function pickForm({ cfg, pain, seed, currentId }) {
  if (!cfg || cfg.enabled !== true) return null;

  const pct = Number(cfg.pct);
  if (!Number.isFinite(pct) || pct <= 0) return null;

  // Só entra no teste quem chegou pelo formulário de controle declarado. Sem
  // isso, um lead que JÁ está no form novo seria re-sorteado e poderia ser
  // jogado de volta pro antigo no meio do preenchimento.
  const only = Array.isArray(cfg.onlyForms) ? cfg.onlyForms : [];
  if (only.length && !only.includes(currentId)) return null;

  const b = bucketFor(seed);
  if (b == null || b >= pct) return null;

  const alvo = (pain && cfg.byPain && cfg.byPain[pain]) || cfg.fallback || "";
  return alvo && alvo !== currentId ? String(alvo) : null;
}

// Cookie de adesão. 90 dias cobre o ciclo de venda inteiro (o lead pode voltar
// semanas depois); SameSite=Lax porque a chegada é navegação de topo vinda do
// anúncio.
export const AB_COOKIE = "lv_ab";
export const abCookieHeader = (valor) =>
  `${AB_COOKIE}=${encodeURIComponent(valor)}; Path=/; Max-Age=${90 * 24 * 3600}; SameSite=Lax`;

export function readAbCookie(header) {
  const m = String(header || "").match(new RegExp(`(?:^|;\\s*)${AB_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : "";
}
