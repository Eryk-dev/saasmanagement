import React from "react";

// Filtro de período do cockpit — um só componente pra Visão geral, Aquisição e
// Funcionários (antes cada tela repetia uma fileira de chips e um par de inputs
// de data). Desenho no modelo do Gerenciador da Meta, que o Leo já usa todo dia:
// atalhos à esquerda, dois meses de calendário à direita, e o intervalo só vale
// quando clica em "aplicar" — mexer no calendário não recarrega a tela a cada
// clique.
//
// Semana começa na SEGUNDA (o time opera seg–sex; "esta semana" no domingo não
// é uma semana nova de trabalho) e as datas seguem o dia do NEGÓCIO em
// America/Sao_Paulo, igual ao resto do cockpit.

const { useState, useEffect, useMemo, useRef } = React;
const DAY = 86_400_000;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => new Date(`${s}T12:00:00`); // meio-dia: imune a borda de fuso/DST
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7));          // segunda
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1, 12);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);

// Dias ÚTEIS (seg–sex) no intervalo [since, until], inclusivo. O time não opera
// no fim de semana, então as metas absolutas (mês/semana) se distribuem só nos
// dias úteis — a fatia do fim de semana vira meta a mais nos dias úteis, não
// some. Meio-dia evita borda de fuso; setDate anda o dia certo mesmo com DST.
export function businessDaysBetween(sinceYmd, untilYmd) {
  let n = 0;
  const d = parse(sinceYmd), end = parse(untilYmd);
  while (d <= end) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}

// `days`/`off` = janela corrida terminando hoje (ou ontem). `anchor` = período
// de CALENDÁRIO (semana/mês), que é o que "este mês" precisa: começa no dia 1 e
// não numa contagem de 30 dias pra trás.
export const PRESETS = [
  { key: "today", label: "Hoje", days: 1, off: 0 },
  { key: "yesterday", label: "Ontem", days: 1, off: 1 },
  { key: "7d", label: "Últimos 7 dias", days: 7, off: 0 },
  { key: "14d", label: "Últimos 14 dias", days: 14, off: 0 },
  { key: "28d", label: "Últimos 28 dias", days: 28, off: 0 },
  { key: "30d", label: "Últimos 30 dias", days: 30, off: 0 },
  { key: "90d", label: "Últimos 90 dias", days: 90, off: 0 },
  { key: "week", label: "Esta semana", anchor: "week", back: 0 },
  { key: "lastWeek", label: "Semana passada", anchor: "week", back: 1 },
  { key: "month", label: "Este mês", anchor: "month", back: 0 },
  { key: "lastMonth", label: "Mês passado", anchor: "month", back: 1 },
];

// Intervalo cru (since/until) de um preset. Período de calendário em curso para
// HOJE, não no fim do mês: "este mês" no dia 10 é 01→10, senão o realizado seria
// comparado com uma janela que ainda não aconteceu.
function rangeOfPreset(p, now) {
  const today = new Date(now); today.setHours(12, 0, 0, 0);
  if (p.anchor === "week") {
    const start = addDays(startOfWeek(today), -7 * p.back);
    return { since: start, until: p.back ? addDays(start, 6) : today };
  }
  if (p.anchor === "month") {
    const ref = new Date(today.getFullYear(), today.getMonth() - p.back, 1, 12);
    return { since: startOfMonth(ref), until: p.back ? endOfMonth(ref) : today };
  }
  const until = addDays(today, -(p.off || 0));
  return { since: addDays(until, -(p.days - 1)), until };
}

const shortRange = (since, until) => {
  const f = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  return since === until ? f(since) : `${f(since)} a ${f(until)}`;
};

// Janela do período: datas, duração, dias úteis, rótulo e a janela ANTERIOR de
// mesma duração (base das comparações e da meta dinâmica de calls do SDR).
export function periodWindow(period, custom, now = new Date()) {
  let since, until, label;
  if (period === "custom" && custom?.since && custom?.until) {
    since = custom.since; until = custom.until;
    label = shortRange(since, until);
  } else {
    const p = PRESETS.find((x) => x.key === period) || PRESETS.find((x) => x.key === "30d");
    const r = rangeOfPreset(p, now);
    since = ymd(r.since); until = ymd(r.until);
    label = p.label.toLowerCase();
  }
  const days = Math.max(1, Math.round((parse(until) - parse(since)) / DAY) + 1);
  const prevUntil = addDays(parse(since), -1);
  const prevSince = addDays(prevUntil, -(days - 1));
  return {
    since, until,
    prevSince: ymd(prevSince), prevUntil: ymd(prevUntil),
    days, businessDays: businessDaysBetween(since, until),
    short: label, label,
    range: shortRange(since, until),
  };
}

