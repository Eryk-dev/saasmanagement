import React from "react";
import { api } from "../lib/api.js";
import { waLink, waDigits } from "../lib/ui.js";
import { useData } from "../data.jsx";
import { WaBubbles, WaComposer } from "./wa-thread.jsx";

// Chat de WhatsApp dentro do drawer do lead E do popup do cliente (mesma
// conversa da tela de Inbox). Lê do wa-store (GET /api/whatsapp/threads/:numero)
// e envia pelo lead quando ele tem telefone; sem lead (cliente manual), envia
// direto pela conversa (POST /threads/:numero/send, que funciona sem lead).
// Pra gerenciar o fluxo todo o SDR usa a tela #whatsapp; aqui é o atalho
// contextual. "Ligar" abre a conversa no app.

export function WhatsappChat({ lead, phone: phoneProp }) {
  const { version } = useData();
  const [msgs, setMsgs] = React.useState(null);
  const configured = !!window.SEED?.CONFIG?.whatsapp?.configured;
  const phone = lead?.phone || phoneProp || "";
  const wa = waLink(phone);
  const tid = waDigits(phone);

  React.useEffect(() => {
    if (!tid) { setMsgs([]); return; }
    let alive = true;
    api.waThread(tid).then((r) => alive && setMsgs(r.messages || [])).catch(() => alive && setMsgs([]));
    return () => { alive = false; };
  }, [tid, version]);

  // marca lida ao abrir/ter conteúdo
  React.useEffect(() => {
    if (tid && msgs && msgs.some((m) => m.direction === "in")) api.waThreadRead(tid).catch(() => {});
  }, [tid, msgs]);

  const refetch = () => tid && api.waThread(tid).then((r) => setMsgs(r.messages || [])).catch(() => {});

  return (
    <div style={{ ...box, display: "flex", flexDirection: "column", minHeight: 200, maxHeight: 460 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: "var(--fg-4)" }}>WhatsApp</span>
        <span className="mono dim" style={{ fontSize: 10.5 }}>{phone || "sem telefone"}</span>
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" title="Ligar / abrir no WhatsApp"
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 10px", borderRadius: 6, background: "#25D366", color: "#06120c", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
            ✆ Ligar
          </a>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {msgs === null
          ? <div className="mono dim" style={{ fontSize: 11.5, padding: "16px 0", textAlign: "center" }}>carregando…</div>
          : <WaBubbles messages={msgs} emptyHint={configured ? "nenhuma mensagem ainda · manda a primeira abaixo" : "nenhuma mensagem"} />}
      </div>

      {configured ? (
        <div style={{ marginTop: 8 }}>
          <WaComposer disabled={!phone} placeholder={phone ? undefined : "sem telefone"}
            onSend={(t) => (lead?.phone ? api.sendWhatsapp(lead.id, t) : api.waThreadSend(tid, t)).then(refetch)} />
          <div className="mono dim" style={{ fontSize: 9.5, marginTop: 5 }}>
            fora de 24h desde a última resposta do cliente, a Meta exige um template aprovado
          </div>
        </div>
      ) : (
        <div className="mono dim" style={{ fontSize: 11, marginTop: 8, padding: "8px 10px", border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)" }}>
          WhatsApp ainda não configurado no servidor. Enquanto isso, o botão “Ligar” abre a conversa no app.
        </div>
      )}
    </div>
  );
}

const box = {
  background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "12px 14px",
};
