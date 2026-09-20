import React from "react";
import "./tickets/tickets.css";
import "./support-settings.css";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { Avatar, EmptyState, PrimaryButton, SecondaryButton, toast } from "../atoms.jsx";
import { Card } from "../components/viz.jsx";
import { Info, InfoNota } from "../components/story.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { currentUser, isAdminUser } from "../lib/users.js";
import { TICKET_PRIORITIES, TICKET_STATUSES, supportScope, noScopeHint } from "../lib/tickets.js";
import { SelectPopover } from "../components/select-popover.jsx";
import { Checkbox, HoursInput, SwitchRow } from "../components/form-controls.jsx";

// Suporte · Configurações de SLA, por produto do workspace ativo:
//   · prazos de 1ª resposta e de resolução por prioridade (em horas ÚTEIS
//     quando o expediente está ligado — a API conta em minutos);
//   · expediente, pausa do relógio, aviso antecipado e fechamento automático;
//   · categorias da fila, portal do cliente e aviso por e-mail;
//   · atendentes: quem atende qual produto. Esse é o ACL do Suporte — quem não
//     é admin só inclui/remove produtos que ele mesmo atende (a API confere).

const { useState, useEffect, useMemo, useCallback, useRef } = React;

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
  const [saveError, setSaveError] = useState("");
  const request = useRef(0), pending = useRef(false), productRef = useRef(saasId);
  productRef.current = saasId;

  const load = useCallback(async () => {
    if (!handles || !saasId || productRef.current !== saasId) return;
    const id = ++request.current;
    try { const s = await api.supportSettings(saasId); if (id === request.current) { setSaved(s); setDraft(s); setError(""); } }
    catch (err) { if (id === request.current) setError(err.message || "erro"); }
  }, [handles, saasId]);
  useEffect(() => { setSaved(null); setDraft(null); setError(""); setSaveError(""); setNewCategory(""); load(); return () => { request.current++; }; }, [load]);

  const dirty = useMemo(() => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const set = (patch) => { if (!pending.current) setDraft((d) => ({ ...d, ...patch })); };
  const setPolicy = (p, key, minutes) => { if (!pending.current) setDraft((d) => ({ ...d, policies: { ...d.policies, [p]: { ...d.policies[p], [key]: minutes } } })); };
  const invalidPolicy = !!draft && TICKET_PRIORITIES.some(p => draft.policies[p.key].resolutionMin < draft.policies[p.key].firstResponseMin);

  const save = async () => {
    if (pending.current || !dirty || invalidPolicy) return;
    pending.current = true; setBusy(true); setSaveError("");
    try {
      const body = { policies: draft.policies, businessHours: draft.businessHours, pauseOn: draft.pauseOn, categories: draft.categories, autoCloseResolvedDays: Number(draft.autoCloseResolvedDays) || 0, warnAt: draft.warnAt, portal: draft.portal, notifyCustomerByEmail: draft.notifyCustomerByEmail, linear: draft.linear };
      // `queued` é recibo da resposta (quantos tickets foram pra fila do
      // Linear), não configuração: fora do que compara rascunho x salvo.
      const { queued, ...s } = await api.supportSettingsSave(saasId, body);
      if (productRef.current !== saasId) return;
      setSaved(s); setDraft(s);
      toast(queued
        ? `Configurações salvas · ${queued} ticket${queued > 1 ? "s abertos entraram" : " aberto entrou"} na fila do Linear`
        : "Configurações de SLA salvas · valem para os tickets abertos ou alterados daqui em diante", "pos", 5000);
    } catch (err) {
      if (productRef.current === saasId) setSaveError(`Não deu para salvar · ${err.message || "tente de novo"}`);
    } finally { pending.current = false; setBusy(false); }
  };

  const portalUrl = `${typeof location !== "undefined" ? location.origin : ""}/s/new/${saasId}`;
  const gmail = !!window.SEED?.CONFIG?.google?.gmail;

  return (
    <div className="support-page sla-page">
      <header className="sla-page-head"><h1>Configurações de SLA</h1><div className="sla-head-actions">
        {handles && draft && (
          <>
            {dirty && <span className="sla-dirty">alterações não salvas</span>}
            {dirty && <SecondaryButton onClick={() => { setDraft(saved); setNewCategory(""); setSaveError(""); }} disabled={busy}>Descartar</SecondaryButton>}
            <PrimaryButton onClick={save} disabled={!dirty || busy || invalidPolicy} style={!dirty ? {background:"var(--bg-2)",color:"var(--fg-4)",borderColor:"transparent",opacity:1} : undefined}>{busy ? "Salvando…" : dirty ? "Salvar" : "Tudo salvo"}</PrimaryButton>
          </>
        )}
      </div></header>
      {saveError && <div role="alert" className="sla-error">{saveError}. O preenchimento foi mantido; tente Salvar novamente.</div>}

      {!handles ? (
        <EmptyState title={`Você não atende ${product?.name || "este produto"}`} hint={noScopeHint(product?.name)} />
      ) : error ? (
        <div role="alert" style={{ margin: "16px var(--pad-x)", padding: "12px 14px", borderRadius: "var(--r-3)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5 }}>
          Não deu pra carregar as configurações ({error}). <button type="button" onClick={load} style={{ fontWeight: 700, color: "inherit", textDecoration: "underline" }}>recarregar</button>
        </div>
      ) : !draft ? (
        <div className="mono dim" style={{ fontSize: 12, padding: "24px var(--pad-x)" }}>carregando…</div>
      ) : (
        <div className="support-settings-body">
          <fieldset className="sla-cols" disabled={busy}>
            <Card title="Prazos por prioridade" hint={draft.businessHours.enabled ? "em horas úteis, dentro do expediente abaixo" : "em horas corridas (expediente desligado)"}>
              <div style={{ padding: "8px var(--inset-x) 16px" }}>
                <div className="support-policy kicker" style={{ paddingTop: 4 }}>
                  <span>Prioridade</span><span>1ª resposta</span><span>Resolução</span>
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
                  <input className="inp" aria-label="Nova categoria" value={newCategory} maxLength={60} onChange={(e) => setNewCategory(e.target.value)} placeholder="nova categoria" style={{ width: 160 }} />
                  <SecondaryButton size="sm" type="submit" disabled={!newCategory.trim()}>Adicionar</SecondaryButton>
                </form>
                {draft.categories.length === 0 && <span className="mono dim" style={{ fontSize: 12 }}>sem categorias · a fila funciona sem elas</span>}
              </div>
            </Card>

            <Card title="Relógio do SLA" hint="quando o prazo corre, pausa e avisa">
              <div style={{ padding: "12px var(--inset-x) 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <SwitchRow disabled={busy} checked={draft.businessHours.enabled} onChange={(v) => set({ businessHours: { ...draft.businessHours, enabled: v } })}
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

            <Card title="Portal do cliente" hint="o cliente abre e acompanha o chamado sem login">
              <div style={{ padding: "12px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                <SwitchRow disabled={busy} checked={draft.portal.enabled} onChange={(v) => set({ portal: { ...draft.portal, enabled: v } })}
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
                  <textarea className="inp" aria-label="Texto de abertura do portal" rows={3} maxLength={1000} value={draft.portal.intro} onChange={(e) => set({ portal: { ...draft.portal, intro: e.target.value } })}
                    placeholder="Ex.: respondemos em até 1 dia útil. Para urgências, marque a prioridade." style={{ height: "auto", padding: "8px 10px", resize: "vertical", font: "inherit", fontSize: 13 }} />
                </Field>
                <SwitchRow disabled={busy} checked={draft.notifyCustomerByEmail} onChange={(v) => set({ notifyCustomerByEmail: v })}
                  title="Avisar o cliente por e-mail quando a equipe responder"
                  hint={gmail ? "sai pela conta Google conectada, com o link do chamado" : "precisa da conta Google conectada com envio de e-mail (Ajustes → Integrações)"} />
                <InfoNota>Nota interna nunca aparece no portal. Anexo só aparece quando é marcado como visível ou citado numa resposta ao cliente.</InfoNota>
              </div>
            </Card>

          </fieldset>
          <AgentsCard saasId={saasId} version={version} />
          <fieldset className="sla-integration" disabled={busy}><LinearCard draft={draft} set={set} disabled={busy} /></fieldset>
        </div>
      )}
    </div>
  );
}

// ── Linear ──────────────────────────────────────────────────────────────────
// O espelho é AUTOMÁTICO: ligado aqui, todo ticket deste produto vira issue no
// time/projeto escolhido e cada mensagem vira comentário. De volta, a coluna da
// issue move o status do ticket e o comentário do dev entra como nota interna.
// Ligar (ou trocar de projeto) manda os tickets ABERTOS pra fila; os já
// encerrados ficam de fora — arquivo de suporte não vira backlog do time.
const MESSAGE_MODES = [
  { value: "all", label: "respostas e notas internas" },
  { value: "public", label: "só as respostas ao cliente" },
  { value: "none", label: "nenhuma (só o ticket)" },
];
// De-para de volta pelo TIPO da coluna: cada time batiza as colunas como quer.
const STATE_BACK_ROWS = [
  ["completed", "Concluída (Done)"],
  ["canceled", "Cancelada"],
  ["started", "Em andamento"],
  ["duplicate", "Duplicada"],
];
const STATUS_OPTIONS = [{ value: "", label: "não mexer no ticket", color: "var(--fg-3)" },
  ...TICKET_STATUSES.map((s) => ({ value: s.key, label: s.label, tone: s.tone }))];

function LinearCard({ draft, set, disabled }) {
  const [catalog, setCatalog] = useState(null);
  const [erro, setErro] = useState("");
  const [attempt, setAttempt] = useState(0);
  const l = draft.linear || {};
  useEffect(() => {
    let vivo = true;
    setErro("");
    api.linearCatalog().then((c) => { if (vivo) setCatalog(c); }).catch((err) => { if (vivo) setErro(err.message || "erro"); });
    return () => { vivo = false; };
  }, [attempt]);
  const setL = (patch) => set({ linear: { ...l, ...patch } });
  const teams = catalog?.teams || [];
  const team = teams.find((t) => t.id === l.teamId) || null;
  const webhookUrl = `${typeof location !== "undefined" ? location.origin : ""}/api/webhooks/linear`;

  return (
    <Card title="Linear" hint="espelho dos tickets deste produto com as issues do time">
      <div style={{ padding: "12px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {erro && <div role="alert" className="sla-error">Não deu para carregar o catálogo do Linear. <button onClick={() => setAttempt(n => n + 1)}>Tentar novamente</button></div>}
        {catalog === null && !erro && <div className="mono dim" style={{ fontSize: 12 }}>carregando o catálogo do Linear…</div>}
        {catalog && !catalog.configured && (
          <div style={{ fontSize: 12.5, color: "var(--warn)" }}>
            Falta a chave da API do Linear no servidor (<code className="mono">LINEAR_API_KEY</code>). Sem ela, o espelho fica desligado.{erro ? ` · ${erro}` : ""}
          </div>
        )}
        {catalog?.configured && (
          <>
            <SwitchRow disabled={disabled} checked={l.enabled === true} onChange={(v) => setL({ enabled: v })}
              title="Espelhar os tickets deste produto no Linear"
              hint={catalog.organization ? `conectado em ${catalog.organization}${catalog.viewer ? ` como ${catalog.viewer}` : ""}` : "todo ticket novo vira issue; ao ligar, os tickets abertos entram na fila"} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, opacity: l.enabled ? 1 : 0.55 }}>
              <Field label="Time">
                <SelectPopover label="Time do Linear" value={l.teamId || ""} disabled={!l.enabled}
                  options={[{ value: "", label: "escolha o time", color: "var(--fg-3)" }, ...teams.map((t) => ({ value: t.id, label: `${t.key} · ${t.name}` }))]}
                  onChange={(v) => setL({ teamId: v, teamKey: teams.find((t) => t.id === v)?.key || "", teamName: teams.find((t) => t.id === v)?.name || "", projectId: "", projectName: "" })} />
              </Field>
              <Field label="Projeto" hint="onde os tickets deste produto vão parar; sem projeto, a issue nasce solta no time">
                <SelectPopover label="Projeto do Linear" value={l.projectId || ""} disabled={!l.enabled || !team}
                  options={[{ value: "", label: "sem projeto", color: "var(--fg-3)" }, ...(team?.projects || []).map((p) => ({ value: p.id, label: p.name }))]}
                  onChange={(v) => setL({ projectId: v, projectName: (team?.projects || []).find((p) => p.id === v)?.name || "" })} />
              </Field>
              <Field label="Mandar pro Linear" hint="a mensagem do cliente e a da equipe viram comentário na issue">
                <SelectPopover label="Mensagens espelhadas" value={l.mirrorMessages || "all"} disabled={!l.enabled} options={MESSAGE_MODES}
                  onChange={(v) => setL({ mirrorMessages: v })} />
              </Field>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: l.enabled ? 1 : 0.55 }}>
              <span className="kicker">Quando a issue muda de coluna no Linear<Info texto="o de-para é pelo tipo da coluna (Done, Canceled, In Progress), então vale para qualquer nome que o time use" /></span>
              {STATE_BACK_ROWS.map(([type, label]) => (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--fg-3)" }}>
                  <span style={{ width: 150, flexShrink: 0 }}>{label}</span>
                  <span style={{ flex: 1, maxWidth: 260 }}>
                    <SelectPopover size="sm" label={`Status do ticket quando a issue fica ${label}`} disabled={!l.enabled}
                      value={l.stateBack?.[type] || ""} options={STATUS_OPTIONS}
                      onChange={(v) => setL({ stateBack: { ...(l.stateBack || {}), [type]: v } })} />
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, opacity: l.enabled ? 1 : 0.55 }}>
              <Checkbox checked={l.syncPriority !== false} disabled={!l.enabled} onChange={(v) => setL({ syncPriority: v })}>
                espelhar a prioridade nos dois sentidos
              </Checkbox>
              <Checkbox checked={l.syncStatus !== false} disabled={!l.enabled} onChange={(v) => setL({ syncStatus: v })}>
                concluir o ticket move a issue para a coluna de concluído
              </Checkbox>
              <Checkbox checked={l.titleBack !== false} disabled={!l.enabled} onChange={(v) => setL({ titleBack: v })}>
                título editado no Linear renomeia o ticket
              </Checkbox>
            </div>
            <InfoNota>
              Para o Linear avisar o cockpit na hora, cadastre <code className="mono">{webhookUrl}</code> em Settings → API → Webhooks, com os eventos <b>Issues</b> e <b>Comments</b>.
              {catalog.webhook ? " O segredo do webhook já está configurado no servidor." : " Falta o segredo no servidor (LINEAR_WEBHOOK_SECRET) — sem ele a rota recusa, e a volta só chega na reconciliação."}
              {" "}Comentário do dev vira aviso no ticket e aparece na aba Linear — nunca no portal do cliente.
            </InfoNota>
          </>
        )}
      </div>
    </Card>
  );
}

// ── Atendentes ──────────────────────────────────────────────────────────────
function AgentsCard({ saasId, version }) {
  const [agents, setAgents] = useState(null);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);
  const products = window.SEED?.SAAS || [];
  const myScope = supportScope();
  const admin = isAdminUser();
  const me = currentUser()?.id || "";
  useEffect(() => {
    let vivo = true;
    api.supportAgents().then((a) => { if (vivo && !pending.current) { setAgents(a || []); setError(""); } }).catch((err) => { if (vivo) setError(`Não deu para carregar os atendentes · ${err.message}`); });
    return () => { vivo = false; };
  }, [version, attempt]);

  const put = async (a, body) => {
    if (pending.current) return;
    pending.current = true;
    const before = agents;
    setSaving(a.id);
    setAgents((list) => list.map((x) => (x.id === a.id ? { ...x, ...body } : x)));
    try { const saved = await api.supportAgentSave(a.id, body); setAgents((list) => list.map((x) => (x.id === a.id ? saved : x))); }
    catch (err) { setAgents(before); toast(`Não deu pra salvar ${a.name} · ${err.message}`, "neg"); }
    finally { pending.current = false; setSaving(""); }
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
      {error && <div role="alert" className="sla-error">{error} <button onClick={() => setAttempt(n => n + 1)}>Tentar novamente</button></div>}
      <div className="sla-agents">
        {agents === null && !error && <div className="dim" style={{fontSize:12}}>Carregando atendentes…</div>}
        {sorted.map(a => <div key={a.id} className="sla-agent" aria-busy={saving === a.id}>
          <Avatar id={a.id} name={a.name} size={32}/>
          <div className="sla-agent-who"><div>{a.name}{a.id === me ? " (você)" : ""}</div><span>{a.admin ? "Admin · todos os produtos" : a.support ? "Atendente" : "Equipe"}</span></div>
          <div className="sla-agent-products">{products.map(p => {
            const allowed = admin || myScope === null || myScope.includes(p.id);
            return <button key={p.id} type="button" aria-label={`${a.name} atende ${p.name}`} aria-pressed={a.admin || (a.supportSaas || []).includes(p.id)} disabled={a.admin || !allowed || !!saving}
              title={a.admin ? "Admin acessa todos os produtos" : allowed ? "Alterar acesso aos tickets do produto" : "Você só altera os produtos que atende"}
              onClick={() => put(a,{supportSaas:(a.supportSaas || []).includes(p.id) ? (a.supportSaas || []).filter(x => x !== p.id) : [...(a.supportSaas || []),p.id]})}>{p.name}</button>;
          })}</div>
          <span className="sla-agent-notify"><Checkbox label={`${a.name} é atendente`} checked={!!a.support} disabled={!!saving} onChange={on => put(a,{support:on})}/><span>Atendente · recebe avisos</span></span>
          {saving === a.id && <span className="dim" style={{fontSize:11}}>Salvando…</span>}
        </div>)}
        {agents?.length === 0 && !error && <div className="dim" style={{fontSize:12}}>Nenhum atendente disponível.</div>}
      </div>
    </Card>
  );
}
