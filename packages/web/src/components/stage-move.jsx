import React from "react";
import { PrimaryButton, useEsc } from "../atoms.jsx";
import { stageKind, phaseOf, isLossKind, isWonKind, lossReasonsOf } from "../lib/funnel.js";
import { usersByRole, currentUser } from "../lib/users.js";
import { PAYMENT_METHODS, CLOSED_PLANS, CONSULT_PACKAGES, CLOSED_PLAN_MONTHS, dealProductsOf, paymentUpfront, paymentRecurring } from "../lib/payments.js";
import { DealProductField, isOneOffProduct } from "./lead-blocks.jsx";
import { api } from "../lib/api.js";
import { SlotGrid, nextBusinessDays, callBusyKeys } from "../screens/today.jsx";

// Gate de movimento de estágio — os três momentos do processo que exigem input:
//   handoff  = card saindo da fase SDR pra fase Closer sem closer marcado
//   lost     = card indo pra Perdido/Desqualificado (motivo obrigatório na UI;
//              o servidor aceita sem e grava "nao_informado" — API/MCP não travam)
//   won      = card indo pra Ganho sem valor de negócio (o amount vira a receita
//              da campanha no relatório de marketing e o Purchase enviado à Meta)
//   call     = card indo pra etapa de call sem hora marcada (o servidor exige;
//              a grade já esconde o horário ocupado do closer)
// Usado pelo drag-and-drop do board E pelo select de estágio do drawer.

export function moveGate(saasCfg, lead, toStage) {
  const toKind = stageKind(saasCfg, toStage);
  if (isLossKind(toKind)) return { type: "lost", toKind };
  const fromKind = stageKind(saasCfg, lead.stage || saasCfg?.funnel?.[0]?.stage);
  const fromPhase = phaseOf(fromKind);
  if (fromPhase === "sdr" && phaseOf(toKind) === "closer" && !lead.closer) return { type: "handoff", toKind };
  // Indo pro Follow-up o gate abre SEMPRE: saindo da call registra QUAL
  // proposta ficou na mesa (a oferta que o follow-up vai cobrar) e, de
  // qualquer origem, oferece o HORÁRIO do follow-up (opcional — sem horário a
  // cadência cuida). Antes só existia saindo da call e sem agenda, então quem
  // movia pra Follow-up pelo select do drawer não tinha onde marcar a hora.
  if (toKind === "followup") return { type: "offer", toKind, askOffer: fromKind === "call" };
  // Etapa de call SEM hora marcada: o servidor recusa (card em call sem horário
  // não aparece na Agenda nem ocupa slot), então o gate pede a hora ANTES de
  // mover, em vez de deixar o PATCH tomar 422 e o card não sair do lugar.
  if (toKind === "call" && !lead.callAt) return { type: "call", toKind };
  // Fechamento = passar pra Ganho (pede o valor e o produto quando ainda não
  // tem) OU pra Integração — na Integração o gate abre SEMPRE, pré-preenchido:
  // é a última porta antes da entrega, então é aqui que o closer confere (ou
  // corrige) produto, plano, valor e pagamento. Um clique confirma; ajuste
  // re-espelha no cliente e na assinatura criados no fechamento
  // (syncWonLeadDeal na API).
  const missingProduct = !lead.dealProduct && dealProductsOf(lead.saas).length > 0;
  if (toKind === "integracao" || (isWonKind(toKind) && (!(Number(lead.amount) > 0) || missingProduct))) return { type: "won", toKind };
  return null;
}

const field = {
  width: "100%", height: 32, padding: "0 10px",
  background: "var(--bg-2)", border: "1px solid var(--line-2)",
  borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13,
};
const label = { display: "block", marginBottom: 4 };

