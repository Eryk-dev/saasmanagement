import React from "react";
import { createPortal } from "react-dom";
import { api } from "../../lib/api.js";
import { PrimaryButton, SecondaryButton, toast } from "../../atoms.jsx";
import { Modal } from "../../components/overlay.jsx";
import { SelectPopover } from "../../components/select-popover.jsx";
import { LinearMarkdown, Inline } from "./linear-markdown.jsx";
import { HERMES_PHASES, HERMES_STEPS, hermesOf, isDone } from "../../lib/tickets.js";

const { useState, useEffect, useCallback } = React;

// Hermes no ticket. O ticket é o mesmo de sempre: esta seção só mostra em que
// fase o Hermes está com o card do Linear e oferece as ações do guia dele
// (Tutorial-Hermes, 23/09/2026) para quem pode agir. O que a ação faz é o que o
// Hermes já lê no card — mudança de coluna ou comentário com o comando.

const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const WINDOW_TEXT = {
  noite: "publica entre 23h e 04h · até lá dá pra desistir",
  imediato: "aprovar já publica · se der problema, reverter",
};

// Ações: rótulo do botão, o que pedir no diálogo e o que acontece (guia, p. 5).
const ACTIONS = {
  aprovar: { label: "Aprovar", title: (v) => `Aprovar a correção${v ? ` v${v}` : ""}`, primary: true,
    hint: (w) => `O card vai para Aprovado. ${w === "imediato" ? "LeverPrice publica na hora." : "LeverAds publica entre 23h e 04h."} Nada vai para o ar nem para o cliente sem isso.` },
  ajuste: { label: "Pedir ajuste", title: () => "Pedir ajuste", text: true, placeholder: "ex.: botão maior, igual ao Salvar",
    hint: () => "Sai uma versão nova; a revisora confere e o card volta para Validar com prova e prints novos." },
  recusar: { label: "Recusar", title: () => "Recusar a correção", text: true, placeholder: "ex.: isso é regra do ML", tone: "neg",
    hint: () => "O card vai para Canceled e o Hermes deixa um rascunho de resposta ao cliente; vocês decidem se mandam." },
  responder: { label: "Responder", title: () => "Responder ao Hermes", text: true, primary: true, placeholder: "a resposta à pergunta do Hermes",
    hint: () => "A resposta vai no card e o caso volta sozinho para a fila do Hermes." },
  revisao: { label: "Enviar para revisão", title: () => "Enviar para revisão sem responder", text: true, optional: true, placeholder: "recado para o Hermes (opcional): ex.: o cliente não respondeu, siga com o que tem",
    hint: () => "O card vai para a revisão sem a resposta da pergunta. Se o Hermes achar uma dúvida nova, ele devolve o card para Aguardando resposta." },
  perguntar: { label: "Perguntar", title: () => "Perguntar ao Hermes", text: true, placeholder: "sua dúvida sobre o caso",
    hint: () => "O Hermes responde no próprio card." },
  desistir: { label: "Desistir da aprovação", title: () => "Desistir da aprovação",
    hint: () => "A publicação da noite é cancelada e o card volta para Validar." },
  reverter: { label: "Reverter", title: () => "Reverter a publicação", text: true, placeholder: "ex.: a tela de anúncios quebrou", tone: "neg",
    hint: () => "O Hermes volta na hora para a versão anterior, confere e comenta. A correção volta para Validar." },
  passar_time: { label: "Passar ao time", title: () => "Passar para alguém do time", person: true,
    hint: () => "O Hermes para e deixa um resumo: o que descobriu, o que tentou e onde está a prova." },
  entregar: { label: "Entregar ao Hermes", title: () => "Entregar ao Hermes", text: true, optional: true, placeholder: "contexto para o Hermes (opcional)",
    hint: () => "O card fica sem responsável no Linear e recebe “hermes: assumir”. O Hermes só assume bug técnico de verdade; até ele aceitar, o ticket mostra o pedido." },
};
const ICON_PATHS = {
  aprovar: "M20 6 9 17l-5-5",
  ajuste: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  recusar: "M18 6 6 18M6 6l12 12",
  responder: "M9 17 4 12l5-5M20 18v-2a4 4 0 0 0-4-4H4",
  revisao: "M5 12h14M13 6l6 6-6 6",
  perguntar: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  desistir: "M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13",
  reverter: "M1 4v6h6M3.5 15a9 9 0 1 0 2.1-9.4L1 10",
  passar_time: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6",
  entregar: "m22 2-7 20-4-9-9-4ZM22 2 11 13",
};
const ActionIcon = ({ action }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={ICON_PATHS[action]} />
  </svg>
);

