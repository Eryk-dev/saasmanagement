import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { Card, Pill, Segmented } from "./viz.jsx";
import { SelectPopover } from "./select-popover.jsx";
import { SwitchRow } from "./form-controls.jsx";
import { EmptyState, PrimaryButton, SecondaryButton, Sparkline } from "../atoms.jsx";

// Aba Robô da Inbox (só admin; a API recusa quem não é): qual IA responde as
// conversas do robô SDR, os ajustes que antes só mudavam por PATCH no
// product.sdrBot, o uso da IA e a auditoria das regras. Ligar/desligar o robô
// e as frentes dele continua no card "SDR automático" da aba Automações.

const PROVIDERS = [
  { value: "", label: "Padrão do servidor" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "anthropic", label: "Claude (Anthropic)" },
];
const PROVIDER_NAME = { openrouter: "OpenRouter", anthropic: "Claude (Anthropic)" };
const KEY_NAME = { openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
const REPLAY_TAG = "robo";

const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString("pt-BR");
const fmtTokens = (n) => {
  const v = Number(n) || 0;
  return v >= 1e6 ? `${(v / 1e6).toFixed(1).replace(".", ",")} mi` : v >= 1e3 ? `${Math.round(v / 1e3)} mil` : String(v);
};
const fmtUsd = (v) => `US$ ${v.toFixed(2).replace(".", ",")}`;
const priceHint = (m) => (m.priceIn != null && m.priceOut != null ? `$${m.priceIn} · $${m.priceOut}` : "");

const field = { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 };
const fieldLabel = { fontSize: 12, color: "var(--fg-3)" };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 };
const body = { padding: "14px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 14 };
const note = (ok) => ({ fontSize: 12, color: ok ? "var(--pos)" : "var(--neg)" });

function NumField({ label, value, onChange, suffix, hint }) {
  return (
    <label style={field} title={hint}>
      <span style={fieldLabel}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input className="inp" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 90 }} />
        {suffix && <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{suffix}</span>}
      </span>
    </label>
  );
}

