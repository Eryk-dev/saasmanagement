import React from "react";
import { createPortal } from "react-dom";
import { api } from "../../lib/api.js";
import { PrimaryButton, SecondaryButton, toast } from "../../atoms.jsx";
import { Drawer, Modal } from "../../components/overlay.jsx";
import { SelectPopover } from "../../components/select-popover.jsx";
import { QuickReplyList, useQuickReplies, filterQuickReplies, orderForPicker, slashTokenAt } from "./quick-reply-picker.jsx";
import { LinearMarkdown } from "./linear-markdown.jsx";
import { UserPicker, UserAvatarRing } from "../../components/user-picker.jsx";
import { isAdminUser } from "../../lib/users.js";
import {
  TICKET_STATUSES, STATUS_BY_KEY, TICKET_PRIORITIES, PRIORITY_BY_KEY, CHANNEL_LABEL,
  slaState, SLA_TONE, distance, agentHandles, portalUrl, linearInReview, linearKey,
} from "../../lib/tickets.js";

const { useState, useEffect, useRef, useCallback } = React;

// Detalhe do ticket no desktop: modal largo, com a conversa (e a resposta
// sempre à mão) na coluna principal e os dados do atendimento (status, prazos,
// cliente, anexos, Linear) numa coluna lateral fixa — a gaveta estreita
// escondia os dados atrás de uma aba e apertava a conversa (volta de 24/09).
// No celular é gaveta, e os dados ficam na aba Dados.

const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const fmtSize = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// Opções dos seletores: status e prioridade carregam o ponto da cor da fila.
const STATUS_OPTIONS = TICKET_STATUSES.map((st) => ({ value: st.key, label: st.label, tone: st.tone }));
const PRIORITY_OPTIONS = TICKET_PRIORITIES.map((p) => ({ value: p.key, label: p.label, tone: p.tone, color: p.key === "urgent" ? "var(--neg)" : undefined }));
const iconBtn = { width: 32, height: 32, borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 14, flexShrink: 0 };

// Campo que salva sozinho (régua do painel de Tarefas): o rascunho manda
// enquanto está sujo e fechar com rascunho sujo grava.
function useAutosave(serverValue, save) {
  const [draft, setDraft] = useState(serverValue ?? "");
  const dirty = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const saveRef = useRef(save); saveRef.current = save;
  const [status, setStatus] = useState("");
  useEffect(() => { if (!dirty.current) setDraft(serverValue ?? ""); }, [serverValue]);
  const commit = useCallback(async () => {
    if (!dirty.current) return true;
    dirty.current = false;
    setStatus("saving");
    const ok = await saveRef.current(draftRef.current);
    setStatus(ok ? "saved" : "error");
    if (ok) setTimeout(() => setStatus((s) => (s === "saved" ? "" : s)), 1500);
    else dirty.current = true;
    return ok;
  }, []);
  useEffect(() => () => { if (dirty.current) saveRef.current(draftRef.current); }, []);
  return { draft, onChange: (v) => { setDraft(v); dirty.current = true; }, commit, status };
}
function SaveStatus({ status, onRetry }) {
  if (!status) return null;
  if (status === "error") return <button type="button" onClick={onRetry} style={{ fontSize: 11, color: "var(--neg)", fontWeight: 600, flexShrink: 0 }}>não salvou · tentar de novo</button>;
  return <span className="mono dim" style={{ fontSize: 11, flexShrink: 0 }}>{status === "saving" ? "salvando…" : "salvo"}</span>;
}

// ── Coluna lateral ──────────────────────────────────────────────────────────
function Section({ title, aside, children }) {
  return (
    <section className="support-detail-section">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="kicker">{title}</span>
        {aside && <span style={{ marginLeft: "auto" }}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}
function Field({ label, children, anchorRef }) {
  return (
    <div className="support-detail-field">
      <span>{label}</span>
      <div ref={anchorRef}>{children}</div>
    </div>
  );
}

// Mensagens do atendimento (sem os comentários espelhados do Linear).
export const conversationMessages = (ticket) => (ticket?.messages || []).filter((m) => m.source?.type !== "linear");

const CLOCK_WORD = { ok: "no prazo", warning: "vence em breve", breached: "estourado", paused: "pausado", met: "cumprido", none: "sem prazo" };
function SlaClock({ label, state, due, doneAt, doneLabel }) {
  const tone = SLA_TONE[state] || "var(--fg-3)";
  let main;
  if (doneAt) main = `${doneLabel} ${fmtWhen(doneAt)}`;
  else if (state === "paused") main = "aguardando o cliente";
  else if (state === "none" || !due) main = "—";
  else if (state === "breached") main = `passou há ${distance(new Date(due) - Date.now())}`;
  else main = `vence em ${distance(new Date(due) - Date.now())}`;
  return (
    <div className="support-clock">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{label}</span>
        <span className="support-status" style={{ "--dot": tone, marginLeft: "auto", color: state === "breached" ? "var(--neg)" : state === "warning" ? "var(--warn)" : "var(--fg-2)", fontWeight: 600 }}>{CLOCK_WORD[state] || state}</span>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: state === "breached" ? "var(--neg)" : "var(--fg-1)", marginTop: 3 }}>{main}</div>
      {due && !doneAt && state !== "none" && <div className="mono dim" style={{ fontSize: 11, marginTop: 1 }}>prazo {fmtWhen(due)}</div>}
    </div>
  );
}

