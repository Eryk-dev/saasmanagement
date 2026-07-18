import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { currentUser } from "../lib/users.js";

// Tela Consultas — a operação pós-venda da mentoria (UniqueKids, 8 encontros):
// aba AGENDA (grade da semana + jornadas por cliente com progresso n/8) e aba
// ENTREGÁVEIS (o Manual da Família de cada cliente: seções editáveis, IA compõe
// a partir das consultas, página pública /m/:id pra entregar na consulta 8).
// Dados fora do bootstrap: fetch próprio re-disparado pelo tempo real (version).

const { useState: useS, useEffect: useE, useMemo: useM } = React;

const TOTAL = 8;                       // encontros do pacote
const H0 = 7, H1 = 21;                 // 07:00…20:00 (mesma faixa da tela Agenda)
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Mesma família? Espelho do sameFamily do servidor (deliverables.js): ids
// quando ambos têm, senão nome case-insensitive.
function sameFamily(a, b) {
  if (!a || !b) return false;
  if (a.customerId && b.customerId) return a.customerId === b.customerId;
  if (a.leadId && b.leadId) return a.leadId === b.leadId;
  const an = String(a.clientName || "").trim().toLowerCase();
  const bn = String(b.clientName || "").trim().toLowerCase();
  return !!an && an === bn;
}

// Segunda a sábado da semana que contém `ref` (consulta pode cair no sábado).
function weekDays(ref) {
  const d = new Date(ref); d.setHours(0, 0, 0, 0);
  const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 6 }, (_, i) => { const x = new Date(monday); x.setDate(monday.getDate() + i); return x; });
}

// Base pública da API (as páginas /m/ são servidas pela API, não pelo SPA).
const PUBLIC_BASE = import.meta.env.VITE_API_BASE || window.location.origin;
const manualUrl = (id) => `${PUBLIC_BASE}/m/${id}`;

const STATUS = {
  scheduled: { label: "agendada", color: "var(--accent)" },
  done:      { label: "feita",    color: "var(--pos, #17803d)" },
  no_show:   { label: "faltou",   color: "var(--warn, #b45309)" },
  canceled:  { label: "desmarcada", color: "var(--fg-4)" },
};

