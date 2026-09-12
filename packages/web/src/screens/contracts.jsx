import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState, PrimaryButton, SecondaryButton, CardHead, MoreMenu, useEsc, toast } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { currentUser, displayName } from "../lib/users.js";
import { fieldsOf, fullHtml, printContract, downloadContract, contractClientName, issueDate, byIssuedDesc } from "../lib/contracts.js";

// Contratos — biblioteca de MODELOS por produto. O fluxo é "resgatar": abrir o
// modelo, PREENCHER os dados do cliente no formulário do drawer (os campos vêm
// dos tokens {{chave}} do corpo) e imprimir/salvar em PDF já preenchido, ou
// baixar o .html. Campo vazio imprime como linha em branco (preenche à mão).
// O corpo é o MIOLO em HTML; a impressão veste o CSS jurídico padrão (A4,
// serifa), o mesmo do contrato original de assinatura da LeverAds.
//
// Controle do que SAIU: gerar o contrato de um cliente (imprimir, baixar ou
// copiar) grava sozinho um registro no histórico — snapshot do modelo preenchido
// (corpo + campos + valores) preso ao cliente. O modelo pode evoluir; o registro
// reimprime o papel que foi assinado. O mesmo histórico aparece na ficha do
// cliente (tela Clientes), filtrado por ele.

const { useState: useS, useEffect: useE, useRef: useR } = React;

// ── Orçamento de largura (mesma régua de Clientes/Pipeline/Propostas) ─────
// 1024px de janela menos nav, pad-x e padding do cartão sobram 716px: a soma
// dos PISOS + gaps das duas tabelas tem que caber aí (o smoke-ssr confere).
export const MODEL_GRID = "minmax(150px,1.4fr) 100px 76px minmax(120px,1fr) 180px";
export const HIST_GRID = "104px minmax(130px,1.3fr) minmax(120px,1fr) 100px 176px";
export const GRID_GAP = 12;
export const GRID_BUDGET = 716;

// Hora do registro. issueDate dá o dia ("16 ago 26") e é o carimbo compartilhado
// com a ficha do cliente; na tabela do histórico a hora separa dois contratos do
// mesmo cliente no mesmo dia.
const issueHour = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
};

// Esqueleto de um modelo novo: cabeçalho + quadro resumo mínimo, pro time não
// começar do zero.
const NEW_BODY = `<h1>Título do contrato</h1>
<p class="subtitle">Subtítulo · Lever Ads Software House LTDA</p>

<h2>Quadro Resumo</h2>
<table class="quadro">
  <tr><th>Contratada</th><td><strong>LEVER ADS SOFTWARE HOUSE LTDA</strong>, CNPJ <strong>67.931.740/0001-12</strong>, Avenida Itamarati, 2800, Parque Erasmo Assunção, CEP 09271-410, Santo André/SP.</td></tr>
  <tr><th>Contratante</th><td>Razão social / Nome: {{razao_social}}<br>CNPJ / CPF: {{cnpj_cpf}}</td></tr>
  <tr><th>Investimento</th><td>Valor total: R$ {{valor_total}} · Forma de pagamento: {{forma_pagamento}}</td></tr>
</table>

<h2>Cláusula 1ª · Objeto</h2>
<p><strong>1.1.</strong> Descreva aqui o objeto do contrato.</p>`;