function Attachments({ ticket, onChange }) {
  const [busy, setBusy] = useState(null);
  const [isPublic, setIsPublic] = useState(false);
  const fileRef = useRef(null);
  const list = ticket.attachments || [];
  const send = async (files) => {
    for (const file of Array.from(files || [])) {
      if (file.size > 5 * 1024 * 1024) { toast(`${file.name}: arquivo acima de 5MB`, "warn"); continue; }
      setBusy(0);
      try { const r = await api.ticketAttachment(ticket.id, file, { isPublic }, (p) => setBusy(p)); onChange(r.ticket); }
      catch (err) { toast(`Não deu pra anexar ${file.name} · ${err.message || "tente de novo"}`, "neg"); }
      finally { setBusy(null); }
    }
  };
  const open = async (a) => {
    try { const url = await api.ticketAttachmentUrl(ticket.id, a.id); window.open(url, "_blank", "noopener"); }
    catch (err) { toast(`Não deu pra abrir ${a.name || "o arquivo"} · ${err.message}`, "neg"); }
  };
  const remove = async (a) => {
    if (!window.confirm(`Remover o anexo ${a.name || ""}? O cliente também deixa de ver.`)) return;
    try { onChange(await api.ticketAttachmentDelete(ticket.id, a.id)); }
    catch (err) { toast(`Não deu pra remover · ${err.message}`, "neg"); }
  };
  return (
    <Section title={`Anexos${list.length ? ` · ${list.length}` : ""}`}
      aside={<SecondaryButton size="sm" type="button" onClick={() => fileRef.current?.click()} disabled={busy != null}>{busy != null ? `${Math.round(busy * 100)}%` : "Anexar"}</SecondaryButton>}>
      <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { send(e.target.files); e.target.value = ""; }} />
      {list.length === 0 && <div className="mono dim" style={{ fontSize: 11.5 }}>nenhum arquivo · até 5MB cada</div>}
      {list.map((a) => (
        <div key={a.id} className="tk-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: "1px solid var(--line-1)", fontSize: 12.5 }}>
          <button type="button" onClick={() => open(a)} className="support-ellipsis" title={a.name} style={{ flex: 1, textAlign: "left", color: "var(--accent)" }}>{a.name || "arquivo"}</button>
          <span style={{ fontSize: 11, color: a.public ? "var(--pos)" : "var(--fg-4)", whiteSpace: "nowrap" }} title={a.public ? "aparece no portal do cliente" : "só a equipe vê"}>{a.public ? "cliente vê" : "interno"}</span>
          <span className="mono dim" style={{ fontSize: 10.5, whiteSpace: "nowrap" }}>{fmtSize(a.size || 0)}</span>
          <button type="button" className="tk-hover" aria-label={`Remover ${a.name || "anexo"}`} title="Remover anexo" onClick={() => remove(a)} style={{ color: "var(--neg)", fontSize: 12 }}>✕</button>
        </div>
      ))}
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-3)", marginTop: 8 }} title="Sem marcar, o arquivo fica interno até ser citado numa resposta ao cliente">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} style={{ accentColor: "var(--accent)" }} />novos anexos já visíveis ao cliente
      </label>
    </Section>
  );
}

function RequesterFields({ ticket, save }) {
  const r = ticket.requester || {};
  const field = (key, placeholder, type = "text") => (
    <input key={`${ticket.id}:${key}:${r[key] || ""}`} className="inp" type={type} defaultValue={r[key] || ""} placeholder={placeholder} aria-label={placeholder}
      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r[key] || "")) save({ requester: { [key]: v } }); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }}
      style={{ width: "100%", boxSizing: "border-box", fontSize: 12.5 }} />
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {field("name", "nome do solicitante")}
      {field("email", "e-mail (recebe o aviso de resposta)", "email")}
      {field("phone", "telefone", "tel")}
    </div>
  );
}

// ── Conversa ────────────────────────────────────────────────────────────────
// A Conversa é o REGISTRO DO ATENDIMENTO: pedido do cliente, respostas e notas
// da equipe. O que veio do Linear (comentário de dev espelhado como nota) fica
// fora daqui e vive na aba Linear — misturar as duas conversas fazia a thread
// do cliente sumir no meio da discussão técnica.
function Conversation({ ticket, agentName, description }) {
  const [editing, setEditing] = useState(false);
  const items = conversationMessages(ticket);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [items.length]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="support-msg" data-kind="customer">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span className="kicker">pedido · {ticket.requester?.name || CHANNEL_LABEL[ticket.channel] || "cliente"} · {fmtWhen(ticket.createdAt)}</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
            <SaveStatus status={description.status} onRetry={description.commit} />
            <button type="button" onClick={() => { if (editing) description.commit(); setEditing((v) => !v); }} style={{ fontSize: 11.5, color: "var(--accent)", fontWeight: 600 }}>{editing ? "concluir" : "editar"}</button>
          </span>
        </div>
        {editing ? (
          <textarea autoFocus value={description.draft} rows={4} className="inp" placeholder="o que o cliente pediu"
            onChange={(e) => description.onChange(e.target.value)} onBlur={description.commit} onKeyDown={(e) => e.stopPropagation()}
            style={{ width: "100%", boxSizing: "border-box", height: "auto", padding: "8px 10px", resize: "vertical", font: "inherit", fontSize: 13 }} />
        ) : (description.draft || <span className="dim">sem descrição</span>)}
      </div>
      {items.map((m) => {
        const kind = m.author?.type === "customer" ? "customer" : m.kind === "note" ? "note" : "reply";
        // Nota vinda de comentário no Linear entra com o ator `linear` (não é
        // gente do cockpit): mostra a origem no lugar do id cru.
        const who = kind === "customer" ? (m.author?.name || ticket.requester?.name || "cliente") : (ACTOR_NAME[m.author?.id] || agentName(m.author?.id));
        return (
          <div key={m.id} className="support-msg" data-kind={kind}>
            <div className="kicker" style={{ marginBottom: 4, color: kind === "note" ? "var(--warn)" : undefined }}>
              {kind === "note" ? "nota interna" : kind === "reply" ? "resposta ao cliente" : "cliente"} · {who} · {fmtWhen(m.at)}
            </div>
            {m.text}
            {(m.attachments || []).length > 0 && (
              <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
                anexos: {(m.attachments || []).map((aid) => (ticket.attachments || []).find((a) => a.id === aid)?.name || "arquivo").join(" · ")}
              </div>
            )}
          </div>
        );
      })}
      {items.length === 0 && <div className="mono dim" style={{ fontSize: 12, textAlign: "center", padding: "6px 0" }}>ninguém respondeu ainda · a primeira resposta ao cliente cumpre o SLA de 1ª resposta</div>}
      <div ref={endRef} />
    </div>
  );
}