function fmtAt(at) {
  if (!at) return "sem horário";
  const d = new Date(at + (at.length === 16 ? ":00" : ""));
  if (!Number.isFinite(d.getTime())) return at;
  return `${WD[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ConsultasScreen() {
  const { version, refresh } = useData();
  const [product] = useActiveSaas();
  const [tab, setTab] = useS("agenda");            // agenda | entregaveis
  const [consultas, setConsultas] = useS(null);
  const [manuais, setManuais] = useS(null);
  const [weekRef, setWeekRef] = useS(() => new Date());
  const [editing, setEditing] = useS(null);        // registro de consulta (novo sem id)
  const [manualSel, setManualSel] = useS(null);    // id do manual aberto no editor

  useE(() => {
    let alive = true;
    Promise.all([api.list("consultations"), api.list("deliverables")])
      .then(([cs, ms]) => {
        if (!alive) return;
        setConsultas(cs.filter((c) => !product?.id || c.saas === product.id));
        setManuais(ms.filter((m) => !product?.id || m.saas === product.id));
      })
      .catch(() => { if (alive) { setConsultas([]); setManuais([]); } });
    return () => { alive = false; };
  }, [product?.id, version]);

  const customers = useM(
    () => (window.SEED?.CUSTOMERS || []).filter((c) => !product?.id || c.saas === product.id),
    [product?.id, version],
  );

  // Jornadas: consultas agrupadas por cliente, na ordem da próxima consulta.
  // Mesmo matcher do servidor (sameFamily): ids quando AMBOS têm, senão o nome —
  // consulta criada "digitando o nome" cai na MESMA jornada do cliente do select.
  const journeys = useM(() => {
    const out = [];
    for (const c of consultas || []) {
      let j = out.find((x) => sameFamily(x, c));
      if (!j) { j = { clientName: c.clientName, customerId: c.customerId || "", leadId: c.leadId || "", items: [] }; out.push(j); }
      if (c.customerId && !j.customerId) j.customerId = c.customerId; // jornada acumula os ids
      if (c.leadId && !j.leadId) j.leadId = c.leadId;
      j.items.push(c);
    }
    for (const j of out) {
      j.key = j.customerId || j.leadId || j.clientName || "?";
      j.items.sort((a, b) => (a.n || 0) - (b.n || 0));
      j.done = j.items.filter((c) => c.status === "done").length;
      j.next = j.items.filter((c) => c.status === "scheduled" && c.at).sort((a, b) => String(a.at).localeCompare(String(b.at)))[0] || null;
      // Tamanho do pacote comprado (8 ou 4): vem carimbado nas consultas criadas
      // pela conversão do Ganho; jornada antiga/manual cai no padrão de 8.
      j.total = j.items.reduce((a, c) => Math.max(a, Number(c.packageTotal) || 0), 0) || TOTAL;
    }
    return out.sort((a, b) => String(a.next?.at || "9999").localeCompare(String(b.next?.at || "9999")));
  }, [consultas]);

  const days = useM(() => weekDays(weekRef), [weekRef]);
  const byCell = useM(() => {
    const m = new Map();
    for (const c of consultas || []) {
      if (!c.at || c.status === "canceled") continue;
      const key = `${c.at.slice(0, 10)}-${c.at.slice(11, 13)}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(c);
    }
    return m;
  }, [consultas]);

  function newConsulta(prefill = {}) {
    setEditing({
      saas: product?.id || "uniquekids", customerId: "", leadId: "", clientName: "", childName: "", phone: "",
      n: 1, at: "", durationMin: 60, status: "scheduled", notes: "", owner: currentUser()?.id || "",
      ...prefill,
    });
  }
  // Marcar a PRÓXIMA consulta de uma jornada: herda o cliente e o próximo n.
  function nextOf(j) {
    const maxN = Math.max(0, ...j.items.map((c) => c.n || 0));
    const last = j.items[j.items.length - 1] || {};
    newConsulta({ customerId: j.customerId, leadId: j.leadId, clientName: j.clientName, childName: last.childName || "", phone: last.phone || "", n: Math.min(maxN + 1, 99), packageTotal: j.total });
  }

  if (!product) return <EmptyState title="Sem produto ativo" hint="Escolha um produto no seletor da barra lateral." />;

  const manualOpen = (manuais || []).find((m) => m.id === manualSel) || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageHead title="Consultas" sub={`mentoria 1:1 · agenda e entregáveis de ${product.name}`}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {[["agenda", "Agenda"], ["entregaveis", "Entregáveis"]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={chip(tab === k)}>{label}</button>
          ))}
          <button onClick={() => newConsulta()} style={{ ...chip(false), background: "var(--accent)", color: "var(--accent-fg, #fff)", border: "none", fontWeight: 700 }}>+ Nova consulta</button>
        </div>
      </PageHead>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px var(--pad-x) 56px" }}>
        {tab === "agenda" ? (
          <AgendaTab
            days={days} byCell={byCell} journeys={journeys} consultas={consultas}
            onShiftWeek={(dir) => setWeekRef((r) => { const d = new Date(r); d.setDate(d.getDate() + dir * 7); return d; })}
            onToday={() => setWeekRef(new Date())}
            onPick={(c) => setEditing(c)}
            onCell={(day, h) => newConsulta({ at: `${ymd(day)}T${pad(h)}:00` })}
            onNext={nextOf}
            onOpenManual={(j) => {
              const m = (manuais || []).find((x) => sameFamily(x, j));
              if (m) { setTab("entregaveis"); setManualSel(m.id); }
            }}
          />
        ) : (
          <EntregaveisTab manuais={manuais} customers={customers} product={product}
            onOpen={(id) => setManualSel(id)} refresh={refresh} />
        )}
      </div>

      {editing && (
        <ConsultaModal c={editing} customers={customers}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }} />
      )}
      {manualOpen && (
        <ManualEditor m={manualOpen} onClose={() => setManualSel(null)} refresh={refresh} />
      )}
    </div>
  );
}

