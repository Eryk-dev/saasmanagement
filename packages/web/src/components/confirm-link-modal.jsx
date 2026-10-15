import React from "react";
import { Modal } from "./overlay.jsx";
import { gatewayLabel } from "../lib/payments.js";

// Pop-up de confirmação ANTES de gerar um link de pagamento (Leo, 15/10/2026):
// o valor que vai pro checkout aparece em destaque, com parcelas, gateway e
// pra quem é, e só gera depois do "sim". Vale pra todo ponto que gera link
// (modal do lead/cliente, cobrança avulsa, fatura, upsell, "cobrar próxima").
const brl = (n) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ConfirmLinkModal({ amount, installments, gateway, title, who, pasted = false, onConfirm, onCancel }) {
  const facts = [
    who ? ["para", who] : null,
    title ? ["no checkout", title] : null,
    installments > 1 ? ["parcelas", `até ${installments}x`] : installments === 1 ? ["parcelas", "à vista"] : null,
    gateway ? ["gateway", gatewayLabel(gateway)] : null,
  ].filter(Boolean);
  return (
    <Modal onClose={onCancel} label="Confirmar valor do link" largura={380} painelStyle={{ padding: "20px 22px" }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{pasted ? "Registrar link com este valor?" : "Gerar link com este valor?"}</div>
      <div className="tnum" style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5, marginTop: 10, color: "var(--fg-1)" }}>{brl(amount)}</div>
      {facts.length > 0 && (
        <dl style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", fontSize: 12.5 }}>
          {facts.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="mono dim" style={{ fontSize: 10.5, alignSelf: "center" }}>{k}</dt>
              <dd style={{ margin: 0, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v}>{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      <div className="mono dim" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
        confira o valor antes de mandar pro cliente: o link nasce com esse número e não dá pra editar depois.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ padding: "8px 14px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 13 }}>Cancelar</button>
        <button autoFocus onClick={onConfirm} style={{ padding: "8px 14px", background: "var(--btn-bg)", color: "var(--btn-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 600 }}>
          {pasted ? "Registrar link" : "Gerar link"}
        </button>
      </div>
    </Modal>
  );
}

// Hook: `const [confirmEl, askLink] = useConfirmLink()` → renderiza `confirmEl`
// na tela e chama `await askLink({ amount, installments, gateway, title, who })`
// antes de bater na API; resolve true no "Gerar link" e false no cancelar.
export function useConfirmLink() {
  const [pending, setPending] = React.useState(null);
  const ask = React.useCallback((info) => new Promise((resolve) => setPending({ info, resolve })), []);
  const settle = (ok) => { pending?.resolve(ok); setPending(null); };
  const element = pending ? <ConfirmLinkModal {...pending.info} onConfirm={() => settle(true)} onCancel={() => settle(false)} /> : null;
  return [element, ask];
}
