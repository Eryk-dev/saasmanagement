import React from "react";
import { createPortal } from "react-dom";
import { Segmented } from "../components/viz.jsx";
import {
  PrimaryButton,
  SecondaryButton,
  WaButton,
  MoreMenu,
  toast,
} from "../atoms.jsx";
import { Modal, Drawer } from "../components/overlay.jsx";
import { waLink } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { displayName } from "../lib/users.js";
import "./integration-forms.css";

// Formulário de Integração — a tela que administra o questionário que o cliente
// RECÉM-FECHADO preenche antes da call de integração.
//
// Não confundir com "Formulários" (marketing): lá é captação de lead, com funil
// e pixel. Aqui a pessoa já comprou, e o que se coleta é a configuração da
// operação dela (contas, rotas de clonagem, preço, o que não pode sair,
// estoque) mais o TERMO de veracidade assinado. O integrador chega na call já
// sabendo, em vez de descobrir ao vivo.
//
// Fluxo: solicitar (escolhe o cliente ou o lead) → o servidor devolve um link
// opaco (/fi/:id) → manda no WhatsApp → o cliente responde → a resposta aparece
// aqui, presa ao cliente, com o snapshot das perguntas daquela versão.
//
// As PERGUNTAS moram no servidor (packages/api/src/integration-form.js) e são
// as mesmas pra todo cliente: o botão "ver perguntas" abre a pré-visualização.
//
// TIPOS (17/09/2026): a mesma máquina serve mais de um questionário. Hoje são
// dois, `integracao` (o de sempre) e `nota_fiscal` (o cadastro do tomador pro
// financeiro emitir a NFS-e, definido em packages/api/src/fiscal-form.js). O
// pedido escolhe o tipo; o documento guarda em `kind` (sem kind = integração).

const { useState: useS, useEffect: useE, useRef: useR, useMemo: useM } = React;

// Pisos + quatro gaps da prancha CRM final. Em telas menores, a tabela
// rola dentro do card sem alargar a página.
export const FORM_GRID =
  "minmax(180px, 1.4fr) minmax(150px, 1fr) minmax(190px, 1.3fr) 130px 190px";
export const FORM_GRID_GAP = 12;
export const FORM_GRID_BUDGET = 888;

const publicBase = () =>
  import.meta.env.VITE_API_BASE || window.location?.origin || "";
const formUrl = (doc) => `${publicBase()}/fi/${doc.id}`;
const previewUrl = (kind) =>
  `${publicBase()}/fi/preview?kind=${encodeURIComponent(kind)}`;

const KINDS = {
  integracao: {
    key: "integracao",
    label: "integração",
    full: "Formulário de Integração",
    hint: "como é a operação: contas, rotas, preço, estoque",
    wa: (nome, brand, url) =>
      `Oi ${nome}! Aqui é da ${brand}. Antes da nossa call de integração, preenche este formulário rapidinho pra gente já deixar as suas contas configuradas do jeito certo: ${url}`,
  },
  nota_fiscal: {
    key: "nota_fiscal",
    label: "nota fiscal",
    full: "Dados para nota fiscal",
    hint: "cadastro do tomador: razão social, CNPJ, endereço, e-mail da nota",
    wa: (nome, brand, url) =>
      `Oi ${nome}! Aqui é do financeiro da ${brand}. Pra emitir a sua nota fiscal certinho, preenche este formulário com os dados da empresa (leva uns dois minutos): ${url}`,
  },
};
const kindOf = (doc) => (doc && KINDS[doc.kind] ? doc.kind : "integracao");

const fmtAt = (iso) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const fmtDay = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";
const firstName = (s) =>
  String(s || "")
    .trim()
    .split(/\s+/)[0] || "";

// Mensagem pronta do pedido. A marca vem do workspace ativo (a tela existe pra
// LeverAds hoje, mas o texto não fica preso a ela).
function waText(doc, brand) {
  return KINDS[kindOf(doc)].wa(
    firstName(doc.customerName),
    brand || "LeverAds",
    formUrl(doc),
  );
}

