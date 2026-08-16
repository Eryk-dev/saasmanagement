import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState, PrimaryButton, SecondaryButton, CardHead, useEsc, toast } from "../atoms.jsx";
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
  function openView(c) { setSel(c); setEdit(false); setDraft(null); setFill({}); setCustId(""); setConfirmed(false); setIssueSel(null); lastIssueKey.current = ""; }

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

        {items && items.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: 14 }}>
            {items.map((c) => (
              <div key={c.id} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em", fontFamily: "var(--display)", cursor: "pointer" }} onClick={() => openView(c)}>{c.name}</div>
                    {c.tag && <span className="kicker" style={{ display: "inline-block", marginTop: 6, color: "var(--accent)", border: "1px solid var(--accent-line)", background: "var(--accent-soft)", borderRadius: 999, padding: "2px 8px" }}>{c.tag}</span>}
                  </div>
                </div>
                {c.note && <div style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5 }}>{c.note}</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
                  <button onClick={() => openView(c)} style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", borderColor: "transparent" }}>Abrir</button>
                  <button onClick={() => printTemplate(c)} title="imprime o modelo EM BRANCO (sem cliente, não entra no histórico)" style={btn}>Imprimir em branco</button>
                  <button onClick={() => openEdit(c)} style={btn}>Editar</button>
                </div>
              </div>
            ))}
          </div>
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
                {shown.map((i) => (
                  <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--line-1)", fontSize: 13, flexWrap: "wrap" }}>
                    <span className="mono dim tnum" style={{ fontSize: 11.5, flexShrink: 0 }}>{issueDate(i.createdAt)}</span>
                    {/* Clicar no cliente filtra o histórico por ele — o caminho
                        curto pro "quantos contratos esse cliente já assinou". */}
                    <button onClick={() => { setIssueQ(i.customerName || ""); setIssuesAll(false); }}
                      title={i.customerId ? "ver só os contratos deste cliente" : "registro sem vínculo de cliente (razão social digitada na mão)"}
                      style={{ fontWeight: 600, minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: i.customerId ? "var(--fg-1)" : "var(--fg-3)" }}>
                      {i.customerName || "sem cliente"}
                    </button>
                    <span style={{ color: "var(--fg-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.name}</span>
                    {i.tag && <span className="chip accent" style={{ flexShrink: 0 }}>{i.tag}</span>}
                    {String(i.values?.valor_total || "").trim() && (
                      <span className="mono tnum" style={{ fontSize: 12, color: "var(--fg-2)", flexShrink: 0 }}>R$ {String(i.values.valor_total).trim()}</span>
                    )}
                    <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                      {i.author && <span className="mono dim" style={{ fontSize: 10.5 }}>{displayName(i.author)}</span>}
                      <SecondaryButton size="sm" onClick={() => { setIssueSel(i); setSel(null); setEdit(false); }}>Abrir</SecondaryButton>
                      <SecondaryButton size="sm" onClick={() => printIssue(i)}>Imprimir / PDF</SecondaryButton>
                    </span>
                  </div>
                ))}
                {found.length > shown.length && (
                  <button onClick={() => setIssuesAll(true)} className="mono" style={{ fontSize: 11, color: "var(--accent)", padding: "8px 0" }}>
                    +{found.length - shown.length} mais
                  </button>
                )}
              </div>
            );
          })()}
        </div>

        <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
          os modelos ficam salvos no servidor pro time todo. Abra um modelo, escolha o cliente e preencha o Quadro Resumo: “Imprimir / PDF” abre o contrato pronto pra salvar em PDF e o registro entra no histórico preso àquele cliente (ele também aparece na ficha do cliente, na tela Clientes). Campo vazio sai como linha em branco pra preencher à mão.
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
                    <button onClick={() => generate(sel, "print")} disabled={busy} style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", borderColor: "transparent", opacity: busy ? 0.6 : 1 }}>Imprimir / PDF</button>
                    <button onClick={() => generate(sel, "download")} disabled={busy} style={btn}>Baixar .html</button>
                    <button onClick={() => copyHtml(sel, fill)} disabled={busy} style={{ ...btn, ...(copied ? { background: "var(--pos-soft)", color: "var(--pos)" } : {}) }}>{copied ? "✓ copiado" : "Copiar HTML"}</button>
                    <button onClick={() => openEdit(sel)} style={btn}>Editar</button>
                    <button onClick={() => duplicate(sel)} disabled={busy} style={btn}>Duplicar</button>
                    <button onClick={() => remove(sel)} disabled={busy} className="dim" style={{ ...btn, color: "var(--neg)" }}>Excluir</button>
                  </>
                )}
                <button onClick={close} className="mono dim" style={{ fontSize: 16, padding: "0 4px" }}>✕</button>
              </div>
            </div>

            {!edit && sel && (() => {
              const fields = fieldsOf(sel);
              if (!fields.length) return <iframe title={sel.name} srcDoc={fullHtml(sel)} style={{ flex: 1, border: 0, background: "#fff" }} />;
              const done = fields.filter((f) => String(fill[f.key] || "").trim()).length;
              return (
                <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                  <div style={{ width: 330, flexShrink: 0, borderRight: "1px solid var(--line-1)", overflow: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, background: "var(--bg-inset)" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                      <span className="kicker">Dados do contrato</span>
                      <span className="mono dim tnum" style={{ fontSize: 10 }}>{done}/{fields.length}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--fg-4)", lineHeight: 1.5, marginTop: -6 }}>
                      preencha e o contrato ao lado se atualiza; campo vazio sai como linha em branco no PDF
                    </div>
                    {customers.length > 0 && (
                      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span className="kicker" style={{ fontSize: 10 }}>Cliente (vincula o registro)</span>
                        <select value={custId} onChange={(e) => pickCustomer(sel, e.target.value)} style={inp}>
                          <option value="">— sem vínculo (digite abaixo) —</option>
                          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </label>
                    )}
                    {fields.map((f) => (
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
                    ))}
                    {done > 0 && (
                      <button onClick={() => { setFill({}); setCustId(""); setConfirmed(false); lastIssueKey.current = ""; }} className="mono dim" style={{ alignSelf: "flex-start", fontSize: 11 }}>limpar campos</button>
                    )}
                    {/* Estado do registro. Gerar (imprimir/baixar/copiar) já
                        grava sozinho; o botão fica pra quem vai mandar o
                        contrato por fora e quer o controle do mesmo jeito. */}
                    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                      {confirmed ? (
                        <span className="chip pos" style={{ fontSize: 11.5 }}>contrato de {fillClient} no histórico</span>
                      ) : (
                        <SecondaryButton onClick={() => registerIssue(sel)} disabled={busy || !fillClient}
                          title={fillClient ? "registrar no histórico sem imprimir agora" : "escolha o cliente ou preencha a razão social"}
                          style={{ width: "100%" }}>
                          {busy ? "registrando…" : "Registrar no histórico"}
                        </SecondaryButton>
                      )}
                      <span className="mono dim" style={{ fontSize: 10, lineHeight: 1.5 }}>
                        {fillClient
                          ? "imprimir, baixar ou copiar já registra o contrato no histórico deste cliente"
                          : "escolha o cliente ou preencha a razão social pra o contrato entrar no histórico"}
                      </span>
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
