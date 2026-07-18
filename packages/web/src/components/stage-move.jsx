import React from "react";
import { PrimaryButton } from "../atoms.jsx";
import { stageKind, phaseOf, isLossKind, isWonKind, lossReasonsOf } from "../lib/funnel.js";
import { usersByRole, currentUser } from "../lib/users.js";
import { PAYMENT_METHODS, CLOSED_PLANS, CONSULT_PACKAGES } from "../lib/payments.js";
import { api } from "../lib/api.js";

// Gate de movimento de estágio — os três momentos do processo que exigem input:
//   handoff  = card saindo da fase SDR pra fase Closer sem closer marcado
//   lost     = card indo pra Perdido/Desqualificado (motivo obrigatório na UI;
//              o servidor aceita sem e grava "nao_informado" — API/MCP não travam)
//   won      = card indo pra Ganho sem valor de negócio (o amount vira a receita
//              da campanha no relatório de marketing e o Purchase enviado à Meta)
// Usado pelo drag-and-drop do board E pelo select de estágio do drawer.

export function moveGate(saasCfg, lead, toStage) {
  const toKind = stageKind(saasCfg, toStage);
  if (isLossKind(toKind)) return { type: "lost", toKind };
  const fromKind = stageKind(saasCfg, lead.stage || saasCfg?.funnel?.[0]?.stage);
  const fromPhase = phaseOf(fromKind);
  if (fromPhase === "sdr" && phaseOf(toKind) === "closer" && !lead.closer) return { type: "handoff", toKind };
  // Call feita → Follow-up: registra QUAL proposta ficou na mesa (a oferta que
  // o cliente levou pra pensar) — é ela que o follow-up vai cobrar.
  if (fromKind === "call" && toKind === "followup") return { type: "offer", toKind };
  // Fechamento = passar pra INTEGRAÇÃO (handoff pro Eryk) OU pra Ganho: pede o
  // valor do negócio na hora (é onde a receita do closer é lançada).
  if ((isWonKind(toKind) || toKind === "integracao") && !(Number(lead.amount) > 0)) return { type: "won", toKind };
  return null;
}

const field = {
  width: "100%", height: 32, padding: "0 10px",
  background: "var(--bg-2)", border: "1px solid var(--line-2)",
  borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13,
};
const label = { fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 4 };