// Resumo de uma linha da resposta (mesma régua do servidor): é o que a lista
// mostra sem precisar abrir a ficha.
function resumo(doc) {
  const a = doc.answers || {};
  const partes = [];
  if (kindOf(doc) === "nota_fiscal") {
    const pj = String(a.tipo || "").startsWith("Pessoa jurídica");
    if (pj ? a.razao_social : a.nome_pf)
      partes.push(pj ? a.razao_social : a.nome_pf);
    if (pj ? a.cnpj : a.cpf) partes.push(pj ? a.cnpj : a.cpf);
    if (a.cidade || a.uf)
      partes.push([a.cidade, a.uf].filter(Boolean).join("/"));
    if (pj && a.regime) partes.push(a.regime);
    return partes.join(" · ");
  }
  if (Array.isArray(a.contas) && a.contas.length)
    partes.push(
      `${a.contas.length} ${a.contas.length === 1 ? "conta" : "contas"}`,
    );
  if (Array.isArray(a.rotas) && a.rotas.length)
    partes.push(`${a.rotas.length} ${a.rotas.length === 1 ? "rota" : "rotas"}`);
  if (a.erp && a.erp !== "Não uso") partes.push(a.erp);
  if (String(a.sync || "").startsWith("Sim")) partes.push("sincroniza estoque");
  return partes.join(" · ");
}

// Respostas viradas em texto puro (botão "copiar respostas"): serve pro
// integrador colar no card, no Notion ou na conversa sem abrir a tela.
function answersText(doc) {
  const a = doc.answers || {};
  const linhas = [
    `${KINDS[kindOf(doc)].full.toUpperCase()} · ${doc.customerName || "cliente"}`,
    `respondido em ${fmtAt(doc.respondedAt)}`,
    "",
  ];
  for (const sec of doc.sections || []) {
    linhas.push(`## ${sec.title}`);
    for (const q of sec.questions || []) {
      const v = a[q.key];
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        linhas.push(`${q.label}:`);
        v.forEach((row, i) => {
          linhas.push(
            `  ${i + 1}. ${(q.fields || []).map((f) => `${f.label}: ${row[f.key] || "—"}`).join(" · ")}`,
          );
        });
      } else if (typeof v === "boolean") {
        linhas.push(`[${v ? "x" : " "}] ${q.label}`);
      } else {
        linhas.push(`${q.label}: ${v}`);
      }
    }
    linhas.push("");
  }
  if (doc.respondent) {
    linhas.push(
      "## Assinatura",
      `${doc.respondent.name || "—"} · ${doc.respondent.doc || "—"} · ${fmtAt(doc.respondent.at)} · IP ${doc.respondent.ip || "—"}`,
    );
  }
  return linhas.join("\n");
}

async function copiar(texto, msg) {
  try {
    await navigator.clipboard.writeText(texto);
    toast(msg, "pos");
    return true;
  } catch {
    toast("Não foi possível copiar. Tente novamente.", "neg");
    return false;
  }
}

function CopyButton({ text, children, className }) {
  const [copied, setCopied] = useS(false),
    [busy, setBusy] = useS(false);
  const timer = useR(null),
    pending = useR(false);
  useE(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className={className}
      disabled={busy}
      onClick={async () => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        if (await copiar(text, "Copiado")) {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        }
        pending.current = false;
        setBusy(false);
      }}
    >
      {busy ? "Copiando…" : copied ? "Copiado ✓" : children}
    </button>
  );
}

const diasDe = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t)
    ? Math.max(0, Math.floor((Date.now() - t) / 86400000))
    : null;
};