// ── Calendário de um mês ─────────────────────────────────────────────────────
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function MonthGrid({ month, sel, today, onPick, onHover, hover }) {
  const first = startOfMonth(month);
  const cells = [];
  const lead = (first.getDay() + 6) % 7; // segunda = 0
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= endOfMonth(month).getDate(); d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d, 12));
  // Enquanto só a 1ª ponta está escolhida, o dia sob o cursor faz as vezes da 2ª:
  // o intervalo se pinta antes do clique, então dá pra ver o que vai selecionar.
  const end = sel.until || (sel.since && hover) || sel.since;
  const lo = sel.since && end ? (sel.since <= end ? sel.since : end) : null;
  const hi = sel.since && end ? (sel.since <= end ? end : sel.since) : null;
  return (
    <div style={{ flex: "0 0 212px", width: 212 }}>
      <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 600, textTransform: "capitalize", marginBottom: 8 }}>
        {MONTHS[month.getMonth()]} {month.getFullYear()}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="mono" style={{ textAlign: "center", fontSize: 9.5, color: "var(--fg-4)", paddingBottom: 4 }}>{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const s = ymd(d);
          const future = s > today;
          const edge = s === sel.since || s === sel.until;
          const inRange = lo && hi && s >= lo && s <= hi;
          return (
            <button key={s} type="button" disabled={future}
              onClick={() => onPick(s)} onMouseEnter={() => onHover(s)}
              title={future ? "data futura" : undefined}
              style={{
                height: 28, borderRadius: edge ? "var(--r-2)" : 0, fontSize: 12,
                cursor: future ? "default" : "pointer",
                opacity: future ? 0.3 : 1,
                fontWeight: edge ? 700 : s === today ? 600 : 400,
                background: edge ? "var(--accent)" : inRange ? "var(--accent-soft)" : "transparent",
                color: edge ? "var(--accent-fg)" : inRange ? "var(--accent)" : "var(--fg-1)",
                border: s === today && !edge ? "1px solid var(--line-2)" : "1px solid transparent",
              }}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Dois calendários só quando cabem (atalhos 150 + 2×212 + espaços ≈ 620). Em
// tela estreita fica um só, senão o segundo mês vaza pra fora do popover.
const twoMonths = () => (typeof window === "undefined" ? true : window.innerWidth >= 640);

// ── O filtro ─────────────────────────────────────────────────────────────────
// `period`/`custom` são o estado APLICADO (a tela guarda e recarrega com ele);
// o popover trabalha num rascunho e só devolve em "aplicar".
export function PeriodPicker({ period, custom, onChange, presets }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ period, custom });
  const [sel, setSel] = useState({ since: "", until: "" });
  const [hover, setHover] = useState("");
  const [view, setView] = useState(() => startOfMonth(new Date()));
  const ref = useRef(null);
  // Posição MEDIDA + position:fixed (mesmo desenho do filtro da Publicidade).
  // Com `absolute` o popover é encolhido pela largura do wrapper do botão (o
  // bloco de contenção), e os dois calendários vazavam pra fora da caixa; e
  // dentro de um container com overflow ele ainda seria cortado.
  const [pos, setPos] = useState(null);
  const today = ymd(new Date());
  const list = useMemo(() => (presets ? PRESETS.filter((p) => presets.includes(p.key)) : PRESETS), [presets]);
  const applied = useMemo(() => periodWindow(period, custom), [period, custom?.since, custom?.until]);

  // Abrir sempre parte do que está aplicado (e não do rascunho anterior), e o
  // calendário mostra o mês do intervalo — abrir em "mês passado" no mês atual
  // esconderia justamente o que está selecionado.
  useEffect(() => {
    if (!open) return;
    const w = periodWindow(period, custom);
    setDraft({ period, custom }); setSel({ since: w.since, until: w.until }); setHover("");
    const end = parse(w.until);
    // Abre com o mês do FIM à direita: um intervalo de "mês passado" fica
    // visível sem ter que navegar. Com um calendário só (tela estreita), mostra
    // o mês do fim, que é onde está a ponta que a pessoa costuma ajustar.
    const back = twoMonths() ? 1 : 0;
    setView(startOfMonth(new Date(end.getFullYear(), end.getMonth() - back, 1, 12)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const pickPreset = (key) => {
    const w = periodWindow(key, null);
    setDraft({ period: key, custom: null });
    setSel({ since: w.since, until: w.until });
    setHover("");
  };

  // 1º clique abre um intervalo novo; o 2º fecha. Clicar antes do início vira o
  // novo início (em vez de trocar as pontas em silêncio).
  const pickDay = (s) => {
    setHover("");
    if (!sel.since || sel.until) { setSel({ since: s, until: "" }); return; }
    const [since, until] = s < sel.since ? [s, sel.since] : [sel.since, s];
    setSel({ since, until });
    setDraft({ period: "custom", custom: { since, until } });
  };

  const apply = () => {
    if (sel.since && !sel.until) onChange("custom", { since: sel.since, until: sel.since });
    else if (draft.period === "custom") onChange("custom", draft.custom);
    else onChange(draft.period, null);
    setOpen(false);
  };

  const btn = { height: 32, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  };
  const two = twoMonths();
  return (
    <div ref={ref} style={{ display: "inline-flex", maxWidth: "100%" }}>
      <button type="button" onClick={toggle} style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 8, maxWidth: "100%", overflow: "hidden" }}>
        <span style={{ textTransform: "capitalize", whiteSpace: "nowrap" }}>{applied.label}</span>
        <span className="mono dim tnum hide-mobile" style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap" }}>{applied.range}</span>
        <span className="dim" style={{ fontSize: 9 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && pos && (
        <>
          {/* Fundo que fecha no clique fora: com position:fixed o popover sai do
              fluxo, então o "clicou fora?" pelo contains() do wrapper não pega. */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 69 }} />
          <div style={{
            position: "fixed", top: pos.top, right: pos.right, zIndex: 70,
            background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)",
            boxShadow: "var(--shadow-pop)", padding: 14,
            // Largura EXPLÍCITA: sem ela o popover encolhe até caber no bloco de
            // contenção e os calendários vazam. maxHeight + scroll pra lista de
            // atalhos não estourar a tela em janela baixa.
            // 648 = 28 de padding + 150 de atalhos + 16 de espaço + 2×212 de
            // calendário + 14 entre eles, com folga pra arredondamento.
            width: two ? 648 : "min(94vw, 320px)", maxWidth: "94vw",
            maxHeight: "calc(100vh - 90px)", overflowY: "auto",
            display: "flex", flexDirection: two ? "row" : "column", gap: 16, alignItems: "flex-start",
          }}>
            <div style={two
              ? { display: "flex", flexDirection: "column", gap: 1, flex: "0 0 150px" }
              : { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, width: "100%" }}>
              {list.map((p) => (
                <button key={p.key} type="button" onClick={() => pickPreset(p.key)}
                  style={{
                    textAlign: "left", padding: "6px 9px", borderRadius: "var(--r-2)", fontSize: 12.5, cursor: "pointer",
                    background: draft.period === p.key ? "var(--accent-soft)" : "transparent",
                    color: draft.period === p.key ? "var(--accent)" : "var(--fg-2)",
                    fontWeight: draft.period === p.key ? 600 : 400,
                  }}>
                  {p.label}
                </button>
              ))}
              <button type="button" onClick={() => setSel({ since: "", until: "" })}
                style={{ textAlign: "left", padding: "6px 9px", borderRadius: "var(--r-2)", fontSize: 12.5, cursor: "pointer", color: draft.period === "custom" ? "var(--accent)" : "var(--fg-2)", fontWeight: draft.period === "custom" ? 600 : 400 }}>
                Personalizado
              </button>
            </div>

            <div style={{ flex: "1 1 auto", minWidth: 0 }} onMouseLeave={() => setHover("")}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <button type="button" title="mês anterior" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1, 12))}
                  style={{ width: 26, height: 26, borderRadius: "var(--r-2)", color: "var(--fg-3)", cursor: "pointer" }}>‹</button>
                <button type="button" title="mês seguinte" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1, 12))}
                  style={{ width: 26, height: 26, borderRadius: "var(--r-2)", color: "var(--fg-3)", cursor: "pointer" }}>›</button>
              </div>
              {/* flex:0 0 212 nos dois meses: deixá-los encolher é o que fazia o
                  segundo vazar pra fora da caixa. */}
              <div style={{ display: "flex", gap: 14 }}>
                <MonthGrid month={view} sel={sel} today={today} hover={hover} onPick={pickDay} onHover={setHover} />
                {two && <MonthGrid month={new Date(view.getFullYear(), view.getMonth() + 1, 1, 12)} sel={sel} today={today} hover={hover} onPick={pickDay} onHover={setHover} />}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <span className="mono dim" style={{ fontSize: 10.5, flex: 1, minWidth: 110 }}>
                  {sel.since && !sel.until ? "escolha o fim do intervalo" : "as datas seguem o horário de São Paulo"}
                </span>
                <button type="button" onClick={() => setOpen(false)} style={btn}>cancelar</button>
                <button type="button" onClick={apply}
                  style={{ ...btn, border: "1px solid var(--accent)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))" }}>
                  aplicar
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
