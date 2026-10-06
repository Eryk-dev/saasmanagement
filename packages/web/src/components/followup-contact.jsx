import React from "react";
import { LeadSection } from "./lead-card.jsx";
import { scriptSegments } from "../lib/scripts.js";
import { waLink } from "../lib/ui.js";
import { assetUrl } from "../lib/api.js";
import {
  followupContacts, followupStepOf, followupNextContact, followupDueDay, nextFollowupDay, todayBrt,
  firstFollowupDay, dayLabel, ymdOf, FOLLOWUP_STEPS, FOLLOWUP_CHANNELS,
} from "../lib/followup.js";

// Follow-up em 4 contatos, por DIA (05/10/2026). Dois blocos usados pela
// atividade (Minhas atividades), pelo gate de mudança de etapa, pelo Inbox e
// pela ficha do lead: o seletor de DIA (sem horário — follow-up nunca ocupa a
// agenda) e o painel "Contato N de 4" (mensagem configurada + registro).

const { useState: useS, useEffect: useE } = React;

const chip = (on) => ({
  height: 30, padding: "0 10px", borderRadius: 999, fontSize: 11, fontFamily: "var(--mono)", cursor: "pointer",
  background: on ? "var(--accent)" : "var(--bg-1)",
  color: on ? "var(--accent-fg)" : "var(--fg-3)",
  border: "1px solid " + (on ? "var(--accent)" : "var(--line-2)"),
});

// Próximos N dias úteis a partir de hoje (inclui hoje se for dia útil).
export function businessDayOptions(n = 6) {
  const out = []; const d = new Date(); d.setHours(0, 0, 0, 0);
  while (out.length < n) { const w = d.getDay(); if (w !== 0 && w !== 6) out.push(ymdOf(d)); d.setDate(d.getDate() + 1); }
  return out;
}

// Seletor de DIA: chips dos próximos dias úteis + calendário livre. O valor é
// "YYYY-MM-DD" (sem hora).
export function DayPicker({ value, onChange, days = businessDayOptions(6), label = "" }) {
  const custom = !!value && !days.includes(value);
  return (
    <div role="group" aria-label={label || "Dia"} style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
      {days.map((d) => (
        <button key={d} type="button" aria-pressed={value === d} onClick={() => onChange(d)} style={chip(value === d)}>
          {dayLabel(d)}
        </button>
      ))}
      <label title="escolher qualquer dia no calendário" style={{
        ...chip(custom), display: "inline-flex", alignItems: "center", padding: "0 8px",
        border: "1px " + (custom ? "solid var(--accent)" : "dashed var(--line-2)"),
      }}>
        <input type="date" aria-label="Outro dia" min={ymdOf(new Date())} value={value || ""} onChange={(e) => onChange(e.target.value)}
          style={{ border: 0, background: "transparent", fontSize: 11, fontFamily: "var(--mono)", color: "inherit", padding: 0, outline: "none", colorScheme: "light dark" }} />
      </label>
    </div>
  );
}

// Texto final da mensagem (tokens resolvidos; lacuna vira o texto da dica).
export function followupMessageText(mensagem, tokens) {
  return scriptSegments(mensagem, tokens).map((s) => (s.text != null ? s.text : s.value != null ? s.value : `[${s.gap}]`)).join("");
}

function MessagePreview({ mensagem, tokens }) {
  return scriptSegments(mensagem, tokens).map((s, i) => {
    if (s.text != null) return <React.Fragment key={i}>{s.text}</React.Fragment>;
    if (s.value != null) return <strong key={i} style={{ color: "var(--accent)", fontWeight: 600 }}>{s.value}</strong>;
    return <span key={i} className="mono" title="dado não preenchido no lead: descubra nesta conversa"
      style={{ background: "var(--warn-soft)", color: "var(--warn)", borderRadius: 4, padding: "0 5px", fontSize: "0.85em" }}>{s.gap}</span>;
  });
}

// A área de transferência só garante image/png: JPG/GIF/WebP passam por um
// canvas antes de ir pra lá.
async function imagePngBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`imagem -> ${res.status}`);
  const blob = await res.blob();
  if (blob.type === "image/png") return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("png"))), "image/png"));
}