const ORDER = ["aprovar", "responder", "revisao", "ajuste", "recusar", "desistir", "reverter", "perguntar", "passar_time", "entregar"];

function ActionDialog({ action, ticket, info, onClose, onDone }) {
  const cfg = ACTIONS[action];
  const [text, setText] = useState("");
  const [person, setPerson] = useState("");
  const [busy, setBusy] = useState(false);
  // Regra 2 do guia: a aprovação vale para a versão LIDA. O diálogo relê o
  // card agora e mostra o resumo dele; é essa versão que vai pro servidor.
  const aprovando = action === "aprovar";
  const [lido, setLido] = useState(aprovando ? null : false);
  useEffect(() => {
    if (!aprovando) return;
    let vivo = true;
    api.ticketLinear(ticket.id).then((r) => { if (vivo) setLido(r?.hermes?.card || false); }).catch(() => { if (vivo) setLido(false); });
    return () => { vivo = false; };
  }, [aprovando, ticket.id]);
  const version = (aprovando && lido?.version) || ticket.hermes?.version || 0;
  const precisa = (cfg.text && !cfg.optional && !text.trim()) || (cfg.person && !person) || (aprovando && lido === null);
  const enviar = async () => {
    if (busy || precisa) return;
    setBusy(true);
    try {
      const saved = await api.ticketHermesAction(ticket.id, { action, text: text.trim(), version, assignee: person || undefined });
      toast(`${cfg.label} · registrado no card do Linear`, "pos");
      onDone(saved);
    } catch (err) {
      const msg = err.body?.code === "version_changed" ? "saiu uma versão nova da correção: leia o card de novo antes de aprovar" : (err.message || "tente de novo");
      toast(`Hermes · ${msg}`, "neg", 7000);
      if (err.body?.code === "version_changed" || err.body?.code === "wrong_phase") onDone(null);
    } finally { setBusy(false); }
  };
  const panel = (
    <Modal onClose={onClose} fechavel={!busy} label={cfg.title(version)} largura={520}>
      <form onSubmit={(e) => { e.preventDefault(); enviar(); }} style={{ padding: "20px var(--inset-x)", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <h2 className="card-title" style={{ margin: 0 }}>{cfg.title(version)}</h2>
          <div className="card-sub" style={{ marginTop: 3 }}>{cfg.hint(info?.publishWindow)}</div>
        </div>
        {aprovando && lido === null && <div className="mono dim" style={{ fontSize: 12 }}>lendo o card no Linear…</div>}
        {aprovando && lido && (
          <dl className="hermes-card-grid hermes-approve-summary">
            {[["prova", "Prova"], ["risco", "Risco"], ["banco", "Mexe no banco?"], ["aviso", "Aviso ao cliente"]].filter(([k]) => lido.fields?.[k]).map(([k, label]) => (
              <React.Fragment key={k}><dt>{label}</dt><dd><LinearMarkdown text={lido.fields[k]} /></dd></React.Fragment>
            ))}
          </dl>
        )}
        {aprovando && lido === false && <div style={{ fontSize: 12, color: "var(--warn)" }}>Não consegui ler o card de validação agora; confira no Linear antes de aprovar.</div>}
        {cfg.text && (
          <textarea className="inp" autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={cfg.placeholder} disabled={busy}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) enviar(); }}
            style={{ height: "auto", padding: "8px 10px", resize: "vertical", font: "inherit", fontSize: 13 }} />
        )}
        {cfg.person && (
          <SelectPopover label="Quem assume" value={person} onChange={setPerson} placeholder="escolha a pessoa no Linear" searchable={(info?.people || []).length > 8}
            options={(info?.people || []).filter((p) => !/hermes/i.test(p.name)).map((p) => ({ value: p.id, label: p.name }))} />
        )}
        <div className="mono dim" style={{ fontSize: 11 }}>sai no card como comentário assinado com o seu nome, “via Cockpit”</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <SecondaryButton type="button" onClick={onClose} disabled={busy}>Cancelar</SecondaryButton>
          {cfg.tone === "neg"
            ? <SecondaryButton type="submit" tom="neg" disabled={busy || precisa}>{busy ? "Enviando…" : cfg.label}</SecondaryButton>
            : <PrimaryButton type="submit" disabled={busy || precisa}>{busy ? "Enviando…" : action === "aprovar" && version ? `Aprovar v${version}` : cfg.label}</PrimaryButton>}
        </div>
      </form>
    </Modal>
  );
  return typeof document !== "undefined" && document.body?.nodeType === 1 ? createPortal(panel, document.body) : panel;
}