function AiCard({ product, cfg, onSaved }) {
  const [provider, setProvider] = useState(cfg.ai.provider);
  const [model, setModel] = useState(cfg.ai.model);
  const [models, setModels] = useState({}); // provider → lista | { error }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [replay, setReplay] = useState(null);
  const [runs, setRuns] = useState([]);

  useEffect(() => {
    if (!provider || models[provider] || !cfg.providers[provider]) return;
    api.sdrModels(provider)
      .then((r) => setModels((m) => ({ ...m, [provider]: r.models || [] })))
      .catch((e) => setModels((m) => ({ ...m, [provider]: { error: e.message || "não deu pra listar os modelos" } })));
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadReplay = () => {
    api.sdrReplayStatus(REPLAY_TAG).then(setReplay).catch(() => {});
    api.sdrReplayRuns().then((r) => setRuns(r.runs || [])).catch(() => {});
  };
  useEffect(loadReplay, []);
  useEffect(() => {
    if (replay?.status !== "running") return;
    const t = setInterval(loadReplay, 5000);
    return () => clearInterval(t);
  }, [replay?.status]);

  const list = Array.isArray(models[provider]) ? models[provider] : [];
  const listError = models[provider]?.error || "";
  const options = useMemo(() => {
    const opts = list.map((m) => ({ value: m.id, label: m.name === m.id ? m.id : `${m.name} · ${m.id}`, hint: priceHint(m) }));
    if (model && !opts.some((o) => o.value === model)) opts.unshift({ value: model, label: model, hint: "salvo" });
    return opts;
  }, [list, model]);

  const dirty = provider !== cfg.ai.provider || model !== cfg.ai.model;
  const noKey = provider && !cfg.providers[provider];

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const next = await api.sdrConfigSave(product.id, { ai: { provider, model: provider ? model : "" } });
      onSaved(next);
      setMsg({ ok: true, text: "Salvo. Vale a partir da próxima mensagem que o robô responder." });
    } catch (e) { setMsg({ ok: false, text: e.message || "não deu pra salvar" }); }
    finally { setBusy(false); }
  }
  async function test() {
    setMsg(null);
    try {
      await api.sdrReplayStart(product.id, { provider, model, tag: REPLAY_TAG, threads: 25, turns: 3 });
      loadReplay();
    } catch (e) { setMsg({ ok: false, text: e.message || "não deu pra iniciar a bateria" }); }
  }

  const eff = cfg.effective;
  const running = replay?.status === "running";
  return (
    <Card title="IA do robô" hint="o modelo que responde as conversas do robô SDR · resumo de call, blog e o resto do cockpit seguem no padrão do servidor">
      <div style={body}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <span style={{ color: "var(--fg-3)" }}>Responde hoje com</span>
          <span className="mono" style={{ fontWeight: 600 }}>{eff.model || "—"}</span>
          {eff.provider && <Pill tone="mut">{PROVIDER_NAME[eff.provider] || eff.provider}</Pill>}
          {!cfg.conversation && <Pill tone="warn" title="Liga na aba Automações, card SDR automático">conversa com IA desligada</Pill>}
        </div>
        {eff.fallback && <div style={note(false)}>{eff.fallback}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={fieldLabel}>Provedor</span>
          <Segmented value={provider} options={PROVIDERS} onChange={(v) => { setProvider(v); setModel(v === cfg.ai.provider ? cfg.ai.model : ""); }} />
          {!provider && (
            <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
              {cfg.default.model ? `${cfg.default.model} via ${PROVIDER_NAME[cfg.default.provider] || cfg.default.provider} (AI_MODEL no servidor)` : "sem IA configurada no servidor"}
            </span>
          )}
          {noKey && <span style={note(false)}>{KEY_NAME[provider]} não está no servidor: salvar não troca nada até a chave entrar.</span>}
        </div>

        {provider && !noKey && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={fieldLabel}>Modelo {provider === "openrouter" && <span className="dim">· preço por 1M tokens (entrada · saída)</span>}</span>
            {listError ? (
              <>
                <input className="inp" value={model} onChange={(e) => setModel(e.target.value.trim())} placeholder="slug do modelo, ex.: anthropic/claude-sonnet-5-5" />
                <span style={note(false)}>{listError}</span>
              </>
            ) : (
              <SelectPopover value={model} options={options} onChange={setModel} searchable label="Modelo"
                placeholder={models[provider] ? "padrão do provedor" : "carregando modelos…"} />
            )}
            {provider === "openrouter" && <span style={{ fontSize: 12, color: "var(--fg-3)" }}>A lista mostra só modelos com saída estruturada, que o robô exige.</span>}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <SecondaryButton onClick={test} disabled={running || !!noKey}>
              {running ? `testando… ${replay?.progress?.done ?? 0}/${replay?.progress?.total ?? "?"}` : "Testar na bateria de replay"}
            </SecondaryButton>
            <span style={{ fontSize: 12, color: "var(--fg-3)" }}>roda a escolha em 25 conversas reais, sem mandar nada pra ninguém</span>
          </div>
          {replay?.status === "error" && <span style={note(false)}>{replay.error}</span>}
          {runs.length > 0 && (
            <div className="tbl-x">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead><tr>{["modelo", "quando", "agendaria", "pediria humano", "trava de preço", "erros"].map((h) => <th key={h} className="kicker" style={{ padding: "8px 10px", textAlign: "left" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {runs.slice(0, 6).map((r) => (
                    <tr key={r.id}>
                      <td className="mono" style={{ padding: "7px 10px", borderTop: "1px solid var(--line-1)" }}>{r.model || "—"}</td>
                      <td style={{ padding: "7px 10px", borderTop: "1px solid var(--line-1)", whiteSpace: "nowrap" }}>{r.startedAt ? new Date(r.startedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}{r.status === "running" ? " · rodando" : ""}</td>
                      <td className="tnum" style={{ padding: "7px 10px", borderTop: "1px solid var(--line-1)" }}>{r.report ? `${r.report.wouldBookThreads ?? 0} de ${r.report.threads ?? 0}` : "—"}</td>
                      <td className="tnum" style={{ padding: "7px 10px", borderTop: "1px solid var(--line-1)" }}>{r.report?.actions?.humano ?? 0}</td>
                      <td className="tnum" style={{ padding: "7px 10px", borderTop: "1px solid var(--line-1)" }}>{r.report?.priceGuardHits ?? 0}</td>
                      <td className="tnum" style={{ padding: "7px 10px", borderTop: "1px solid var(--line-1)", color: r.report?.errors ? "var(--neg)" : undefined }}>{r.report?.errors ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
          {msg && <span style={note(msg.ok)}>{msg.text}</span>}
          <PrimaryButton onClick={save} disabled={busy || !dirty}>{busy ? "Salvando…" : "Salvar IA"}</PrimaryButton>
        </div>
      </div>
    </Card>
  );
}

const toDraft = (v) => ({
  ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "number" ? String(x) : x])),
  ladderWarmDays: (v.ladderWarmDays || []).join(", "),
});
const NUM_KEYS = ["humanMuteHours", "humanMuteHourStart", "humanMuteHourEnd", "debounceSec", "freshHours", "ladderColdDays", "ladderDropHours", "ladderPerDay", "ladderCooldownDays", "backlogRescuePerBatch", "backlogRescueMaxFailPct", "backlogRescueMinSample"];

function AdvancedCard({ product, cfg, onSaved }) {
  const [d, setD] = useState(() => toDraft(cfg.values));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));

  async function save() {
    const patch = { ...d, ladderWarmDays: String(d.ladderWarmDays).split(/[,;\s]+/).filter(Boolean).map(Number) };
    for (const k of NUM_KEYS) patch[k] = Number(String(d[k]).replace(",", "."));
    setBusy(true); setMsg(null);
    try {
      const next = await api.sdrConfigSave(product.id, patch);
      onSaved(next);
      setD(toDraft(next.values));
      setMsg({ ok: true, text: "Ajustes salvos." });
    } catch (e) { setMsg({ ok: false, text: e.message || "não deu pra salvar" }); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Ajustes avançados" hint="o que antes só mudava direto no banco · os padrões vieram das campanhas medidas (sdr-flow.js)">
      <div style={body}>
        <div className="kicker">Pausa quando alguém do time fala</div>
        <div style={grid}>
          <NumField label="O robô fica calado por" suffix="h" value={d.humanMuteHours} onChange={set("humanMuteHours")} hint="Depois que alguém do time escreve na conversa, o robô espera esse tempo antes de voltar a responder." />
        </div>
        <SwitchRow checked={!!d.humanMuteOffHours} onChange={set("humanMuteOffHours")} title="Ignorar a pausa fora do horário comercial"
          hint="Fora do horário abaixo (e no fim de semana) o robô responde mesmo que alguém do time tenha falado há pouco. Pedido de gente (handoff) continua calando." />
        {d.humanMuteOffHours && (
          <div style={grid}>
            <NumField label="Horário comercial, seg a sex, das" suffix="h" value={d.humanMuteHourStart} onChange={set("humanMuteHourStart")} />
            <NumField label="às" suffix="h" value={d.humanMuteHourEnd} onChange={set("humanMuteHourEnd")} />
          </div>
        )}

        <div className="kicker">Conversa</div>
        <div style={grid}>
          <NumField label="Espera a rajada de mensagens" suffix="s" value={d.debounceSec} onChange={set("debounceSec")} hint="Chegou outra mensagem no meio, só a última responde, juntando a rajada inteira." />
          <NumField label="Lead mais velho que isso é do time" suffix="h" value={d.freshHours} onChange={set("freshHours")} />
        </div>

        <div className="kicker">Escada de retomada</div>
        <div style={grid}>
          <NumField label="Frio: encerra no" suffix="º dia" value={d.ladderColdDays} onChange={set("ladderColdDays")} hint="Quem nunca respondeu: 1º toque, 24h e o encerramento neste dia." />
          <label style={field} title="Quem respondeu e sumiu: dias contados da última mensagem dele.">
            <span style={fieldLabel}>Morno: retoma nos dias</span>
            <input className="inp" value={d.ladderWarmDays} onChange={(e) => set("ladderWarmDays")(e.target.value)} placeholder="3, 8, 13" style={{ width: 140 }} />
          </label>
          <NumField label="Sem resposta após o último" suffix="h" value={d.ladderDropHours} onChange={set("ladderDropHours")} />
          <NumField label="Teto por dia" suffix="mensagens" value={d.ladderPerDay} onChange={set("ladderPerDay")} />
          <NumField label="Intervalo mínimo por lead" suffix="dias" value={d.ladderCooldownDays} onChange={set("ladderCooldownDays")} />
        </div>
        <SwitchRow checked={!!d.ladderDrop} onChange={set("ladderDrop")} title="Mover pra Nutrição no fim da escada" hint="Desligado, o card fica onde está depois do último degrau." />

        <div className="kicker">Campanha de resgate do backlog</div>
        <SwitchRow checked={!!d.backlogRescue} onChange={set("backlogRescue")} title="Resgatar o backlog (Qualificando + Nutrição)" hint="Lotes a cada meia hora em dias úteis, mais novos primeiro. Pausa sozinha se a Meta começar a recusar entrega." />
        <div style={grid}>
          <NumField label="Lote" suffix="leads" value={d.backlogRescuePerBatch} onChange={set("backlogRescuePerBatch")} />
          <NumField label="Pausa com falha acima de" suffix="%" value={d.backlogRescueMaxFailPct} onChange={set("backlogRescueMaxFailPct")} />
          <NumField label="Amostra mínima pra pausar" suffix="msgs" value={d.backlogRescueMinSample} onChange={set("backlogRescueMinSample")} />
        </div>

        <div className="kicker">Versões da IA</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <div style={field}><span style={fieldLabel}>Prompt</span><Segmented value={d.promptVersion} options={[{ value: "v1", label: "v1" }, { value: "v2", label: "v2 (rulebook)" }]} onChange={set("promptVersion")} /></div>
          <div style={field}>
            <span style={fieldLabel}>Contrato da oferta</span>
            <Segmented value={d.promptVersion === "v2" ? "v2" : d.offerContract} options={[{ value: "v1", label: "v1" }, { value: "v2", label: "v2 (horário por id)" }]} onChange={(v) => d.promptVersion !== "v2" && set("offerContract")(v)} />
            {d.promptVersion === "v2" && <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>o prompt v2 já usa o contrato v2</span>}
          </div>
          <div style={field}><span style={fieldLabel}>Validador de saída</span><Segmented value={d.guardsMode} options={[{ value: "audit", label: "só audita" }, { value: "enforce", label: "manda" }]} onChange={set("guardsMode")} /></div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
          {msg && <span style={note(msg.ok)}>{msg.text}</span>}
          <PrimaryButton onClick={save} disabled={busy}>{busy ? "Salvando…" : "Salvar ajustes"}</PrimaryButton>
        </div>
      </div>
    </Card>
  );
}

function UsageCard({ product, providers }) {
  const [days, setDays] = useState(14);
  const [usage, setUsage] = useState(null);
  const [err, setErr] = useState("");
  const [prices, setPrices] = useState({});
  useEffect(() => {
    setErr("");
    api.sdrAiUsage(product.id, days).then(setUsage).catch((e) => setErr(e.message || "não deu pra ler o uso"));
  }, [product.id, days]);
  // Preço dos modelos do OpenRouter pra estimar o custo (sem desconto de cache).
  useEffect(() => {
    if (!providers.openrouter) return;
    api.sdrModels("openrouter").then((r) => setPrices(Object.fromEntries((r.models || []).map((m) => [m.id, m])))).catch(() => {});
  }, [providers.openrouter]);

  const t = usage?.total;
  const rows = Object.entries(usage?.byModel || {}).sort((a, b) => b[1].calls - a[1].calls);
  const costOf = (id, u) => {
    const p = prices[id] || prices[Object.keys(prices).find((k) => k.endsWith(`/${id}`))];
    return p && p.priceIn != null ? (u.in * p.priceIn + u.out * p.priceOut) / 1e6 : null;
  };
  const total = rows.reduce((s, [id, u]) => { const c = costOf(id, u); return c == null ? s : (s || 0) + c; }, null);
  const tiles = t ? [
    ["Respostas da IA", fmtInt(t.calls)],
    ["Tokens de entrada", fmtTokens(t.in)],
    ["Tokens de saída", fmtTokens(t.out)],
    ["Lidos do cache", t.in ? `${Math.round((t.cacheRead / t.in) * 100)}%` : "—"],
    ["Tempo médio", t.calls ? `${(t.ms / t.calls / 1000).toFixed(1).replace(".", ",")} s` : "—"],
    ["Custo estimado", total == null ? "—" : fmtUsd(total)],
  ] : [];
  return (
    <Card title="Uso do robô" hint="decisões da IA nas conversas · custo estimado pelo preço do OpenRouter, sem desconto de cache"
      action={<Segmented value={days} options={[{ value: 7, label: "7 dias" }, { value: 14, label: "14 dias" }, { value: 30, label: "30 dias" }]} onChange={setDays} />}>
      <div style={body}>
        {err ? <span style={note(false)}>{err}</span> : !usage ? <span className="dim" style={{ fontSize: 12 }}>carregando…</span> : !t.calls ? (
          <EmptyState title="Sem uso no período" hint="O robô ainda não respondeu nenhuma conversa com IA nestes dias." />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 12 }}>
              {tiles.map(([label, value]) => (
                <div key={label} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{label}</div>
                  <div className="tnum" style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>
            {usage.daily?.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>respostas por dia</span>
                <Sparkline data={usage.daily.map((x) => x.calls)} width={220} height={30} />
              </div>
            )}
            <div className="tbl-x">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead><tr>{["modelo", "respostas", "entrada", "saída", "custo"].map((h) => <th key={h} className="kicker" style={{ padding: "8px 10px", textAlign: "left" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map(([id, u]) => {
                    const c = costOf(id, u);
                    return (
                      <tr key={id}>
                        <td className="mono" style={{ padding: "7px 10px", borderTop: "1px solid var(--line-1)" }}>{id}</td>
                        <td className="tnum" style={{ padding: "7px 10px", borderTop: "1px solid var(--line-1)" }}>{fmtInt(u.calls)}</td>
                        <td className="tnum" style={{ padding: "7px 10px", borderTop: "1px solid var(--line-1)" }}>{fmtTokens(u.in)}</td>
                        <td className="tnum" style={{ padding: "7px 10px", borderTop: "1px solid var(--line-1)" }}>{fmtTokens(u.out)}</td>
                        <td className="tnum" style={{ padding: "7px 10px", borderTop: "1px solid var(--line-1)" }}>{c == null ? "—" : fmtUsd(c)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function AuditCard({ product }) {
  const [audit, setAudit] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.sdrAudit(product.id, 7).then(setAudit).catch((e) => setErr(e.message || "não deu pra ler a auditoria")); }, [product.id]);
  const rules = Object.entries(audit?.byRule || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const violations = rules.reduce((s, [, n]) => s + n, 0);
  return (
    <Card title="Auditoria das regras" hint="últimos 7 dias · o validador confere cada resposta contra o rulebook (sdr-rules.js)">
      <div style={body}>
        {err ? <span style={note(false)}>{err}</span> : !audit ? <span className="dim" style={{ fontSize: 12 }}>carregando…</span> : !audit.decisions ? (
          <EmptyState title="Nenhuma decisão auditada" hint="Aparece aqui quando o robô responder conversas com o validador ligado." />
        ) : (
          <>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13 }}>
              <span><b className="tnum">{fmtInt(audit.decisions)}</b> <span className="dim">decisões</span></span>
              <span><b className="tnum" style={{ color: violations ? "var(--neg)" : undefined }}>{fmtInt(violations)}</b> <span className="dim">violações</span></span>
              <span><b className="tnum">{fmtInt(audit.shadowDiff)}</b> <span className="dim">divergências da sombra</span></span>
            </div>
            {rules.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rules.map(([id, n]) => (
                  <div key={id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5 }}>
                    <span className="mono" style={{ fontWeight: 600, flex: "none" }}>{id}</span>
                    <span style={{ flex: 1, minWidth: 0, color: "var(--fg-2)" }}>{audit.ruleTitles?.[id] || ""}</span>
                    <span className="tnum" style={{ flex: "none" }}>{n}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

export function SdrRobotPanel({ product }) {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!product) return;
    setErr(""); setCfg(null);
    api.sdrConfig(product.id).then(setCfg).catch((e) => setErr(e.message || "não deu pra ler a configuração do robô"));
  }, [product?.id, attempt]);

  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes." />;
  if (err) {
    return (
      <div className="inbox-automations">
        <div role="alert" className="inbox-read-error">{err}<SecondaryButton onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</SecondaryButton></div>
      </div>
    );
  }
  if (!cfg) return <div className="inbox-automations"><span role="status" className="dim" style={{ fontSize: 12 }}>Carregando a configuração do robô…</span></div>;
  return (
    <div className="inbox-automations">
      <div className="inbox-automations-column">
        <AiCard key={`ai-${product.id}`} product={product} cfg={cfg} onSaved={setCfg} />
        <AdvancedCard key={`adv-${product.id}`} product={product} cfg={cfg} onSaved={setCfg} />
      </div>
      <div className="inbox-automations-column">
        <UsageCard product={product} providers={cfg.providers} />
        <AuditCard product={product} />
      </div>
    </div>
  );
}