export function MoveLeadModal({ lead, toStage, gate, saasCfg, onConfirm, onCancel }) {
  const isLost = gate.type === "lost";
  const isWonGate = gate.type === "won";
  const reasons = lossReasonsOf(saasCfg);
  const closers = usersByRole("closer");
  const [closer, setCloser] = React.useState(lead.closer || closers[0]?.id || "");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [callAt, setCallAt] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [payment, setPayment] = React.useState(lead.paymentMethod || "");
  const [planClosed, setPlanClosed] = React.useState(lead.planClosed || "anual");
  // UniqueKids: o ganho É a compra de um pacote de consultas (mentoria 1:1) —
  // o gate captura o tamanho e o servidor cria a jornada inteira na conversão.
  const isKidsWon = isWonGate && lead.saas === "uniquekids";
  const [consultPackage, setConsultPackage] = React.useState(String(lead.consultPackage || 8));
  // Call → Follow-up: qual proposta ficou na mesa (o follow-up cobra ELA).
  const isOffer = gate.type === "offer";
  const [offer, setOffer] = React.useState(lead.proposalOffer || "");
  const askCall = !isLost && !isWonGate && !isOffer && gate.toKind === "call";
  const ready = isLost ? !!reason : isWonGate ? (Number(amount) > 0 && !!payment) : isOffer ? !!offer : !!closer;

  function confirm() {
    if (!ready) return;
    const patch = { stage: toStage };
    if (isLost) {
      patch.lostReason = reason;
      if (note.trim()) patch.lostNote = note.trim();
    } else if (isWonGate) {
      patch.amount = Number(amount);
      patch.paymentMethod = payment;
      // Mentoria é compra única (o valor não anualiza); o pacote é o "plano".
      patch.planClosed = isKidsWon ? "unico" : planClosed;
      if (isKidsWon) patch.consultPackage = Number(consultPackage) || 8;
    } else if (isOffer) {
      patch.proposalOffer = offer;
    } else {
      patch.closer = closer;
      if (callAt) patch.callAt = callAt;
    }
    onConfirm(patch, {
      // Nota do handoff vira um toque na timeline (contexto pro closer).
      activity: !isLost && !isWonGate && !isOffer && note.trim()
        ? { saas: lead.saas, lead: lead.id, type: "note", text: `Handoff → closer: ${note.trim()}`, author: currentUser()?.id || "", meta: { reschedule: false } }
        : null,
    });
  }

  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 90, background: "color-mix(in srgb, var(--bg-0) 62%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)", padding: 18 }}>
        <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700 }}>
          {isLost ? `Mover pra “${toStage}”` : isWonGate ? (gate.toKind === "integracao" ? "Fechar e mandar pra integração 🎉" : "Fechar como ganho 🎉") : isOffer ? "Call feita → follow-up" : "Passar pro closer"}
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 3, marginBottom: 14 }}>
          {lead.name}{lead.company ? ` · ${lead.company}` : ""} → {toStage}
        </div>

        {isOffer ? (
          <>
            <label style={label}>Qual proposta ficou na mesa? *</label>
            <select value={offer} onChange={(e) => setOffer(e.target.value)} style={field} autoFocus>
              <option value="">— a oferta que o cliente levou pra pensar —</option>
              {CLOSED_PLANS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              <option value="nenhuma">não chegou na proposta</option>
            </select>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 6 }}>
              fica no card e orienta o follow-up: é essa proposta que você vai cobrar
            </div>
          </>
        ) : isWonGate ? (
          <>
            <label style={label}>Valor do negócio (R$) *</label>
            <input type="number" min="0" step="0.01" value={amount} autoFocus placeholder="ex.: 7188"
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
              style={field} />
            <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 6 }}>
              vira a receita da campanha no relatório de marketing e o valor da conversão enviada pra Meta
            </div>
            {/* Mentoria não tem plano recorrente: o PACOTE de consultas é o que
                foi comprado, então ele substitui o "Plano fechado" no Kids. */}
            <div style={{ height: 12 }} />
            {isKidsWon ? (
              <>
                <label style={label}>Pacote de consultas *</label>
                <select value={consultPackage} onChange={(e) => setConsultPackage(e.target.value)} style={field}>
                  {CONSULT_PACKAGES.map((n) => <option key={n} value={n}>{n} consultas</option>)}
                </select>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 6 }}>
                  a jornada inteira nasce na tela Consultas (sem data); cada consulta marcada entra na Agenda e no Google
                </div>
              </>
            ) : (
              <>
                <label style={label}>Plano fechado *</label>
                <select value={planClosed} onChange={(e) => setPlanClosed(e.target.value)} style={field}>
                  {CLOSED_PLANS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </>
            )}
            <div style={{ height: 12 }} />
            <label style={label}>Modo de pagamento *</label>
            <select value={payment} onChange={(e) => setPayment(e.target.value)} style={field}>
              <option value="">— como o cliente fechou —</option>
              {PAYMENT_METHODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </>
        ) : isLost ? (
          <>
            <label style={label}>Motivo {gate.toKind === "desqualificado" ? "da desqualificação" : "da perda"} *</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} style={field} autoFocus>
              <option value="">— escolha o motivo —</option>
              {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <div style={{ height: 10 }} />
            <label style={label}>Detalhe (opcional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ex.: fechou com o concorrente X" style={{ ...field, height: "auto", padding: "8px 10px", resize: "vertical" }} />
          </>
        ) : (
          <>
            <label style={label}>Closer responsável *</label>
            <select value={closer} onChange={(e) => setCloser(e.target.value)} style={field} autoFocus>
              {closers.length === 0 && <option value="">— nenhum closer no time (Ajustes → Equipe) —</option>}
              {closers.map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
            </select>
            {askCall && (
              <>
                <div style={{ height: 10 }} />
                <label style={label}>Call agendada pra (opcional)</label>
                <input type="datetime-local" value={callAt} onChange={(e) => setCallAt(e.target.value)} style={field} />
              </>
            )}
            <div style={{ height: 10 }} />
            <label style={label}>Contexto pro closer (opcional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ex.: quer expandir pra 6 contas, sensível a preço" style={{ ...field, height: "auto", padding: "8px 10px", resize: "vertical" }} />
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={{ height: 30, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12.5 }}>cancelar</button>
          <PrimaryButton onClick={confirm} disabled={!ready}>confirmar movimento</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// Executa um movimento gateado: PATCH do lead + activity extra (nota de handoff).
export async function applyGatedMove(patch, extra, leadId) {
  await api.update("leads", leadId, patch);
  if (extra?.activity) { try { await api.logActivity(extra.activity); } catch { /* best-effort */ } }
}
