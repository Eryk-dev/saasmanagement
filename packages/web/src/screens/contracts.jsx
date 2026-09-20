import React from "react";
import { createPortal } from "react-dom";
import { Drawer } from "../components/overlay.jsx";
import { MoreMenu, toast } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { currentUser, displayName } from "../lib/users.js";
import {
  fieldsOf,
  fullHtml,
  printContract,
  downloadContract,
  contractClientName,
  byIssuedDesc,
} from "../lib/contracts.js";
import "./contracts.css";

const { useState, useEffect, useRef } = React;
export const MODEL_GRID =
  "minmax(180px,1.4fr) 110px 80px minmax(140px,1fr) 200px";
export const HIST_GRID =
  "112px minmax(150px,1.3fr) minmax(140px,1fr) 110px 190px";
export const GRID_GAP = 12;
// Pisos + gaps da prancha CRM final; a tabela de 820px rola dentro do card
// em viewports menores, sem alargar a página.
export const GRID_BUDGET = 778;
const date = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const ago = (iso) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return Number.isFinite(days) ? (days <= 0 ? "hoje" : `há ${days}d`) : "";
};
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

function ContractsScreen() {
  const [product] = useActiveSaas();
  return <ContractsWorkspace key={product?.id || "global"} product={product} />;
}
function ContractsWorkspace({ product }) {
  const [items, setItems] = useState(null),
    [issues, setIssues] = useState(null);
  const [error, setError] = useState(null),
    [historyError, setHistoryError] = useState(null),
    [operationError, setOperationError] = useState(null);
  const [sel, setSel] = useState(null),
    [edit, setEdit] = useState(false),
    [draft, setDraft] = useState(null),
    [fill, setFill] = useState({});
  const [busy, setBusy] = useState(false),
    [issueQ, setIssueQ] = useState(""),
    [issuesAll, setIssuesAll] = useState(false);
  const [issueSel, setIssueSel] = useState(null),
    [custId, setCustId] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [copied, setCopied] = useState(false);
  const copyTimer = useRef(null),
    lastIssueKey = useRef(""),
    sequence = useRef(0),
    mutation = useRef(false),
    initialDraft = useRef("");
  const customers = (window.SEED?.CUSTOMERS || []).filter(
    (c) => !product?.id || c.saas === product.id,
  );
  const fillCustomer = customers.find((c) => c.id === custId) || null,
    fillClient = contractClientName(fillCustomer, fill);
  async function load() {
    const request = ++sequence.current;
    setError(null);
    setHistoryError(null);
    await Promise.allSettled([
      api
        .list("contracts")
        .then((rows) => {
          if (request === sequence.current)
            setItems(
              (rows || []).filter((c) => !c.saas || c.saas === product?.id),
            );
        })
        .catch((e) => {
          if (request === sequence.current) setError(e.message || String(e));
        }),
      api
        .list("contract_issues", product?.id ? { saas: product.id } : {})
        .then((rows) => {
          if (request === sequence.current)
            setIssues(
              (rows || [])
                .filter((c) => !c.saas || c.saas === product?.id)
                .sort(byIssuedDesc),
            );
        })
        .catch((e) => {
          if (request === sequence.current)
            setHistoryError(e.message || String(e));
        }),
    ]);
  }
  useEffect(() => {
    load();
    return () => {
      sequence.current++;
      clearTimeout(copyTimer.current);
    };
  }, []);
  function resetError() {
    setOperationError(null);
    setCopied(false);
  }
  function openView(c) {
    setSel(c);
    setEdit(false);
    setDraft(null);
    setFill({});
    setCustId("");
    setConfirmed(false);
    setIssueSel(null);
    lastIssueKey.current = "";
    resetError();
  }
  function openEdit(c) {
    const next = {
      name: c.name || "",
      tag: c.tag || "",
      note: c.note || "",
      body: c.body || "",
    };
    setSel(c);
    setEdit(true);
    setDraft(next);
    initialDraft.current = JSON.stringify(next);
    resetError();
  }
  function openNew() {
    const next = { name: "", tag: "", note: "", body: NEW_BODY };
    setSel(null);
    setEdit(true);
    setDraft(next);
    initialDraft.current = JSON.stringify(next);
    resetError();
  }
  function finishClose() {
    setSel(null);
    setEdit(false);
    setDraft(null);
    resetError();
  }
  function discard() {
    return (
      !(edit
        ? JSON.stringify(draft) !== initialDraft.current
        : !confirmed && Object.values(fill).some((v) => String(v).trim())) ||
      window.confirm("Descartar as alterações deste contrato?")
    );
  }
  function close() {
    if (mutation.current || !discard()) return;
    finishClose();
  }
  // O Drawer controla Escape e foco; todos os caminhos de saída passam
  // pela confirmação de descarte e ficam bloqueados durante a gravação.
  function pickCustomer(id) {
    setCustId(id);
    setConfirmed(false);
    const customer = customers.find((c) => c.id === id);
    if (!customer) return;
    const keys = new Set(fieldsOf(sel).map((f) => f.key));
    const suggestions = {
      razao_social: customer.name || "",
      representante: customer.contact || "",
      email: customer.email || "",
      whatsapp: customer.phone || "",
    };
    setFill((previous) => {
      const next = { ...previous };
      for (const [key, value] of Object.entries(suggestions))
        if (keys.has(key) && value && !String(next[key] || "").trim())
          next[key] = value;
      return next;
    });
  }
  async function perform(action) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setOperationError(null);
    try {
      return await action();
    } catch (e) {
      setOperationError(e.message || String(e));
      toast(e.message || "Não foi possível concluir. Tente novamente.", "neg");
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  // Snapshot e deduplicação da geração preservados. Reimprimir um registro ou
  // imprimir um modelo em branco não cria um segundo documento no histórico.
  async function saveIssue(c) {
    if (!c || !fillClient) return;
    const key = JSON.stringify([c.id, fillCustomer?.id || fillClient, fill]);
    if (lastIssueKey.current === key) {
      setConfirmed(true);
      return;
    }
    await api.create("contract_issues", {
      saas: product?.id || "",
      contract: c.id,
      name: c.name || "",
      tag: c.tag || "",
      customerId: fillCustomer?.id || "",
      customerName: fillClient,
      values: { ...fill },
      fields: fieldsOf(c),
      body: c.body || "",
      author: currentUser()?.id || "",
      createdAt: new Date().toISOString(),
    });
    lastIssueKey.current = key;
    setConfirmed(true);
    toast(`Contrato registrado no histórico de ${fillClient}`, "pos");
    await load();
  }
  function registerIssue(c) {
    return perform(() => saveIssue(c));
  }
  function removeIssue(issue) {
    if (
      mutation.current ||
      !window.confirm(
        `Excluir o registro "${issue.name} · ${issue.customerName}"? O contrato sai do histórico do cliente e o histórico não guarda cópia.`,
      )
    )
      return;
    return perform(async () => {
      await api.remove("contract_issues", issue.id);
      setIssueSel(null);
      await load();
      toast("Registro excluído do histórico", "pos");
    });
  }
  function saveDraft() {
    if (!draft?.name?.trim()) {
      setOperationError("Dê um nome ao modelo.");
      return;
    }
    return perform(async () => {
      const payload = {
        ...draft,
        name: draft.name.trim(),
        saas: product?.id || "",
        updatedAt: new Date().toISOString(),
      };
      if (sel?.id) await api.update("contracts", sel.id, payload);
      else await api.create("contracts", payload);
      finishClose();
      await load();
    });
  }
  function duplicate(c) {
    return perform(async () => {
      await api.create("contracts", {
        name: `${c.name} (cópia)`,
        tag: c.tag || "",
        note: c.note || "",
        body: c.body || "",
        saas: product?.id || "",
        updatedAt: new Date().toISOString(),
      });
      await load();
    });
  }
  function remove(c) {
    if (
      mutation.current ||
      !window.confirm(`Excluir o modelo "${c.name}"? Essa ação não tem volta.`)
    )
      return;
    return perform(async () => {
      await api.remove("contracts", c.id);
      if (sel?.id === c.id) finishClose();
      await load();
    });
  }
  function printOnly(c, values) {
    const ok = printContract(c, values);
    if (!ok)
      toast(
        "O navegador bloqueou a janela de impressão · libere o popup deste site",
        "neg",
      );
    return ok;
  }
  function generate(c, how) {
    if (mutation.current) return;
    if (how === "print" && !printOnly(c, fill)) return;
    if (how === "download") downloadContract(c, fill);
    return registerIssue(c);
  }
  function copyHtml(c) {
    return perform(async () => {
      await navigator.clipboard.writeText(fullHtml(c, fill));
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
      await saveIssue(c);
    });
  }
  const fields = sel && !edit ? fieldsOf(sel) : [],
    done = fields.filter((f) => String(fill[f.key] || "").trim()).length;
  const term = issueQ.trim().toLowerCase(),
    found = (issues || []).filter(
      (i) =>
        !term ||
        [i.customerName, i.name, i.tag, displayName(i.author)].some((s) =>
          String(s || "")
            .toLowerCase()
            .includes(term),
        ),
    ),
    shown = issuesAll ? found : found.slice(0, 12);
  const preview = sel && !edit ? summaryOf(sel, fill) : [];
  const company = preview.find((row) => row.key.toLowerCase() === "contratada");
  return (
    <div className="contracts-page">
      <header className="contracts-header">
        <h1>Contratos</h1>
        <button onClick={openNew} disabled={busy}>
          Criar modelo
        </button>
      </header>
      {operationError && !sel && !edit && !issueSel && (
        <div className="contracts-state" role="alert">
          {operationError}
        </div>
      )}
      <section className="contracts-card contracts-models">
        <div className="contracts-section-head">
          <h2>
            <i />
            modelos
          </h2>
          <p>abra o modelo, escolha o cliente e preencha o Quadro Resumo</p>
        </div>
        {error && <ReadError message={error} onRetry={load} />}
        {!items && !error && (
          <div className="contracts-state" role="status">
            Carregando modelos…
          </div>
        )}
        {items && (
          <div className="tbl-x" tabIndex={0} aria-label="Modelos de contrato">
            <div
              className="contracts-table"
              style={{ "--contracts-grid": MODEL_GRID }}
            >
              <div className="contracts-table-head">
                <span>Modelo</span>
                <span>Etiqueta</span>
                <span>Gerados</span>
                <span>Último</span>
                <span>Ação</span>
              </div>
              {items.map((c) => {
                const generated = (issues || []).filter(
                    (i) => i.contract === c.id,
                  ),
                  last = generated[0],
                  count = fieldsOf(c).length;
                return (
                  <div className="contracts-model-row contracts-row" key={c.id}>
                    <div className="contracts-model-name">
                      <button
                        onClick={() => openView(c)}
                        disabled={busy}
                        title={c.name}
                      >
                        {c.name}
                      </button>
                      <small title={c.note || undefined}>
                        {count} {count === 1 ? "campo" : "campos"} no Quadro
                        Resumo{c.note ? ` · ${c.note}` : ""}
                      </small>
                    </div>
                    <span>
                      {c.tag ? (
                        <span className="contracts-tag">{c.tag}</span>
                      ) : (
                        <span className="contracts-no-tag">—</span>
                      )}
                    </span>
                    <span
                      className="contracts-count"
                      data-empty={!generated.length}
                    >
                      {issues ? generated.length : "—"}
                    </span>
                    <span className="contracts-last" data-empty={!last}>
                      {issues
                        ? last
                          ? `${last.customerName || "sem cliente"} · ${date(last.createdAt)}`
                          : "nunca usado"
                        : "—"}
                    </span>
                    <span className="contracts-actions">
                      <button
                        className="contracts-use"
                        disabled={busy}
                        onClick={() => openView(c)}
                      >
                        Usar →
                      </button>
                      <button
                        className="contracts-duplicate"
                        onClick={() => duplicate(c)}
                        disabled={busy}
                      >
                        Duplicar
                      </button>
                      <button
                        className="contracts-delete"
                        onClick={() => remove(c)}
                        disabled={busy}
                      >
                        Excluir
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {items?.length === 0 && (
          <div className="contracts-empty">
            Nenhum modelo ainda.{" "}
            <button onClick={openNew} disabled={busy}>
              Criar modelo
            </button>
          </div>
        )}
      </section>
      <section className="contracts-card contracts-history">
        <div className="contracts-history-head">
          <div>
            <h2>
              <i />
              histórico
            </h2>
            <h3>Contratos gerados{issues ? ` · ${issues.length}` : ""}</h3>
            <p>
              imprimir, baixar ou copiar um modelo preenchido registra o
              contrato aqui, preso ao cliente
            </p>
          </div>
          <label className="contracts-search">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20.4 20.4l-4.2-4.2" />
            </svg>
            <input
              aria-label="Buscar no histórico de contratos"
              value={issueQ}
              onChange={(e) => {
                setIssueQ(e.target.value);
                setIssuesAll(false);
              }}
              placeholder="buscar por cliente ou modelo…"
            />
          </label>
        </div>
        {historyError && <ReadError message={historyError} onRetry={load} />}
        {!issues && !historyError && (
          <div className="contracts-state" role="status">
            Carregando histórico…
          </div>
        )}
        {issues && (
          <div
            className="tbl-x"
            tabIndex={0}
            aria-label="Histórico de contratos"
          >
            <div
              className="contracts-table"
              style={{ "--contracts-grid": HIST_GRID }}
            >
              <div className="contracts-table-head">
                <span>Quando</span>
                <span>Cliente</span>
                <span>Modelo</span>
                <span>Gerado por</span>
                <span>Ação</span>
              </div>
              {shown.map((issue) => (
                <div
                  className="contracts-issue-row contracts-row"
                  key={issue.id}
                >
                  <span className="contracts-date">
                    <span>{date(issue.createdAt)}</span>
                    <small>{ago(issue.createdAt)}</small>
                  </span>
                  <button
                    className="contracts-client"
                    title={issue.customerName}
                    onClick={() => {
                      setIssueQ(issue.customerName || "");
                      setIssuesAll(false);
                    }}
                  >
                    {issue.customerName || "sem cliente"}
                  </button>
                  <span className="contracts-issue-model" title={issue.name}>
                    {issue.name}
                  </span>
                  <span className="contracts-author">
                    {issue.author ? displayName(issue.author) : "—"}
                  </span>
                  <span className="contracts-actions">
                    <button
                      onClick={() => {
                        setIssueSel(issue);
                        resetError();
                      }}
                    >
                      Abrir
                    </button>
                    <button
                      className="contracts-print"
                      onClick={() => printOnly(issue, issue.values)}
                    >
                      Imprimir
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {issues && !found.length && (
          <div className="contracts-empty">
            {term ? (
              <>
                nenhum contrato com esse termo ·{" "}
                <button onClick={() => setIssueQ("")}>Limpar</button>
              </>
            ) : (
              "nenhum contrato gerado ainda"
            )}
          </div>
        )}
        {found.length > shown.length && (
          <button className="contracts-more" onClick={() => setIssuesAll(true)}>
            +{found.length - shown.length} registros
          </button>
        )}
      </section>
      {sel &&
        !edit &&
        createPortal(
          <Drawer
            onClose={close}
            fechavel={!busy}
            label="Modelo de contrato"
            largura={520}
            style={{ background: "transparent", padding: 0 }}
            painelStyle={{
              position: "fixed",
              right: 26,
              top: 90,
              bottom: 26,
              height: "auto",
              maxWidth: "calc(100vw - 28px)",
              overflow: "hidden",
            }}
          >
            <div className="contract-peek">
              <header className="contract-peek-head">
                <div>
                  <span>modelo de contrato</span>
                  <h2>{sel.name}</h2>
                </div>
                <span className="contract-menu">
                  <MoreMenu
                    size={26}
                    items={[
                      !busy && {
                        label: "Editar modelo",
                        onClick: () => {
                          if (discard()) openEdit(sel);
                        },
                      },
                      !busy && {
                        label: "Duplicar modelo",
                        onClick: () => duplicate(sel),
                      },
                      !busy && {
                        label: "Excluir modelo",
                        tone: "neg",
                        onClick: () => remove(sel),
                      },
                      !busy && {
                        label: "Ver documento completo",
                        onClick: () =>
                          setIssueSel({ ...sel, values: fill, preview: true }),
                      },
                      !busy && {
                        label: "Baixar .html",
                        onClick: () => generate(sel, "download"),
                      },
                      !busy &&
                        fillClient && {
                          label: "Registrar sem imprimir",
                          onClick: () => registerIssue(sel),
                        },
                    ]}
                  />
                </span>
                <button
                  aria-label="Fechar modelo"
                  onClick={close}
                  disabled={busy}
                >
                  ✕
                </button>
              </header>
              <div className="contract-peek-body">
                {operationError && (
                  <div className="contracts-state" role="alert">
                    {operationError}
                  </div>
                )}
                <section className="contract-customer">
                  <div className="contract-step">
                    <span>1 · cliente</span>
                    <small data-done={!!custId}>
                      {custId
                        ? `✓ ${fillCustomer?.name || ""}`
                        : "escolha para registrar no cliente"}
                    </small>
                  </div>
                  <select
                    aria-label="Cliente do contrato"
                    value={custId}
                    onChange={(e) => pickCustomer(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">escolher o cliente…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </section>
                <section className="contract-fields">
                  <div className="contract-step">
                    <span>2 · quadro resumo</span>
                    <small data-done={done === fields.length}>
                      {done} de {fields.length}
                    </small>
                  </div>
                  <div className="contract-fields-list">
                    {fields.map((field) => (
                      <label key={field.key}>
                        <span>{field.label}</span>
                        {field.multiline ? (
                          <textarea
                            rows={2}
                            value={fill[field.key] || ""}
                            placeholder={field.placeholder || ""}
                            disabled={busy}
                            onChange={(e) => {
                              setConfirmed(false);
                              setFill((v) => ({
                                ...v,
                                [field.key]: e.target.value,
                              }));
                            }}
                          />
                        ) : (
                          <input
                            value={fill[field.key] || ""}
                            placeholder={field.placeholder || ""}
                            disabled={busy}
                            data-filled={!!String(fill[field.key] || "").trim()}
                            onChange={(e) => {
                              setConfirmed(false);
                              setFill((v) => ({
                                ...v,
                                [field.key]: e.target.value,
                              }));
                            }}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                  {!fields.length && (
                    <p>Este modelo não tem campos para preencher.</p>
                  )}
                </section>
                <section className="contract-preview">
                  <div className="contract-step">
                    <span>3 · prévia do quadro</span>
                  </div>
                  <div className="contract-preview-table">
                    {preview.map((row, i) => (
                      <div key={i}>
                        <span>{row.key}</span>
                        <span data-empty={row.empty}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                  {company && <p>a contratada é sempre a {company.value}</p>}
                </section>
              </div>
              <footer className="contract-peek-footer">
                <div>
                  <button
                    className="contract-register"
                    disabled={busy || !fillClient || confirmed}
                    data-confirmed={confirmed}
                    onClick={() => generate(sel, "print")}
                  >
                    {busy
                      ? "Registrando…"
                      : confirmed
                        ? "Registrado no histórico ✓"
                        : fillClient
                          ? "Registrar e gerar PDF"
                          : "Escolha um cliente"}
                  </button>
                  <button
                    className="contract-copy"
                    disabled={busy}
                    onClick={() => copyHtml(sel)}
                  >
                    {copied ? "Copiado ✓" : "Copiar HTML"}
                  </button>
                </div>
                <button
                  className="contract-blank"
                  disabled={busy}
                  onClick={() => printOnly(sel, {})}
                >
                  Imprimir em branco · não registra
                </button>
              </footer>
            </div>
          </Drawer>,
          document.body,
        )}
      {edit &&
        draft &&
        createPortal(
          <Drawer
            onClose={close}
            fechavel={!busy}
            label={sel ? "Editar modelo" : "Novo modelo"}
            largura={860}
          >
            <div className="contract-editor">
              <header className="contract-editor-head">
                <h2>{sel ? "Editar modelo" : "Novo modelo"}</h2>
                <button
                  aria-label="Fechar editor"
                  onClick={close}
                  disabled={busy}
                >
                  ✕
                </button>
              </header>
              {operationError && (
                <div className="contracts-state" role="alert">
                  {operationError}
                </div>
              )}
              <div className="contract-editor-basics">
                <label>
                  <span>Nome do modelo</span>
                  <input
                    value={draft.name}
                    disabled={busy}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, name: e.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Etiqueta</span>
                  <input
                    value={draft.tag}
                    disabled={busy}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, tag: e.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Nota de uso</span>
                  <input
                    value={draft.note}
                    disabled={busy}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, note: e.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="contract-editor-document">
                <textarea
                  aria-label="Corpo do modelo em HTML"
                  value={draft.body}
                  disabled={busy}
                  spellCheck={false}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, body: e.target.value }))
                  }
                />
                <iframe title="Prévia do modelo" srcDoc={fullHtml(draft)} />
              </div>
              <footer>
                <button onClick={saveDraft} disabled={busy}>
                  {busy ? "Salvando…" : "Salvar modelo"}
                </button>
                <button
                  onClick={() => {
                    if (mutation.current || !discard()) return;
                    sel ? openView(sel) : finishClose();
                  }}
                  disabled={busy}
                >
                  Cancelar
                </button>
              </footer>
            </div>
          </Drawer>,
          document.body,
        )}
      {issueSel &&
        createPortal(
          <IssueViewer
            issue={issueSel}
            busy={busy}
            error={operationError}
            onClose={() => {
              if (!busy) {
                setIssueSel(null);
                resetError();
              }
            }}
            onPrint={() => printOnly(issueSel, issueSel.values)}
            onRemove={issueSel.preview ? null : () => removeIssue(issueSel)}
          />,
          document.body,
        )}
    </div>
  );
}
function ReadError({ message, onRetry }) {
  return (
    <div className="contracts-state" role="alert">
      Não foi possível carregar: {message}{" "}
      <button onClick={onRetry}>Tentar novamente</button>
    </div>
  );
}
function IssueViewer({ issue, busy, error, onClose, onPrint, onRemove }) {
  return (
    <Drawer
      onClose={onClose}
      fechavel={!busy}
      label={issue.preview ? "Documento completo" : "Contrato gerado"}
      largura={860}
    >
      <div className="contract-viewer">
        <header>
          <div>
            <small>
              {issue.preview ? "Modelo de contrato" : "Contrato gerado"}
            </small>
            <h2>
              {issue.customerName ? `${issue.customerName} · ` : ""}
              {issue.name}
            </h2>
          </div>
          <div>
            <button onClick={onPrint} disabled={busy}>
              Imprimir / PDF
            </button>
            {onRemove && (
              <button onClick={onRemove} disabled={busy}>
                Excluir registro
              </button>
            )}
            <button
              onClick={onClose}
              disabled={busy}
              aria-label="Fechar documento"
            >
              ✕
            </button>
          </div>
        </header>
        {error && (
          <div className="contracts-state" role="alert">
            {error}
          </div>
        )}
        <iframe
          title="Documento do contrato"
          srcDoc={fullHtml(issue, issue.values)}
        />
      </div>
    </Drawer>
  );
}
// A prévia usa o quadro do próprio modelo, sem injetar a contratada de outro
// produto. Modelos sem table.quadro mostram seus campos reais.
function summaryOf(contract, values) {
  const doc = new DOMParser().parseFromString(
    fullHtml(contract, values),
    "text/html",
  );
  const rows = [...doc.querySelectorAll("table.quadro tr")]
    .map((tr) => {
      const cells = tr.querySelectorAll("th,td");
      return cells.length > 1
        ? {
            key: cells[0].textContent.trim(),
            value: cells[1].textContent.trim(),
            empty: cells[1].textContent.includes("______________________"),
          }
        : null;
    })
    .filter(Boolean);
  return rows.length
    ? rows
    : fieldsOf(contract).map((field) => ({
        key: field.label,
        value: String(values[field.key] || "—"),
        empty: !String(values[field.key] || "").trim(),
      }));
}
export { ContractsScreen };
