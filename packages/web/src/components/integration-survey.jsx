// Pesquisa de satisfação da integração no card da Integração (recurso de CS,
// 12/11/2026). Envio À MÃO: o CS copia o link (com a mensagem pronta), abre o
// WhatsApp dele com o texto ou manda por e-mail pela conta conectada. O link é
// o mesmo até o cliente responder. A resposta (nota de 1 a 5, se já usa sozinho
// e o comentário) aparece aqui; nota até 3 ou "ainda não" abre um
// acompanhamento de CS. Não entra no health score.
// API: customers/integration-survey.js.

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { waLink } from "../lib/ui.js";
import { openRecord } from "../lib/open-record.js";
import { toast } from "../atoms.jsx";
import { faceOf, faceParts } from "../../../api/src/shared/satisfaction-faces.js";

// Carinha da nota (1 triste vermelha … 5 sorrindo verde), a mesma da página
// que o cliente respondeu (api/src/shared/satisfaction-faces.js).
export function Face({ score, size = 22 }) {
  const p = faceParts(score);
  if (!p) return null;
  return <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={`${score} de 5: ${faceOf(score).label}`} style={{ flexShrink: 0 }}>
    <circle cx="20" cy="20" r="17" fill={`${p.color}22`} stroke={p.color} strokeWidth="2.5" />
    {p.eyes.map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.2" fill={p.color} />)}
    <path d={p.mouth} fill="none" stroke={p.color} strokeWidth="2.6" strokeLinecap="round" />
  </svg>;
}

const READY = { sim: "sim", parcial: "em parte", nao: "ainda não" };
const CHANNEL = { link: "link copiado", whatsapp: "WhatsApp", email: "e-mail" };
const ddmm = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }) : "");
const tone = (score) => (score >= 4 ? "pos" : score <= 3 ? "neg" : "mut");

export function IntegrationSurvey({ onboarding, customer, lead }) {
  const [survey, setSurvey] = useState(undefined);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let alive = true;
    api.onboardingSurvey(onboarding.id).then((r) => alive && setSurvey(r.survey || null)).catch(() => alive && setSurvey(null));
    return () => { alive = false; };
  }, [onboarding.id]);

  if (onboarding.stage === "cancelada" || survey === undefined) return null;
  const phone = customer?.phone || lead?.phone || "";
  const wa = waLink(phone);
  const email = customer?.email || "";
  const answered = survey?.status === "answered";
  const early = !["go_live", "concluida"].includes(onboarding.stage);

  async function ask(channel) {
    if (busy) return;
    // A aba do WhatsApp abre no clique (sem esperar a API), senão o navegador bloqueia.
    const tab = channel === "whatsapp" ? window.open("", "_blank") : null;
    setBusy(channel);
    try {
      const r = await api.askOnboardingSurvey(onboarding.id, channel);
      setSurvey(r.survey);
      if (channel === "link") {
        try { await navigator.clipboard.writeText(r.text); toast("Mensagem com o link copiada", "pos"); }
        catch { window.prompt("Mensagem da pesquisa:", r.text); }
      } else if (channel === "whatsapp") {
        if (tab) tab.location.href = `${wa}?text=${encodeURIComponent(r.text)}`;
      } else {
        toast(`Pesquisa enviada para ${email}`, "pos");
      }
    } catch (e) {
      tab?.close();
      toast(e.message || "Não foi possível gerar a pesquisa.", "neg");
    } finally {
      setBusy("");
    }
  }

  // Enxuto de propósito (12/11/2026): o card da integração já é longo, então a
  // pesquisa ocupa duas ou três linhas. Respondida: selo com nota e prontidão,
  // estrelas + data + atalho do acompanhamento numa linha e o comentário em até
  // duas linhas (inteiro no title).
  const state = answered
    ? [`nota ${survey.score} de 5`, READY[survey.ready]].filter(Boolean).join(" · ")
    : survey ? "aguardando resposta" : "não enviada";
  const note = survey
    ? `Enviada em ${ddmm(survey.sentAt)} por ${String(survey.channel || "").split("+").map((c) => CHANNEL[c] || c).join(" e ")} · o link vale até ele responder.`
    : early ? "Melhor mandar com a integração feita: o cliente avalia já usando." : "";
  const line = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12.5, marginTop: 8 };
  return <section>
    <div className="customer-peek-kicker">
      <span>pesquisa de satisfação</span>
      <span className="customer-peek-state" data-tone={answered ? tone(survey.score) : "mut"}>{state}</span>
    </div>
    {answered ? <>
      <div style={line}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 650, color: faceOf(survey.score)?.color }}>
          <Face score={survey.score} size={26} />{faceOf(survey.score)?.label}
        </span>
        <span style={{ color: "var(--fg-4)" }}>respondida em {ddmm(survey.answeredAt)}</span>
        {survey.followup && <button type="button" className="customer-peek-link" style={{ marginLeft: "auto" }} onClick={() => openRecord("followup", survey.followup)}>acompanhamento →</button>}
      </div>
      {survey.comment && <p className="customer-peek-note" title={survey.comment}
        style={{ margin: "6px 0 0", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>“{survey.comment}”</p>}
    </> : <>
      {note && <p className="customer-peek-note" style={{ margin: "6px 0 0" }}>{note}</p>}
      <div style={line}>
        <button type="button" className="customer-peek-link" disabled={!!busy} onClick={() => ask("link")}>{busy === "link" ? "gerando…" : "copiar mensagem"}</button>
        {wa && <button type="button" className="customer-peek-link" disabled={!!busy} onClick={() => ask("whatsapp")}>{busy === "whatsapp" ? "abrindo…" : "mandar no Whats ↗"}</button>}
        {email && <button type="button" className="customer-peek-link" disabled={!!busy} title={`Envia para ${email} pela conta de e-mail conectada`} onClick={() => ask("email")}>{busy === "email" ? "enviando…" : "enviar por e-mail"}</button>}
      </div>
    </>}
  </section>;
}