// Passos do guia, compactos: o atual em destaque, com quando entrou.
function Steps({ h }) {
  const atual = h.meta?.step || 0;
  const quando = {};
  for (const x of h.history || []) { const st = HERMES_PHASES[x.phase]?.step; if (st) quando[st] = x.at; }
  return (
    <ol className="hermes-steps" aria-label="Passos do Hermes">
      {HERMES_STEPS.map((nome, i) => {
        const n = i + 1;
        const estado = n < atual ? "done" : n === atual ? "now" : "next";
        return (
          <li key={nome} data-state={estado} title={quando[n] ? `${nome} · ${fmtWhen(quando[n])}` : nome}>
            <span className="hermes-step-dot" />
            <span className="hermes-step-name">{n === atual && h.phase === "pergunta" ? (h.stalled ? "Parado" : "Pergunta") : nome}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function HermesSection({ ticket, settings, onChange, onOpenLinear }) {
  const hcfg = settings?.linear?.hermes;
  const h = hermesOf(ticket);
  const [info, setInfo] = useState(null);
  const [dialog, setDialog] = useState("");
  const ligado = !!hcfg?.enabled;
  const load = useCallback(() => {
    api.ticketHermes(ticket.id).then(setInfo).catch(() => setInfo(null));
  }, [ticket.id]);
  useEffect(() => { if (ligado || h) load(); }, [ligado, ticket.version, ticket.hermes?.phase, ticket.hermes?.requested?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ligado && !h) return null;
  // Ticket comum, concluído e sem nada do Hermes: nada a mostrar nem a fazer.
  if (!h && (isDone(ticket) || !info?.allowed?.entregar)) return null;

  const acoes = ORDER.filter((a) => info?.allowed?.[a]);
  const m = h?.meta;
  let linha = null;
  if (h?.requested && !h.labeled) linha = <>Entregue {fmtWhen(h.requested.at)} · aguardando o Hermes assumir</>;
  else if (h?.labeled && !h.active) linha = <>Com {h.handoff?.to || "o time"} desde {fmtWhen(h.handoff?.at)} · o Hermes parou e deixou o resumo no card</>;
  else if (h?.phase === "validar") linha = <b style={{ color: "var(--warn)" }}>Correção{h.version ? ` v${h.version}` : ""} pronta · esperando um aprovador</b>;
  else if (h?.phase === "pergunta" && h.stalled) {
    // Na lateral só o resumo; o motivo inteiro está na aba Linear.
    const r = String(h.stalled.reason || "");
    const curto = !r || /bancada|infraestrutura/i.test(r) ? "falha na bancada" : r.length > 60 ? `${r.slice(0, 60)}…` : r;
    linha = <><b style={{ color: "var(--warn)" }} title={r}>O Hermes parou · {curto}</b><br />Resolva e responda no card para ele retomar, ou envie para revisão.</>;
  }
  else if (h?.phase === "pergunta") linha = <b style={{ color: "var(--warn)" }}>O Hermes perguntou algo · responda pelo card</b>;
  else if (h?.phase === "aprovado") linha = <>Aprovado{h.approvedVersion ? ` v${h.approvedVersion}` : ""} · {WINDOW_TEXT[info?.publishWindow || hcfg?.publishWindow] || ""}</>;
  else if (h?.phase === "no_ar") linha = <>No ar{h.liveAt ? ` às ${/^\d{2}:\d{2}$/.test(h.liveAt) ? h.liveAt : fmtWhen(h.liveAt)}` : ""} · o Hermes avisa o cliente se o grupo estiver liberado</>;
  else if (h?.phase === "cancelado") linha = <>Não era bug · a explicação e o rascunho de resposta estão no card</>;
  else if (m) linha = <>{m.label}{h.phaseSince ? ` desde ${fmtWhen(h.phaseSince)}` : ""}</>;

  const chip = h?.active && m ? <span className={`chip ${m.human && !isDone(ticket) ? "warn" : "info"}`} style={{ fontSize: 11, minHeight: 0 }}>{h.phase === "pergunta" && h.stalled ? "Parado" : m.short}{h.version && (h.phase === "validar" || h.phase === "aprovado") ? ` v${h.version}` : ""}</span> : null;
  return (
    <section className="support-detail-section hermes-section" data-human={h?.needsHuman ? "1" : undefined}>
      <div className="hermes-head">
        <span className="hermes-mark" aria-hidden="true">H</span>
        <span className="hermes-title">Hermes</span>
        {chip && <span style={{ marginLeft: "auto" }}>{chip}</span>}
      </div>
      {h?.active && <Steps h={h} />}
      {linha && <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: h?.active ? 8 : 0 }}>{linha}</div>}
      {h?.active && ticket.linear?.issueId && onOpenLinear && (
        <button type="button" className="hermes-link" onClick={onOpenLinear}>
          {h.phase === "validar" ? "ler o card de validação" : "ver o card no Linear"}
        </button>
      )}
      {acoes.length > 0 && (
        <div className="hermes-actions">
          {acoes.map((a) => (
            <button key={a} type="button" className="hermes-btn" data-kind={ACTIONS[a].primary ? "primary" : undefined} data-tone={ACTIONS[a].tone}
              title={ACTIONS[a].hint(info?.publishWindow)} onClick={() => setDialog(a)}>
              <ActionIcon action={a} />
              <span>{a === "aprovar" && h?.version ? `Aprovar v${h.version}` : ACTIONS[a].label}</span>
            </button>
          ))}
        </div>
      )}
      {h?.active && info && !info.actions && (
        <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>ações pelo cockpit desligadas neste produto · decida no card do Linear</div>
      )}
      {h?.active && info?.actions && !info.approver && h.needsHuman && (
        <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>só os aprovadores do Hermes neste produto decidem</div>
      )}
      {dialog && (
        <ActionDialog action={dialog} ticket={ticket} info={info} onClose={() => setDialog("")}
          onDone={(saved) => { setDialog(""); if (saved?.id) onChange(saved); load(); }} />
      )}
    </section>
  );
}

// Card de validação do Hermes no topo da aba Linear, lido do comentário AGORA
// (o ticket não guarda o texto). Rótulos do guia, p. 4.
const CARD_ROWS = [
  ["problema", "O que acontecia"], ["prova", "Prova"], ["tela", "Tela"], ["banco", "Mexe no banco?"],
  ["risco", "Risco"], ["publica", "Quando publica"], ["aviso", "Aviso ao cliente"], ["versao", "Versão"],
];
const RISK_TONE = { alto: "neg", medio: "warn", baixo: "pos" };

// A pergunta que a API manda é o comentário INTEIRO do Hermes (título, resumo
// do que ele testou, "Precisa de:" e o <details> técnico) — e ele já aparece
// em Comentários logo abaixo. Aqui só entram os pedidos: os itens de
// "Precisa de:" e, sem essa seção, as linhas que terminam em "?". Cada um com
// o destinatário (`[Eryk] …`) separado. Puro e exportado: o smoke testa.
const ITEM_RE = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
// Destinatário: `[Eryk] …` (markdown do Hermes) ou `Eryk · …`.
const DESTINO_RE = /^(?:\\?\[([^\]\\]{1,40})\\?\]\s*[·:-]?\s*|(\p{Lu}[\p{L}]{1,20}(?: \p{Lu}[\p{L}]{1,20})?) · )/u;
const PRECISA_RE = /^\s*(?:\*\*)?\s*precisa(?:mos)? de\s*:?\s*(?:\*\*)?\s*:?\s*$/i;
// "**Precisa de:** [Eryk] resolver …" na mesma linha do rótulo.
const PRECISA_INLINE_RE = /^\s*(?:\*\*)?\s*precisa(?:mos)? de\s*:?\s*(?:\*\*)?\s*:?\s+(\S.*)$/i;
const ROTULO_RE = /^\s*(?:\*\*)?\p{Lu}[\p{L}\d ]{0,30}:(?:\*\*)?\s/u;
export function pedidosDaPergunta(text) {
  const linhas = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const fim = linhas.findIndex((l) => /^\s*<details/i.test(l) || /^\s*\+\+\+\s*\S/.test(l));
  const corpo = fim >= 0 ? linhas.slice(0, fim) : linhas;
  const pedido = (s) => {
    const t = String(s).replace(/\*\*/g, "").trim();
    const d = DESTINO_RE.exec(t);
    return d ? { para: (d[1] || d[2]).trim(), texto: t.slice(d[0].length).trim() } : { para: "", texto: t };
  };
  const inline = corpo.map((l) => PRECISA_INLINE_RE.exec(l)).find(Boolean);
  if (inline) return [pedido(inline[1])];
  const i = corpo.findIndex((l) => PRECISA_RE.test(l));
  if (i >= 0) {
    const itens = [];
    for (const l of corpo.slice(i + 1)) {
      if (!l.trim()) { if (itens.length) break; continue; }
      const item = ITEM_RE.exec(l);
      if (!item && ROTULO_RE.test(l) && !DESTINO_RE.test(l.trim())) break; // "Estado: …" já é outro assunto
      itens.push(pedido(item ? item[1] : l));
    }
    if (itens.length) return itens;
  }
  return corpo.map((l) => (ITEM_RE.exec(l)?.[1] ?? l).trim()).filter((l) => /\?\s*$/.test(l) && !/^#/.test(l)).map(pedido);
}

function Pedidos({ pedidos }) {
  return (
    <ul className="hermes-pedidos">
      {pedidos.map((p, i) => (
        <li key={i}>
          {p.para && <span className="hermes-pedido-para">{`Para ${p.para}`}</span>}
          <span className="hermes-pedido-texto"><Inline text={p.texto} rotulo={false} /></span>
        </li>
      ))}
    </ul>
  );
}

export function HermesCard({ hermes, onExpired, onUseDraft }) {
  if (!hermes || (!hermes.card && !hermes.question && !hermes.stalled && !hermes.draftReply)) return null;
  const { card, question, stalled, draftReply } = hermes;
  const pedidos = question ? pedidosDaPergunta(question.text) : [];
  // Parado por falha da bancada: o motivo e o que destrava, sem fingir pergunta.
  const destrava = stalled ? pedidosDaPergunta(stalled.text).filter((p) => !/\?\s*$/.test(p.texto) || p.para) : [];
  return (
    <div className="hermes-card">
      {stalled && (
        <div className="support-msg hermes-pergunta" data-kind="note">
          <span className="kicker" style={{ display: "block", marginBottom: 6 }}>O Hermes parou · {fmtWhen(stalled.at)}</span>
          <div className="hermes-pedido-texto">{stalled.reason || "falha na bancada"}</div>
          {destrava.length > 0 && <div style={{ marginTop: 10 }}><Pedidos pedidos={destrava} /></div>}
          <div className="hermes-pedido-nota">Não há pergunta para o cliente. Resolva e responda no card para o Hermes retomar, ou envie para revisão.</div>
        </div>
      )}
      {question && (
        <div className="support-msg hermes-pergunta" data-kind="note">
          <span className="kicker" style={{ display: "block", marginBottom: 6 }}>O Hermes perguntou · {fmtWhen(question.at)}</span>
          {pedidos.length ? (
            <>
              <Pedidos pedidos={pedidos} />
              <div className="hermes-pedido-nota">O que o Hermes já testou está no comentário completo, em Comentários na issue.</div>
            </>
          ) : <LinearMarkdown text={question.text} onExpired={onExpired} />}
        </div>
      )}
      {card && (
        <div className="support-msg" data-kind="linear">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span className="kicker">Validação{card.version ? ` v${card.version}` : ""} · {fmtWhen(card.at)}</span>
            {card.risk && <span className={`chip ${RISK_TONE[card.risk] || "info"}`} style={{ fontSize: 11, minHeight: 0, marginLeft: "auto" }}>risco {card.risk === "medio" ? "médio" : card.risk}</span>}
          </div>
          <dl className="hermes-card-grid">
            {CARD_ROWS.filter(([k]) => card.fields?.[k]).map(([k, label]) => (
              <React.Fragment key={k}>
                <dt>{label}</dt>
                <dd><LinearMarkdown text={card.fields[k]} onExpired={onExpired} /></dd>
              </React.Fragment>
            ))}
          </dl>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>Os prints usam dados de teste, nunca a loja real do cliente.</div>
        </div>
      )}
      {draftReply && (
        <div className="support-msg" data-kind="linear-desc">
          <span className="kicker" style={{ display: "block", marginBottom: 4 }}>Rascunho de resposta ao cliente</span>
          <div style={{ whiteSpace: "pre-wrap" }}>{draftReply}</div>
          {onUseDraft && (
            <button type="button" onClick={() => onUseDraft(draftReply)} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)", marginTop: 6 }}>
              usar na resposta ao cliente
            </button>
          )}
        </div>
      )}
    </div>
  );
}