// Perguntas atuais vêm da REST. Respostas já enviadas usam exclusivamente
// doc.sections, o snapshot gravado no envio, para preservar os rótulos originais.
function Questions({ kind }) {
  const [data, setData] = useS(null),
    [error, setError] = useS(false),
    [retry, setRetry] = useS(0);
  useE(() => {
    let active = true;
    setData(null);
    setError(false);
    api
      .integrationFormQuestions(kind)
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [kind, retry]);
  return (
    <div className="intform-questions">
      {error ? (
        <div role="alert">
          Não foi possível carregar as perguntas.{" "}
          <button onClick={() => setRetry((v) => v + 1)}>
            Tentar novamente
          </button>
        </div>
      ) : !data ? (
        <div role="status">Carregando perguntas…</div>
      ) : (
        (data.sections || []).map((section) => (
          <section key={section.key}>
            <h3>{section.title}</h3>
            <ul>
              {(section.questions || []).map((q) => (
                <li key={q.key}>{q.label}</li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
function QuestionsModal({ initialKind, onClose }) {
  const [kind, setKind] = useS(initialKind);
  return createPortal(
    <Modal onClose={onClose} label="Perguntas do formulário" largura={620}>
      <div className="intform-questions-modal intform-dialog">
        <header>
          <h2>Perguntas do formulário</h2>
          <button onClick={onClose} aria-label="Fechar perguntas">
            ✕
          </button>
        </header>
        <Segmented
          value={kind}
          onChange={setKind}
          options={Object.values(KINDS).map((k) => ({
            value: k.key,
            label: k.label,
          }))}
        />
        <Questions kind={kind} />
        <a href={previewUrl(kind)} target="_blank" rel="noreferrer">
          Abrir prévia pública ↗
        </a>
      </div>
    </Modal>,
    document.body,
  );
}

// ── Solicitar: escolhe o cliente (ou o lead que acabou de fechar) ────────────
// Mesma régua do seletor de "quem vai pagar" (payment-link-modal): busca
// digitável sobre o SEED do workspace, porque select com 1.200 leads não serve.
function AskModal({ saas, brand, onClose, onCreated }) {
  const [formKind, setFormKind] = useS("integracao"); // qual questionário
  const [kind, setKind] = useS("customer"); // quem preenche: cliente ou lead
  const [q, setQ] = useS("");
  const [busy, setBusy] = useS(false);
  const [error, setError] = useS(null);
  const pending = useR(false);
  const [novo, setNovo] = useS(null); // pedido criado: a tela vira "copie o link"

  const rows = useM(() => {
    const src =
      kind === "customer"
        ? window.SEED?.CUSTOMERS || []
        : window.SEED?.LEADS || [];
    const term = q.trim().toLowerCase();
    const mine = src.filter((d) => !saas || d.saas === saas);
    const hit = term
      ? mine.filter((d) =>
          `${d.name || ""} ${d.company || ""} ${d.email || ""} ${d.phone || ""}`
            .toLowerCase()
            .includes(term),
        )
      : mine;
    return [...hit]
      .sort((a, b) => String(b.id).localeCompare(String(a.id)))
      .slice(0, 10);
  }, [kind, q, saas]);

  async function criar(doc) {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    setBusy(true);
    try {
      const created = await api.create("integration_forms", {
        saas,
        kind: formKind,
        customerId: kind === "customer" ? doc.id : doc.customerId || "",
        customerName: doc.company || doc.name || "",
        leadId: kind === "lead" ? doc.id : "",
        phone: doc.phone || "",
      });
      setNovo(created);
      onCreated(created);
    } catch (e) {
      setError("Não foi possível criar o formulário. Tente novamente.");
      toast(`não deu pra criar o formulário: ${e.message}`, "neg");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return createPortal(
    <Modal
      onClose={onClose}
      fechavel={!busy}
      label="solicitar formulário"
      largura={560}
      painelStyle={{ padding: 22 }}
    >
      <div className="intform-dialog">
        {error && (
          <div className="intform-feedback" role="alert">
            {error}
          </div>
        )}
        {busy && <div role="status">Criando formulário…</div>}
        {!novo ? (
          <>
            <div className="card-title">Solicitar formulário</div>
            <div className="card-sub" style={{ marginTop: 2 }}>
              Escolha o formulário e quem vai preencher. O link nasce único pra
              essa pessoa.
            </div>

            {/* Qual questionário: cada tipo tem as próprias perguntas, o próprio termo e a própria mensagem de WhatsApp. */}
            <div
              className="intform-kinds"
              role="radiogroup"
              aria-label="Qual formulário"
            >
              {Object.values(KINDS).map((k) => (
                <button
                  key={k.key}
                  type="button"
                  role="radio"
                  aria-checked={formKind === k.key}
                  disabled={busy}
                  className="intform-kind"
                  data-on={formKind === k.key || undefined}
                  onClick={() => setFormKind(k.key)}
                >
                  <div className="intform-kind-title">{k.full}</div>
                  <div className="intform-note">{k.hint}</div>
                </button>
              ))}
            </div>

            <div style={{ marginTop: 14 }}>
              <Segmented
                value={kind}
                onChange={(v) => {
                  if (!busy) {
                    setKind(v);
                    setQ("");
                  }
                }}
                options={[
                  { value: "customer", label: "Cliente" },
                  { value: "lead", label: "Lead que fechou" },
                ]}
              />
            </div>

            <input
              type="search"
              aria-label="Buscar destinatário do formulário"
              disabled={busy}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="inp"
              placeholder={
                kind === "customer"
                  ? "buscar cliente…"
                  : "buscar lead por nome, e-mail ou telefone…"
              }
              style={{ width: "100%", marginTop: 10 }}
            />

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                marginTop: 8,
              }}
            >
              {rows.map((d) => (
                <button
                  key={d.id}
                  disabled={busy}
                  onClick={() => criar(d)}
                  style={{
                    textAlign: "left",
                    padding: "9px 10px",
                    borderRadius: 999,
                    background: "transparent",
                    border: "1px solid transparent",
                    cursor: busy ? "default" : "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {d.company || d.name || "(sem nome)"}
                  </div>
                  <div className="mono dim" style={{ fontSize: 10.5 }}>
                    {/* o nome só entra quando é o CONTATO por trás da empresa (lead), senão repetiria o título */}
                    {[
                      kind === "lead" ? d.stage : d.plan,
                      d.company ? d.name : "",
                      d.phone,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                </button>
              ))}
              {!rows.length && (
                <div
                  className="mono dim"
                  style={{ fontSize: 11.5, padding: "10px 2px" }}
                >
                  ninguém encontrado nesse workspace.
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 14,
              }}
            >
              <SecondaryButton disabled={busy} onClick={onClose}>
                Fechar
              </SecondaryButton>
            </div>
          </>
        ) : (
          <>
            <div className="card-title">
              Link criado para {novo.customerName || "o cliente"}
            </div>
            <div className="card-sub" style={{ marginTop: 2 }}>
              {KINDS[kindOf(novo)].full}. Mande no WhatsApp; o formulário só
              pode ser respondido uma vez.
            </div>
            <div
              className="mono"
              style={{
                marginTop: 14,
                padding: "10px 12px",
                background: "var(--bg-2)",
                borderRadius: "var(--r-2)",
                fontSize: 11.5,
                wordBreak: "break-all",
              }}
            >
              {formUrl(novo)}
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 14,
                flexWrap: "wrap",
              }}
            >
              <PrimaryButton
                onClick={() => copiar(formUrl(novo), "link copiado")}
              >
                Copiar link
              </PrimaryButton>
              <WaButton
                href={`https://api.whatsapp.com/send?text=${encodeURIComponent(waText(novo, brand))}`}
              >
                Mandar no WhatsApp
              </WaButton>
              <SecondaryButton onClick={onClose}>Fechar</SecondaryButton>
            </div>
          </>
        )}
      </div>
    </Modal>,
    document.body,
  );
}

// ── Ficha da resposta ───────────────────────────────────────────────────────
// Renderiza o SNAPSHOT gravado no envio (doc.sections), não a definição atual:
// o questionário evolui, mas a resposta continua sendo lida com os rótulos com
// que foi feita.
function AnswersDrawer({ doc, brand, onClose, onRemove, removing, error }) {
  const answered = doc.status === "respondido",
    answers = doc.answers || {},
    kind = kindOf(doc),
    days = diasDe(doc.createdAt),
    wa = waLink(doc.phone);
  return createPortal(
    <Drawer
      onClose={onClose}
      fechavel={!removing}
      label="respostas do formulário"
      largura={470}
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
      <div className="intform-dialog intform-answer">
        <header className="intform-answer-head">
          <div>
            <span>
              {KINDS[kind].full} ·{" "}
              {answered
                ? `respondido em ${fmtDay(doc.respondedAt)}`
                : "aguardando o cliente"}
            </span>
            <h2>{doc.customerName || "sem cliente"}</h2>
          </div>
          <MoreMenu
            items={[
              {
                label: "Copiar link",
                onClick: () => copiar(formUrl(doc), "Link copiado"),
              },
              {
                label: "Abrir formulário",
                onClick: () =>
                  window.open(formUrl(doc), "_blank", "noopener,noreferrer"),
              },
            ]}
          />
          <button
            onClick={onClose}
            disabled={removing}
            aria-label="Fechar respostas"
          >
            ✕
          </button>
        </header>
        <div className="intform-answer-body">
          {error && (
            <div className="intform-feedback" role="alert">
              {error}
            </div>
          )}
          {answered ? (
            (doc.sections || []).map((section) => {
              const questions = (section.questions || []).filter(
                (q) => answers[q.key] !== undefined,
              );
              if (!questions.length) return null;
              return (
                <section key={section.key}>
                  <h3>{section.title}</h3>
                  <div className="intform-answer-values">
                    {questions.map((q) => {
                      const value = answers[q.key];
                      if (Array.isArray(value))
                        return (
                          <div className="intform-answer-repeat" key={q.key}>
                            <h4>{q.label}</h4>
                            {value.map((row, i) => (
                              <div key={i}>
                                <h4>
                                  {q.rowLabel || "Item"} {i + 1}
                                </h4>
                                {(q.fields || []).map((field) => (
                                  <div
                                    className="intform-answer-pair"
                                    key={field.key}
                                  >
                                    <span>{field.label}</span>
                                    <strong>
                                      {String(row[field.key] ?? "—")}
                                    </strong>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        );
                      return (
                        <div className="intform-answer-pair" key={q.key}>
                          <span>{q.label}</span>
                          <strong>
                            {typeof value === "boolean"
                              ? value
                                ? "✓ Sim"
                                : "✕ Não"
                              : String(value ?? "—") || "—"}
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          ) : (
            <>
              <section className="intform-answer-wait">
                <h3>aguardando o cliente</h3>
                <p>
                  {days === 0
                    ? "Pedido enviado hoje. O formulário só pode ser respondido uma vez."
                    : days === null
                      ? "O cliente ainda não respondeu. Envie o link para receber as informações."
                      : `Pedido há ${days} ${days === 1 ? "dia" : "dias"} · ${days >= 5 ? "passou do ponto, vale ligar em vez de insistir no WhatsApp." : kind === "integracao" ? "a integração não deve ser marcada antes da resposta." : "aguardando os dados para emitir a nota fiscal."}`}
                </p>
              </section>
              <section>
                <h3>mensagem pronta</h3>
                <div className="intform-message">{waText(doc, brand)}</div>
                <CopyButton text={waText(doc, brand)}>
                  Copiar a mensagem
                </CopyButton>
              </section>
              <section>
                <h3>o que vai ser perguntado</h3>
                <Questions kind={kind} />
              </section>
            </>
          )}
          {answered && doc.respondent && (
            <section className="intform-answer-signed">
              <span>✓</span>
              <div>
                <strong>{doc.respondent.name || "Assinatura do termo"}</strong>
                <p>
                  {[
                    doc.respondent.doc,
                    fmtAt(doc.respondent.at),
                    doc.respondent.ip ? `IP ${doc.respondent.ip}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {doc.term?.length > 0 && (
                  <details>
                    <summary>Ver termo assinado</summary>
                    {doc.term.map((text, i) => (
                      <p key={i}>{text}</p>
                    ))}
                  </details>
                )}
              </div>
            </section>
          )}
          {answered && !doc.sections?.length && (
            <section>Não há perguntas salvas neste registro.</section>
          )}
        </div>
        <footer className="intform-answer-footer">
          {answered ? (
            <CopyButton
              className="intform-answer-primary"
              text={answersText(doc)}
            >
              Copiar respostas
            </CopyButton>
          ) : wa ? (
            <a
              className="intform-answer-primary intform-charge"
              href={`${wa}?text=${encodeURIComponent(waText(doc, brand))}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Cobrar no WhatsApp
            </a>
          ) : (
            <CopyButton className="intform-answer-primary" text={formUrl(doc)}>
              Copiar link
            </CopyButton>
          )}
          <button
            className="intform-delete"
            onClick={onRemove}
            disabled={removing}
          >
            {removing ? "Excluindo…" : "Excluir formulário"}
          </button>
        </footer>
      </div>
    </Drawer>,
    document.body,
  );
}

function IntegrationFormsScreen() {
  const [product] = useActiveSaas();
  return (
    <IntegrationFormsWorkspace
      key={product?.id || "global"}
      product={product}
    />
  );
}
function IntegrationFormsWorkspace({ product }) {
  const [items, setItems] = useS(null);
  const [err, setErr] = useS(null);
  const [tab, setTab] = useS("todos");
  const [tipo, setTipo] = useS("todos"); // integracao · nota_fiscal · todos
  const [q, setQ] = useS("");
  const [sel, setSel] = useS(null);
  const [asking, setAsking] = useS(false);
  const [removing, setRemoving] = useS(null);
  const [removeError, setRemoveError] = useS(null);
  const [questions, setQuestions] = useS(false);
  const [limit, setLimit] = useS(50);
  const removePending = useR(false);
  const requestId = useR(0);
  const brand = product?.name || "LeverAds";

  async function load() {
    const request = ++requestId.current;
    setErr(null);
    try {
      const all = await api.list(
        "integration_forms",
        product?.id ? { saas: product.id } : {},
      );
      if (request !== requestId.current) return;
      setItems(
        (all || []).sort((a, b) =>
          String(b.createdAt || b.id).localeCompare(
            String(a.createdAt || a.id),
          ),
        ),
      );
      setErr(null);
    } catch (e) {
      if (request === requestId.current) {
        setErr(e.message);
      }
    }
  }
  // Trocar de produto zera a tela: o pedido de um workspace não vale no outro.
  useE(() => {
    setItems(null);
    setSel(null);
    setAsking(false);
    load();
    return () => {
      requestId.current++;
    };
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remover(doc) {
    if (removePending.current) return;
    if (
      !window.confirm(
        `Excluir o formulário de ${doc.customerName || "este cliente"}? O link para de funcionar${doc.status === "respondido" ? " e as respostas somem" : ""}.`,
      )
    )
      return;
    removePending.current = true;
    setRemoveError(null);
    setRemoving(doc.id);
    try {
      await api.remove("integration_forms", doc.id);
      setSel(null);
      setItems((cur) => (cur || []).filter((x) => x.id !== doc.id));
      toast("formulário excluído", "pos");
    } catch (e) {
      setRemoveError("Não foi possível excluir. Tente novamente.");
      toast(`não deu pra excluir: ${e.message}`, "neg");
    } finally {
      removePending.current = false;
      setRemoving(null);
    }
  }

  const list = (items || []).filter(
    (x) => tipo === "todos" || kindOf(x) === tipo,
  );
  const pendentes = list.filter((x) => x.status !== "respondido");
  const respondidos = list.filter((x) => x.status === "respondido");
  const esperas = pendentes
    .map((x) => ({ nome: x.customerName, d: diasDe(x.createdAt) }))
    .filter((x) => x.d != null);
  const maisLonga = esperas.length
    ? esperas.reduce((a, b) => (b.d > a.d ? b : a))
    : null;
  const esperaMax = maisLonga?.d ?? null;
  const esperaMaxNome = maisLonga?.nome || "";
  const term = q.trim().toLowerCase();
  const visiveis = (
    tab === "pendente" ? pendentes : tab === "respondido" ? respondidos : list
  )
    .filter(
      (x) =>
        !term ||
        `${x.customerName || ""} ${resumo(x)}`.toLowerCase().includes(term),
    )
    .sort(
      (a, b) =>
        (a.status === "respondido" ? 1 : 0) -
          (b.status === "respondido" ? 1 : 0) ||
        (a.status !== "respondido"
          ? (diasDe(b.createdAt) || 0) - (diasDe(a.createdAt) || 0)
          : 0),
    );
  const late = pendentes.filter((doc) => diasDe(doc.createdAt) >= 5).length;
  const shown = visiveis.slice(0, limit);
  function clearFilters() {
    setTab("todos");
    setTipo("todos");
    setQ("");
    setLimit(50);
  }

  return (
    <div className="intform-page" style={{ "--form-grid": FORM_GRID }}>
      <header className="intform-header">
        <div>
          <h1>Formulário de Integração</h1>
        </div>
        <div>
          <button
            className="intform-preview"
            onClick={() => setQuestions(true)}
          >
            Perguntas · {KINDS[tipo === "todos" ? "integracao" : tipo].label}
          </button>
          <button className="intform-request" onClick={() => setAsking(true)}>
            Solicitar formulário
          </button>
        </div>
      </header>
      {items && (
        <section
          className="intform-stats capsule-navy"
          aria-label="Situação dos formulários"
        >
          <svg
            className="intform-mark"
            width="180"
            height="180"
            viewBox="355 525 455 590"
            aria-hidden="true"
          >
            <polygon
              fill="currentColor"
              points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53"
            />
          </svg>
          <div className="intform-stats-values">
            <div className="intform-waiting">
              <h2>
                <i />
                aguardando resposta
              </h2>
              <strong>{pendentes.length}</strong>
              <small>
                {pendentes.length
                  ? "antes de marcar a integração"
                  : "ninguém devendo"}
              </small>
            </div>
            <div>
              <span>Espera mais longa</span>
              <strong data-late={esperaMax >= 5}>
                {esperaMax === null
                  ? "—"
                  : `${esperaMax} ${esperaMax === 1 ? "dia" : "dias"}`}
              </strong>
              <small>{esperaMaxNome || "nenhum pedido aberto"}</small>
            </div>
            <div className="intform-responded">
              <span>Respondidos</span>
              <strong>{respondidos.length}</strong>
              <small>
                {respondidos.length
                  ? `${respondidos.filter((x) => kindOf(x) === "integracao").length} integração · ${respondidos.filter((x) => kindOf(x) === "nota_fiscal").length} nota fiscal`
                  : "nenhum respondido ainda"}
              </small>
            </div>
            <button
              disabled={!late}
              onClick={() => {
                setTab("pendente");
                setQ("");
                setLimit(50);
              }}
            >
              {late
                ? `Cobrar ${late} ${late === 1 ? "atrasado" : "atrasados"} →`
                : "Nada atrasado"}
            </button>
          </div>
        </section>
      )}
      <section className="intform-card">
        <div className="intform-filters">
          <div className="intform-tabs" aria-label="Filtrar por situação">
            {[
              ["todos", "Todos", list.length],
              ["pendente", "Aguardando", pendentes.length],
              ["respondido", "Respondidos", respondidos.length],
            ].map(([id, label, count]) => (
              <button
                key={id}
                aria-pressed={tab === id}
                onClick={() => {
                  setTab(id);
                  setLimit(50);
                }}
              >
                {label} <span>{items ? count : "—"}</span>
              </button>
            ))}
          </div>
          <select
            aria-label="Tipo de formulário"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value);
              setLimit(50);
            }}
            className="intform-kind-select"
          >
            <option value="todos">todos os formulários</option>
            {Object.values(KINDS).map((k) => (
              <option key={k.key} value={k.key}>
                {k.full}
              </option>
            ))}
          </select>
          <label className="intform-search">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20.4 20.4l-4.2-4.2" />
            </svg>
            <input
              type="search"
              aria-label="Buscar cliente ou resposta"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimit(50);
              }}
              placeholder="buscar cliente…"
            />
          </label>
        </div>
        {err && (
          <div className="intform-feedback" role="alert">
            Não foi possível carregar os formulários.{" "}
            <button onClick={load}>Tentar novamente</button>
          </div>
        )}
        {!items && !err && (
          <div className="intform-feedback" role="status">
            Carregando formulários…
          </div>
        )}
        {items && (
          <div className="tbl-x" tabIndex={0} aria-label="Lista de formulários">
            <table
              className="intform-table"
              aria-label="Formulários pedidos aos clientes"
            >
              <thead>
                <tr>
                  {[
                    "Cliente",
                    "Situação",
                    "O que veio",
                    "Pedido por",
                    "Ação",
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((doc) => {
                  const responded = doc.status === "respondido",
                    days = diasDe(doc.createdAt),
                    wa = waLink(doc.phone);
                  return (
                    <tr key={doc.id} data-id={doc.id}>
                      <td>
                        <button
                          className="intform-name"
                          onClick={() => {
                            setSel(doc);
                            setRemoveError(null);
                          }}
                          title={doc.customerName}
                        >
                          {doc.customerName || "(sem cliente)"}
                        </button>
                        <div className="intform-meta">
                          <b className="intform-kind-tag">
                            {KINDS[kindOf(doc)].label}
                          </b>{" "}
                          · pedido {fmtDay(doc.createdAt)}
                        </div>
                      </td>
                      <td>
                        <span
                          className="intform-status"
                          style={{
                            color: responded
                              ? "var(--pos)"
                              : days >= 5
                                ? "var(--neg)"
                                : "var(--warn)",
                          }}
                        >
                          <i />
                          {responded
                            ? "respondido"
                            : !days
                              ? "aguardando"
                              : `aguardando há ${days} ${days === 1 ? "dia" : "dias"}`}
                        </span>
                        {responded && (
                          <div className="intform-term">
                            {fmtDay(doc.respondedAt)} · termo assinado
                          </div>
                        )}
                      </td>
                      <td
                        className="intform-summary"
                        data-pending={!responded}
                        title={
                          responded ? resumo(doc) : KINDS[kindOf(doc)].hint
                        }
                      >
                        {responded
                          ? resumo(doc) || "—"
                          : KINDS[kindOf(doc)].hint}
                      </td>
                      <td
                        className="intform-author"
                        title={doc.author ? displayName(doc.author) : ""}
                      >
                        {doc.author ? displayName(doc.author) : "—"}
                      </td>
                      <td className="intform-actions">
                        {responded ? (
                          <button
                            className="intform-view"
                            onClick={() => {
                              setSel(doc);
                              setRemoveError(null);
                            }}
                          >
                            Ver respostas
                          </button>
                        ) : wa ? (
                          <a
                            className="intform-charge"
                            href={`${wa}?text=${encodeURIComponent(waText(doc, brand))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Cobrar
                          </a>
                        ) : (
                          <button
                            onClick={() => {
                              setSel(doc);
                              setRemoveError(null);
                            }}
                          >
                            Ver pedido
                          </button>
                        )}
                        <CopyButton
                          text={responded ? answersText(doc) : formUrl(doc)}
                        >
                          {responded ? "Copiar respostas" : "Copiar link"}
                        </CopyButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {items && !visiveis.length && (
          <div className="intform-empty">
            {items.length
              ? "Nada nesse filtro"
              : "Nenhum formulário pedido ainda"}{" "}
            ·{" "}
            {items.length ? (
              <button onClick={clearFilters}>Limpar filtros</button>
            ) : (
              <button onClick={() => setAsking(true)}>
                Solicitar formulário
              </button>
            )}
          </div>
        )}
        {visiveis.length > shown.length && (
          <button
            className="intform-more"
            onClick={() => setLimit((v) => v + 50)}
          >
            Mostrar mais · {shown.length} de {visiveis.length}
          </button>
        )}
      </section>
      {questions && (
        <QuestionsModal
          initialKind={tipo === "todos" ? "integracao" : tipo}
          onClose={() => setQuestions(false)}
        />
      )}
      {asking && (
        <AskModal
          saas={product?.id}
          brand={brand}
          onClose={() => setAsking(false)}
          onCreated={(doc) => setItems((cur) => [doc, ...(cur || [])])}
        />
      )}
      {sel && (
        <AnswersDrawer
          doc={sel}
          brand={brand}
          onClose={() => setSel(null)}
          onRemove={() => remover(sel)}
          removing={removing === sel.id}
          error={removeError}
        />
      )}
    </div>
  );
}

export { IntegrationFormsScreen };