// Marcador 1–4: feitos em cheio, o da vez com contorno.
function Steps({ step }) {
  return (
    <ol aria-label="Contatos do follow-up" style={{ display: "flex", gap: 6, listStyle: "none", margin: 0, padding: 0 }}>
      {Array.from({ length: FOLLOWUP_STEPS }, (_, i) => {
        const n = i + 1;
        const done = n <= step;
        const cur = n === step + 1;
        return (
          <li key={n} aria-current={cur ? "step" : undefined} title={done ? `Contato ${n} feito` : cur ? `Contato ${n} · o da vez` : `Contato ${n}`}
            className="tnum" style={{
              width: 24, height: 24, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 11.5, fontWeight: 600,
              background: done ? "var(--pos)" : cur ? "var(--accent-soft)" : "var(--bg-2)",
              color: done ? "var(--wa-brand-fg, #fff)" : cur ? "var(--accent)" : "var(--fg-4)",
              border: "1px solid " + (done ? "var(--pos)" : cur ? "var(--accent)" : "var(--line-1)"),
            }}>{done ? "✓" : n}</li>
        );
      })}
    </ol>
  );
}

// Painel do contato da vez. `onRegister({ n, channel, note })` grava o toque
// com meta.followupContact (o servidor marca o dia do próximo pelo prazo);
// `onChangeDay(day)` só troca o dia do contato pendente.
export function FollowupContactBlock({ lead, tokens, onRegister, onChangeDay, onWhatsapp = null, preview = false }) {
  const contacts = followupContacts();
  const step = followupStepOf(lead);
  const n = followupNextContact(lead);
  const contact = n ? contacts[n - 1] : null;
  const due = followupDueDay(lead);
  const hoje = ymdOf(new Date());
  const late = !!due && due < hoje;
  const [channel, setChannel] = useS("whatsapp");
  const [note, setNote] = useS("");
  const [copied, setCopied] = useS(false);
  const [imgCopy, setImgCopy] = useS(""); // "" | "ok" | "erro"
  const [editDay, setEditDay] = useS(false);
  const [day, setDay] = useS(due || "");
  useE(() => { setChannel("whatsapp"); setNote(""); setCopied(false); setImgCopy(""); setEditDay(false); setDay(due || ""); }, [lead.id, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = contact ? followupMessageText(contact.mensagem, tokens) : "";
  const nextDay = n && n < FOLLOWUP_STEPS ? nextFollowupDay(contacts, n, todayBrt()) : "";
  const wa = waLink(lead.phone);

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt("Copie a mensagem:", text); }
  }
  const image = contact?.imagem ? assetUrl(contact.imagem) : "";
  async function copyImage() {
    try {
      // Promise dentro do ClipboardItem: o Safari só aceita a escrita ainda no gesto do clique.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": imagePngBlob(image) })]);
      setImgCopy("ok");
    } catch { setImgCopy("erro"); }
    setTimeout(() => setImgCopy(""), 2000);
  }
  function openWa() {
    if (onWhatsapp) onWhatsapp(lead, text);
    else if (wa) window.open(`${wa}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  const btn = (primary = false, disabled = false) => ({
    height: 32, padding: "0 14px", borderRadius: 999, fontSize: 12.5, fontWeight: primary ? 700 : 500,
    background: disabled ? "var(--bg-2)" : primary ? "var(--btn-bg, var(--accent))" : "var(--bg-1)",
    color: disabled ? "var(--fg-4)" : primary ? "var(--btn-fg, var(--accent-fg))" : "var(--fg-2)",
    border: "1px solid " + (disabled ? "var(--line-2)" : primary ? "var(--btn-bg, var(--accent))" : "var(--line-2)"),
    cursor: disabled ? "not-allowed" : "pointer",
  });

  // Selo FOLLOW-UP ao lado do contato: o painel diz de cara de que etapa é.
  const title = <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
    <span className="today-followup-tag" style={{
      display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 999, whiteSpace: "nowrap",
      background: "var(--warn-soft)", color: "var(--warn)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em",
    }}>FOLLOW-UP</span>
    <span style={{ whiteSpace: "nowrap" }}>{n ? `Contato ${n} de ${FOLLOWUP_STEPS}` : "Follow-up concluído"}</span>
  </span>;
  // Atrasado: o aviso sai do cabeçalho e vira faixa vermelha no topo do bloco
  // (o mesmo alarme do card da fila).
  const isLate = !!n && late;
  const when = !n || isLate ? "" : !due ? "sem dia marcado" : due === hoje ? "hoje" : dayLabel(due);
  const daysLate = isLate ? Math.max(1, Math.round((new Date(`${hoje}T12:00`) - new Date(`${due}T12:00`)) / 86400000)) : 0;
  return (
    <LeadSection title={title} className={`today-followup-contact${isLate ? " is-late" : ""}`}
      action={<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        {when && <span className="tnum" style={{ fontSize: 12, fontWeight: 600, color: late ? "var(--neg)" : "var(--fg-3)" }}>{when}</span>}
        <Steps step={step} />
      </span>}>
      {isLate && (
        <div className="today-followup-late" role="alert">
          <strong>Follow-up atrasado {daysLate === 1 ? "1 dia" : `${daysLate} dias`}</strong>
          <span>o contato {n} era para {dayLabel(due)} · faça hoje</span>
        </div>
      )}
      {!n ? (
        <p className="today-script-hint" role="status">
          Os {FOLLOWUP_STEPS} contatos foram feitos. Escolha o destino do card no Próximo passo: Integração, Nutrição ou Desqualificado.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div className="kicker" style={{ marginBottom: 4 }}>{contact.titulo}</div>
            <div className="lead-script-copy" style={{ whiteSpace: "pre-wrap" }}><MessagePreview mensagem={contact.mensagem} tokens={tokens} /></div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={copy} style={btn()}>{copied ? "copiado ✓" : "Copiar mensagem"}</button>
              {image && <span className="today-followup-image" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <a href={image} target="_blank" rel="noopener noreferrer" title="abrir a imagem em tamanho real" style={{ display: "inline-flex", flex: "none" }}>
                  <img src={image} alt={`Imagem do contato ${n}`}
                    style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line-1)", background: "var(--bg-2)", display: "block" }} />
                </a>
                <button type="button" onClick={copyImage} style={btn()}>
                  {imgCopy === "ok" ? "imagem copiada ✓" : imgCopy === "erro" ? "não deu pra copiar" : "Copiar imagem"}
                </button>
              </span>}
              {(onWhatsapp || wa) && !preview && <button type="button" onClick={openWa} style={btn()}>Abrir no WhatsApp</button>}
            </div>
          </div>
          {!preview && <>
            <div>
              <div className="kicker" style={{ marginBottom: 6 }}>Canal do contato</div>
              <div role="radiogroup" aria-label="Canal do contato" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {FOLLOWUP_CHANNELS.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={channel === c.id} onClick={() => setChannel(c.id)} style={chip(channel === c.id)}>{c.label}</button>
                ))}
              </div>
            </div>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="kicker">Nota (opcional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="o que aconteceu neste contato"
                style={{ height: 32, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 }} />
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={() => onRegister({ n, channel, note: note.trim() })} style={btn(true)}>Registrar contato {n}</button>
              <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
                {nextDay ? `próximo contato: ${dayLabel(nextDay)}` : "último contato: depois dele, escolha o destino"}
              </span>
              {onChangeDay && <button type="button" onClick={() => setEditDay((v) => !v)} aria-expanded={editDay}
                style={{ ...btn(), marginLeft: "auto", border: "1px dashed var(--line-2)" }}>mudar o dia</button>}
            </div>
            {editDay && onChangeDay && (
              <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: "var(--r-2)", background: "var(--bg-1)", border: "1px solid var(--line-1)" }}>
                <div style={{ fontSize: 12, color: "var(--fg-3)" }}>Dia do contato {n} · sem horário, não ocupa a agenda.</div>
                <DayPicker value={day} onChange={setDay} label={`Dia do contato ${n}`} />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setEditDay(false)} style={btn()}>cancelar</button>
                  <button type="button" disabled={!day || day === due} onClick={() => { onChangeDay(day); setEditDay(false); }} style={btn(true, !day || day === due)}>salvar dia</button>
                </div>
              </div>
            )}
          </>}
        </div>
      )}
    </LeadSection>
  );
}

// Dia sugerido do Contato 1 ao entrar no follow-up (hoje + prazo do Contato 1).
export function defaultFollowupDay() {
  return firstFollowupDay(followupContacts()) || ymdOf(new Date());
}
