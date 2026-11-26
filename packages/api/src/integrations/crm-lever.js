// Aviso de lead novo pro CRM Lever (o CRM novo, crm.levermoney.com.br).
//
// Pedido do Leo em 26/11/2026: o "Aeroporto de leads" de lá (pop-up do lead
// novo no CRM e na TV da sala, com 1 minuto e som) não tocava com lead de
// verdade. Os anúncios apontam pros formulários DAQUI; o CRM Lever só fica
// sabendo do lead quando a cópia dele (o Espelho, que lê este banco) roda, a
// cada 3 minutos. Com este aviso ele copia na hora e o pop-up sai em segundos.
//
// O aviso NÃO leva dado nenhum: nem nome, nem telefone, nem id do lead, nem
// chave. É só um "tem coisa nova, vem buscar": quem busca é o CRM Lever, pela
// leitura que ele já faz deste banco. Por isso a porta de lá é pública e não
// precisa de segredo de nenhum dos dois lados.
//
// Fail-open SEMPRE, como o Discord: erro de rede ou timeout (3s) nunca
// propaga, e quem chama não espera a resposta. Aviso perdido não perde lead:
// ele chega no ciclo normal da cópia, só que mais tarde.
//
// Endereço: em produção vale o do CRM Lever, sem variável nenhuma. Fora de
// produção fica desligado (teste e dev nunca batem lá), a menos que
// CRM_LEVER_URL aponte pra um CRM de dev. CRM_LEVER_URL=off desliga em
// produção sem precisar de deploy de código.
// Factory com fetch injetável pra testar offline (mesmo padrão do discord.js).

import { resolveAppEnv } from "../platform/app-env.js";

export const CRM_LEVER_PROD_URL = "https://crm.levermoney.com.br";
const NUDGE_PATH = "/api/public/espelho/lead-novo";

// O endereço do CRM Lever pra este ambiente ("" = desligado).
export function crmLeverUrl(env = process.env) {
  const explicit = String(env.CRM_LEVER_URL ?? "").trim();
  if (explicit) return /^(off|0|false)$/i.test(explicit) ? "" : explicit;
  return resolveAppEnv(env) === "production" ? CRM_LEVER_PROD_URL : "";
}

export function makeCrmLever({ fetch: f = globalThis.fetch, baseUrl = "" } = {}) {
  const url = baseUrl ? `${String(baseUrl).replace(/\/+$/, "")}${NUDGE_PATH}` : "";
  const configured = () => !!url;

  return {
    configured,

    // "Entrou lead por formulário agora." Nunca lança; devolve se o CRM Lever
    // respondeu (só pra teste e log: quem chama não depende disso).
    async leadNew() {
      if (!configured()) return false;
      try {
        const res = await f(url, {
          method: "POST",
          // o CRM Lever exige JSON + este cabeçalho em todo POST (anti-CSRF de lá)
          headers: { "content-type": "application/json", "x-crm-csrf": "1" },
          body: "{}",
          signal: AbortSignal.timeout(3000),
        });
        return !!res?.ok;
      } catch {
        return false;
      }
    },
  };
}

// Singleton de produção (env). Testes usam makeCrmLever com fetch mockado.
export const crmLever = makeCrmLever({ baseUrl: crmLeverUrl() });
