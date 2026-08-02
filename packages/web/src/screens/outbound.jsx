import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { waLink } from "../lib/ui.js";

// Outbound — o RADAR DE CONTAS do Cold Calling 2.0 (Receita Previsível).
// A prospecção ativa vive aqui, SEPARADA do pipeline: conta-alvo não é lead
// ainda, é uma empresa no PIC que o SDR vai trabalhar. O funil é a "linha de
// montagem" do livro (8 status de conta, p.124-126): fria → em prospecção →
// vira lead ("oportunidade ativa", cria o card no pipeline com classe ALVO)
// ou estaciona em nutrir/sem-perfil. Regras que a tela respeita:
//   - nunca prospectar cliente atual (status próprio esconde da fila);
//   - profundo > raso: melhor 10 contas trabalhadas 10x que 100 tocadas 1x;
//   - virar lead cria o lead com source "Outbound · radar" + outbound:true —
//     é o que carimba a classe Alvo nas métricas (leadClassOf, metrics-core).

const { useState: useS, useEffect: useE, useMemo: useM } = React;

// Os 8 status de conta do livro, adaptados: "oportunidade" e "encerrada" são
// espelho do que aconteceu no pipeline; os demais são a fila do SDR.
export const OUTBOUND_STATUS = [
  { key: "fria", label: "Fria", hint: "nenhuma atividade ainda" },
  { key: "prospectando", label: "Em prospecção", hint: "SDR contatando e pesquisando" },
  { key: "nutrir", label: "Nutrir · trimestral", hint: "sem oportunidade agora; revisitar a cada 3 meses" },
  { key: "oportunidade", label: "Oportunidade ativa", hint: "virou lead no pipeline (classe Alvo)" },
  { key: "encerrada", label: "Oport. encerrada", hint: "perdeu; conta especial: maior chance futura" },
  { key: "cliente", label: "Cliente", hint: "da casa; nunca prospectar" },
  { key: "sem-perfil", label: "Sem perfil", hint: "fora do PIC; não gastar tempo" },
  { key: "duplicada", label: "Duplicada", hint: "registro repetido" },
];
const statusLabel = (k) => OUTBOUND_STATUS.find((s) => s.key === k)?.label || k || "—";

const IMPORT_HINT = "uma conta por linha, campos separados por ; nesta ordem:\nnome; whatsapp; email; instagram; anúncios; nicho; marketplace; cidade; site";

