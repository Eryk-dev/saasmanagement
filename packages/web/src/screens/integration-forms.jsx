import React from "react";
import { PageHead, Card, FilterTab, Segmented } from "../components/viz.jsx";
import { EmptyState, PrimaryButton, SecondaryButton, WaButton, MoreMenu, toast } from "../atoms.jsx";
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

// Pisos + quatro gaps cabem na área útil de uma janela de 1024px.
export const FORM_GRID = "minmax(148px, 1.1fr) minmax(145px, 1fr) minmax(125px, 1fr) 86px 152px";
export const FORM_GRID_GAP = 12;
export const FORM_GRID_BUDGET = 716;

const publicBase = () => import.meta.env.VITE_API_BASE || window.location?.origin || "";
const formUrl = (doc) => `${publicBase()}/fi/${doc.id}`;
const previewUrl = (kind) => `${publicBase()}/fi/preview?kind=${encodeURIComponent(kind)}`;

const KINDS = {
  integracao: {
    key: "integracao", label: "integração", full: "Formulário de Integração",
    hint: "como é a operação: contas, rotas, preço, estoque",
    wa: (nome, brand, url) => `Oi ${nome}! Aqui é da ${brand}. Antes da nossa call de integração, preenche este formulário rapidinho pra gente já deixar as suas contas configuradas do jeito certo: ${url}`,
  },
  nota_fiscal: {
    key: "nota_fiscal", label: "nota fiscal", full: "Dados para nota fiscal",
    hint: "cadastro do tomador: razão social, CNPJ, endereço, e-mail da nota",
    wa: (nome, brand, url) => `Oi ${nome}! Aqui é do financeiro da ${brand}. Pra emitir a sua nota fiscal certinho, preenche este formulário com os dados da empresa (leva uns dois minutos): ${url}`,
  },
};
const kindOf = (doc) => (doc && KINDS[doc.kind] ? doc.kind : "integracao");

const fmtAt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";

// Mensagem pronta do pedido. A marca vem do workspace ativo (a tela existe pra
// LeverAds hoje, mas o texto não fica preso a ela).
function waText(doc, brand) {
  return KINDS[kindOf(doc)].wa(firstName(doc.customerName), brand || "LeverAds", formUrl(doc));
}

// Resumo de uma linha da resposta (mesma régua do servidor): é o que a lista
// mostra sem precisar abrir a ficha.
function resumo(doc) {
  const a = doc.answers || {};
  const partes = [];
  if (kindOf(doc) === "nota_fiscal") {
    const pj = String(a.tipo || "").startsWith("Pessoa jurídica");
    if (pj ? a.razao_social : a.nome_pf) partes.push(pj ? a.razao_social : a.nome_pf);
    if (pj ? a.cnpj : a.cpf) partes.push(pj ? a.cnpj : a.cpf);
    if (a.cidade || a.uf) partes.push([a.cidade, a.uf].filter(Boolean).join("/"));
    if (pj && a.regime) partes.push(a.regime);
    return partes.join(" · ");
  }
  if (Array.isArray(a.contas) && a.contas.length) partes.push(`${a.contas.length} ${a.contas.length === 1 ? "conta" : "contas"}`);
  if (Array.isArray(a.rotas) && a.rotas.length) partes.push(`${a.rotas.length} ${a.rotas.length === 1 ? "rota" : "rotas"}`);
  if (a.erp && a.erp !== "Não uso") partes.push(a.erp);
  if (String(a.sync || "").startsWith("Sim")) partes.push("sincroniza estoque");
  return partes.join(" · ");
}