export function MoveLeadModal({ lead, toStage, gate, saasCfg, onConfirm, onCancel }) {
  useEsc(onCancel);
  const isLost = gate.type === "lost";
  const isWonGate = gate.type === "won";
  const reasons = lossReasonsOf(saasCfg);
  const closers = usersByRole("closer");
  const [closer, setCloser] = React.useState(lead.closer || closers[0]?.id || "");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [callAt, setCallAt] = React.useState("");
  const [amount, setAmount] = React.useState(Number(lead.amount) > 0 ? String(lead.amount) : "");
  const [payment, setPayment] = React.useState(lead.paymentMethod || "");
  const [planClosed, setPlanClosed] = React.useState(lead.planClosed || "anual");
  // Faturado/parcelado: em quantas parcelas o dinheiro entra. Vazio = sugestão
  // do plano (12 anual, 6 semestral). Vira o cronograma de faturas "Parcela
  // i/N" no servidor; o pago × em aberto é marcado na tela Clientes.
  const [installments, setInstallments] = React.useState(
    Number(lead.paymentInstallments) > 0 ? String(lead.paymentInstallments) : "");
  // Indo pra INTEGRAÇÃO com o negócio já valorado: o gate vira conferência de
  // plano e valor (pré-preenchido, um clique) em vez de fechamento novo.
  const isAdjust = isWonGate && gate.toKind === "integracao" && Number(lead.amount) > 0;
  // UniqueKids: o ganho É a compra de um pacote de consultas (mentoria 1:1) —
  // o gate captura o tamanho e o servidor cria a jornada inteira na conversão.
  const isKidsWon = isWonGate && lead.saas === "uniquekids";
  const [consultPackage, setConsultPackage] = React.useState(String(lead.consultPackage || 8));
  // O QUE foi vendido (produto da apresentação): obrigatório no fechamento de
  // quem tem catálogo — é o escopo que a Integração vai entregar e o que nomeia
  // o Plano do cliente. Já vem preenchido quando o link de pagamento gravou.
  const [dealProduct, setDealProduct] = React.useState(lead.dealProduct || "");
  const askProduct = isWonGate && !isKidsWon && dealProductsOf(lead.saas).length > 0;
  const oneOff = isOneOffProduct(lead.saas, dealProduct);
  // Assinatura mensal (recorrência): o valor lançado é o MENSAL — o acumulado
  // do cliente soma outra mensalidade a cada 30 dias (accruedAmountOf). Não há
  // Nº de parcelas (a cobrança é indefinida), então o faturado fica fora.
  const isMonthly = !isKidsWon && !oneOff && planClosed === "mensal";
  const isFaturado = !!payment && paymentUpfront(payment) === false && !paymentRecurring(payment) && !isMonthly;
  const effInstallments = Number(installments) > 0 ? Number(installments)
    : (CLOSED_PLAN_MONTHS[isKidsWon || oneOff ? "unico" : planClosed] || 12);
  // Follow-up: qual proposta ficou na mesa (só saindo da call — askOffer) e
  // quando fazer o follow-up (opcional, followAt). O horário vira followupAt
  // PRÓPRIO + nextActionAt — nunca callAt (a agenda desenharia uma call que
  // não existe; caso Beto/Milaan, 13/08).
  const isOffer = gate.type === "offer";
  const askOffer = isOffer && gate.askOffer !== false;
  const [offer, setOffer] = React.useState(lead.proposalOffer || "");
  const [followAt, setFollowAt] = React.useState(lead.followupAt || "");
  // Hora da call pela MESMA grade do Meu dia: slot ocupado do closer vem
  // desabilitado, então não dá pra criar conflito digitando.
  const isCall = gate.type === "call";
  const askCall = !isLost && !isWonGate && !isOffer && gate.toKind === "call";
  const [day, setDay] = React.useState(() => nextBusinessDays(1)[0]);
  const busy = React.useMemo(
    () => callBusyKeys(window.SEED?.LEADS || [], closer, lead.id),
    [closer, lead.id],
  );
  // A call é OBRIGATÓRIA pra entrar na etapa (regra do servidor), tanto no gate
  // de call quanto no handoff que já cai numa etapa de call.
  const ready = isLost ? !!reason
    : isWonGate ? (Number(amount) > 0 && !!payment && (!askProduct || !!dealProduct))
      : isOffer ? (!askOffer || !!offer)
        : askCall ? (!!closer && !!callAt)
          : !!closer;

  function confirm() {
    if (!ready) return;
    const patch = { stage: toStage };
    if (isLost) {
      patch.lostReason = reason;
      if (note.trim()) patch.lostNote = note.trim();
    } else if (isWonGate) {
      patch.amount = Number(amount);
      patch.paymentMethod = payment;
      // À vista/cartão zera o parcelamento (um faturado antigo não assombra).
      patch.paymentInstallments = isFaturado ? effInstallments : "";
      // Mentoria é compra única (o valor não anualiza); o pacote é o "plano".
      patch.planClosed = isKidsWon ? "unico" : oneOff ? "unico" : planClosed;
      if (isKidsWon) patch.consultPackage = Number(consultPackage) || 8;
      if (askProduct) patch.dealProduct = dealProduct;
    } else if (isOffer) {
      if (askOffer && offer) patch.proposalOffer = offer;
      // Espelho do Meu dia: followupAt (aparece na Agenda com cara de follow-up,
      // sem travar slot de venda) + nextActionAt (a fila vence NESSE horário).
      if (followAt) { patch.followupAt = followAt; patch.nextActionAt = followAt; }
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
      {/* maxHeight+scroll: com o teclado aberto no celular o gate de ganho
          (valor/método/pacote) passa da altura visível — rola em vez de cortar. */}
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", maxHeight: "min(88dvh, 100%)", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)", padding: 18 }}>
        <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700 }}>
          {isLost ? `Mover pra “${toStage}”` : isAdjust ? "Confirmar plano e valor" : isWonGate ? "Fechar como ganho 🎉" : isOffer ? (askOffer ? "Call feita → follow-up" : "Marcar o follow-up") : isCall ? "Marcar a call" : "Passar pro closer"}
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 3, marginBottom: 14 }}>
          {lead.name}{lead.company ? ` · ${lead.company}` : ""} → {toStage}
        </div>

        {isOffer ? (
          <>
            {askOffer && (
              <>
                <label className="kicker" style={label}>Qual proposta ficou na mesa? *</label>
                <select value={offer} onChange={(e) => setOffer(e.target.value)} style={field} autoFocus>
                  <option value="">— a oferta que o cliente levou pra pensar —</option>
                  {CLOSED_PLANS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  <option value="nenhuma">não chegou na proposta</option>
                </select>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 6 }}>
                  fica no card e orienta o follow-up: é essa proposta que você vai cobrar
                </div>
                <div style={{ height: 12 }} />
              </>
            )}
            <label className="kicker" style={label}>Follow-up agendado pra (opcional)</label>
            <SlotGrid days={nextBusinessDays(6)} day={day} setDay={setDay} slot={followAt} setSlot={setFollowAt} busy={busy} />
            <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 6 }}>
              entra na agenda nesse horário (sem travar slot de call) e a fila do Meu dia cobra nele · sem horário, retoma pela cadência
            </div>
          </>
        ) : isWonGate ? (
          <>
            {/* O QUE ele comprou vem primeiro: escolher o produto já sugere o
                preço do catálogo no valor, então o resto do gate cai pronto. */}
            {askProduct && (
              <>
                <DealProductField saas={lead.saas} value={dealProduct} plan={planClosed}
                  fieldStyle={field} labelStyle={label}
                  onChange={(id, p) => { setDealProduct(id); if (p?.oneOff) setPlanClosed("unico"); }}
                  onPick={(r) => { setAmount(String(r.value)); if (r.plan) setPlanClosed(r.plan); }} />
                <div style={{ height: 12 }} />
              </>
            )}
            <label className="kicker" style={label}>{isMonthly ? "Valor mensal (R$) *" : "Valor do negócio (R$) *"}</label>
            <input type="number" min="0" step="0.01" value={amount} autoFocus={!askProduct} placeholder={isMonthly ? "ex.: 599" : "ex.: 7188"}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
              style={field} />
            <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 6 }}>
              {isMonthly
                ? "recorrência: a cada 30 dias do fechamento o acumulado do cliente soma mais uma mensalidade"
                : isAdjust
                  ? "ajustar aqui atualiza o cliente e a assinatura criados no fechamento"
                  : "vira a receita da campanha no relatório de marketing e o valor da conversão enviada pra Meta"}
            </div>
            {/* Mentoria não tem plano recorrente: o PACOTE de consultas é o que
                foi comprado, então ele substitui o "Plano fechado" no Kids. */}
            <div style={{ height: 12 }} />
            {isKidsWon ? (
              <>
                <label className="kicker" style={label}>Pacote de consultas *</label>
                <select value={consultPackage} onChange={(e) => setConsultPackage(e.target.value)} style={field}>
                  {CONSULT_PACKAGES.map((n) => <option key={n} value={n}>{n} consultas</option>)}
                </select>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 6 }}>
                  a jornada inteira nasce na tela Consultas (sem data); cada consulta marcada entra na Agenda e no Google
                </div>
              </>
            ) : (
              <>
                <label className="kicker" style={label}>Plano fechado *</label>
                {/* Serviço único (clonagem avulsa) não tem ciclo: o plano é o
                    próprio produto, então o select fica travado. */}
                <select value={oneOff ? "unico" : planClosed} disabled={oneOff}
                  onChange={(e) => {
                    setPlanClosed(e.target.value);
                    // Assinatura mensal fecha no cartão recorrente por padrão —
                    // só sugere quando o closer ainda não escolheu o pagamento.
                    if (e.target.value === "mensal" && !payment) setPayment("cartao_recorrente");
                  }} style={{ ...field, opacity: oneOff ? 0.7 : 1 }}>
                  {CLOSED_PLANS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </>
            )}
            <div style={{ height: 12 }} />
            <label className="kicker" style={label}>Modo de pagamento *</label>
            <select value={payment} onChange={(e) => setPayment(e.target.value)} style={field}>
              <option value="">— como o cliente fechou —</option>
              {PAYMENT_METHODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {isFaturado && (
              <>
                <div style={{ height: 12 }} />
                <label className="kicker" style={label}>Faturado em quantas vezes *</label>
                <select value={String(effInstallments)} onChange={(e) => setInstallments(e.target.value)} style={field}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}x{Number(amount) > 0 ? ` de R$ ${(Number(amount) / n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}
                    </option>
                  ))}
                </select>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 6 }}>
                  vira o cronograma de parcelas (vencimento mensal a partir de hoje); marque cada uma como paga na tela Clientes
                </div>
              </>
            )}
          </>
        ) : isLost ? (
          <>
            <label className="kicker" style={label}>Motivo {gate.toKind === "desqualificado" ? "da desqualificação" : "da perda"} *</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} style={field} autoFocus>
              <option value="">— escolha o motivo —</option>
              {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <div style={{ height: 10 }} />
            <label className="kicker" style={label}>Detalhe (opcional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ex.: fechou com o concorrente X" style={{ ...field, height: "auto", padding: "8px 10px", resize: "vertical" }} />
          </>
        ) : (
          <>
            <label className="kicker" style={label}>Closer responsável *</label>
            <select value={closer} onChange={(e) => setCloser(e.target.value)} style={field} autoFocus>
              {closers.length === 0 && <option value="">— nenhum closer no time (Ajustes → Equipe) —</option>}
              {closers.map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
            </select>
            {askCall && (
              <>
                <div style={{ height: 10 }} />
                <label className="kicker" style={label}>Call agendada pra *</label>
                <SlotGrid days={nextBusinessDays(6)} day={day} setDay={setDay} slot={callAt} setSlot={setCallAt} busy={busy} />
              </>
            )}
            <div style={{ height: 10 }} />
            <label className="kicker" style={label}>Contexto pro closer (opcional)</label>
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