// ── Aba Agenda ────────────────────────────────────────────────────────────────
function AgendaTab({ days, byCell, journeys, consultas, onShiftWeek, onToday, onPick, onCell, onNext, onOpenManual }) {
  const today = ymd(new Date());
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => onShiftWeek(-1)} style={navBtn}>‹</button>
        <button onClick={onToday} style={navBtn}>hoje</button>
        <button onClick={() => onShiftWeek(1)} style={navBtn}>›</button>
        <span className="mono dim" style={{ fontSize: 11.5 }}>
          {pad(days[0].getDate())}/{pad(days[0].getMonth() + 1)} a {pad(days[5].getDate())}/{pad(days[5].getMonth() + 1)} · clique num horário vazio pra marcar
        </span>
      </div>

      {/* Grade da semana (seg-sáb × horas) */}
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", overflow: "hidden", background: "var(--bg-1)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "52px repeat(6, 1fr)" }}>
          <div style={{ background: "var(--bg-inset)" }} />
          {days.map((d) => (
            <div key={ymd(d)} style={{ padding: "8px 10px", background: "var(--bg-inset)", borderLeft: "1px solid var(--line-1)", textAlign: "center" }}>
              <span className="mono" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: ymd(d) === today ? "var(--accent)" : "var(--fg-4)", fontWeight: ymd(d) === today ? 800 : 500 }}>
                {WD[d.getDay()]} {pad(d.getDate())}
              </span>
            </div>
          ))}
          {Array.from({ length: H1 - H0 }, (_, i) => H0 + i).map((h) => (
            <React.Fragment key={h}>
              <div className="mono tnum" style={{ fontSize: 10, color: "var(--fg-4)", textAlign: "right", padding: "2px 8px 0 0", height: 34, borderTop: "1px solid var(--line-1)" }}>{pad(h)}h</div>
              {days.map((d) => {
                const cell = byCell.get(`${ymd(d)}-${pad(h)}`) || [];
                return (
                  <div key={`${ymd(d)}-${h}`} onClick={() => (cell.length ? onPick(cell[0]) : onCell(d, h))}
                    title={cell.length ? cell.map((c) => `${c.clientName} · consulta ${c.n}/${c.packageTotal || TOTAL}`).join("\n") : "marcar consulta"}
                    style={{ height: 34, borderTop: "1px solid var(--line-1)", borderLeft: "1px solid var(--line-1)", cursor: "pointer", padding: 2, background: "transparent" }}>
                    {cell.map((c) => {
                      const st = STATUS[c.status] || STATUS.scheduled;
                      return (
                        <div key={c.id} style={{ height: "100%", borderRadius: 6, padding: "2px 7px", fontSize: 10.5, fontWeight: 700, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", background: "color-mix(in srgb, " + st.color + " 14%, transparent)", color: st.color, border: "1px solid color-mix(in srgb, " + st.color + " 35%, transparent)" }}>
                          {c.clientName || "?"} · {c.n}/{c.packageTotal || TOTAL}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Jornadas por cliente */}
      <div>
        <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Jornadas · {journeys.length} cliente{journeys.length === 1 ? "" : "s"}</div>
        {consultas === null ? (
          <div className="mono dim" style={{ fontSize: 11.5 }}>carregando…</div>
        ) : journeys.length === 0 ? (
          <EmptyState title="Nenhuma jornada ainda" hint="marca a 1ª consulta do cliente no botão acima (o Manual da Família nasce junto)" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
            {journeys.map((j) => (
              <div key={j.key} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.clientName || "?"}</div>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{j.done}/{j.total}</span>
                </div>
                {/* bolinhas do progresso 1..N (tamanho do pacote comprado) */}
                <div style={{ display: "flex", gap: 5, margin: "10px 0" }}>
                  {Array.from({ length: j.total }, (_, i) => i + 1).map((n) => {
                    const c = j.items.find((x) => x.n === n);
                    const st = c ? (STATUS[c.status] || STATUS.scheduled) : null;
                    const done = c?.status === "done";
                    return (
                      <span key={n} title={c ? `consulta ${n}: ${st.label}${c.at ? ` · ${fmtAt(c.at)}` : ""}` : `consulta ${n}: não marcada`}
                        onClick={() => c && onPick(c)}
                        style={{ width: 22, height: 22, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, cursor: c ? "pointer" : "default",
                          background: c ? "color-mix(in srgb, " + st.color + " 16%, transparent)" : "var(--bg-2)",
                          border: "1px solid " + (c ? st.color : "var(--line-2)"),
                          color: c ? st.color : "var(--fg-4)" }}>
                        {done ? "✓" : n}
                      </span>
                    );
                  })}
                </div>
                <div className="mono dim" style={{ fontSize: 11 }}>
                  {j.next ? `próxima: ${fmtAt(j.next.at)}` : j.done >= j.total ? "jornada completa 🎉" : "sem próxima marcada"}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  {j.done < j.total && <button onClick={() => onNext(j)} style={chip(false)}>+ marcar próxima</button>}
                  <button onClick={() => onOpenManual(j)} style={chip(false)}>Manual da Família</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Modal de consulta (criar/editar) ─────────────────────────────────────────
function ConsultaModal({ c, customers, onClose, onSaved }) {
  const [form, setForm] = useS(c);
  const [busy, setBusy] = useS("");
  const [err, setErr] = useS("");
  const isNew = !c.id;
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  function pickCustomer(id) {
    const cu = customers.find((x) => x.id === id);
    if (cu) set({ customerId: cu.id, leadId: cu.leadId || "", clientName: cu.contact || cu.name || "", phone: cu.phone || "" });
    else set({ customerId: "", leadId: "" });
  }

  async function save() {
    if (!form.clientName.trim()) { setErr("dá um nome pro cliente"); return; }
    setBusy("save"); setErr("");
    try {
      if (isNew) await api.create("consultations", form);
      else await api.update("consultations", form.id, form);
      onSaved();
    } catch (e) { setErr(e?.message || "não salvou"); setBusy(""); }
  }
  // Ações que dependem do registro no servidor (Meet/resumo): primeiro SALVA o
  // que está na tela (o horário editado vale), roda a ação e recarrega o
  // registro SEM fechar o modal — a Ana vê o link/resumo na hora.
  async function act(kind, fn) {
    setBusy(kind); setErr("");
    try {
      await api.update("consultations", form.id, form);
      await fn();
      const fresh = await api.get("consultations", form.id);
      setForm(fresh);
    } catch (e) { setErr(e?.message || "falhou"); }
    finally { setBusy(""); }
  }
  async function removeConsulta() {
    setBusy("del"); setErr("");
    try { await api.remove("consultations", form.id); onSaved(); }
    catch (e) { setErr(e?.message || "falhou"); setBusy(""); }
  }

  const s = form.summary;
  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...sheet, width: "min(680px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>{isNew ? "Nova consulta" : `Consulta ${form.n}/${form.packageTotal || TOTAL} · ${form.clientName}`}</div>
          <button onClick={onClose} style={{ ...chip(false), padding: "0 9px" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={lab}>Cliente
            <select value={form.customerId || "__free"} onChange={(e) => pickCustomer(e.target.value === "__free" ? "" : e.target.value)} style={inp}>
              <option value="__free">Digitar o nome…</option>
              {customers.map((cu) => <option key={cu.id} value={cu.id}>{cu.name}{cu.contact && cu.contact !== cu.name ? ` · ${cu.contact}` : ""}</option>)}
            </select>
          </label>
          <label style={lab}>Nome (como a Ana chama)
            <input value={form.clientName} onChange={(e) => set({ clientName: e.target.value })} placeholder="ex.: Mariana" style={inp} />
          </label>
          <label style={lab}>Criança (opcional)
            <input value={form.childName || ""} onChange={(e) => set({ childName: e.target.value })} placeholder="nome do filho" style={inp} />
          </label>
          <label style={lab}>WhatsApp (opcional)
            <input value={form.phone || ""} onChange={(e) => set({ phone: e.target.value })} placeholder="(41) 9…" style={inp} />
          </label>
          <label style={lab}>Consulta nº
            <input type="number" min={1} max={99} value={form.n} onChange={(e) => set({ n: Number(e.target.value) || 1 })} style={inp} />
          </label>
          <label style={lab}>Duração (min)
            <input type="number" min={15} step={15} value={form.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) || 60 })} style={inp} />
          </label>
          <label style={{ ...lab, gridColumn: "1 / -1" }}>Dia e horário
            <input type="datetime-local" value={form.at || ""} onChange={(e) => set({ at: e.target.value })} style={inp} />
          </label>
        </div>

        {!isNew && (
          <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            {Object.entries(STATUS).map(([k, v]) => (
              <button key={k} onClick={() => set({ status: k })} style={{ ...chip(form.status === k), ...(form.status === k ? { borderColor: v.color, color: v.color } : {}) }}>{v.label}</button>
            ))}
          </div>
        )}

        <label style={{ ...lab, marginTop: 12 }}>Anotações da consulta
          <textarea value={form.notes || ""} onChange={(e) => set({ notes: e.target.value })} rows={3} placeholder="o que rolou, combinados, observações (entra no material do Manual)" style={{ ...inp, resize: "vertical" }} />
        </label>

        {/* Meet + resumo IA */}
        {!isNew && (
          <div style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {form.meetUrl
                ? <a href={form.meetUrl} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11.5, color: "var(--accent)" }}>{form.meetUrl} ↗</a>
                : <span className="mono dim" style={{ fontSize: 11 }}>sem Meet ainda (o Meet grava e transcreve sozinho)</span>}
              <span style={{ flex: 1 }} />
              {!form.meetUrl && <button disabled={!!busy || !form.at} title={form.at ? "cria o Meet no horário da consulta" : "defina o horário primeiro"} onClick={() => act("meet", () => api.consultationMeet(form.id))} style={chip(false)}>{busy === "meet" ? "criando…" : "Criar Meet"}</button>}
              <button disabled={!!busy || !form.meetUrl} onClick={() => act("sum", () => api.consultationSummary(form.id, true))} style={chip(false)} title="busca a transcrição e resume (também acontece sozinho após a consulta)">{busy === "sum" ? "resumindo…" : "↻ Resumir com IA"}</button>
            </div>
            {s && (
              <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Resumo da consulta (IA)</div>
                <div>{s.resumo}</div>
                {s.evolucao && <div style={{ marginTop: 6 }}><b>Evolução:</b> {s.evolucao}</div>}
                {!!s.combinados?.length && <div style={{ marginTop: 6 }}><b>Combinados:</b> {s.combinados.join(" · ")}</div>}
                {!!s.tarefas?.length && <div style={{ marginTop: 4 }}><b>Tarefas de casa:</b> {s.tarefas.join(" · ")}</div>}
                {s.sinais && <div style={{ marginTop: 4, color: "var(--warn, #b45309)" }}><b>Sinais de atenção:</b> {s.sinais}</div>}
                {s.proxima && <div style={{ marginTop: 4 }}><b>Foco da próxima:</b> {s.proxima}</div>}
              </div>
            )}
          </div>
        )}

        {err && <div style={{ fontSize: 11.5, color: "#e5484d", marginTop: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {!isNew && <button disabled={!!busy} onClick={removeConsulta} style={{ ...chip(false), color: "#e5484d" }}>apagar</button>}
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={chip(false)}>cancelar</button>
          <button disabled={!!busy} onClick={save} style={{ ...chip(false), background: "var(--accent)", color: "var(--accent-fg, #fff)", border: "none", fontWeight: 700 }}>{busy === "save" ? "salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Aba Entregáveis ───────────────────────────────────────────────────────────
function EntregaveisTab({ manuais, customers, product, onOpen, refresh }) {
  async function createManual() {
    const cu = customers[0];
    const rec = await api.create("deliverables", {
      saas: product.id, customerId: cu?.id || "", leadId: cu?.leadId || "",
      clientName: cu?.contact || cu?.name || "Nova família", childName: "",
      status: "building", // sections: o servidor aplica o template das 6 seções
    });
    refresh();
    onOpen(rec.id);
  }
  if (manuais === null) return <div className="mono dim" style={{ fontSize: 11.5 }}>carregando…</div>;
  if (!manuais.length) {
    return <EmptyState title="Nenhum manual ainda" hint="o Manual da Família nasce sozinho na 1ª consulta do cliente; ou crie um manualmente" action={<button onClick={createManual} style={chip(false)}>+ criar manual</button>} />;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
      {manuais.map((m) => {
        const filled = (m.sections || []).filter((s) => String(s.content || "").trim()).length;
        const total = (m.sections || []).length || 6;
        const delivered = m.status === "delivered";
        return (
          <div key={m.id} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.clientName || "?"}{m.childName ? ` · ${m.childName}` : ""}
              </div>
              <span className="mono" style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, fontWeight: 700,
                background: delivered ? "color-mix(in srgb, var(--pos, #17803d) 14%, transparent)" : "var(--bg-2)",
                color: delivered ? "var(--pos, #17803d)" : "var(--fg-3)",
                border: "1px solid " + (delivered ? "var(--pos, #17803d)" : "var(--line-2)") }}>
                {delivered ? "entregue" : "em construção"}
              </span>
            </div>
            {/* progresso das seções */}
            <div style={{ display: "flex", gap: 4, margin: "10px 0 6px" }}>
              {(m.sections || []).map((s) => (
                <span key={s.key} title={s.title + (String(s.content || "").trim() ? " · escrita" : " · vazia")}
                  style={{ flex: 1, height: 6, borderRadius: 3, background: String(s.content || "").trim() ? "var(--accent)" : "var(--bg-3)" }} />
              ))}
            </div>
            <div className="mono dim" style={{ fontSize: 10.5 }}>{filled}/{total} seções escritas</div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={() => onOpen(m.id)} style={chip(false)}>Abrir</button>
              <a href={manualUrl(m.id)} target="_blank" rel="noreferrer" style={{ ...chip(false), textDecoration: "none" }}>Ver página ↗</a>
              <button onClick={() => navigator.clipboard?.writeText(manualUrl(m.id))} style={chip(false)} title="copiar o link público pra mandar no WhatsApp">copiar link</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Editor do Manual da Família ───────────────────────────────────────────────
function ManualEditor({ m, onClose, refresh }) {
  const [doc, setDoc] = useS(m);
  const [busy, setBusy] = useS("");
  const [err, setErr] = useS("");
  useE(() => setDoc(m), [m.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function setSection(i, content) {
    setDoc((d) => {
      const sections = d.sections.map((s, idx) => (idx === i ? { ...s, content } : s));
      return { ...d, sections };
    });
  }
  async function saveSections(sections) {
    try { await api.update("deliverables", doc.id, { sections }); } catch (e) { setErr(e?.message || "não salvou"); }
  }
  async function compose() {
    setBusy("compose"); setErr("");
    try {
      const r = await api.composeManual(doc.id);
      setDoc((d) => ({ ...d, sections: r.sections }));
      refresh();
    } catch (e) { setErr(e?.message || "não deu pra compor"); }
    finally { setBusy(""); }
  }
  async function deliver() {
    setBusy("deliver"); setErr("");
    const delivered = doc.status !== "delivered";
    try {
      await api.update("deliverables", doc.id, { status: delivered ? "delivered" : "building", deliveredAt: delivered ? new Date().toISOString() : "" });
      setDoc((d) => ({ ...d, status: delivered ? "delivered" : "building" }));
      refresh();
    } catch (e) { setErr(e?.message || "falhou"); }
    finally { setBusy(""); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...sheet, width: "min(860px, 96vw)", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 800, flex: 1, minWidth: 200 }}>Manual da Família · {doc.clientName}</div>
          <button disabled={!!busy} onClick={compose} style={{ ...chip(false), borderColor: "var(--accent-line)", color: "var(--accent)", background: "var(--accent-soft)" }}
            title="a IA escreve as seções a partir dos resumos e notas das consultas feitas (você revisa e edita)">
            {busy === "compose" ? "compondo…" : "✦ Compor com IA"}
          </button>
          <a href={manualUrl(doc.id)} target="_blank" rel="noreferrer" style={{ ...chip(false), textDecoration: "none" }}>Ver página ↗</a>
          <button onClick={() => navigator.clipboard?.writeText(manualUrl(doc.id))} style={chip(false)}>copiar link</button>
          <button disabled={!!busy} onClick={deliver} style={{ ...chip(false), ...(doc.status === "delivered" ? {} : { background: "var(--pos, #17803d)", color: "#fff", border: "none", fontWeight: 700 }) }}>
            {doc.status === "delivered" ? "reabrir" : "Marcar entregue"}
          </button>
          <button onClick={onClose} style={{ ...chip(false), padding: "0 9px" }}>✕</button>
        </div>
        <div className="mono dim" style={{ fontSize: 10.5, marginBottom: 12 }}>
          as seções são o que a apresentação promete · a IA propõe a partir das consultas, você edita à vontade · seção vazia não aparece na página
        </div>
        <label style={{ ...lab, marginBottom: 12, maxWidth: 320 }}>Nome da criança
          <input value={doc.childName || ""} onChange={(e) => setDoc((d) => ({ ...d, childName: e.target.value }))}
            onBlur={(e) => api.update("deliverables", doc.id, { childName: e.target.value }).catch(() => {})} style={inp} />
        </label>

        {(doc.sections || []).map((s, i) => (
          <div key={s.key} style={{ marginBottom: 14, border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "12px 14px", background: "var(--bg-inset)" }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>{i + 1}. {s.title}</div>
            <div className="dim" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.45 }}>{s.hint}</div>
            <textarea value={s.content || ""} rows={s.content ? Math.min(14, Math.max(4, s.content.split("\n").length + 1)) : 3}
              onChange={(e) => setSection(i, e.target.value)}
              onBlur={() => saveSections(doc.sections)}
              placeholder="ainda vazia · escreva ou use o Compor com IA"
              style={{ ...inp, resize: "vertical", lineHeight: 1.55 }} />
            {!!s.sources?.length && <div className="mono dim" style={{ fontSize: 9.5, marginTop: 4 }}>modulada pelas consultas {s.sources.join(", ")}</div>}
          </div>
        ))}
        {err && <div style={{ fontSize: 11.5, color: "#e5484d" }}>{err}</div>}
      </div>
    </div>
  );
}

// ── estilos ───────────────────────────────────────────────────────────────────
const kicker = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
const chip = (on) => ({ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 11px", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"), background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)" });
const navBtn = { height: 28, minWidth: 32, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 13, cursor: "pointer" };
const overlay = { position: "fixed", inset: 0, background: "rgba(8, 18, 26, 0.45)", display: "grid", placeItems: "center", zIndex: 90, padding: 16 };
const sheet = { background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "18px 20px", boxShadow: "0 24px 80px rgba(2, 16, 28, 0.35)" };
const lab = { display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, color: "var(--fg-3)", fontWeight: 600 };
const inp = { width: "100%", padding: "8px 10px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5, fontWeight: 400 };