// Respostas viradas em texto puro (botão "copiar respostas"): serve pro
// integrador colar no card, no Notion ou na conversa sem abrir a tela.
function answersText(doc) {
  const a = doc.answers || {};
  const linhas = [`${KINDS[kindOf(doc)].full.toUpperCase()} · ${doc.customerName || "cliente"}`, `respondido em ${fmtAt(doc.respondedAt)}`, ""];
  for (const sec of doc.sections || []) {
    linhas.push(`## ${sec.title}`);
    for (const q of sec.questions || []) {
      const v = a[q.key];
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        linhas.push(`${q.label}:`);
        v.forEach((row, i) => {
          linhas.push(`  ${i + 1}. ${(q.fields || []).map((f) => `${f.label}: ${row[f.key] || "—"}`).join(" · ")}`);
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
    linhas.push("## Assinatura", `${doc.respondent.name || "—"} · ${doc.respondent.doc || "—"} · ${fmtAt(doc.respondent.at)} · IP ${doc.respondent.ip || "—"}`);
  }
  return linhas.join("\n");
}

const copiar = (texto, msg) => {
  navigator.clipboard.writeText(texto)
    .then(() => toast(msg, "pos"))
    .catch(() => toast("não deu pra copiar · copie da barra do navegador", "neg"));
};

// ── Solicitar: escolhe o cliente (ou o lead que acabou de fechar) ────────────
// Mesma régua do seletor de "quem vai pagar" (payment-link-modal): busca
// digitável sobre o SEED do workspace, porque select com 1.200 leads não serve.
function AskModal({ saas, brand, onClose, onCreated }) {
  const [formKind, setFormKind] = useS("integracao"); // qual questionário
  const [kind, setKind] = useS("customer");           // quem preenche: cliente ou lead
  const [q, setQ] = useS("");
  const [busy, setBusy] = useS(false);
  const [novo, setNovo] = useS(null); // pedido criado: a tela vira "copie o link"

  const rows = useM(() => {
    const src = kind === "customer" ? (window.SEED?.CUSTOMERS || []) : (window.SEED?.LEADS || []);
    const term = q.trim().toLowerCase();
    const mine = src.filter((d) => !saas || d.saas === saas);
    const hit = term
      ? mine.filter((d) => `${d.name || ""} ${d.company || ""} ${d.email || ""} ${d.phone || ""}`.toLowerCase().includes(term))
      : mine;
    return [...hit].sort((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, 10);
  }, [kind, q, saas]);

  async function criar(doc) {
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
      toast(`não deu pra criar o formulário: ${e.message}`, "neg");
    } finally { setBusy(false); }
  }

  return (
    <Modal onClose={onClose} fechavel={!busy} label="solicitar formulário" largura={560} painelStyle={{ padding: 22 }}>
      <div className="intform-dialog">
        {!novo ? (
          <>
            <div className="card-title">Solicitar formulário</div>
            <div className="card-sub" style={{ marginTop: 2 }}>Escolha o formulário e quem vai preencher. O link nasce único pra essa pessoa.</div>

            {/* Qual questionário: cada tipo tem as próprias perguntas, o próprio termo e a própria mensagem de WhatsApp. */}
            <div className="intform-kinds" role="radiogroup" aria-label="Qual formulário">
              {Object.values(KINDS).map((k) => (
                <button key={k.key} type="button" role="radio" aria-checked={formKind === k.key} disabled={busy}
                  className="intform-kind" data-on={formKind === k.key || undefined} onClick={() => setFormKind(k.key)}>
                  <div className="intform-kind-title">{k.full}</div>
                  <div className="intform-note">{k.hint}</div>
                </button>
              ))}
            </div>

            <div style={{ marginTop: 14 }}><Segmented value={kind} onChange={(v) => { if (!busy) { setKind(v); setQ(""); } }} options={[
              { value: "customer", label: "Cliente" }, { value: "lead", label: "Lead que fechou" },
            ]} /></div>

            <input type="search" aria-label="Buscar destinatário do formulário" autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="inp"
              placeholder={kind === "customer" ? "buscar cliente…" : "buscar lead por nome, e-mail ou telefone…"}
              style={{ width: "100%", marginTop: 10 }} />

            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
              {rows.map((d) => (
                <button key={d.id} disabled={busy} onClick={() => criar(d)}
                  style={{ textAlign: "left", padding: "9px 10px", borderRadius: 999, background: "transparent", border: "1px solid transparent", cursor: busy ? "default" : "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{d.company || d.name || "(sem nome)"}</div>
                  <div className="mono dim" style={{ fontSize: 10.5 }}>
                    {/* o nome só entra quando é o CONTATO por trás da empresa (lead), senão repetiria o título */}
                    {[kind === "lead" ? d.stage : d.plan, d.company ? d.name : "", d.phone].filter(Boolean).join(" · ") || "—"}
                  </div>
                </button>
              ))}
              {!rows.length && <div className="mono dim" style={{ fontSize: 11.5, padding: "10px 2px" }}>ninguém encontrado nesse workspace.</div>}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <SecondaryButton disabled={busy} onClick={onClose}>Fechar</SecondaryButton>
            </div>
          </>
        ) : (
          <>
            <div className="card-title">Link criado para {novo.customerName || "o cliente"}</div>
            <div className="card-sub" style={{ marginTop: 2 }}>{KINDS[kindOf(novo)].full}. Mande no WhatsApp; o formulário só pode ser respondido uma vez.</div>
            <div className="mono" style={{ marginTop: 14, padding: "10px 12px", background: "var(--bg-2)", borderRadius: "var(--r-2)", fontSize: 11.5, wordBreak: "break-all" }}>{formUrl(novo)}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <PrimaryButton onClick={() => copiar(formUrl(novo), "link copiado")}>Copiar link</PrimaryButton>
              <WaButton href={`https://api.whatsapp.com/send?text=${encodeURIComponent(waText(novo, brand))}`}>Mandar no WhatsApp</WaButton>
              <SecondaryButton onClick={onClose}>Fechar</SecondaryButton>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Ficha da resposta ───────────────────────────────────────────────────────
// Renderiza o SNAPSHOT gravado no envio (doc.sections), não a definição atual:
// o questionário evolui, mas a resposta continua sendo lida com os rótulos com
// que foi feita.
function AnswersDrawer({ doc, brand, onClose, onRemove, removing }) {
  const a = doc.answers || {};
  const respondido = doc.status === "respondido";

  return (
    <Drawer onClose={onClose} fechavel={!removing} label="respostas do formulário" largura={760}>
      <div className="intform-dialog intform-answer">
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="kicker">{`${KINDS[kindOf(doc)].full} · ${respondido ? `respondido em ${fmtAt(doc.respondedAt)}` : "aguardando o cliente"}`}</div>
            <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {doc.customerName || "sem cliente"}
            </div>
          </div>
          <button onClick={onClose} disabled={removing} aria-label="Fechar respostas" className="mono dim" style={{ fontSize: 16, padding: "0 4px" }}>✕</button>
        </div>

        <div style={{ padding: "16px 20px 40px", overflowY: "auto", flex: 1 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
            <SecondaryButton size="sm" onClick={() => copiar(formUrl(doc), "link copiado")}>Copiar link</SecondaryButton>
            <WaButton small href={`https://api.whatsapp.com/send?text=${encodeURIComponent(waText(doc, brand))}`}>WhatsApp</WaButton>
            <a href={formUrl(doc)} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, alignSelf: "center", color: "var(--accent)" }}>abrir ↗</a>
            {respondido && <SecondaryButton size="sm" onClick={() => copiar(answersText(doc), "respostas copiadas")}>Copiar respostas</SecondaryButton>}
            <span style={{ flex: 1 }} />
            {removing ? <span role="status" className="intform-note">Excluindo…</span> : <MoreMenu items={[{ label: "excluir formulário", tone: "neg", onClick: onRemove }]} />}
          </div>

          {!respondido && (
            <EmptyState
              title="O cliente ainda não respondeu"
              hint={kindOf(doc) === "nota_fiscal"
                ? "Mande o link no WhatsApp. Assim que ele enviar, o cadastro fiscal aparece aqui e vai pra ficha do cliente, pronto pro financeiro emitir."
                : "Mande o link no WhatsApp. Assim que ele enviar, as respostas aparecem aqui e o card do lead recebe o registro na timeline."}
            />
          )}

          {respondido && (doc.sections || []).map((sec) => {
            const qs = (sec.questions || []).filter((q) => a[q.key] !== undefined);
            if (!qs.length) return null;
            return (
              <div key={sec.key} style={{ marginBottom: 22 }}>
                <div className="kicker accent">{sec.title}</div>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 12 }}>
                  {qs.map((q) => {
                    const v = a[q.key];
                    // Bloco que repete (contas, rotas): cada linha vira um
                    // cartão de rótulo/valor. Tabela com 7 colunas de pergunta
                    // longa fica ilegível na largura do drawer e no celular.
                    if (Array.isArray(v)) {
                      return (
                        <div key={q.key}>
                          <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginBottom: 6 }}>{q.label}</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {v.map((row, i) => (
                              <div key={i} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "10px 12px" }}>
                                <span className="kicker">{`${q.rowLabel || "Item"} ${i + 1}`}</span>
                                <div className="resp-cols" style={{ "--cols": "repeat(2, minmax(0, 1fr))", gap: "8px 16px", marginTop: 6 }}>
                                  {(q.fields || []).map((f) => (
                                    <div key={f.key}>
                                      <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{f.label}</div>
                                      <div style={{ fontSize: 12.5, marginTop: 1 }}>{row[f.key] || "—"}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    if (typeof v === "boolean") {
                      return (
                        <div key={q.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "var(--fg-2)" }}>
                          <span style={{ color: v ? "var(--pos)" : "var(--neg)", fontWeight: 700 }}>{v ? "✓" : "✕"}</span>
                          <span>{q.label}</span>
                        </div>
                      );
                    }
                    return (
                      <div key={q.key}>
                        <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{q.label}</div>
                        <div style={{ fontSize: 13.5, marginTop: 2, whiteSpace: "pre-wrap" }}>{v || "—"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {respondido && doc.respondent && (
            <div style={{ background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: 16 }}>
              <div className="kicker accent">assinatura do termo</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 6 }}>{doc.respondent.name || "—"}</div>
              <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
                {[doc.respondent.doc, fmtAt(doc.respondent.at), doc.respondent.ip ? `IP ${doc.respondent.ip}` : ""].filter(Boolean).join(" · ")}
              </div>
              {(doc.term || []).map((p, i) => (
                <p key={i} style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 8, lineHeight: 1.5 }}>{p}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function IntegrationFormsScreen() {
  const [product] = useActiveSaas();
  const [items, setItems] = useS(null);
  const [err, setErr] = useS(null);
  const [tab, setTab] = useS("todos");
  const [tipo, setTipo] = useS("todos"); // integracao · nota_fiscal · todos
  const [q, setQ] = useS("");
  const [sel, setSel] = useS(null);
  const [asking, setAsking] = useS(false);
  const [removing, setRemoving] = useS(null);
  const requestId = useR(0);
  const brand = product?.name || "LeverAds";

  async function load() {
    const request = ++requestId.current;
    setErr(null);
    try {
      const all = await api.list("integration_forms", product?.id ? { saas: product.id } : {});
      if (request !== requestId.current) return;
      setItems((all || []).sort((a, b) => String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id))));
      setErr(null);
    } catch (e) { if (request === requestId.current) { setErr(e.message); setItems([]); } }
  }
  // Trocar de produto zera a tela: o pedido de um workspace não vale no outro.
  useE(() => {
    setItems(null); setSel(null); setAsking(false); load();
    return () => { requestId.current++; };
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remover(doc) {
    if (removing) return;
    if (!window.confirm(`Excluir o formulário de ${doc.customerName || "este cliente"}? O link para de funcionar${doc.status === "respondido" ? " e as respostas somem" : ""}.`)) return;
    setRemoving(doc.id);
    try {
      await api.remove("integration_forms", doc.id);
      setSel(null);
      setItems((cur) => (cur || []).filter((x) => x.id !== doc.id));
      toast("formulário excluído", "pos");
    } catch (e) { toast(`não deu pra excluir: ${e.message}`, "neg"); }
    finally { setRemoving(null); }
  }

  const list = (items || []).filter((x) => tipo === "todos" || kindOf(x) === tipo);
  const pendentes = list.filter((x) => x.status !== "respondido");
  const respondidos = list.filter((x) => x.status === "respondido");
  // A espera de cada pedido aberto (de createdAt): é a régua da faixa e da linha.
  const diasDe = (iso) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null;
  };
  const esperas = pendentes.map((x) => ({ nome: x.customerName, d: diasDe(x.createdAt) })).filter((x) => x.d != null);
  const maisLonga = esperas.length ? esperas.reduce((a, b) => (b.d > a.d ? b : a)) : null;
  const esperaMax = maisLonga?.d ?? null;
  const esperaMaxNome = maisLonga?.nome || "";
  const term = q.trim().toLowerCase();
  const visiveis = (tab === "pendente" ? pendentes : tab === "respondido" ? respondidos : list)
    .filter((x) => !term || `${x.customerName || ""} ${resumo(x)}`.toLowerCase().includes(term));

  return (
    <div className="intform-page" style={{ "--form-grid": FORM_GRID }}>
      <PageHead
        title="Formulário de Integração"
        sub="O cliente que fechou responde pelo link: como é a operação dele (antes da call) e os dados pra nota fiscal · com termo de veracidade assinado."
      >
        {Object.values(KINDS).map((k) => (
          <a key={k.key} className="intform-link" href={previewUrl(k.key)} target="_blank" rel="noreferrer">{`Perguntas · ${k.label}`}</a>
        ))}
        <PrimaryButton onClick={() => setAsking(true)}>Solicitar formulário</PrimaryButton>
      </PageHead>

      {!err && <section className="intform-stats capsule-navy" aria-label="Situação dos formulários">
        {[
          { label: "Aguardando resposta", value: pendentes.length, note: pendentes.length ? "antes de marcar a integração" : "ninguém devendo" },
          { label: "Espera mais longa", value: esperaMax == null ? "—" : `${esperaMax} ${esperaMax === 1 ? "dia" : "dias"}`, note: esperaMaxNome || "nenhum pedido aberto", tone: esperaMax >= 5 ? "var(--neg)" : "var(--fg-1)" },
          { label: "Respondidos", value: respondidos.length, note: respondidos.length ? `${respondidos.filter((x) => kindOf(x) === "integracao").length} integração · ${respondidos.filter((x) => kindOf(x) === "nota_fiscal").length} nota fiscal` : "nenhum respondido ainda", tone: respondidos.length ? "var(--pos)" : "var(--fg-1)" },
        ].map((stat) => <Card key={stat.label} style={{ padding: "14px 16px", background: "transparent", boxShadow: "none" }}>
          <div className="kicker">{stat.label}</div>
          <div className="intform-number tnum" style={{ color: stat.tone }}>{items === null ? "…" : stat.value}</div>
          <div className="intform-note">{items === null ? "carregando…" : stat.note}</div>
        </Card>)}
      </section>}

      <div className="intform-filters">
        <div className="intform-tabs" aria-label="Filtrar por situação">
          <FilterTab active={tab === "todos"} count={list.length} onClick={() => setTab("todos")}>Todos</FilterTab>
          <FilterTab active={tab === "pendente"} count={pendentes.length} onClick={() => setTab("pendente")}>Aguardando</FilterTab>
          <FilterTab active={tab === "respondido"} count={respondidos.length} onClick={() => setTab("respondido")}>Respondidos</FilterTab>
        </div>
        <select aria-label="Tipo de formulário" value={tipo} onChange={(e) => setTipo(e.target.value)} className="inp intform-kind-select">
          <option value="todos">todos os formulários</option>
          {Object.values(KINDS).map((k) => <option key={k.key} value={k.key}>{k.full}</option>)}
        </select>
        <input type="search" aria-label="Buscar cliente ou resposta" value={q} onChange={(e) => setQ(e.target.value)} className="inp" placeholder="buscar cliente…" />
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {err ? <div className="intform-feedback" role="alert">
          <div>Não foi possível carregar os formulários.</div>
          <SecondaryButton onClick={() => { setItems(null); load(); }}>Tentar novamente</SecondaryButton>
        </div> : items === null ? <div className="intform-feedback" role="status">Carregando formulários…</div> : !visiveis.length ? (
          <EmptyState
            title={list.length ? "Nada nesse filtro" : "Nenhum formulário pedido ainda"}
            hint={list.length ? "Troque a aba, o tipo ou limpe a busca." : "Solicite as informações da operação antes da call de integração, e os dados pra nota fiscal pro financeiro emitir sem pedir CNPJ no WhatsApp."}
            action={list.length ? <SecondaryButton onClick={() => { setTab("todos"); setTipo("todos"); setQ(""); }}>Limpar filtros</SecondaryButton> : <PrimaryButton onClick={() => setAsking(true)}>Solicitar formulário</PrimaryButton>}
          />
        ) : (
          <div className="tbl-x">
            <table className="intform-table" aria-label="Formulários pedidos aos clientes">
              <thead><tr>{["Cliente", "Situação", "O que veio", "Pedido por", "Ação"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>
                {visiveis.map((doc) => {
                  const responded = doc.status === "respondido";
                  const days = diasDe(doc.createdAt);
                  const wa = waLink(doc.phone);
                  const status = responded ? "respondido" : days == null ? "aguardando" : `aguardando há ${days} ${days === 1 ? "dia" : "dias"}`;
                  return <tr key={doc.id}>
                    <td data-label="Cliente">
                      <button className="intform-name" onClick={() => setSel(doc)} title={doc.customerName}>{doc.customerName || "(sem cliente)"}</button>
                      <div className="intform-meta"><b className="intform-kind-tag">{KINDS[kindOf(doc)].label}</b> · pedido {fmtDay(doc.createdAt)}</div>
                    </td>
                    <td data-label="Situação">
                      <span className="intform-status" style={{ color: responded ? "var(--pos)" : days >= 5 ? "var(--neg)" : "var(--warn)" }}>
                        <span aria-hidden="true" />{status}
                      </span>
                      {responded && <div className="intform-meta">{fmtDay(doc.respondedAt)} · termo assinado</div>}
                    </td>
                    <td data-label="O que veio" className="intform-summary" title={resumo(doc)}>{resumo(doc) || "—"}</td>
                    <td data-label="Pedido por" className="intform-author" title={doc.author ? displayName(doc.author) : ""}>{doc.author ? displayName(doc.author) : "—"}</td>
                    <td className="intform-actions">
                      {responded ? <SecondaryButton size="sm" onClick={() => setSel(doc)}>Ver respostas</SecondaryButton>
                        : wa ? <a className="intform-link" href={`${wa}?text=${encodeURIComponent(waText(doc, brand))}`} target="_blank" rel="noopener noreferrer" title="Abrir WhatsApp com o link do formulário">Cobrar</a>
                        : <SecondaryButton size="sm" onClick={() => copiar(formUrl(doc), "link copiado")}>Copiar link</SecondaryButton>}
                      {removing === doc.id ? <span role="status" className="intform-note">Excluindo…</span> : <MoreMenu items={[
                        { label: "ver formulário", onClick: () => setSel(doc) },
                        { label: "copiar link", onClick: () => copiar(formUrl(doc), "link copiado") },
                        !removing && { label: "excluir formulário", tone: "neg", onClick: () => remover(doc) },
                      ]} />}
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {asking && (
        <AskModal
          saas={product?.id}
          brand={brand}
          onClose={() => setAsking(false)}
          onCreated={(doc) => setItems((cur) => [doc, ...(cur || [])])}
        />
      )}
      {sel && <AnswersDrawer doc={sel} brand={brand} onClose={() => setSel(null)} onRemove={() => remover(sel)} removing={removing === sel.id} />}
    </div>
  );
}

export { IntegrationFormsScreen };
