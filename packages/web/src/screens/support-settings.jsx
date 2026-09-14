import React from "react";
import "./tickets/tickets.css";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { Avatar, EmptyState, PrimaryButton, SecondaryButton, toast } from "../atoms.jsx";
import { Card, PageHead } from "../components/viz.jsx";
import { Info, InfoNota } from "../components/story.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { currentUser, isAdminUser } from "../lib/users.js";
import { TICKET_PRIORITIES, supportScope, noScopeHint } from "../lib/tickets.js";
import { SelectPopover } from "../components/select-popover.jsx";
import { Checkbox, HoursInput, SwitchRow } from "../components/form-controls.jsx";

// Suporte · Configurações de SLA, por produto do workspace ativo:
//   · prazos de 1ª resposta e de resolução por prioridade (em horas ÚTEIS
//     quando o expediente está ligado — a API conta em minutos);
//   · expediente, pausa do relógio, aviso antecipado e fechamento automático;
//   · categorias da fila, portal do cliente e aviso por e-mail;
//   · atendentes: quem atende qual produto. Esse é o ACL do Suporte — quem não
//     é admin só inclui/remove produtos que ele mesmo atende (a API confere).

const { useState, useEffect, useMemo, useCallback } = React;

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, "0")}h` }));
const WARN_OPTIONS = [0.5, 0.7, 0.8, 0.9].map((v) => ({ value: v, label: `com ${Math.round(v * 100)}% do prazo` }));
const CLOSE_OPTIONS = [0, 2, 3, 5, 7, 14, 30].map((d) => ({ value: d, label: d === 0 ? "nunca" : `${d} dias` }));

// div, não <label>: o seletor (Popover) dentro de label reabre a lista no clique.
// O controle desce pro pé da célula (marginTop auto): rótulo que quebra em duas
// linhas numa grade não desalinha o campo dos vizinhos.
function Field({ label, hint, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, height: "100%" }}>
      <span className="kicker">{label}{hint && <Info texto={hint} />}</span>
      <div style={{ marginTop: "auto", minWidth: 0, display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

export function SupportSettingsScreen() {
  const { version } = useData();
  const [product] = useActiveSaas();
  const saasId = product?.id || "";
  const scope = supportScope();
  const handles = scope === null || scope.includes(saasId);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState("");

  const load = useCallback(async () => {
    if (!handles || !saasId) return;
    try { const s = await api.supportSettings(saasId); setSaved(s); setDraft(s); setError(""); }
    catch (err) { setError(err.message || "erro"); }
  }, [handles, saasId]);
  useEffect(() => { setSaved(null); setDraft(null); load(); }, [load]);

  const dirty = useMemo(() => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setPolicy = (p, key, minutes) => setDraft((d) => ({ ...d, policies: { ...d.policies, [p]: { ...d.policies[p], [key]: minutes } } }));

  const save = async () => {
    setBusy(true);
    try {
      const body = { policies: draft.policies, businessHours: draft.businessHours, pauseOn: draft.pauseOn, categories: draft.categories, autoCloseResolvedDays: Number(draft.autoCloseResolvedDays) || 0, warnAt: draft.warnAt, portal: draft.portal, notifyCustomerByEmail: draft.notifyCustomerByEmail };
      const s = await api.supportSettingsSave(saasId, body);
      setSaved(s); setDraft(s);
      toast("Configurações de SLA salvas · valem para os tickets abertos ou alterados daqui em diante", "pos", 5000);
    } catch (err) {
      toast(`Não deu pra salvar · ${err.message || "tente de novo"}`, "neg", 6000);
    } finally { setBusy(false); }
  };

  const portalUrl = `${typeof location !== "undefined" ? location.origin : ""}/s/new/${saasId}`;
  const gmail = !!window.SEED?.CONFIG?.google?.gmail;

  return (
    <div className="support-page" style={{ overflowY: "auto" }}>
      <PageHead title="Configurações de SLA" sub={`suporte · ${product?.name || ""}: prazos por prioridade, expediente e quem atende`}>
        {handles && draft && (
          <>
            {dirty && <SecondaryButton onClick={() => setDraft(saved)} disabled={busy}>Descartar</SecondaryButton>}
            <PrimaryButton onClick={save} disabled={!dirty || busy}>{busy ? "Salvando…" : "Salvar"}</PrimaryButton>
          </>
        )}
      </PageHead>

      {!handles ? (
        <EmptyState title={`Você não atende ${product?.name || "este produto"}`} hint={noScopeHint(product?.name)} />
      ) : error ? (
        <div style={{ margin: "16px var(--pad-x)", padding: "12px 14px", borderRadius: "var(--r-3)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5 }}>
          Não deu pra carregar as configurações ({error}). <button type="button" onClick={load} style={{ fontWeight: 700, color: "inherit", textDecoration: "underline" }}>recarregar</button>
        </div>
      ) : !draft ? (
        <div className="mono dim" style={{ fontSize: 12, padding: "24px var(--pad-x)" }}>carregando…</div>
      ) : (
        <div className="support-settings-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 16, alignItems: "start" }}>
            <Card title="Prazos por prioridade" hint={draft.businessHours.enabled ? "em horas úteis, dentro do expediente abaixo" : "em horas corridas (expediente desligado)"}>
              <div style={{ padding: "8px var(--inset-x) 16px" }}>
                <div className="support-policy kicker" style={{ paddingTop: 4 }}>
                  <span>Prioridade</span><span>1ª resposta (h)</span><span>Resolução (h)</span>
                </div>
                {TICKET_PRIORITIES.map((p) => (
                  <div key={p.key} className="support-policy">
                    <span className="support-status" style={{ "--dot": p.tone, fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{p.label}</span>
                    <HoursInput label={`1ª resposta ${p.label} em horas`} minutes={draft.policies[p.key].firstResponseMin} onChange={(m) => setPolicy(p.key, "firstResponseMin", m)} />
                    <HoursInput label={`Resolução ${p.label} em horas`} minutes={draft.policies[p.key].resolutionMin} onChange={(m) => setPolicy(p.key, "resolutionMin", m)} />
                  </div>
                ))}
                {TICKET_PRIORITIES.some((p) => draft.policies[p.key].resolutionMin < draft.policies[p.key].firstResponseMin) && (
                  <div role="alert" style={{ fontSize: 12.5, color: "var(--neg)", marginTop: 8 }}>A resolução não pode vencer antes da 1ª resposta.</div>
                )}
              </div>
            </Card>

            <Card title="Relógio do SLA" hint="quando o prazo corre, pausa e avisa">
              <div style={{ padding: "12px var(--inset-x) 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <SwitchRow checked={draft.businessHours.enabled} onChange={(v) => set({ businessHours: { ...draft.businessHours, enabled: v } })}
                    title="Contar só no expediente" hint="segunda a sexta, no horário de Brasília; desligado, o prazo corre 24 horas" />
                </div>
                <Field label="Início do expediente">
                  <SelectPopover label="Início do expediente" value={draft.businessHours.hourStart} disabled={!draft.businessHours.enabled} options={HOUR_OPTIONS.filter((o) => o.value < 23)}
                    onChange={(v) => set({ businessHours: { ...draft.businessHours, hourStart: v, hourEnd: draft.businessHours.hourEnd > v ? draft.businessHours.hourEnd : v + 1 } })} />
                </Field>
                <Field label="Fim do expediente">
                  <SelectPopover label="Fim do expediente" value={draft.businessHours.hourEnd} disabled={!draft.businessHours.enabled} options={HOUR_OPTIONS.filter((o) => o.value > draft.businessHours.hourStart)}
                    onChange={(v) => set({ businessHours: { ...draft.businessHours, hourEnd: v } })} />
                </Field>
                <Field label="Avisar o responsável" hint="a notificação sai quando o ticket passa desta fração do prazo (em tempo útil)">
                  <SelectPopover label="Avisar o responsável" value={draft.warnAt} options={WARN_OPTIONS} onChange={(v) => set({ warnAt: v })} />
                </Field>
                <Field label="Fechar resolvidos em" hint="0 = nunca fecha sozinho; o cliente ainda pode responder um ticket resolvido e reabrir">
                  <SelectPopover label="Fechar resolvidos em" value={draft.autoCloseResolvedDays} options={CLOSE_OPTIONS} onChange={(v) => set({ autoCloseResolvedDays: v })} />
                </Field>
                <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="kicker">Pausar a resolução quando<Info texto="o tempo útil pausado empurra o prazo de resolução para frente; a 1ª resposta nunca pausa" /></span>
                  {[["pending_customer", "Aguardando cliente"], ["on_hold", "Em espera"]].map(([k, l]) => (
                    <Checkbox key={k} checked={draft.pauseOn.includes(k)}
                      onChange={(on) => set({ pauseOn: on ? [...draft.pauseOn, k] : draft.pauseOn.filter((x) => x !== k) })}>
                      o status for {l}
                    </Checkbox>
                  ))}
                </div>
              </div>
            </Card>

            <Card title="Categorias" hint="organizam a fila e o relatório futuro">
              <div style={{ padding: "12px var(--inset-x) 18px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {draft.categories.map((c) => (
                  <span key={c} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {c}
                    <button type="button" aria-label={`Remover ${c}`} onClick={() => set({ categories: draft.categories.filter((x) => x !== c) })} style={{ color: "var(--fg-4)" }}>✕</button>
                  </span>
                ))}
                <form onSubmit={(e) => { e.preventDefault(); const v = newCategory.trim(); if (v && !draft.categories.includes(v)) set({ categories: [...draft.categories, v] }); setNewCategory(""); }}
                  style={{ display: "inline-flex", gap: 6 }}>
                  <input className="inp" value={newCategory} maxLength={60} onChange={(e) => setNewCategory(e.target.value)} placeholder="nova categoria" style={{ width: 160 }} />
                  <SecondaryButton size="sm" type="submit" disabled={!newCategory.trim()}>Adicionar</SecondaryButton>
                </form>
                {draft.categories.length === 0 && <span className="mono dim" style={{ fontSize: 12 }}>sem categorias · a fila funciona sem elas</span>}
              </div>
            </Card>

            <Card title="Portal do cliente" hint="o cliente abre e acompanha o chamado sem login">
              <div style={{ padding: "12px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                <SwitchRow checked={draft.portal.enabled} onChange={(v) => set({ portal: { ...draft.portal, enabled: v } })}
                  title="Aceitar tickets novos pelo link público" hint="desligado, o link de abertura avisa que o atendimento não está disponível; os chamados já abertos seguem acessíveis" />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", opacity: draft.portal.enabled ? 1 : 0.55 }}>
                  <code className="mono support-ellipsis" title={portalUrl} style={{ fontSize: 12, height: 32, boxSizing: "border-box", display: "flex", alignItems: "center", padding: "0 10px", background: "var(--bg-inset)", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", flex: "1 1 200px" }}>{portalUrl}</code>
                  <SecondaryButton size="sm" type="button" title="Abrir o link público numa nova aba" aria-label="Abrir o link público numa nova aba"
                    onClick={() => window.open(portalUrl, "_blank", "noopener")} style={{ width: 32, padding: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                    </svg>
                  </SecondaryButton>
                  <SecondaryButton size="sm" type="button" onClick={async () => { try { await navigator.clipboard.writeText(portalUrl); toast("Link copiado", "pos"); } catch { toast(portalUrl, "neutral", 8000); } }}>Copiar</SecondaryButton>
                </div>
                <Field label="Texto de abertura do portal">
                  <textarea className="inp" rows={3} maxLength={1000} value={draft.portal.intro} onChange={(e) => set({ portal: { ...draft.portal, intro: e.target.value } })}
                    placeholder="Ex.: respondemos em até 1 dia útil. Para urgências, marque a prioridade." style={{ height: "auto", padding: "8px 10px", resize: "vertical", font: "inherit", fontSize: 13 }} />
                </Field>
                <SwitchRow checked={draft.notifyCustomerByEmail} onChange={(v) => set({ notifyCustomerByEmail: v })}
                  title="Avisar o cliente por e-mail quando a equipe responder"
                  hint={gmail ? "sai pela conta Google conectada, com o link do chamado" : "precisa da conta Google conectada com envio de e-mail (Ajustes → Integrações)"} />
                <InfoNota>Nota interna nunca aparece no portal. Anexo só aparece quando é marcado como visível ou citado numa resposta ao cliente.</InfoNota>
              </div>
            </Card>
          </div>

          <AgentsCard saasId={saasId} version={version} />
        </div>
      )}
    </div>
  );
}

// ── Atendentes ──────────────────────────────────────────────────────────────
function AgentsCard({ saasId, version }) {
  const [agents, setAgents] = useState(null);
  const [saving, setSaving] = useState("");
  const products = window.SEED?.SAAS || [];
  const myScope = supportScope();
  const admin = isAdminUser();
  const me = currentUser()?.id || "";
  useEffect(() => {
    let vivo = true;
    api.supportAgents().then((a) => { if (vivo) setAgents(a || []); }).catch((err) => { if (vivo) { setAgents([]); toast(`Não deu pra carregar os atendentes · ${err.message}`, "neg"); } });
    return () => { vivo = false; };
  }, [version]);

  const grid = `minmax(160px, 1fr) 92px repeat(${products.length}, 96px)`;
  const put = async (a, body) => {
    const before = agents;
    setSaving(a.id);
    setAgents((list) => list.map((x) => (x.id === a.id ? { ...x, ...body } : x)));
    try { const saved = await api.supportAgentSave(a.id, body); setAgents((list) => list.map((x) => (x.id === a.id ? saved : x))); }
    catch (err) { setAgents(before); toast(`Não deu pra salvar ${a.name} · ${err.message}`, "neg"); }
    finally { setSaving(""); }
  };
  const sorted = (agents || []).slice().sort((x, y) => (Number(y.support) - Number(x.support)) || String(x.name).localeCompare(String(y.name), "pt-BR"));
  const semNinguem = agents && !agents.some((a) => a.support && (a.admin || (a.supportSaas || []).includes(saasId)));

  return (
    <Card title="Atendentes" hint="quem atende qual produto · a lista é o acesso: fora dela, a pessoa não vê os tickets do produto (admin vê todos)">
      {semNinguem && (
        <div style={{ margin: "12px var(--inset-x) 0", fontSize: 12.5, color: "var(--warn)" }}>
          Ninguém com a etiqueta de atendente cuida deste produto: ticket novo sem responsável não avisa ninguém.
        </div>
      )}
      <div className="tbl-x" style={{ marginTop: 12, borderTop: "1px solid var(--line-1)" }}>
        <div style={{ minWidth: 160 + 92 + products.length * 96 + (products.length + 1) * 8 + 28 }}>
          <div className="support-agents kicker" style={{ gridTemplateColumns: grid, background: "var(--bg-inset)" }}>
            <span>Pessoa</span>
            <span style={{ textAlign: "center" }} title="recebe o aviso de ticket novo sem responsável">Atendente</span>
            {products.map((p) => <span key={p.id} style={{ textAlign: "center" }} className="support-ellipsis">{p.name}</span>)}
          </div>
          {agents === null && <div className="mono dim" style={{ padding: "12px 14px", fontSize: 12 }}>carregando…</div>}
          {sorted.map((a) => (
            <div key={a.id} className="support-agents" style={{ gridTemplateColumns: grid, opacity: saving === a.id ? 0.6 : 1 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <Avatar id={a.id} name={a.name} size={22} />
                <span className="support-ellipsis">{a.name}{a.id === me ? " (você)" : ""}</span>
                {a.admin && <span className="chip accent" title="admin vê os tickets de todos os produtos">admin</span>}
              </span>
              <span style={{ textAlign: "center" }}>
                <Checkbox label={`${a.name} é atendente`} checked={!!a.support} disabled={saving === a.id} onChange={(on) => put(a, { support: on })} />
              </span>
              {products.map((p) => {
                const allowed = admin || myScope === null || myScope.includes(p.id);
                return (
                  <span key={p.id} style={{ textAlign: "center" }} title={allowed ? "" : "você só altera os produtos que atende"}>
                    <Checkbox label={`${a.name} atende ${p.name}`} checked={a.admin || (a.supportSaas || []).includes(p.id)}
                      disabled={a.admin || !allowed || saving === a.id}
                      onChange={(on) => put(a, { supportSaas: on ? [...(a.supportSaas || []), p.id] : (a.supportSaas || []).filter((x) => x !== p.id) })} />
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
