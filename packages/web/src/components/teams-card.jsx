// Times (Lever CRM, Fase 2; api: auth/teams.js). Pessoas de um produto por
// função (SDR, closer, integração, CS, suporte), com gestor. Na tela
// Funcionários, o filtro recorta os cartões pelo time e o admin cria, edita e
// arquiva aqui.

import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { allUsers, displayName, isAdminUser } from "../lib/users.js";
import { Modal } from "./overlay.jsx";
import { SelectPopover } from "./select-popover.jsx";
import { Checkbox } from "./form-controls.jsx";
import { toast } from "../atoms.jsx";

export const TEAM_KIND = { sdr: "SDR", closer: "Closer", integracao: "Integração", cs: "CS", suporte: "Suporte", outro: "Outro" };
const KIND_OPTIONS = Object.entries(TEAM_KIND).map(([value, label]) => ({ value, label }));
const card = { background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", overflow: "hidden" };
const btn = { padding: "8px 14px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 13 };
const btnPrimary = { padding: "8px 14px", background: "var(--btn-bg)", color: "var(--btn-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 600 };

export function useTeams(saas) {
  const [teams, setTeams] = useState(null);
  const load = () => api.teams(saas || "").then((r) => setTeams((r && r.teams) || [])).catch(() => setTeams([]));
  useEffect(() => { load(); }, [saas]); // eslint-disable-line react-hooks/exhaustive-deps
  return [teams, load];
}

// Chips "todos · time A · time B". Some sem times.
export function TeamFilter({ teams, value, onChange }) {
  if (!teams?.length) return null;
  const chip = (active) => ({ height: 28, padding: "0 12px", borderRadius: 999, fontSize: 12.5, cursor: "pointer", border: `1px solid ${active ? "var(--accent)" : "var(--line-2)"}`, background: active ? "var(--accent-soft, var(--bg-2))" : "var(--bg-1)", color: "var(--fg-1)", fontWeight: active ? 600 : 400 });
  return <div role="radiogroup" aria-label="Time" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
    <button type="button" role="radio" aria-checked={!value} style={chip(!value)} onClick={() => onChange("")}>todos</button>
    {teams.map((t) => <button key={t.id} type="button" role="radio" aria-checked={value === t.id} style={chip(value === t.id)} onClick={() => onChange(t.id)}>{t.name}</button>)}
  </div>;
}

function TeamForm({ saas, team, onClose, onSaved }) {
  const [name, setName] = useState(team?.name || "");
  const [kind, setKind] = useState(team?.kind || "sdr");
  const [manager, setManager] = useState(team?.manager || "");
  const [members, setMembers] = useState(team?.members || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const people = allUsers().filter((u) => u.active !== false && (!u.saas || !saas || u.saas === saas));
  const toggle = (id) => setMembers((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = { name, kind, manager, members, saas: team ? team.saas : saas };
      if (team) await api.updateTeam(team.id, body); else await api.createTeam(body);
      toast(team ? "Time salvo" : "Time criado", "pos");
      onSaved();
    } catch (e) { setError(e.message || "Não foi possível salvar o time."); } finally { setBusy(false); }
  }
  return <Modal onClose={onClose} fechavel={!busy} label={team ? "Editar time" : "Novo time"} painelStyle={{ padding: "20px 22px" }} largura={480} padding={20}>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 17 }}>{team ? "Editar time" : "Novo time"}</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 2, minWidth: 0 }}><div className="kicker">Nome</div><input className="inp" style={{ width: "100%", marginTop: 4 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: SDR LeverAds" /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div className="kicker">Função</div><div style={{ marginTop: 4 }}><SelectPopover value={kind} options={KIND_OPTIONS} onChange={setKind} label="Função do time" /></div></div>
      </div>
      <div><div className="kicker">Gestor</div><div style={{ marginTop: 4 }}>
        <SelectPopover value={manager} options={[{ value: "", label: "sem gestor" }, ...people.map((u) => ({ value: u.id, label: displayName(u.id) }))]} onChange={setManager} label="Gestor do time" searchable />
      </div></div>
      <div><div className="kicker">Membros</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6, marginTop: 6, maxHeight: 220, overflow: "auto" }}>
          {people.map((u) => <Checkbox key={u.id} checked={members.includes(u.id) || manager === u.id} disabled={manager === u.id} onChange={() => toggle(u.id)}>{displayName(u.id)}</Checkbox>)}
        </div>
      </div>
      {error && <p role="alert" style={{ margin: 0, color: "var(--neg)", fontSize: 12.5 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {team && <button type="button" style={{ ...btn, marginRight: "auto", color: "var(--fg-3)" }} disabled={busy}
          onClick={async () => { setBusy(true); try { await api.updateTeam(team.id, { status: "archived" }); onSaved(); } catch (e) { setError(e.message); setBusy(false); } }}>Arquivar</button>}
        <button type="button" style={btn} onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" style={btnPrimary} onClick={save} disabled={busy}>{busy ? "Salvando…" : team ? "Salvar" : "Criar time"}</button>
      </div>
    </div>
  </Modal>;
}

// Lista dos times do produto; o admin cria e edita.
export function TeamsCard({ saas, teams, onChanged }) {
  const [editing, setEditing] = useState(null); // null | "new" | team
  const admin = isAdminUser();
  if (!teams) return null;
  if (!teams.length && !admin) return null;
  return <section style={card}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "20px 24px 14px" }}>
      <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>Times</h3>
      <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>quem trabalha junto, por função</span>
      {admin && <button type="button" style={{ ...btn, marginLeft: "auto", padding: "5px 12px", fontSize: 12.5 }} onClick={() => setEditing("new")}>Novo time</button>}
    </div>
    {!teams.length && <div style={{ borderTop: "1px solid var(--line-faint)", padding: "18px 24px", fontSize: 13, color: "var(--fg-3)" }}>Nenhum time ainda. Crie um para filtrar os cartões por time.</div>}
    {teams.map((t) => <div key={t.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "13px var(--inset-x)", borderTop: "1px solid var(--line-faint)", flexWrap: "wrap" }}>
      <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 140 }}>{t.name}</span>
      <span style={{ height: 22, padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: 999, fontSize: 11, fontWeight: 600, background: "var(--bg-2)", color: "var(--fg-3)" }}>{TEAM_KIND[t.kind] || t.kind}</span>
      <span style={{ fontSize: 12.5, color: "var(--fg-3)", flex: 1, minWidth: "min(220px, 100%)" }}>
        {t.members.map(displayName).join(", ") || "sem membros"}{t.manager ? ` · gestor ${displayName(t.manager)}` : ""}{!t.saas ? " · todos os produtos" : ""}
      </span>
      {admin && <button type="button" style={{ ...btn, padding: "5px 12px", fontSize: 12.5 }} onClick={() => setEditing(t)}>Editar</button>}
    </div>)}
    {editing && <TeamForm saas={saas} team={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
  </section>;
}
