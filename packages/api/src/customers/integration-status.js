// A integração do cliente numa definição só (12/11/2026).
//
// Até aqui o cockpit tinha três ideias de "integração" que não conversavam:
//   · o card do lead na etapa Integração (`integrationAt`, `integrator`) e
//     depois em Pós-venda;
//   · o registro `onboardings` (onboardings.js), que a Carteira lia pelo
//     ciclo de vida;
//   · o marco "onboarding" da régua (`customer.milestonesDone.onboarding`),
//     que a tela Clientes lia.
// Concluir a integração não marcava o marco, e a régua só abre acompanhamento
// pra marco vencido há até 30 dias: quem entrou antes ficava com "falta:
// Onboarding" pra sempre em Clientes enquanto a Carteira dizia "saudável".
//
// Agora o estado vem daqui e o resto deriva dele:
//   integrando  · tem integração aberta (o registro manda);
//   integrado   · integração concluída, marco já feito ou legado;
//   aguardando  · venda fechada com o card ainda antes da entrega (Ganho ou
//                 Integração sem registro aberto), em produto cujo funil tem
//                 etapa de Integração.
// O ciclo de vida põe "integrando" e "aguardando" em `integracao` (Carteira e o
// número "em integração" de Clientes), e `refreshLifecycle` grava o marco
// "onboarding" quando o cliente fica integrado, com a data do go-live.
//
// Legado = integrado (decisão de 12/11/2026): cliente sem integração aberta e
// sem card esperando a entrega, ou vendido antes desta consolidação, conta como
// integrado. Card parado no Ganho de vendas antigas (o Ganho já foi a última
// etapa do funil) não volta a "falta integrar".

import { kindOf } from "../crm/stages.js";

export const OPEN_ONBOARDING = new Set(["aguardando_kickoff", "kickoff", "configuracao", "treinamento", "go_live"]);
export const INTEGRATION_STATUSES = ["integrando", "aguardando", "integrado"];
// Vendas fechadas antes disto são legado: integradas mesmo sem registro.
export const LEGACY_CUTOFF = "2026-11-12T00:00:00.000Z";

const ms = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : NaN; };
const funnelHasIntegration = (product) =>
  (Array.isArray(product?.funnel) ? product.funnel : []).some((f) => f && kindOf(product, f.stage) === "integracao");

// Data em que o cliente ficou integrado: o go-live da integração concluída mais
// recente (implantação primeiro), senão o marco já gravado.
function integratedAtOf(customer, onboardings) {
  const done = onboardings.filter((o) => o.stage === "concluida")
    .sort((a, b) => (a.kind === "implantacao" ? 0 : 1) - (b.kind === "implantacao" ? 0 : 1)
      || String(b.goLiveAt || b.stageAt || "").localeCompare(String(a.goLiveAt || a.stageAt || "")))[0];
  return (done && (done.goLiveAt || done.stageAt)) || "";
}

/**
 * Estado da integração do cliente.
 * @param customer o cliente
 * @param onboardings as integrações dele (todas)
 * @param lead o lead da venda (`customer.leadId`), quando existe
 * @param product o produto do cliente (para o funil)
 * @returns {{ status: "integrando"|"aguardando"|"integrado", at: string, onboarding: string, legacy?: boolean }}
 */
export function integrationOf(customer, { onboardings = [], lead = null, product = null } = {}) {
  const open = onboardings.filter((o) => OPEN_ONBOARDING.has(o.stage))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  if (open) return { status: "integrando", at: "", onboarding: open.id };

  const marked = customer?.milestonesDone?.onboarding || "";
  const concluded = integratedAtOf(customer, onboardings);
  if (marked || concluded) return { status: "integrado", at: concluded || marked, onboarding: "" };

  const saleLead = lead && customer?.leadId && lead.id === customer.leadId && lead.customerId === customer.id ? lead : null;
  if (saleLead && funnelHasIntegration(product)) {
    const k = kindOf(product, saleLead.stage);
    const soldAt = ms(saleLead.wonAt) || ms(customer.startedAt);
    const recent = Number.isFinite(soldAt) && soldAt >= ms(LEGACY_CUTOFF);
    if ((k === "ganho" || k === "integracao") && recent) return { status: "aguardando", at: "", onboarding: "" };
  }
  return { status: "integrado", at: customer?.startedAt || "", onboarding: "", legacy: true };
}

export const isIntegrating = (status) => status === "integrando" || status === "aguardando";