const EVENT_TEXT = {
  created: (d) => `abriu o ticket (${CHANNEL_LABEL[d.channel] || d.channel || "equipe"})`,
  status_changed: (d) => `mudou o status: ${STATUS_BY_KEY[d.from]?.label || d.from} → ${STATUS_BY_KEY[d.to]?.label || d.to}`,
  priority_changed: (d) => `mudou a prioridade: ${PRIORITY_BY_KEY[d.from]?.label || d.from} → ${PRIORITY_BY_KEY[d.to]?.label || d.to}`,
  assigned: (d, name) => (d.to ? `atribuiu a ${name(d.to)}` : "tirou o responsável"),
  updated: (d) => `editou ${(d.fields || []).join(", ")}`,
  message: (d) => (d.authorType === "customer" ? "cliente respondeu" : d.kind === "note" ? "deixou uma nota interna" : "respondeu ao cliente"),
  attachment_added: (d) => `anexou ${d.name || "um arquivo"}${d.public ? " (visível ao cliente)" : ""}`,
  attachment_removed: (d) => `removeu ${d.name || "um anexo"}`,
  sla_breached: (d) => `SLA de ${d.clock === "firstResponse" ? "1ª resposta" : "resolução"} estourou`,
  linear_linked: (d) => `${d.manual ? "vinculou" : "espelhou"} no Linear${d.identifier ? ` (${d.identifier})` : ""}`,
  // `linearAssignee`: a issue foi para alguém sem usuário correspondente aqui,
  // então o responsável do ticket ficou como estava.
  linear_issue_updated: (d, name) => (d.linearAssignee
    ? `atribuiu ${d.identifier || "a issue"} a ${d.linearAssignee} no Linear · sem usuário correspondente aqui, o responsável não mudou`
    : `mudou pelo Linear${d.state ? ` · coluna ${d.state}` : ""}${d.status ? ` → ${STATUS_BY_KEY[d.status]?.label || d.status}` : ""}${"assignee" in d ? ` · responsável: ${d.assignee ? name(d.assignee) : "ninguém"}` : ""}`),
  linear_unlinked: (d) => `desvinculou do Linear${d.identifier ? ` (${d.identifier})` : ""}`,
  // O texto do comentário não é copiado pro ticket (vive na aba Linear): a
  // atividade guarda quem comentou e o começo do que disse.
  linear_comment: (d) => `${d.author || "alguém"} comentou em ${d.identifier || "Linear"}${d.excerpt ? `: ${d.excerpt}` : ""}`,
};
const ACTOR_NAME = { portal: "Cliente", api: "Cockpit", linear: "Linear" };
function Activity({ ticketId, version, agentName }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let vivo = true;
    api.ticketActivity(ticketId).then((r) => { if (vivo) setItems(r || []); }).catch(() => { if (vivo) setItems([]); });
    return () => { vivo = false; };
  }, [ticketId, version]);
  if (items === null) return <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>;
  if (!items.length) return <div className="mono dim" style={{ fontSize: 12 }}>sem atividade registrada</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {items.map((e) => (
        <div key={e.id} style={{ fontSize: 12.5, color: "var(--fg-2)", display: "flex", gap: 10 }}>
          <span className="mono dim" style={{ fontSize: 11, flexShrink: 0, width: 84 }}>{fmtWhen(e.at)}</span>
          <span><b style={{ fontWeight: 600 }}>{ACTOR_NAME[e.by] || agentName(e.by)}</b> {(EVENT_TEXT[e.type] || (() => e.type))(e.data || {}, agentName)}</span>
        </div>
      ))}
    </div>
  );
}