const chip = (active) => ({
  padding: "5px 10px", borderRadius: 999, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
  border: "1px solid " + (active ? "var(--accent)" : "var(--line-2)"),
  background: active ? "var(--accent-soft)" : "var(--bg-1)",
  color: active ? "var(--accent)" : "var(--fg-2)", fontWeight: active ? 600 : 500,
});
const inputS = { height: 30, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 12.5, minWidth: 0 };
const btnS = { height: 30, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 12.5, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" };
const btnPrimary = { ...btnS, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-fg, #fff)", fontWeight: 600 };

function fmtDay(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—";
}

function OutboundScreen({ onOpenLead }) {
  const [product] = useActiveSaas();
  const [rows, setRows] = useS(null);
  const [filter, setFilter] = useS("");     // status ativo ("" = fila de trabalho)
  const [q, setQ] = useS("");
  const [showImport, setShowImport] = useS(false);
  const [importText, setImportText] = useS("");
  const [busy, setBusy] = useS("");

  const load = () => api.list("outbound_accounts", { saas: product?.id })
    .then((all) => setRows((all || []).filter((a) => a.saas === product?.id)))
    .catch(() => setRows([]));
  useE(() => { if (product?.id) { setRows(null); load(); } }, [product?.id]); // eslint-disable-line

  const counts = useM(() => {
    const c = {};
    for (const a of rows || []) c[a.status || "fria"] = (c[a.status || "fria"] || 0) + 1;
    return c;
  }, [rows]);

  // Fila de trabalho (filtro vazio) = só o que o SDR deve olhar: fria + em
  // prospecção. Cliente/sem-perfil/duplicada ficam atrás do próprio chip.
  const visible = useM(() => {
    let list = rows || [];
    if (filter) list = list.filter((a) => (a.status || "fria") === filter);
    else list = list.filter((a) => ["fria", "prospectando", ""].includes(a.status || ""));
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((a) => [a.name, a.niche, a.marketplace, a.city, a.instagram, a.email].join(" ").toLowerCase().includes(needle));
    return [...list].sort((a, b) => String(a.status || "").localeCompare(String(b.status || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }, [rows, filter, q]);

  const patch = (acc, p) => {
    setRows((prev) => (prev || []).map((r) => (r.id === acc.id ? { ...r, ...p } : r)));
    api.update("outbound_accounts", acc.id, p).catch(() => {});
  };

  // Toque registrado ao abrir o WhatsApp da conta: fria vira "em prospecção" e
  // lastTouchAt marca a data (a régua "profundo > raso" precisa saber quando).
  const touched = (acc) => {
    const p = { lastTouchAt: new Date().toISOString() };
    if (!acc.status || acc.status === "fria") p.status = "prospectando";
    patch(acc, p);
  };

  // openLead do app espera o OBJETO do lead (drawer), não o id.
  const openLeadById = (id) => {
    const l = (window.SEED?.LEADS || []).find((x) => x.id === id);
    if (l && onOpenLead) onOpenLead(l);
    else window.alert("Recarregue a página pra abrir esse lead (acabou de ser criado).");
  };

  async function toLead(acc) {
    if (acc.leadId) { openLeadById(acc.leadId); return; }
    setBusy(acc.id);
    try {
      // source + outbound carimbam a classe ALVO nas métricas; o servidor
      // aplica dono (autoLeadOwner) e cadência normalmente.
      const lead = await api.create("leads", {
        saas: product.id,
        name: acc.name || "",
        company: acc.name || "",
        phone: acc.phone || "",
        email: acc.email || "",
        niche: acc.niche || "",
        listings: acc.listings || "",
        sourceUrl: acc.site || "",
        source: "Outbound · radar",
        outbound: true,
        comments: [acc.marketplace && `marketplace: ${acc.marketplace}`, acc.instagram && `IG: ${acc.instagram}`, acc.notes].filter(Boolean).join(" · "),
      });
      patch(acc, { status: "oportunidade", leadId: lead?.id || "", lastTouchAt: new Date().toISOString() });
      if (lead?.id && onOpenLead) onOpenLead(lead);
    } catch (e) {
      window.alert(e?.message || "não deu pra criar o lead");
    } finally { setBusy(""); }
  }

  async function runImport() {
    const lines = importText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setBusy("import");
    let ok = 0;
    try {
      for (const line of lines) {
        const [name, phone, email, instagram, listings, niche, marketplace, city, site] = line.split(";").map((s) => (s || "").trim());
        if (!name) continue;
        await api.create("outbound_accounts", {
          saas: product.id, name, phone, email, instagram, listings, niche, marketplace, city, site,
          status: "fria", createdAt: new Date().toISOString(),
        });
        ok++;
      }
      setImportText("");
      setShowImport(false);
      load();
      window.alert(`${ok} conta${ok === 1 ? "" : "s"} importada${ok === 1 ? "" : "s"}.`);
    } catch (e) {
      window.alert(`importei ${ok} e parei: ${e?.message || "erro"}`);
      load();
    } finally { setBusy(""); }
  }

  if (!product) return <EmptyState title="Escolha um produto" />;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Outbound" sub="radar de contas · Cold Calling 2.0 · a classe Alvo nasce aqui" />
      <div style={{ padding: "14px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Filtros por status + busca + ações */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button style={chip(filter === "")} onClick={() => setFilter("")} title="Fria + em prospecção: o que o SDR trabalha hoje">
            fila de trabalho {((counts["fria"] || 0) + (counts["prospectando"] || 0)) || ""}
          </button>
          {OUTBOUND_STATUS.map((s) => (
            <button key={s.key} style={chip(filter === s.key)} onClick={() => setFilter(filter === s.key ? "" : s.key)} title={s.hint}>
              {s.label.toLowerCase()} {counts[s.key] ? counts[s.key] : ""}
            </button>
          ))}
          <input placeholder="buscar conta, nicho…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inputS, marginLeft: "auto", width: 190 }} />
          <button style={btnS} onClick={() => setShowImport((v) => !v)}>{showImport ? "fechar importação" : "importar lista"}</button>
        </div>

        {/* Importação em massa: cola a lista do radar (planilha → ;) e pronto. */}
        {showImport && (
          <div style={{ padding: 12, borderRadius: "var(--r-3)", border: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--fg-3)", whiteSpace: "pre-line" }}>{IMPORT_HINT}</div>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={6}
              placeholder={"Loja do João; 41999998888; joao@loja.com; @lojadojoao; 1200; autopeças; ML; Curitiba; https://loja.com"}
              style={{ padding: 9, borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 12.5, fontFamily: "var(--mono)", resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btnPrimary} disabled={busy === "import"} onClick={runImport}>{busy === "import" ? "importando…" : "importar contas"}</button>
              <span style={{ fontSize: 11.5, color: "var(--fg-4)", alignSelf: "center" }}>só o nome é obrigatório; o resto completa depois</span>
            </div>
          </div>
        )}

        {/* A lista */}
        {rows == null && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
        {rows != null && visible.length === 0 && (
          <EmptyState title={filter ? "Nada nesse status" : "Radar vazio"}
            hint={filter ? "troque o filtro acima" : "importe a lista de contas-alvo (sellers no PIC) e comece a prospecção"} />
        )}
        {visible.length > 0 && (
          <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 860 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--fg-3)", fontSize: 11 }}>
                  {["Conta", "Nicho", "Anúncios", "Mkt", "Contato", "Status", "Último toque", "Notas", ""].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid var(--line-1)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id} style={{ borderBottom: "1px solid var(--line-faint)" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {a.name}
                      {a.city && <span style={{ fontWeight: 400, color: "var(--fg-4)", fontSize: 11 }}> · {a.city}</span>}
                      <div style={{ display: "flex", gap: 6, fontSize: 10.5, fontWeight: 400 }}>
                        {a.site && <a href={a.site} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>site ↗</a>}
                        {a.instagram && <a href={`https://instagram.com/${String(a.instagram).replace(/^@/, "")}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{String(a.instagram).startsWith("@") ? a.instagram : "@" + a.instagram}</a>}
                      </div>
                    </td>
                    <td style={{ padding: "7px 10px" }}>{a.niche || "—"}</td>
                    <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>{a.listings || "—"}</td>
                    <td style={{ padding: "7px 10px" }}>{a.marketplace || "—"}</td>
                    <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                      {a.phone && (
                        <a href={waLink(a.phone)} target="_blank" rel="noreferrer" onClick={() => touched(a)}
                          style={{ marginRight: 8, color: "var(--pos)", fontWeight: 600, textDecoration: "none" }} title="abrir WhatsApp (marca o toque)">✆ wpp</a>
                      )}
                      {a.email && <a href={`mailto:${a.email}`} onClick={() => touched(a)} style={{ color: "var(--accent)", textDecoration: "none" }} title={a.email}>✉ email</a>}
                      {!a.phone && !a.email && <span style={{ color: "var(--fg-4)" }}>—</span>}
                    </td>
                    <td style={{ padding: "7px 10px" }}>
                      <select value={a.status || "fria"} onChange={(e) => patch(a, { status: e.target.value })}
                        title={OUTBOUND_STATUS.find((s) => s.key === (a.status || "fria"))?.hint}
                        style={{ ...inputS, height: 26, fontSize: 11.5 }}>
                        {OUTBOUND_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "7px 10px", whiteSpace: "nowrap", color: "var(--fg-3)" }}>{fmtDay(a.lastTouchAt)}</td>
                    <td style={{ padding: "7px 10px", minWidth: 160 }}>
                      <input defaultValue={a.notes || ""} placeholder="notas…"
                        onBlur={(e) => e.target.value !== (a.notes || "") && patch(a, { notes: e.target.value })}
                        style={{ ...inputS, height: 26, width: "100%", fontSize: 11.5 }} />
                    </td>
                    <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                      {a.leadId ? (
                        <button style={{ ...btnS, height: 26, fontSize: 11.5 }} onClick={() => openLeadById(a.leadId)}>abrir lead ↗</button>
                      ) : (
                        <button style={{ ...btnPrimary, height: 26, fontSize: 11.5 }} disabled={busy === a.id} onClick={() => toLead(a)}
                          title="Cria o lead no pipeline com classe Alvo (source Outbound · radar) e marca a conta como oportunidade ativa">
                          {busy === a.id ? "criando…" : "▶ virar lead"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
          Regras do livro: profundo &gt; raso (10 contas trabalhadas 10x &gt; 100 tocadas 1x) · não desista de conta NO perfil até um não do decisor · desista rápido de conta SEM perfil · nunca prospecte cliente da casa.
        </div>
      </div>
    </div>
  );
}

export { OutboundScreen };
