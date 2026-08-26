import React from "react";
import { PageHead, StatTile, FilterTab } from "../components/viz.jsx";
import { EmptyState, PrimaryButton, SecondaryButton, WaButton, useEsc, toast } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { displayName } from "../lib/users.js";

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

const { useState: useS, useEffect: useE, useRef: useR, useMemo: useM } = React;

const publicBase = () => import.meta.env.VITE_API_BASE || window.location?.origin || "";
const formUrl = (doc) => `${publicBase()}/fi/${doc.id}`;

const fmtAt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";

// Mensagem pronta do pedido. A marca vem do workspace ativo (a tela existe pra
// LeverAds hoje, mas o texto não fica preso a ela).
function waText(doc, brand) {
  return `Oi ${firstName(doc.customerName)}! Aqui é da ${brand || "LeverAds"}. Antes da nossa call de integração, preenche este formulário rapidinho pra gente já deixar as suas contas configuradas do jeito certo: ${formUrl(doc)}`;
}

// Resumo de uma linha da resposta (mesma régua do servidor): é o que a lista
// mostra sem precisar abrir a ficha.
function resumo(doc) {
  const a = doc.answers || {};
  const partes = [];
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
  const linhas = [`FORMULÁRIO DE INTEGRAÇÃO · ${doc.customerName || "cliente"}`, `respondido em ${fmtAt(doc.respondedAt)}`, ""];
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
  const [kind, setKind] = useS("customer");
  const [q, setQ] = useS("");
  const [busy, setBusy] = useS(false);
  const [novo, setNovo] = useS(null); // pedido criado: a tela vira "copie o link"
  useEsc(busy ? null : onClose);

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
    <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.45)", display: "grid", placeItems: "center", zIndex: 80, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", background: "var(--bg-1)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 22 }}>
        {!novo ? (
          <>
            <div className="card-title">Solicitar formulário de integração</div>
            <div className="card-sub" style={{ marginTop: 2 }}>Escolha quem vai preencher. O link nasce único pra essa pessoa.</div>

            <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
              {[["customer", "Cliente"], ["lead", "Lead que fechou"]].map(([id, label]) => (
                <button key={id} onClick={() => setKind(id)} className="chip" style={{
                  cursor: "pointer", fontWeight: 600,
                  background: kind === id ? "var(--accent-soft)" : "var(--bg-2)",
                  color: kind === id ? "var(--accent)" : "var(--fg-3)",
                  boxShadow: kind === id ? "inset 0 0 0 1px var(--accent-line)" : "none",
                }}>{label}</button>
              ))}
            </div>

            <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="inp"
              placeholder={kind === "customer" ? "buscar cliente…" : "buscar lead por nome, e-mail ou telefone…"}
              style={{ width: "100%", marginTop: 10 }} />

            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
              {rows.map((d) => (
                <button key={d.id} disabled={busy} onClick={() => criar(d)}
                  style={{ textAlign: "left", padding: "9px 10px", borderRadius: "var(--r-2)", background: "transparent", border: "1px solid transparent", cursor: busy ? "default" : "pointer" }}
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
              <SecondaryButton onClick={onClose}>Fechar</SecondaryButton>
            </div>
          </>
        ) : (
          <>
            <div className="card-title">Link criado para {novo.customerName || "o cliente"}</div>
            <div className="card-sub" style={{ marginTop: 2 }}>Mande no WhatsApp. O formulário só pode ser respondido uma vez.</div>
            <div className="mono" style={{ marginTop: 14, padding: "10px 12px", background: "var(--bg-2)", borderRadius: "var(--r-2)", fontSize: 11.5, wordBreak: "break-all" }}>{formUrl(novo)}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <PrimaryButton onClick={() => copiar(formUrl(novo), "link copiado")}>Copiar link</PrimaryButton>
              <WaButton href={`https://api.whatsapp.com/send?text=${encodeURIComponent(waText(novo, brand))}`}>Mandar no WhatsApp</WaButton>
              <SecondaryButton onClick={onClose}>Fechar</SecondaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Ficha da resposta ───────────────────────────────────────────────────────
// Renderiza o SNAPSHOT gravado no envio (doc.sections), não a definição atual:
// o questionário evolui, mas a resposta continua sendo lida com os rótulos com
// que foi feita.
function AnswersDrawer({ doc, brand, onClose, onRemove }) {
  useEsc(onClose);
  const a = doc.answers || {};
  const respondido = doc.status === "respondido";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", display: "flex", justifyContent: "flex-end", zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 100vw)", height: "100%", background: "var(--bg-1)", borderLeft: "1px solid var(--line-2)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-pop)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="kicker">{respondido ? `respondido em ${fmtAt(doc.respondedAt)}` : "aguardando o cliente"}</div>
            <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {doc.customerName || "sem cliente"}
            </div>
          </div>
          <button onClick={onClose} className="mono dim" style={{ fontSize: 16, padding: "0 4px" }}>✕</button>
        </div>

        <div style={{ padding: "16px 20px 40px", overflowY: "auto", flex: 1 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
            <SecondaryButton size="sm" onClick={() => copiar(formUrl(doc), "link copiado")}>Copiar link</SecondaryButton>
            <WaButton small href={`https://api.whatsapp.com/send?text=${encodeURIComponent(waText(doc, brand))}`}>WhatsApp</WaButton>
            <a href={formUrl(doc)} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, alignSelf: "center", color: "var(--accent)" }}>abrir ↗</a>
            {respondido && <SecondaryButton size="sm" onClick={() => copiar(answersText(doc), "respostas copiadas")}>Copiar respostas</SecondaryButton>}
            <span style={{ flex: 1 }} />
            <SecondaryButton size="sm" onClick={onRemove} style={{ color: "var(--neg)" }}>Excluir</SecondaryButton>
          </div>

          {!respondido && (
            <EmptyState
              title="O cliente ainda não respondeu"
              hint="Mande o link no WhatsApp. Assim que ele enviar, as respostas aparecem aqui e o card do lead recebe o registro na timeline."
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
                                      <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{f.label}</div>
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
    </div>
  );
}

function IntegrationFormsScreen() {
  const [product] = useActiveSaas();
  const [items, setItems] = useS(null);
  const [err, setErr] = useS(null);
  const [tab, setTab] = useS("todos");
  const [q, setQ] = useS("");
  const [sel, setSel] = useS(null);
  const [asking, setAsking] = useS(false);
  const brand = product?.name || "LeverAds";

  async function load() {
    try {
      const all = await api.list("integration_forms", product?.id ? { saas: product.id } : {});
      setItems((all || []).sort((a, b) => String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id))));
      setErr(null);
    } catch (e) { setErr(e.message); setItems([]); }
  }
  // Trocar de produto zera a tela: o pedido de um workspace não vale no outro.
  useE(() => { setItems(null); setSel(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [product?.id]);

  async function remover(doc) {
    if (!window.confirm(`Excluir o formulário de ${doc.customerName || "este cliente"}? O link para de funcionar${doc.status === "respondido" ? " e as respostas somem" : ""}.`)) return;
    try {
      await api.remove("integration_forms", doc.id);
      setSel(null);
      setItems((cur) => (cur || []).filter((x) => x.id !== doc.id));
      toast("formulário excluído", "pos");
    } catch (e) { toast(`não deu pra excluir: ${e.message}`, "neg"); }
  }

  const list = items || [];
  const pendentes = list.filter((x) => x.status !== "respondido");
  const respondidos = list.filter((x) => x.status === "respondido");
  const term = q.trim().toLowerCase();
  const visiveis = (tab === "pendente" ? pendentes : tab === "respondido" ? respondidos : list)
    .filter((x) => !term || `${x.customerName || ""} ${resumo(x)}`.toLowerCase().includes(term));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead
        title="Formulário de Integração"
        sub="O cliente que acabou de fechar responde como é a operação dele antes da call de integração. Tudo obrigatório, com termo de veracidade assinado."
      >
        <a href={`${publicBase()}/fi/preview`} target="_blank" rel="noreferrer">
          <SecondaryButton>Ver perguntas</SecondaryButton>
        </a>
        <PrimaryButton onClick={() => setAsking(true)}>Solicitar formulário</PrimaryButton>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px" }}>
      <div className="resp-cols" style={{ "--cols": "repeat(3, 1fr)", gap: 14 }}>
        <StatTile label="Aguardando resposta" value={items === null ? "…" : pendentes.length} />
        <StatTile label="Respondidos" value={items === null ? "…" : respondidos.length} />
        <StatTile label="Total de pedidos" value={items === null ? "…" : list.length} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 20, flexWrap: "wrap" }}>
        <FilterTab active={tab === "todos"} count={list.length} onClick={() => setTab("todos")}>Todos</FilterTab>
        <FilterTab active={tab === "pendente"} count={pendentes.length} onClick={() => setTab("pendente")}>Aguardando</FilterTab>
        <FilterTab active={tab === "respondido"} count={respondidos.length} onClick={() => setTab("respondido")}>Respondidos</FilterTab>
        <span style={{ flex: 1 }} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="inp" placeholder="buscar cliente…" style={{ width: "min(100%, 240px)" }} />
      </div>

      {err && <div style={{ marginTop: 14, color: "var(--neg)", fontSize: 12.5 }}>não deu pra carregar: {err}</div>}

      <div style={{ marginTop: 14, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
        {items === null && <div className="mono dim" style={{ fontSize: 12, padding: 20 }}>carregando…</div>}
        {items !== null && !visiveis.length && (
          <EmptyState
            title={list.length ? "Nada nesse filtro" : "Nenhum formulário pedido ainda"}
            hint={list.length ? "Troque a aba ou limpe a busca." : "Fechou um cliente? Peça o formulário antes de marcar a call de integração: o integrador chega sabendo as contas, as rotas de clonagem e as regras de preço."}
            action={!list.length ? <PrimaryButton onClick={() => setAsking(true)}>Solicitar formulário</PrimaryButton> : null}
          />
        )}
        {items !== null && !!visiveis.length && (
          <div className="tbl-x">
            <table className="tbl" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-2)" }}>
                  <th className="kicker" style={{ padding: "8px 12px", textAlign: "left" }}>Cliente</th>
                  <th className="kicker" style={{ padding: "8px 12px", textAlign: "left" }}>Situação</th>
                  <th className="kicker" style={{ padding: "8px 12px", textAlign: "left" }}>O que veio</th>
                  <th className="kicker" style={{ padding: "8px 12px", textAlign: "left" }}>Pedido em</th>
                  <th className="kicker" style={{ padding: "8px 12px", textAlign: "left" }}>Pedido por</th>
                  <th className="kicker" style={{ padding: "8px 12px", textAlign: "right" }}>Link</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((doc) => (
                  <tr key={doc.id} data-click onClick={() => setSel(doc)}>
                    <td style={{ fontWeight: 500 }}>{doc.customerName || "(sem cliente)"}</td>
                    <td>
                      {doc.status === "respondido"
                        ? <span className="chip pos">respondido em {fmtDay(doc.respondedAt)}</span>
                        : <span className="chip warn">aguardando</span>}
                    </td>
                    <td className="dim">{resumo(doc) || "—"}</td>
                    <td className="mono dim" style={{ fontSize: 11.5 }}>{fmtDay(doc.createdAt)}</td>
                    <td className="dim">{doc.author ? displayName(doc.author) : "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                      <SecondaryButton size="sm" onClick={() => copiar(formUrl(doc), "link copiado")}>copiar</SecondaryButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </div>

      {asking && (
        <AskModal
          saas={product?.id}
          brand={brand}
          onClose={() => setAsking(false)}
          onCreated={(doc) => setItems((cur) => [doc, ...(cur || [])])}
        />
      )}
      {sel && <AnswersDrawer doc={sel} brand={brand} onClose={() => setSel(null)} onRemove={() => remover(sel)} />}
    </div>
  );
}

export { IntegrationFormsScreen };