// Responder (vai pro cliente) ou nota interna (fica no cockpit), e o status
// que o ticket assume no mesmo envio. Avisa quem está acima se há rascunho.
function Composer({ ticket, onSent, onDraft, onBusy }) {
  const [kind, setKind] = useState("reply");
  const [text, setText] = useState("");
  const [after, setAfter] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => { onDraft(!!text.trim()); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Respostas rápidas: botão (lista com busca) ou "/" no texto (a busca é o que
  // vem depois da barra). O servidor devolve o texto com as variáveis do ticket.
  const areaRef = useRef(null), qrBtnRef = useRef(null);
  const { items: quickReplies } = useQuickReplies(ticket.saas);
  const [qr, setQr] = useState(null); // { mode: "button" | "slash", query, start }
  const [qrActive, setQrActive] = useState(0);
  const [inserting, setInserting] = useState(false);
  const qrList = qr ? orderForPicker(filterQuickReplies(quickReplies || [], qr.query)) : [];
  useEffect(() => { setQrActive(0); }, [qr?.mode, qr?.query]);
  const onTextChange = (e) => {
    const value = e.target.value;
    setText(value);
    const tok = slashTokenAt(value, e.target.selectionStart);
    if (tok) setQr({ mode: "slash", ...tok });
    else if (qr?.mode === "slash") setQr(null);
  };
  const insertQuickReply = async (item) => {
    const origin = qr;
    setQr(null);
    const el = areaRef.current;
    const start = origin?.mode === "slash" ? origin.start : (el ? el.selectionStart : text.length);
    const end = origin?.mode === "slash" ? origin.start + 1 + origin.query.length : (el ? el.selectionEnd : text.length);
    setInserting(true);
    try {
      const r = await api.ticketQuickReply(ticket.id, item.id);
      setText((cur) => cur.slice(0, Math.min(start, cur.length)) + r.text + cur.slice(Math.min(end, cur.length)));
      requestAnimationFrame(() => { if (!el) return; el.focus(); const pos = start + r.text.length; el.setSelectionRange(pos, pos); });
      const avisos = [
        r.missing?.length ? `variável que não existe: ${r.missing.map((k) => `{{${k}}}`).join(", ")}` : "",
        r.empty?.length ? `sem valor neste ticket: ${r.empty.map((k) => `{{${k}}}`).join(", ")}` : "",
      ].filter(Boolean);
      if (avisos.length) toast(`Confira antes de enviar · ${avisos.join(" · ")}`, "warn", 7000);
    } catch (err) {
      toast(`Não deu pra inserir a resposta rápida · ${err.message || "tente de novo"}`, "neg");
    } finally { setInserting(false); }
  };
  const send = async () => {
    if (!text.trim() || pending.current) return;
    pending.current = true; setBusy(true); onBusy?.(true);
    try {
      const r = await api.ticketMessage(ticket.id, { kind, text, status: after || undefined });
      setText(""); setAfter("");
      onSent(r.ticket);
      toast(kind === "note" ? "Nota salva" : r.emailed ? "Resposta enviada · o cliente recebeu o aviso por e-mail" : "Resposta enviada", "pos");
    } catch (err) {
      toast(`Não deu pra enviar · ${err.message || "tente de novo"}`, "neg");
    } finally { pending.current = false; setBusy(false); onBusy?.(false); }
  };
  return (
    <div className="support-composer" data-kind={kind}>
      <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>
        {[["reply", "Responder ao cliente"], ["note", "Nota interna"]].map(([k, l]) => (
          <button key={k} type="button" disabled={busy} onClick={() => setKind(k)} aria-pressed={kind === k}
            style={{ padding: "5px 10px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: kind === k ? 600 : 500, background: kind === k ? "var(--bg-2)" : "transparent", color: kind === k ? (k === "note" ? "var(--warn)" : "var(--fg-1)") : "var(--fg-3)" }}>{l}</button>
        ))}
        <span className="mono dim hide-mobile" style={{ marginLeft: "auto", fontSize: 11, alignSelf: "center" }}>{kind === "note" ? "só a equipe vê · @nome avisa" : "o cliente vê no portal"}</span>
        <button ref={qrBtnRef} type="button" disabled={busy || inserting} aria-expanded={qr?.mode === "button"} title="Respostas rápidas (ou digite / no texto)"
          onClick={() => setQr((cur) => (cur?.mode === "button" ? null : { mode: "button", query: "" }))}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600, marginLeft: 8,
            color: "var(--accent)", background: qr?.mode === "button" ? "var(--accent-soft)" : "transparent" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2.5L4.5 13.5H12l-1 8 8.5-11H12z" /></svg>
          {inserting ? "Inserindo…" : "Respostas rápidas"}
        </button>
      </div>
      <textarea ref={areaRef} className="inp" value={text} onChange={onTextChange} disabled={busy} aria-label={kind === "note" ? "Nota interna" : "Resposta ao cliente"}
        placeholder={kind === "note" ? "Escreva uma nota para a equipe…" : "Escreva a resposta ao cliente… digite / para respostas rápidas"}
        onClick={(e) => { if (qr?.mode === "slash" && !slashTokenAt(text, e.currentTarget.selectionStart)) setQr(null); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (qr?.mode === "slash" && qrList.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setQrActive((a) => Math.min(qrList.length - 1, a + 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setQrActive((a) => Math.max(0, a - 1)); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertQuickReply(qrList[qrActive]); return; }
          }
          if (qr?.mode === "slash" && e.key === "Escape") { e.preventDefault(); setQr(null); return; }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }} />
      {qr?.mode === "button" && (
        <QuickReplyList anchor={qrBtnRef} withSearch items={qrList} query={qr.query} onQuery={(query) => setQr({ mode: "button", query })}
          active={qrActive} onActive={setQrActive} onPick={insertQuickReply} onClose={() => setQr(null)} loading={quickReplies === null} />
      )}
      {qr?.mode === "slash" && qrList.length > 0 && (
        <QuickReplyList anchor={areaRef} items={qrList} query={qr.query} active={qrActive} onActive={setQrActive} onPick={insertQuickReply} onClose={() => setQr(null)} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {/* div, não label: o clique na opção subiria até o label e reabriria a lista */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-3)" }}>
          e marcar como
          <span style={{ width: 200 }}>
            <SelectPopover size="sm" disabled={busy} label="Depois de enviar" value={after} onChange={setAfter}
              options={[{ value: "", label: `manter ${STATUS_BY_KEY[ticket.status]?.label.toLowerCase() || "o status"}` }, ...STATUS_OPTIONS.filter((o) => o.value !== ticket.status && o.value !== "new")]} />
          </span>
        </div>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span className="mono dim hide-mobile" style={{ fontSize: 11 }}>Ctrl+Enter</span>
          <PrimaryButton type="button" onClick={send} disabled={busy || !text.trim()}>{busy ? "Enviando…" : kind === "note" ? "Salvar nota" : "Enviar resposta"}</PrimaryButton>
        </span>
      </div>
    </div>
  );
}

// ── Aba Linear ──────────────────────────────────────────────────────────────
// O que mora na ISSUE: descrição e comentários, lidos do Linear na hora (o
// ticket guarda só o espelho, que pode estar um ciclo atrás). Se o Linear não
// responde, a aba cai para o que já está gravado no ticket e diz isso — a aba
// nunca vira tela de erro.
const PRIO_LINEAR = { 0: "sem prioridade", 1: "urgente", 2: "alta", 3: "média", 4: "baixa" };

// Relato longo (o de uma issue real passa de 19 mil caracteres) entra recolhido:
// a aba abre mostrando o começo e quem precisa do resto pede.
function Recolhivel({ children, altura = 280 }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div>
      <div style={{ maxHeight: aberto ? "none" : altura, overflow: "hidden", position: "relative" }}>
        {children}
        {!aberto && <div style={{ position: "absolute", inset: "auto 0 0 0", height: 48, background: "linear-gradient(transparent, var(--bg-inset))" }} />}
      </div>
      <button type="button" onClick={() => setAberto((v) => !v)} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)", marginTop: 4 }}>
        {aberto ? "recolher" : "ver tudo"}
      </button>
    </div>
  );
}

function LinearPane({ ticket }) {
  const [data, setData] = useState(null);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  const lidoEm = useRef(0);
  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await api.ticketLinear(ticket.id)); setErro(""); lidoEm.current = Date.now(); }
    catch (err) { setErro(err.message || "erro"); }
    finally { setBusy(false); }
  }, [ticket.id]);
  useEffect(() => { load(); }, [load]);
  // Os links de anexo do Linear são assinados e valem ~5 minutos: voltar pra
  // aba depois de um tempo relê a issue, senão os prints aparecem quebrados.
  useEffect(() => {
    const aoVoltar = () => { if (!document.hidden && Date.now() - lidoEm.current > 3 * 60_000) load(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => { document.removeEventListener("visibilitychange", aoVoltar); window.removeEventListener("focus", aoVoltar); };
  }, [load]);

  if (erro) return <div style={{ fontSize: 12.5, color: "var(--neg)" }}>Não deu pra ler a issue · {erro} <button type="button" onClick={load} style={{ fontWeight: 600, textDecoration: "underline", color: "inherit" }}>tentar de novo</button></div>;
  if (!data) return <div className="mono dim" style={{ fontSize: 12 }}>carregando a issue…</div>;

  const { issue, comments = [] } = data;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <a href={data.url || "#"} target="_blank" rel="noopener noreferrer" className="chip accent" style={{ fontWeight: 600 }}>{data.identifier || "issue"} ↗</a>
        {data.state?.name && <span className="support-status" style={{ "--dot": data.state.type === "completed" ? "var(--pos)" : data.state.type === "canceled" ? "var(--fg-4)" : "var(--accent)" }}>{data.state.name}</span>}
        {issue && <span className="mono dim" style={{ fontSize: 11 }}>{PRIO_LINEAR[issue.priority] ?? ""}{issue.assignee ? ` · ${issue.assignee}` : ""}{issue.project ? ` · ${issue.project}` : ""}</span>}
        <button type="button" onClick={load} disabled={busy} className="mono dim" style={{ marginLeft: "auto", fontSize: 11, textDecoration: "underline" }}>{busy ? "lendo…" : "recarregar"}</button>
      </div>

      {data.stale && (
        <div style={{ fontSize: 12, color: "var(--warn)" }}>
          {data.configured === false
            ? "Linear não configurado no servidor — mostrando o que já está gravado no ticket."
            : `Não consegui ler a issue agora (${data.error || "sem resposta"}) — mostrando o que já está gravado no ticket.`}
        </div>
      )}

      {issue && (
        <>
          <span className="kicker">Descrição da issue</span>
          <div className="support-msg" data-kind="linear-desc">
            {issue.description
              ? (issue.description.length > 1200
                ? <Recolhivel><LinearMarkdown text={issue.description} onExpired={load} /></Recolhivel>
                : <LinearMarkdown text={issue.description} onExpired={load} />)
              : <span className="dim">sem descrição no Linear</span>}
          </div>
        </>
      )}

      <span className="kicker">Comentários{comments.length ? ` · ${comments.length}` : ""}</span>
      {comments.length === 0 && (
        <div className="mono dim" style={{ fontSize: 12 }}>
          {data.stale ? "não deu pra ler os comentários agora — abra a issue no Linear" : "nenhum comentário na issue"}
        </div>
      )}
      {comments.map((c) => (
        <div key={c.id} className="support-msg" data-kind="linear">
          <div className="kicker" style={{ marginBottom: 4, display: "flex", gap: 8, alignItems: "center" }}>
            <span>{c.user?.name || "alguém"} · {fmtWhen(c.createdAt)}</span>
            {c.fromCockpit && <span className="chip" title="saiu daqui: resposta ou nota do ticket espelhada na issue">do cockpit</span>}
          </div>
          {c.body.length > 1200
            ? <Recolhivel altura={200}><LinearMarkdown text={c.body} onExpired={load} /></Recolhivel>
            : <LinearMarkdown text={c.body} onExpired={load} />}
        </div>
      ))}
    </div>
  );
}

// ── Linear: vínculo e ações (coluna lateral) ────────────────────────────────
// Só aparece quando o produto espelha (ou quando este ticket já tem issue): a
// coluna de atendimento não carrega caixa de integração que ninguém usa.
// O espelho é automático — os botões daqui são o empurrão manual (mandar agora,
// vincular a uma issue que já existe) e o desvincular.
function LinearSection({ ticket, settings, onChange }) {
  const [busy, setBusy] = useState("");
  const [colando, setColando] = useState(false);
  const [issue, setIssue] = useState("");
  const l = ticket.linear || {};
  if (!settings?.linear?.enabled && !l.issueId) return null;

  const run = async (acao, fn) => {
    setBusy(acao);
    try { onChange(await fn()); return true; }
    catch (err) { toast(`Linear · ${err.message || "não deu pra falar com o Linear"}`, "neg", 6000); return false; }
    finally { setBusy(""); }
  };
  const vincular = async () => {
    if (!issue.trim()) return;
    if (await run("link", () => api.ticketLinearSync(ticket.id, issue.trim()))) { setIssue(""); setColando(false); toast("Ticket vinculado à issue", "pos"); }
  };
  const desvincular = async () => {
    if (!window.confirm(`Desvincular ${l.identifier || "a issue"}? A issue continua no Linear; este ticket é que para de espelhar.`)) return;
    if (await run("unlink", () => api.ticketLinearUnlink(ticket.id))) toast("Ticket desvinculado", "pos");
  };

  return (
    <Section title="Linear" aside={l.issueId
      ? <SecondaryButton size="sm" type="button" disabled={!!busy} onClick={() => run("sync", () => api.ticketLinearSync(ticket.id))}>{busy === "sync" ? "Enviando…" : "Sincronizar"}</SecondaryButton>
      : <SecondaryButton size="sm" type="button" disabled={!!busy} onClick={() => run("sync", () => api.ticketLinearSync(ticket.id))}>{busy === "sync" ? "Enviando…" : "Enviar agora"}</SecondaryButton>}>
      {l.issueId ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
            <a href={l.url || "#"} target="_blank" rel="noopener noreferrer" className="chip accent" style={{ fontWeight: 600 }} title="Abrir a issue no Linear">
              {l.identifier || "issue"} ↗
            </a>
            {l.stateName && <span className="support-status" style={{ "--dot": l.stateType === "completed" ? "var(--pos)" : l.stateType === "canceled" ? "var(--fg-4)" : "var(--accent)" }}>{l.stateName}</span>}
          </div>
          <div className="mono dim" style={{ fontSize: 11 }}>
            {l.syncedAt ? `espelhado ${fmtWhen(l.syncedAt)}` : "aguardando a primeira sincronização"}
          </div>
          {l.error && <div style={{ fontSize: 11.5, color: "var(--neg)" }}>não sincronizou · {l.error}</div>}
          <button type="button" onClick={desvincular} disabled={!!busy} style={{ alignSelf: "flex-start", fontSize: 11.5, color: "var(--fg-4)", textDecoration: "underline" }}>desvincular</button>
        </div>
      ) : colando ? (
        <form onSubmit={(e) => { e.preventDefault(); vincular(); }} style={{ display: "flex", gap: 6 }}>
          <input className="inp" autoFocus value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="ENG-123 ou a URL" style={{ flex: 1, fontSize: 12.5 }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setColando(false); }} />
          <SecondaryButton size="sm" type="submit" disabled={!issue.trim() || !!busy}>{busy === "link" ? "…" : "Vincular"}</SecondaryButton>
        </form>
      ) : (
        <div className="mono dim" style={{ fontSize: 11.5 }}>
          ainda sem issue · <button type="button" onClick={() => setColando(true)} style={{ color: "var(--accent)", fontWeight: 600 }}>vincular a uma existente</button>
        </div>
      )}
    </Section>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────
export function TicketDetail({ ticketId, summary, saasId, agents, settings, mobile, refreshKey, activityVersion, onClose, onChange, onDeleted }) {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [sending, setSending] = useState(false);
  const deleting = useRef(false);
  const [tab, setTab] = useState("conversation");
  const [picker, setPicker] = useState(false);
  const [draft, setDraft] = useState(false);
  const assigneeRef = useRef(null);

  useEffect(() => {
    let vivo = true;
    api.ticket(ticketId)
      .then((t) => { if (vivo) { setTicket(t); setError(""); } })
      .catch((err) => { if (vivo) setError(err.status === 404 ? "Ticket não encontrado ou fora dos produtos que você atende." : (err.message || "erro")); });
    return () => { vivo = false; };
  }, [ticketId, refreshKey, attempt]);

  const apply = useCallback((t) => { if (!t?.id) return; setTicket(t); onChange && onChange(t); }, [onChange]);
  const save = useCallback(async (patch) => {
    const before = ticket;
    setTicket((t) => (t ? { ...t, ...patch, ...(patch.requester ? { requester: { ...(t.requester || {}), ...patch.requester } } : {}) } : t));
    try { apply(await api.ticketUpdate(ticketId, patch)); return true; }
    catch (err) { setTicket(before); toast(`Não deu pra salvar · ${err.message || "tente de novo"}`, "neg"); return false; }
  }, [ticket, ticketId, apply]);

  const subject = useAutosave(ticket?.subject ?? summary?.subject, (v) => (v.trim() ? save({ subject: v.trim() }) : Promise.resolve(false)));
  const description = useAutosave(ticket?.description ?? "", (v) => save({ description: v }));

  const agentName = useCallback((id) => agents?.find((a) => a.id === id)?.name || id || "—", [agents]);
  const assignable = (agents || []).filter((a) => agentHandles(a, saasId));
  const customers = (window.SEED?.CUSTOMERS || []).filter((c) => c.saas === saasId);

  // Fechar por botão, véu ou Esc confirma o descarte e aguarda mutações pendentes.
  const close = () => { if (deleting.current || sending) return; if (draft && !window.confirm("Descartar a resposta que você está escrevendo?")) return; onClose(); };
  const remove = async () => {
    if (deleting.current || sending) return;
    if (!window.confirm(`Apagar o ticket #${ticket?.number}? A conversa, os anexos e o histórico somem. Para encerrar o atendimento, prefira Fechado.`)) return;
    deleting.current = true; setRemoving(true);
    try { await api.ticketDelete(ticketId); toast("Ticket apagado", "pos"); onDeleted && onDeleted(ticketId); }
    catch (err) { toast(`Não deu pra apagar · ${err.message}`, "neg"); }
    finally { deleting.current = false; setRemoving(false); }
  };

  const t = ticket || summary;
  const sla = ticket ? slaState(ticket) : null;
  const status = STATUS_BY_KEY[t?.status];

  // Abas: a do Linear só existe com issue vinculada. Desvincular no meio do
  // caminho devolve quem estava nela para a Conversa.
  const conversa = ticket ? conversationMessages(ticket) : [];
  const abas = [
    ["conversation", `Conversa${conversa.length ? ` · ${conversa.length}` : ""}`],
    ...(ticket?.linear?.issueId ? [["linear", "Linear"]] : []),
    ["activity", "Atividade"],
    ...(mobile ? [["data", "Dados"]] : []),
  ];
  useEffect(() => {
    if ((tab === "linear" && ticket && !ticket.linear?.issueId) || (tab === "data" && !mobile)) setTab("conversation");
  }, [tab, ticket, mobile]);

  const Painel = mobile ? Drawer : Modal;
  const painelProps = mobile
    ? { largura: 560, painelStyle: { position: "fixed", right: 14, top: 14, bottom: 14, height: "auto", maxWidth: "calc(100% - 28px)", overflow: "hidden" } }
    : { largura: 1080, painelStyle: { height: "min(860px, calc(100dvh - 32px))", overflow: "hidden", display: "flex", flexDirection: "column" } };
  const tabs = (
    <div className="support-detail-tabs">
      {abas.map(([k, l]) => (
        <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} style={{ padding: "5px 10px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: tab === k ? 600 : 500, background: tab === k ? "var(--bg-2)" : "transparent", color: tab === k ? "var(--fg-1)" : "var(--fg-3)" }}>{l}</button>
      ))}
    </div>
  );

  const panel = (
    <Painel onClose={close} fechavel={!removing && !sending} label={t ? `Ticket #${t.number}` : "Ticket"} {...painelProps}>
      <header className="support-detail-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono dim support-ellipsis" style={{ fontSize: 11.5 }}>
            #{t?.number || "…"}
            {/* Atalho pra issue: o número dela abre o card no Linear. */}
            {linearKey(t) && <>{" · "}{t.linear.url
              ? <a href={t.linear.url} target="_blank" rel="noopener noreferrer" className="support-linear-link" title={`Abrir ${linearKey(t)} no Linear`}>#{linearKey(t)}</a>
              : `#${linearKey(t)}`}</>}
            {t ? ` · ${CHANNEL_LABEL[t.channel] || "equipe"} · aberto ${fmtWhen(t.createdAt)}` : ""}
            {linearInReview(t) && <span className="chip info" style={{ fontSize: 11, minHeight: 0, marginLeft: 8, verticalAlign: "middle" }} title={`${t.linear.identifier} está em ${t.linear.stateName} no Linear`}>{t.linear.stateName} no Linear</span>}
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 2 }}>
            <textarea value={subject.draft} rows={1} placeholder="Assunto" aria-label="Assunto" className="tk-panel-field support-detail-subject" disabled={!ticket}
              onChange={(e) => subject.onChange(e.target.value)} onBlur={subject.commit}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } }} />
            <SaveStatus status={subject.status} onRetry={subject.commit} />
          </div>
          {t && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 4, fontSize: 12.5 }}>
              {status && <span className="support-status" style={{ "--dot": status.tone }}>{status.label}</span>}
              {PRIORITY_BY_KEY[t.priority] && <span style={{ color: t.priority === "urgent" ? "var(--neg)" : "var(--fg-3)", fontWeight: t.priority === "urgent" ? 600 : 400 }}>prioridade {PRIORITY_BY_KEY[t.priority].label.toLowerCase()}</span>}
              <span style={{ color: t.assignee ? "var(--fg-3)" : "var(--warn)" }}>{t.assignee ? `com ${agentName(t.assignee)}` : "sem responsável"}</span>
              {sla && (sla.overall === "breached" || sla.overall === "warning") && (
                <span style={{ color: sla.overall === "breached" ? "var(--neg)" : "var(--warn)", fontWeight: 600 }}>{sla.overall === "breached" ? "SLA estourado" : "SLA vencendo"}</span>
              )}
            </div>
          )}
        </div>
        {/* Uma ação só pro portal: abrir como o cliente vê (o link copiável é a própria barra de endereço). */}
        <button type="button" title="Ver como o cliente vê" aria-label="Ver como o cliente vê" disabled={!ticket}
          onClick={() => window.open(`${portalUrl(ticket)}?from=cockpit`, "_blank", "noopener")}
          style={{ ...iconBtn, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: ticket ? 1 : 0.5 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <button type="button" title="Fechar (Esc)" aria-label="Fechar" disabled={removing || sending} onClick={close} style={iconBtn}>✕</button>
      </header>

      {error && <div role="alert" style={{ margin: 18, padding: "12px 14px", borderRadius: "var(--r-3)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5 }}>{error} <button onClick={() => { setError(""); setAttempt((n) => n + 1); }}>Tentar novamente</button></div>}
      {!error && !ticket && <div className="mono dim" style={{ fontSize: 12, padding: 18 }}>carregando…</div>}
      {!error && ticket && (<>
        {mobile && tabs}
        <div className={`support-detail-body${mobile ? "" : " is-wide"}`}>
          <div className="support-detail-main" hidden={tab === "data"}>
            {!mobile && tabs}
            <div className="support-detail-thread">
              {tab === "conversation" ? <Conversation ticket={ticket} agentName={agentName} description={description} />
                : tab === "linear" ? <LinearPane ticket={ticket} />
                  : <Activity ticketId={ticket.id} version={activityVersion} agentName={agentName} />}
            </div>
            <Composer ticket={ticket} onSent={apply} onDraft={setDraft} onBusy={setSending} />
          </div>

          <aside className="support-detail-side" aria-label="Dados do atendimento" hidden={mobile && tab !== "data"}>
            <Section title="Atendimento">
              <Field label="Status">
                <SelectPopover label="Status" value={ticket.status} options={STATUS_OPTIONS} onChange={(v) => save({ status: v })} />
              </Field>
              <Field label="Prioridade">
                <SelectPopover label="Prioridade" value={ticket.priority} options={PRIORITY_OPTIONS} onChange={(v) => save({ priority: v })} />
              </Field>
              <Field label="Responsável" anchorRef={assigneeRef}>
                <button type="button" className="inp" onClick={() => setPicker(true)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, textAlign: "left", fontSize: 12.5, color: ticket.assignee ? "var(--fg-1)" : "var(--warn)" }}>
                  {ticket.assignee ? <><UserAvatarRing id={ticket.assignee} name={agentName(ticket.assignee)} size={18} /><span className="support-ellipsis">{agentName(ticket.assignee)}</span></> : "atribuir…"}
                </button>
                {picker && <UserPicker anchor={assigneeRef} users={assignable} value={ticket.assignee} multi={false} allowNone noneLabel="Sem responsável" title="Responsável"
                  onChange={(id) => save({ assignee: id })} onClose={() => setPicker(false)} />}
              </Field>
              <Field label="Categoria">
                <SelectPopover label="Categoria" value={ticket.category || ""} onChange={(v) => save({ category: v })}
                  options={[{ value: "", label: "sem categoria", color: "var(--fg-3)" }, ...[...new Set([...(settings?.categories || []), ...(ticket.category ? [ticket.category] : [])])].map((c) => ({ value: c, label: c }))]} />
              </Field>
            </Section>

            <Section title="Prazos (SLA)">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }} title="em tempo útil, pelo expediente de Configurações de SLA">
                <SlaClock label="1ª resposta" state={sla.firstResponse} due={ticket.sla?.firstResponseDue} doneAt={ticket.sla?.firstResponseAt} doneLabel="respondido" />
                <SlaClock label="Resolução" state={sla.resolution} due={ticket.sla?.resolutionDue} doneAt={ticket.sla?.resolvedAt} doneLabel="resolvido" />
              </div>
            </Section>

            <Section title="Cliente">
              <div style={{ marginBottom: 6 }}>
                <SelectPopover label="Cliente vinculado" value={ticket.customerId || ""} onChange={(v) => save({ customerId: v })} searchable={customers.length > 6}
                  options={[{ value: "", label: "sem cliente vinculado", color: "var(--fg-3)" }, ...customers.map((c) => ({ value: c.id, label: c.name, hint: c.contact || "" }))]} />
              </div>
              <RequesterFields ticket={ticket} save={save} />
            </Section>

            <Attachments ticket={ticket} onChange={apply} />

            <LinearSection ticket={ticket} settings={settings} onChange={apply} />

            {/* Destrutiva e rara (só admin): no pé da coluna, longe do fluxo de atendimento. */}
            {isAdminUser() && (
              <div className="support-detail-section" style={{ paddingTop: 10 }}>
                <button type="button" disabled={removing || sending} onClick={remove} style={{ fontSize: 12, color: "var(--neg)", fontWeight: 600 }}>Apagar ticket</button>
                <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>para encerrar o atendimento, prefira o status Fechado</div>
              </div>
            )}
          </aside>
        </div></>
      )}
    </Painel>
  );
  return typeof document !== "undefined" && document.body?.nodeType === 1 ? createPortal(panel, document.body) : panel;
}
