import { runNativeProposal } from "./proposal.js";
import { publicBase } from "../platform/request.js";
import { runProposal } from "../crm/levercopy.js";

// Dispatcher native | levercopy — TODO gatilho de proposta passa por aqui (rota
// manual em routes.lead-proposals.js e o auto-trigger do form em routes.forms.js).
// Provider: `product.proposalProvider` explícito vence; sem ele, usa 'native'
// quando o SaaS tem template publicado, senão 'levercopy' (preserva o caminho
// de produção do LeverAds até existir template nativo).
export async function dispatchProposal(repo, lead, { auto = false, force = false, template = "", unpin = false, baseUrl = "" } = {}) {
  // Deck FIXADO no lead (`proposalPinned`): apresentação feita à mão pra aquele
  // cliente. "Re-gerar" trocaria pelo deck padrão e o trabalho sumiria do card,
  // então aqui ela é recusada até alguém confirmar (o botão manda unpin=1).
  if (lead.proposalPinned && lead.proposta_id && !unpin) return { ok: false, skipped: "pinned", lead };
  const product = await repo.get("products", lead.saas);
  let provider = product?.proposalProvider;
  if (provider !== "native" && provider !== "levercopy") {
    const templates = await repo.list("proposal_templates");
    provider = templates.some((t) => t.saas === lead.saas && t.status === "published") ? "native" : "levercopy";
  }
  const result = provider === "native"
    ? await runNativeProposal(repo, lead, { auto, force, template, baseUrl: baseUrl || publicBase() })
    : await runProposal(repo, lead, { auto, force });
  // Trocou o deck fixado de propósito: o lead deixa de estar fixado (senão a
  // próxima re-geração seria recusada por uma fixação que já não vale).
  if (unpin && result.ok && lead.proposalPinned) {
    result.lead = await repo.update("leads", lead.id, { proposalPinned: false });
  }
  return { provider, ...result };
}