// Viewer somente-leitura de um contrato GERADO (componente próprio pro
// useEsc montar/desmontar junto). Sem formulário → backdrop e Esc fecham.
function IssueViewer({ issue, btn, onClose, onPrint, onRemove }) {
  useEsc(onClose);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", display: "flex", justifyContent: "flex-end", zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(860px, 100vw)", height: "100%", background: "var(--bg-1)", borderLeft: "1px solid var(--line-2)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-pop)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="kicker">Contrato gerado{issue.createdAt ? ` · ${issueDate(issue.createdAt)}` : ""}{issue.author ? ` · ${displayName(issue.author)}` : ""}</div>
            <div style={{ fontSize: 17, fontWeight: 500, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {issue.customerName || "sem cliente"} · {issue.name}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <button onClick={onPrint} style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", borderColor: "transparent" }}>Imprimir / PDF</button>
            <button onClick={onRemove} className="dim" style={{ ...btn, color: "var(--neg)" }}>Excluir registro</button>
            <button onClick={onClose} className="mono dim" style={{ fontSize: 16, padding: "0 4px" }}>✕</button>
          </div>
        </div>
        <iframe title={issue.name} srcDoc={fullHtml(issue, issue.values)} style={{ flex: 1, border: 0, background: "#fff" }} />
      </div>
    </div>
  );
}

function ContractsScreen() {
  const [product] = useActiveSaas();
  const [items, setItems] = useS(null);
  const [err, setErr] = useS(null);
  const [sel, setSel] = useS(null);      // modelo aberto (visualização)
  const [edit, setEdit] = useS(false);   // drawer em modo edição
  const [draft, setDraft] = useS(null);  // { name, tag, note, body }
  const [fill, setFill] = useS({});      // valores digitados dos campos {{token}} do modelo aberto
  const [busy, setBusy] = useS(false);
  // Histórico de contratos GERADOS: cada geração grava um snapshot do modelo
  // preenchido (corpo + campos + valores) preso ao cliente — o modelo pode
  // evoluir, o registro reimprime o que foi para a assinatura.
  const [issues, setIssues] = useS(null);
  const [issuesErr, setIssuesErr] = useS(false); // histórico não carregou (≠ histórico vazio)
  const [issueQ, setIssueQ] = useS("");       // busca do histórico (cliente/modelo/etiqueta)
  const [issuesAll, setIssuesAll] = useS(false); // histórico cortado em 12 · "+N"
  const [issueSel, setIssueSel] = useS(null); // registro aberto (viewer somente-leitura)
  const [custId, setCustId] = useS("");       // cliente vinculado no preenchimento
  const [confirmed, setConfirmed] = useS(false);
  const customers = (window.SEED?.CUSTOMERS || []).filter((c) => !product?.id || c.saas === product.id);
  const [copied, setCopied] = useS(false);
  const [maisCampos, setMaisCampos] = useS(false); // quadro resumo longo: "+N campos ▾"
  const copyTimer = useR(null);
  // Assinatura do último registro gravado nesta sessão do drawer (modelo +
  // cliente + valores): imprimir duas vezes o MESMO contrato não vira duas
  // linhas no histórico; mudou um campo, é outro papel e entra de novo.
  const lastIssueKey = useR("");

  async function load() {
    try {
      const all = await api.list("contracts");
      setItems((all || []).filter((c) => !c.saas || c.saas === product?.id));
    } catch (e) { setErr(e.message); }
    // O histórico carrega em separado: se ele falhar, a biblioteca de modelos
    // continua de pé — e a falha NÃO pode virar "nenhum contrato gerado".
    try {
      const hist = await api.list("contract_issues");
      setIssues((hist || []).filter((c) => !c.saas || c.saas === product?.id).sort(byIssuedDesc));
      setIssuesErr(false);
    } catch (e) {
      console.warn("histórico de contratos não carregou:", e.message);
      setIssues([]);
      setIssuesErr(true);
    }
  }
  // Trocar de produto zera a tela INTEIRA (inclusive a busca do histórico: o
  // filtro de um produto não faz sentido no outro).
  useE(() => { setItems(null); setIssues(null); setIssueQ(""); setIssuesAll(false); setErr(null); setSel(null); setEdit(false); load(); }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEsc(sel ? () => { setSel(null); setEdit(false); } : null); // drawer fecha no Esc
  function openView(c) { setSel(c); setEdit(false); setDraft(null); setFill({}); setCustId(""); setConfirmed(false); setIssueSel(null); setMaisCampos(false); lastIssueKey.current = ""; }

  // Vincular o cliente preenche os campos ÓBVIOS que ainda estão vazios (nome,
  // e-mail, WhatsApp, representante) — o que você já digitou não é sobrescrito.
  function pickCustomer(c, id) {
    setCustId(id);
    const cust = customers.find((x) => x.id === id);
    if (!cust) return;
    const keys = new Set(fieldsOf(c).map((f) => f.key));
    const sugestao = {
      razao_social: cust.name || "", representante: cust.contact || "",
      email: cust.email || "", whatsapp: cust.phone || "",
    };
    setFill((v) => {
      const next = { ...v };
      for (const [k, val] of Object.entries(sugestao)) {
        if (keys.has(k) && val && !String(next[k] || "").trim()) next[k] = val;
      }
      return next;
    });
  }

  // Cliente do preenchimento: o vínculo escolhido no select ou, sem vínculo, a
  // razão social digitada. Sem nenhum dos dois não há registro — histórico sem
  // dono não serve de controle.
  const fillCustomer = customers.find((x) => x.id === custId) || null;
  const fillClient = contractClientName(fillCustomer, fill);

  // Registra o contrato GERADO: snapshot completo (corpo + campos + valores)
  // preso ao cliente. Roda no ato de gerar e no botão de registrar sem imprimir.
  // Repetir a MESMA geração é no-op (a assinatura já está no histórico).
  async function registerIssue(c) {
    if (!c || !fillClient) return;
    const key = JSON.stringify([c.id, fillCustomer?.id || fillClient, fill]);
    if (lastIssueKey.current === key) { setConfirmed(true); return; }
    lastIssueKey.current = key;
    setBusy(true);
    try {
      await api.create("contract_issues", {
        saas: product?.id || "", contract: c.id, name: c.name || "", tag: c.tag || "",
        customerId: fillCustomer?.id || "", customerName: fillClient,
        values: { ...fill }, fields: fieldsOf(c), body: c.body || "",
        author: currentUser()?.id || "", createdAt: new Date().toISOString(),
      });
      setConfirmed(true);
      toast(`Contrato registrado no histórico de ${fillClient}`, "pos");
      await load();
    } catch (e) {
      lastIssueKey.current = ""; // falhou: a próxima geração tenta de novo
      setErr(e.message);
      toast("O contrato gerado não entrou no histórico · tente de novo", "neg");
    }
    setBusy(false);
  }

  async function removeIssue(i) {
    if (!window.confirm(`Excluir o registro "${i.name} · ${i.customerName}"? O contrato sai do histórico do cliente e o histórico não guarda cópia.`)) return;
    setBusy(true);
    try {
      setIssueSel(null);
      await api.remove("contract_issues", i.id);
      await load();
      toast("Registro excluído do histórico", "pos");
    } catch (e) { setErr(e.message); toast("O registro não foi excluído · tente de novo", "neg"); }
    setBusy(false);
  }
  function openEdit(c) { setSel(c); setEdit(true); setDraft({ name: c.name || "", tag: c.tag || "", note: c.note || "", body: c.body || "" }); }
  function openNew() { setSel(null); setEdit(true); setDraft({ name: "", tag: "", note: "", body: NEW_BODY }); }
  function close() { setSel(null); setEdit(false); setDraft(null); }

  async function saveDraft() {
    if (!draft?.name?.trim()) return;
    setBusy(true);
    try {
      const payload = { ...draft, name: draft.name.trim(), saas: product?.id || "", updatedAt: new Date().toISOString() };
      if (sel?.id) await api.update("contracts", sel.id, payload);
      else await api.create("contracts", payload);
      close();
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function duplicate(c) {
    setBusy(true);
    try {
      await api.create("contracts", { name: `${c.name} (cópia)`, tag: c.tag || "", note: c.note || "", body: c.body || "", saas: product?.id || "", updatedAt: new Date().toISOString() });
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function remove(c) {
    if (!window.confirm(`Excluir o modelo "${c.name}"? Essa ação não tem volta.`)) return;
    setBusy(true);
    try { await api.remove("contracts", c.id); close(); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  // Gerar o contrato do drawer = o papel SAIU pro cliente: imprime/baixa/copia
  // na hora (o window.open precisa acontecer dentro do clique, senão o navegador
  // barra) e, logo depois, o registro entra no histórico sozinho. Imprimir o
  // MODELO em branco pelo card da biblioteca não gera registro — não é contrato
  // de ninguém ainda.
  function printOnly(c, values) {
    const ok = printContract(c, values);
    if (!ok) toast("O navegador bloqueou a janela de impressão · libere o popup deste site", "neg");
    return ok;
  }
  const printTemplate = (c) => printOnly(c, {});    // modelo em branco, sem cliente
  const printIssue = (i) => printOnly(i, i.values); // reimpressão do que já está no histórico

  function generate(c, how) {
    if (how === "print" && !printOnly(c, fill)) return;
    if (how === "download") downloadContract(c, fill);
    registerIssue(c);
  }

  async function copyHtml(c, values) {
    try { await navigator.clipboard.writeText(fullHtml(c, values)); } catch { /* clipboard bloqueado */ }
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
    registerIssue(c);
  }
  const btn = { height: 32, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", boxShadow: "var(--shadow-1)" };
  // Os três passos do preenchimento (1 cliente · 2 quadro resumo · 3 gerar).
  // Eram um parágrafo de instruções no PÉ da tela, longe de onde a ação
  // acontece; agora são o cabeçalho do drawer e marcam onde você está.
  const selFields = sel && !edit ? fieldsOf(sel) : [];
  const selDone = selFields.filter((f) => String(fill[f.key] || "").trim()).length;
  const passo = !fillClient ? 1 : selDone < selFields.length ? 2 : 3;
  const PASSOS = [[1, "cliente"], [2, "quadro resumo"], [3, "gerar"]];
  const inp = { width: "100%", height: 34, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Contratos" sub="modelos prontos · resgate, preencha o Quadro Resumo e mande assinar">
        <PrimaryButton onClick={openNew}>+ novo modelo</PrimaryButton>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        {!items && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando modelos…</div>}

        {items && items.length === 0 && (
          <div style={{ minHeight: 240, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
            <EmptyState title="Nenhum modelo ainda" hint="Crie o primeiro modelo de contrato deste produto." action={<PrimaryButton onClick={openNew}>+ novo modelo</PrimaryButton>} />
          </div>
        )}

        {/* Modelos em LINHAS. Em cards, "Imprimir em branco" (que de propósito
            NÃO registra nada) tinha o mesmo peso de "Abrir": agora a linha tem
            uma ação primária só, "usar →", e o resto mora no ⋯. */}
        {items && items.length > 0 && (
          <section style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
            <div style={{ padding: "18px var(--inset-x) 12px" }}>
              <h3 className="card-title" style={{ margin: 0 }}>Modelos</h3>
              <div className="card-sub" style={{ marginTop: 3 }}>abra o modelo, escolha o cliente e preencha o Quadro Resumo</div>
            </div>
            <div className="tbl-x">
              <div>
                <div className="kicker" style={{ display: "grid", gridTemplateColumns: MODEL_GRID, gap: GRID_GAP, padding: "8px var(--inset-x)", fontWeight: 600, background: "var(--bg-inset)", borderTop: "1px solid var(--line-1)" }}>
                  <span>Modelo</span><span>Etiqueta</span><span style={{ textAlign: "right" }}>Gerados</span><span>Último</span><span style={{ textAlign: "right" }}>Ação</span>
                </div>
                {items.map((c) => {
                  const nCampos = fieldsOf(c).length;
                  const gerados = (issues || []).filter((i) => i.contract === c.id);
                  const ultimo = gerados[0] || null; // issues já vem do mais novo pro mais antigo
                  return (
                    <div key={c.id} style={{ display: "grid", gridTemplateColumns: MODEL_GRID, gap: GRID_GAP, padding: "12px var(--inset-x)", alignItems: "center", borderTop: "1px solid var(--line-faint)" }}>
                      <div style={{ minWidth: 0 }}>
                        <button onClick={() => openView(c)} title={c.note || "abrir o modelo"}
                          style={{ display: "block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 650, fontFamily: "var(--display)", letterSpacing: "-.01em", color: "var(--fg-1)", textAlign: "left" }}>
                          {c.name}
                        </button>
                        <div style={{ fontSize: 11.5, color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {`${nCampos} ${nCampos === 1 ? "campo" : "campos"} no Quadro Resumo${c.note ? ` · ${c.note}` : ""}`}
                        </div>
                      </div>
                      <span style={{ minWidth: 0 }}>{c.tag ? <span className="chip accent" style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" }}>{c.tag}</span> : <span className="mono dim" style={{ fontSize: 11 }}>—</span>}</span>
                      <span className="tnum" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600, color: gerados.length ? "var(--fg-1)" : "var(--fg-4)" }}>{gerados.length}</span>
                      <span style={{ minWidth: 0, fontSize: 12, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ultimo ? `${ultimo.customerName || "sem cliente"} · ${issueDate(ultimo.createdAt)}` : <span className="mono dim">nunca usado</span>}
                      </span>
                      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                        <button onClick={() => openView(c)} style={{ ...btn, height: 28, padding: "0 11px", background: "var(--btn-bg)", color: "var(--btn-fg)", borderColor: "transparent" }}>usar →</button>
                        <button onClick={() => openEdit(c)} style={{ ...btn, height: 28, padding: "0 10px", fontWeight: 500 }}>editar</button>
                        <MoreMenu items={[
                          { label: "imprimir em branco (não registra)", onClick: () => printTemplate(c) },
                          { label: "duplicar modelo", onClick: () => duplicate(c) },
                          { label: "excluir modelo", tone: "neg", onClick: () => remove(c) },
                        ]} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Histórico do produto: o que JÁ SAIU pra assinatura, do mais novo pro
            mais antigo. A MESMA lista aparece na ficha do cliente (tela
            Clientes) filtrada por ele — aqui é a visão do produto inteiro. */}
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "20px var(--inset-x)" }}>
          <CardHead
            kicker="Histórico" accent
            title="Contratos gerados"
            sub="imprimir, baixar ou copiar um modelo preenchido registra o contrato aqui, preso ao cliente"
            meta={issues && issues.length > 0 ? (
              <input className="inp" value={issueQ} aria-label="Buscar no histórico de contratos"
                onChange={(e) => { setIssueQ(e.target.value); setIssuesAll(false); }}
                placeholder="buscar cliente ou modelo" style={{ width: "min(230px, 44vw)" }} />
            ) : null}
          />

          {issues === null && <div className="mono dim" style={{ fontSize: 12, marginTop: 12 }}>carregando histórico…</div>}
          {issuesErr && (
            <div style={{ fontSize: 12.5, color: "var(--neg)", marginTop: 12 }}>
              Não deu pra carregar o histórico de contratos · recarregue a página pra tentar de novo.
            </div>
          )}
          {issues && !issuesErr && issues.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5, marginTop: 12 }}>
              Nenhum contrato gerado ainda neste produto. Abra um modelo, escolha o cliente, preencha o Quadro Resumo e imprima — o registro entra aqui sozinho.
            </div>
          )}

          {issues && issues.length > 0 && (() => {
            const q = issueQ.trim().toLowerCase();
            const hit = (i) => !q || [i.customerName, i.name, i.tag, displayName(i.author)]
              .some((s) => String(s || "").toLowerCase().includes(q));
            const found = issues.filter(hit);
            const shown = issuesAll ? found : found.slice(0, 12);
            return (
              <div style={{ marginTop: 12 }}>
                <div className="kicker" style={{ marginBottom: 4 }}>
                  {found.length === issues.length
                    ? `${issues.length} ${issues.length === 1 ? "contrato" : "contratos"}`
                    : `${found.length} de ${issues.length}`}
                </div>
                {found.length === 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 0" }}>
                    <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>Nenhum contrato para “{issueQ.trim()}”.</span>
                    <SecondaryButton size="sm" onClick={() => setIssueQ("")}>limpar busca</SecondaryButton>
                  </div>
                )}
                {found.length > 0 && (
                  <div className="tbl-x">
                    <div>
                      <div className="kicker" style={{ display: "grid", gridTemplateColumns: HIST_GRID, gap: GRID_GAP, padding: "8px 0", fontWeight: 600, borderTop: "1px solid var(--line-1)" }}>
                        <span>Quando</span><span>Cliente</span><span>Modelo</span><span>Gerado por</span><span style={{ textAlign: "right" }}>Ação</span>
                      </div>
                      {shown.map((i) => (
                        <div key={i.id} style={{ display: "grid", gridTemplateColumns: HIST_GRID, gap: GRID_GAP, padding: "9px 0", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 13 }}>
                          <span className="mono dim tnum" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                            {issueDate(i.createdAt)}
                            {issueHour(i.createdAt) && <span style={{ display: "block", fontSize: 10.5 }}>{issueHour(i.createdAt)}</span>}
                          </span>
                          {/* Clicar no cliente filtra o histórico por ele — o caminho
                              curto pro "quantos contratos esse cliente já assinou". */}
                          <button onClick={() => { setIssueQ(i.customerName || ""); setIssuesAll(false); }}
                            title={i.customerId ? "ver só os contratos deste cliente" : "registro sem vínculo de cliente (razão social digitada na mão)"}
                            style={{ fontWeight: 600, minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", color: i.customerId ? "var(--fg-1)" : "var(--fg-3)" }}>
                            {i.customerName || "sem cliente"}
                          </button>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", color: "var(--fg-2)", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.name}>{i.name}</span>
                            {(i.tag || String(i.values?.valor_total || "").trim()) && (
                              <span className="mono dim tnum" style={{ fontSize: 10.5 }}>
                                {[i.tag, String(i.values?.valor_total || "").trim() && `R$ ${String(i.values.valor_total).trim()}`].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </span>
                          <span className="mono dim" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.author ? displayName(i.author) : "—"}</span>
                          <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                            <button onClick={() => printIssue(i)} style={{ ...btn, height: 28, padding: "0 10px", fontWeight: 500 }}>reimprimir</button>
                            <MoreMenu items={[
                              { label: "abrir o contrato gerado", onClick: () => { setIssueSel(i); setSel(null); setEdit(false); } },
                              { label: "excluir registro", tone: "neg", onClick: () => removeIssue(i) },
                            ]} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {found.length > shown.length && (
                  <button onClick={() => setIssuesAll(true)} className="mono" style={{ fontSize: 11, color: "var(--accent)", padding: "8px 0" }}>
                    +{found.length - shown.length} registros
                  </button>
                )}
              </div>
            );
          })()}
        </div>

      </div>

      {(sel || edit) && (
        <div style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", display: "flex", justifyContent: "flex-end", zIndex: 70 }}>
          {/* O backdrop NÃO fecha no clique (Leo, 04/08): o painel tem formulário
              preenchido à mão e um clique fora jogava tudo fora. Fecha só no ✕. */}
          <div onClick={(e) => e.stopPropagation()} style={{ width: !edit && sel && fieldsOf(sel).length ? "min(1120px, 100vw)" : "min(860px, 100vw)", height: "100%", background: "var(--bg-1)", borderLeft: "1px solid var(--line-2)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-pop)" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div className="kicker">{edit ? (sel ? "Editar modelo" : "Novo modelo") : "Modelo de contrato"}</div>
                <div style={{ fontSize: 17, fontWeight: 500, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{edit ? (draft?.name || "…") : sel?.name}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                {!edit && sel && (
                  <>
                    {/* Modelo SEM {{token}} não tem quadro resumo pra preencher:
                        não há passo 3 no rodapé, então gerar continua aqui. */}
                    {!selFields.length && (
                      <>
                        <button onClick={() => generate(sel, "print")} disabled={busy} style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", borderColor: "transparent", opacity: busy ? 0.6 : 1 }}>Imprimir / PDF</button>
                        <button onClick={() => generate(sel, "download")} disabled={busy} style={btn}>Baixar .html</button>
                        <button onClick={() => copyHtml(sel, fill)} disabled={busy} style={{ ...btn, ...(copied ? { background: "var(--pos-soft)", color: "var(--pos)" } : {}) }}>{copied ? "✓ copiado" : "Copiar HTML"}</button>
                      </>
                    )}
                    <button onClick={() => openEdit(sel)} style={btn}>Editar</button>
                    <button onClick={() => duplicate(sel)} disabled={busy} style={btn}>Duplicar</button>
                    <button onClick={() => remove(sel)} disabled={busy} className="dim" style={{ ...btn, color: "var(--neg)" }}>Excluir</button>
                  </>
                )}
                <button onClick={close} className="mono dim" style={{ fontSize: 16, padding: "0 4px" }}>✕</button>
              </div>
            </div>

            {!edit && sel && selFields.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 20px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", flexWrap: "wrap" }}>
                {PASSOS.map(([n, label], idx) => (
                  <React.Fragment key={n}>
                    {idx > 0 && <span className="mono dim" style={{ fontSize: 11 }}>·</span>}
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: passo === n ? 650 : 500, color: passo === n ? "var(--fg-1)" : passo > n ? "var(--fg-3)" : "var(--fg-4)" }}>
                      <span className="tnum" style={{
                        width: 18, height: 18, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700,
                        background: passo === n ? "var(--btn-bg)" : passo > n ? "var(--pos-soft)" : "var(--bg-2)",
                        color: passo === n ? "var(--btn-fg)" : passo > n ? "var(--pos)" : "var(--fg-4)",
                      }}>{passo > n ? "✓" : n}</span>
                      {label}
                    </span>
                  </React.Fragment>
                ))}
                <span className="mono dim tnum" style={{ marginLeft: "auto", fontSize: 11 }}>{`${selDone}/${selFields.length} campos`}</span>
              </div>
            )}

            {!edit && sel && (() => {
              const fields = selFields;
              if (!fields.length) return <iframe title={sel.name} srcDoc={fullHtml(sel)} style={{ flex: 1, border: 0, background: "#fff" }} />;
              const done = selDone;
              // Quadro resumo longo não abre como um paredão: os quatro
              // primeiros campos ficam à vista e o resto vem no "+N campos".
              // Se algo escondido já tem valor (o vínculo do cliente preenche
              // e-mail/WhatsApp), a lista abre sozinha — esconder texto já
              // digitado é pior do que mostrar campo demais.
              const primeiros = fields.slice(0, 4);
              const extras = fields.slice(4);
              const extraPreenchido = extras.some((f) => String(fill[f.key] || "").trim());
              const mostrarExtras = maisCampos || extraPreenchido;
              const campoInput = (f) => (
                <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="kicker" style={{ fontSize: 10 }}>{f.label}</span>
                  {f.multiline ? (
                    <textarea value={fill[f.key] || ""} rows={2} placeholder={f.placeholder || ""}
                      onChange={(e) => { setConfirmed(false); const val = e.target.value; setFill((v) => ({ ...v, [f.key]: val })); }}
                      style={{ ...inp, height: "auto", minHeight: 52, padding: "6px 10px", resize: "vertical", fontFamily: "var(--sans)" }} />
                  ) : (
                    <input value={fill[f.key] || ""} placeholder={f.placeholder || ""}
                      onChange={(e) => { setConfirmed(false); const val = e.target.value; setFill((v) => ({ ...v, [f.key]: val })); }} style={inp} />
                  )}
                  {f.hint && <span className="mono dim" style={{ fontSize: 10 }}>{f.hint}</span>}
                </label>
              );
              const passoHead = (n, titulo, nota) => (
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span className="tnum" style={{ fontSize: 10.5, fontWeight: 700, color: passo === n ? "var(--accent)" : "var(--fg-4)" }}>{n}</span>
                  <span className="kicker" style={{ color: passo === n ? "var(--fg-1)" : "var(--fg-3)" }}>{titulo}</span>
                  {nota && <span className="mono dim" style={{ fontSize: 10, marginLeft: "auto" }}>{nota}</span>}
                </div>
              );
              return (
                <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                  <div style={{ width: 360, flexShrink: 0, borderRight: "1px solid var(--line-1)", overflow: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14, background: "var(--bg-inset)" }}>
                    {/* 1 · de quem é o contrato */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {passoHead(1, "De quem é o contrato")}
                      {customers.length > 0 ? (
                        <>
                          <select value={custId} onChange={(e) => pickCustomer(sel, e.target.value)} aria-label="Cliente do contrato" style={inp}>
                            <option value="">— sem vínculo (digite a razão social abaixo) —</option>
                            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <span className="mono dim" style={{ fontSize: 10, lineHeight: 1.5 }}>
                            vincular preenche razão social, representante, e-mail e WhatsApp que ainda estiverem vazios (o que você digitou não é sobrescrito)
                          </span>
                        </>
                      ) : (
                        <span className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>nenhum cliente cadastrado neste produto: preencha a razão social no quadro resumo</span>
                      )}
                    </div>

                    {/* 2 · quadro resumo */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--line-1)", paddingTop: 12 }}>
                      {passoHead(2, "Quadro resumo", `${done}/${fields.length}`)}
                      <span className="mono dim" style={{ fontSize: 10, lineHeight: 1.5, marginTop: -4 }}>
                        o contrato ao lado se atualiza; campo vazio sai como linha em branco no PDF
                      </span>
                      {primeiros.map(campoInput)}
                      {extras.length > 0 && !mostrarExtras && (
                        <button onClick={() => setMaisCampos(true)} className="mono" style={{ alignSelf: "flex-start", fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                          +{extras.length} campos ▾
                        </button>
                      )}
                      {mostrarExtras && extras.map(campoInput)}
                      {done > 0 && (
                        <button onClick={() => { setFill({}); setCustId(""); setConfirmed(false); lastIssueKey.current = ""; }} className="mono dim" style={{ alignSelf: "flex-start", fontSize: 11 }}>limpar campos</button>
                      )}
                    </div>

                    {/* 3 · gerar. Era o topo do drawer, longe do formulário: a
                        ação agora fecha a coluna que você acabou de preencher e
                        diz, ali mesmo, em qual histórico o papel vai cair. */}
                    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line-1)", paddingTop: 12, position: "sticky", bottom: -14, background: "var(--bg-inset)", paddingBottom: 2 }}>
                      {passoHead(3, "Gerar")}
                      <button onClick={() => generate(sel, "print")} disabled={busy}
                        style={{ ...btn, width: "100%", height: 36, justifyContent: "center", background: "var(--btn-bg)", color: "var(--btn-fg)", borderColor: "transparent", opacity: busy ? 0.6 : 1 }}>
                        Imprimir / PDF
                      </button>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => generate(sel, "download")} disabled={busy} style={{ ...btn, flex: 1, justifyContent: "center", fontWeight: 500 }}>Baixar .html</button>
                        <button onClick={() => copyHtml(sel, fill)} disabled={busy} style={{ ...btn, flex: 1, justifyContent: "center", fontWeight: 500, ...(copied ? { background: "var(--pos-soft)", color: "var(--pos)" } : {}) }}>{copied ? "✓ copiado" : "Copiar HTML"}</button>
                      </div>
                      {fillClient ? (
                        <span className="chip pos" style={{ fontSize: 11.5 }}>
                          {confirmed ? `contrato de ${fillClient} no histórico` : `entra no histórico de ${fillClient}`}
                        </span>
                      ) : (
                        <span className="chip warn" style={{ fontSize: 11.5 }}>escolha o cliente ou preencha a razão social pra entrar no histórico</span>
                      )}
                      {!confirmed && (
                        <button onClick={() => registerIssue(sel)} disabled={busy || !fillClient} className="mono"
                          title={fillClient ? "gravar o registro sem abrir a impressão" : "escolha o cliente ou preencha a razão social"}
                          style={{ alignSelf: "flex-start", fontSize: 11, color: fillClient ? "var(--accent)" : "var(--fg-4)", fontWeight: 600 }}>
                          {busy ? "registrando…" : "registrar sem imprimir agora"}
                        </button>
                      )}
                    </div>
                  </div>
                  <iframe title={sel.name} srcDoc={fullHtml(sel, fill)} style={{ flex: 1, border: 0, background: "#fff" }} />
                </div>
              );
            })()}

            {edit && draft && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ padding: "14px 20px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="kicker">Nome do modelo</span>
                    <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="ex.: Consultoria logística · 4 visitas" style={inp} />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="kicker">Etiqueta</span>
                    <input value={draft.tag} onChange={(e) => setDraft((d) => ({ ...d, tag: e.target.value }))} placeholder="ex.: serviço" style={inp} />
                  </label>
                  <label style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="kicker">Nota de uso (aparece no card)</span>
                    <input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="quando usar este modelo, valores de referência…" style={inp} />
                  </label>
                </div>
                <div style={{ flex: 1, minHeight: 0, padding: "0 20px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <textarea value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} spellCheck={false}
                    className="mono" style={{ resize: "none", padding: 12, borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-1)", fontSize: 11.5, lineHeight: 1.55 }} />
                  <iframe title="preview" srcDoc={fullHtml({ ...draft })} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "#fff", width: "100%", height: "100%" }} />
                </div>
                <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "flex", gap: 8 }}>
                  <button onClick={saveDraft} disabled={busy || !draft.name.trim()} style={{ flex: 1, padding: "9px 12px", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy || !draft.name.trim() ? 0.6 : 1 }}>
                    {busy ? "Salvando…" : "Salvar modelo"}
                  </button>
                  <button onClick={() => (sel ? openView(sel) : close())} style={{ padding: "9px 16px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {issueSel && !sel && !edit && (
        <IssueViewer issue={issueSel} btn={btn}
          onClose={() => setIssueSel(null)}
          onPrint={() => printIssue(issueSel)}
          onRemove={() => removeIssue(issueSel)} />
      )}
    </div>
  );
}

export { ContractsScreen };
