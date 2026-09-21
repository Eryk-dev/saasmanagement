import React from "react";
import { MoreMenu } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { waLink, cockpitProposalUrl } from "../lib/ui.js";
import { waProposalPlainText } from "../lib/wa-copy.js";
import { useProposalTemplates } from "./ProposalActions.jsx";
import "./lead-send-actions.css";

// Pipeline e atividades usam as mesmas operações e a mesma oferta do cliente.
export function useLeadProposalActions({ lead, onSaved, onOpenWhatsapp }) {
  const [busy, setBusy] = React.useState(false);
  const pending = React.useRef(false);
  const altDecks = useProposalTemplates(lead?.saas).filter(t => t.selectable);
  const wa = waLink(lead?.phone);
  async function run(kind, template = {}) {
    if (pending.current) return;
    if (kind === "generate" && lead.proposta_id && !window.confirm(`Este lead já tem apresentação gerada. Gerar "${template.pickLabel || template.name || "esta apresentação"}" substitui o link atual (o que já foi mandado pro cliente continua de pé). Continuar?`)) return;
    const win = kind === "generate" || wa ? window.open("", "_blank") : null;
    pending.current = true; setBusy(true);
    try {
      let fresh = lead;
      if (kind === "generate" || !lead.proposta_id || !lead.proposalUrl) {
        const result = await api.generateProposal(lead.id, kind === "generate" ? { force: true, template: template.id, unpin: !!lead.proposalPinned } : undefined);
        if (result?.ok === false) throw new Error("Não foi possível gerar a apresentação. Tente novamente.");
        fresh = await api.get("leads", lead.id);
        onSaved(fresh);
      }
      if (kind === "generate") {
        const url = fresh.proposal_edit_url || fresh.proposalUrl;
        if (!url) throw new Error("A apresentação não retornou um link. Tente novamente.");
        if (win) win.location.replace(url);
      } else {
        const shared = await api.shareProposal(lead.id, 1);
        if (!shared?.url) throw new Error("Não consegui preparar a proposta deste produto.");
        const msg = waProposalPlainText(fresh, shared.url);
        if (wa) {
          const url = `${wa}?text=${encodeURIComponent(msg)}`;
          if (win) win.location.replace(url); else window.open(url, "_blank", "noopener");
        } else if (onOpenWhatsapp) onOpenWhatsapp(fresh, msg);
      }
    } catch (error) {
      if (win) win.close();
      window.alert(error?.message || "Não foi possível preparar a proposta.");
    } finally { pending.current = false; setBusy(false); }
  }
  return { busy, altDecks, generate: (template) => run("generate", template), share: () => run("share") };
}

export function LeadSendActions({ lead, busy, altDecks, onGenerate, onPayment, onShare, onCustom, onOpenWhatsapp, compact = false }) {
  const wa = waLink(lead.phone);
  return <div className={compact ? "lead-send-actions-compact" : "pipeline-lead-send"}>
    {!compact && <h3>enviar pro cliente</h3>}
    <button disabled={busy} onClick={() => onGenerate()}><span aria-hidden="true">▣</span><span>{busy ? "Gerando…" : "Gerar apresentação"}</span></button>
    <button onClick={onPayment}><span aria-hidden="true">▤</span><span>Link de pagamento</span></button>
    <button disabled={busy} onClick={onShare} title="Preparar a oferta principal para enviar no WhatsApp"><span aria-hidden="true">✆</span><span>{compact ? "Proposta no WhatsApp" : "Enviar proposta no WhatsApp"}</span></button>
    <MoreMenu size={30} items={[
      ...altDecks.map(t => ({ label: `gerar ${t.pickLabel || t.name}`, onClick: () => onGenerate(t), disabled: busy })),
      lead.proposal_edit_url && { label: "apresentar ↗", onClick: () => window.open(lead.proposal_edit_url, "_blank", "noreferrer") },
      lead.customProposalUrl && { label: "abrir proposta personalizada ↗", onClick: () => window.open(cockpitProposalUrl(lead.customProposalUrl), "_blank", "noreferrer") },
      { label: lead.customProposalUrl ? "editar proposta personalizada" : "montar proposta personalizada", onClick: onCustom },
      wa && { label: "Abrir conversa no WhatsApp", onClick: () => onOpenWhatsapp ? onOpenWhatsapp(lead) : window.open(wa, "_blank", "noreferrer") },
    ]} />
  </div>;
}
