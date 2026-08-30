// Regras de VEICULAÇÃO dos anúncios Meta (decisão do Leo, 30/08): o anúncio
// existe pra encher a agenda de AMANHÃ com call — encheu, desliga; sexta e
// sábado não se gasta (agenda do dia seguinte seria fim de semana); o orçamento
// persegue um alvo diário = vagas restantes × custo real por call agendada.
//
// Quatro regras independentes (cada uma com toggle e parâmetros na tela
// Publicidade), TODAS nascem desligadas — nada gasta ou pausa até o Leo ligar:
//   agendaFull  — pausa TODAS as campanhas quando a agenda de amanhã bate o
//                 alvo: min(callsPerCloser × closers ativos, horários
//                 desbloqueados). Pausou, NÃO religa no meio do dia (decisão de
//                 30/08); religa na virada, quando "amanhã" vira outro dia.
//   weekendOff  — janela morta: campanhas pausadas nos dias configurados
//                 (sexta e sábado); religam na virada do primeiro dia fora da
//                 janela (domingo 00:00, pra encher a segunda).
//   shortFriday — sexta curta: bloqueio semanal na agenda de TODOS os closers
//                 depois da última call (14h). Vive como agenda_block de
//                 verdade (id determinístico), então vale pro robô SDR, pra
//                 marcação manual e aparece nas telas de agenda.
//   budget      — 1x por dia (na virada) ajusta o orçamento diário na Meta:
//                 alvo = vagas restantes de amanhã × custo por call agendada
//                 (janela móvel); aplica um FATOR único proporcional em cada
//                 objeto que carrega orçamento (campanha CBO ou conjunto ABO),
//                 travado em ±maxStepPct por dia (25% — Leo, 30/08: partir dos
//                 valores atuais e subir 25% ao dia). Agenda já cheia derruba o
//                 alvo, então o fator também DESCE — o sistema se equilibra.
//
// O tick é invariante, não evento: cada passada garante o estado certo pro
// momento (deve estar pausado? deve ter voltado? orçamento do dia já foi?).
// Só religamos o que NÓS pausamos (state.pausedCampaigns) — campanha que o Leo
// pausou na mão fica quieta; campanha que ele religar na mão durante a janela
// também fica (a regra age uma vez por dia, não briga com decisão humana).

import { meta as defaultMeta } from "./meta.js";
import { kindOf } from "./stages.js";
import { leadOrigin, dayKey } from "./metrics-core.js";
import { wallNow, wallFromNaive, occupyCells, blockHits, closerPools, CALL_MIN, OFFER_HOURS } from "./agenda-slots.js";

const pad2 = (n) => String(n).padStart(2, "0");
const ymdOf = (w) => `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())}`;
const brl = (n) => `R$ ${Number(n || 0).toFixed(2).replace(".", ",")}`;
const LOG_MAX = 120;

export const DEFAULT_RULES = {
  // horizon "pair" (Leo, 30/08 à noite): a agenda é olhada em PARES fixos —
  // seg/ter · qua/qui · sexta sozinha. Domingo os anúncios já miram segunda E
  // terça; segunda mira só a terça; terça mira qua+qui; quinta mira a sexta
  // curta. Segunda lotada não desliga nada enquanto a terça tiver buraco.
  // "day" = comportamento antigo, só o próximo dia útil.
  agendaFull: { enabled: false, callsPerCloser: 5, horizon: "pair" },
  weekendOff: { enabled: false, days: [5, 6] }, // 5=sexta, 6=sábado
  shortFriday: { enabled: false, lastCallHour: 14 },
  budget: { enabled: false, maxStepPct: 25, windowDays: 14 },
};

const cfgId = (saas) => `ad_delivery_${saas}`;
const blockId = (saas) => `agb_sexta_curta_${saas}`;

// Merge raso por regra: parâmetro novo no código ganha default sem migração.
export function mergeRules(saved) {
  const out = {};
  for (const [k, def] of Object.entries(DEFAULT_RULES)) out[k] = { ...def, ...(saved?.[k] || {}) };
  return out;
}

// Parâmetros digitados viram números dentro de faixas sãs — dedo errado na tela
// não vira alvo de 500 calls nem passo de 300% no orçamento.
export function sanitizeRules(input) {
  const r = mergeRules(input);
  const num = (v, def, lo, hi) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  };
  r.agendaFull = {
    enabled: !!r.agendaFull.enabled,
    callsPerCloser: num(r.agendaFull.callsPerCloser, 5, 1, 20),
    horizon: r.agendaFull.horizon === "day" ? "day" : "pair",
  };
  r.weekendOff = {
    enabled: !!r.weekendOff.enabled,
    days: [...new Set((Array.isArray(r.weekendOff.days) ? r.weekendOff.days : [5, 6]).map((d) => num(d, -1, 0, 6)))].filter((d) => d >= 0).sort(),
  };
  r.shortFriday = { enabled: !!r.shortFriday.enabled, lastCallHour: num(r.shortFriday.lastCallHour, 14, 8, 19) };
  r.budget = { enabled: !!r.budget.enabled, maxStepPct: num(r.budget.maxStepPct, 25, 5, 50), windowDays: num(r.budget.windowDays, 14, 7, 30) };
  return r;
}

export async function loadDeliveryCfg(repo, saas) {
  const rec = await repo.get("app_config", cfgId(saas)).catch(() => null);
  return {
    id: cfgId(saas),
    rules: mergeRules(rec?.rules),
    state: {
      day: "", pausedCampaigns: [], pauseReason: "", pausedAt: "",
      agendaPausedDay: "", weekendPausedDay: "", lastBudgetDay: "",
      ...(rec?.state || {}),
    },
    log: Array.isArray(rec?.log) ? rec.log : [],
    _exists: !!rec,
  };
}

async function saveDeliveryCfg(repo, saas, cfg) {
  const payload = { rules: cfg.rules, state: cfg.state, log: cfg.log.slice(0, LOG_MAX) };
  if (cfg._exists) await repo.update("app_config", cfgId(saas), payload);
  else await repo.create("app_config", { id: cfgId(saas), ...payload });
  cfg._exists = true;
}

const logLine = (cfg, rule, action, detail) => {
  cfg.log.unshift({ at: new Date().toISOString(), rule, action, detail });
};

// ── Agenda: quanto cabe e quanto já tem ─────────────────────────────────────
// "Horário desbloqueado" na régua do Leo = início de call em HORA CHEIA dentro
// da janela de oferta do robô (9h às 19h, almoço fora — OFFER_HOURS), livre de
// agenda_blocks. Call já marcada NÃO desconta: ela é exatamente o que enche o
// horário. Capacity por closer; closer sem nenhum horário no dia não é "ativo".
export function dayCapacity({ users, blocks, saas, dayStr }) {
  const wall = wallFromNaive(dayStr);
  if (!wall) return { capacity: 0, closersAtivos: 0, closers: 0 };
  const dow = wall.getUTCDay();
  const pool = closerPools(users, saas).all;
  if (dow === 0 || dow === 6) return { capacity: 0, closersAtivos: 0, closers: pool.length };
  const { fromHour, toHour, lunchFrom, lunchTo } = OFFER_HOURS;
  let capacity = 0, closersAtivos = 0;
  for (const u of pool) {
    const mine = (blocks || []).filter((b) => b.user === u.id || (Array.isArray(b.users) && b.users.includes(u.id)));
    let slots = 0;
    for (let h = fromHour; h * 60 + CALL_MIN <= toHour * 60; h++) {
      if (lunchFrom != null && h < lunchTo && h + CALL_MIN / 60 > lunchFrom) continue;
      const cells = occupyCells(`${dayStr}T${pad2(h)}:00`, CALL_MIN);
      if (!mine.some((b) => cells.some((k) => blockHits(b, k)))) slots++;
    }
    capacity += slots;
    if (slots > 0) closersAtivos++;
  }
  return { capacity, closersAtivos, closers: pool.length };
}

// Calls que JÁ enchem o dia: lead do produto com callAt no dia (follow-up não
// ocupa agenda — mesma exceção do busyOf/callBusyKeys). Não importa QUANDO foi
// marcada: horário preenchido é horário preenchido. Quem pediu pra marcar em
// dias mais à frente não entra aqui simplesmente porque a call não é amanhã.
export function bookedCallsFor({ leads, products, saas, dayStr }) {
  const productById = new Map((products || []).map((p) => [p.id, p]));
  return (leads || []).filter((l) =>
    l.saas === saas && l.callAt && String(l.callAt).slice(0, 10) === dayStr &&
    kindOf(productById.get(l.saas), l.stage) !== "followup").length;
}

// Alvo do dia: min(callsPerCloser × closers ativos, horários desbloqueados) —
// resposta do Leo em 30/08: bloqueou muito, o alvo CAI junto (ex.: 22 < 30).
export function dayTarget({ users, blocks, saas, dayStr, callsPerCloser }) {
  const cap = dayCapacity({ users, blocks, saas, dayStr });
  return { ...cap, target: Math.min(callsPerCloser * cap.closersAtivos, cap.capacity) };
}

// ── Janela de preenchimento (pares fixos) ───────────────────────────────────
// horizon "pair": o alvo é o PAR de dias que contém o próximo dia útil —
// seg/ter · qua/qui · sexta sozinha — recortado ao que ainda está À FRENTE:
//   dom → seg+ter · seg → ter · ter → qua+qui · qua → qui · qui → sex ·
//   sex/sáb → seg+ter da semana seguinte.
// horizon "day": só o próximo dia útil (comportamento original).
export function fillWindow(now, horizon = "pair") {
  const d = new Date(now);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  const days = [ymdOf(d)];
  // seg(1) e qua(3) abrem par: o segundo dia entra na janela junto.
  if (horizon === "pair" && (d.getUTCDay() === 1 || d.getUTCDay() === 3)) {
    d.setUTCDate(d.getUTCDate() + 1);
    days.push(ymdOf(d));
  }
  return days;
}

// Números da janela: alvo e marcadas SOMADOS nos dias + o detalhe por dia
// (é o que a tela mostra e o log grava).
export function windowStats({ users, blocks, leads, products, saas, days, callsPerCloser }) {
  const perDay = days.map((dayStr) => {
    const t = dayTarget({ users, blocks, saas, dayStr, callsPerCloser });
    return { day: dayStr, booked: bookedCallsFor({ leads, products, saas, dayStr }), target: t.target, capacity: t.capacity, closersAtivos: t.closersAtivos };
  });
  return {
    days: perDay,
    booked: perDay.reduce((a, d) => a + d.booked, 0),
    target: perDay.reduce((a, d) => a + d.target, 0),
    capacity: perDay.reduce((a, d) => a + d.capacity, 0),
  };
}
const ddmm = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const windowLabel = (days) => days.map(ddmm).join(" + ");

// ── Custo por call agendada (janela móvel, coorte) ──────────────────────────
// Gasto da conta na janela ÷ leads de origem Meta (ads_*) criados na janela que
// marcaram call — a MESMA régua de origem do metrics-core (leadOrigin). Inclui
// gasto manual (campaignId manual_*): dinheiro é dinheiro.
export function costPerCall({ leads, insights, saas, now, windowDays }) {
  const sinceDay = ymdOf(new Date(now.getTime() - windowDays * 86_400_000));
  const cohort = (leads || []).filter((l) =>
    l.saas === saas && String(leadOrigin(l)).startsWith("ads_") && dayKey(l.createdAt) >= sinceDay);
  const calls = cohort.filter((l) => l.callAt).length;
  let spend = 0;
  for (const r of insights || []) {
    if (r.saas === saas && r.date >= sinceDay && r.date <= ymdOf(now)) spend += Number(r.spend) || 0;
  }
  spend = Math.round(spend * 100) / 100;
  return { sinceDay, spend, leads: cohort.length, calls, costPerCall: calls > 0 ? Math.round((spend / calls) * 100) / 100 : null };
}

// ── Sexta curta: o bloqueio semanal que a regra mantém ──────────────────────
// agenda_block real com id determinístico e users = closers atuais do produto
// (refrescado a cada tick — closer novo entra sozinho no bloqueio). fromHour =
// última call + 1: call de 14h ocupa até 15h, o bloqueio começa às 15h.
export async function syncShortFridayBlock(repo, { saas, rule, users }) {
  const id = blockId(saas);
  const existing = await repo.get("agenda_blocks", id).catch(() => null);
  if (!rule?.enabled) {
    if (existing) { await repo.remove("agenda_blocks", id); return "removido"; }
    return null;
  }
  const closers = closerPools(users, saas).all.map((u) => u.id).sort();
  const desired = {
    saas, user: "", users: closers, kind: "block", recur: "weekly", weekday: 5,
    allDay: false, date: "", fromHour: rule.lastCallHour + 1, toHour: 21,
    title: `Sexta curta · última call ${rule.lastCallHour}h`,
    reason: "regra de veiculação (Publicidade)",
  };
  if (!existing) {
    await repo.create("agenda_blocks", { id, ...desired, createdAt: new Date().toISOString() });
    return "criado";
  }
  const dirty = ["users", "fromHour", "title"].some((k) => JSON.stringify(existing[k]) !== JSON.stringify(desired[k]));
  if (dirty) { await repo.update("agenda_blocks", id, desired); return "atualizado"; }
  return null;
}

// ── Ações na Meta ───────────────────────────────────────────────────────────
// Pausa TODAS as campanhas ATIVAS e lembra exatamente quais — a volta religa só
// essas. Falha parcial não perde o que já pausou (best-effort, ids gravados).
async function pauseAll(cfg, meta, adAccount, reason, detail, log) {
  const campaigns = await meta.listCampaigns(adAccount);
  const active = campaigns.filter((c) => c.status === "ACTIVE");
  if (!active.length) return 0;
  const paused = [];
  for (const c of active) {
    try { await meta.setObjectStatus(c.id, "PAUSED"); paused.push(c.id); }
    catch (err) { log?.warn?.(`ad-delivery: pausar ${c.id} falhou: ${String(err.message || err).slice(0, 120)}`); }
  }
  cfg.state.pausedCampaigns = [...new Set([...(cfg.state.pausedCampaigns || []), ...paused])];
  cfg.state.pauseReason = reason;
  cfg.state.pausedAt = new Date().toISOString();
  if (paused.length) logLine(cfg, reason === "fim de semana" ? "weekendOff" : "agendaFull", "pausou", `${paused.length} campanha${paused.length > 1 ? "s" : ""} · ${detail}`);
  return paused.length;
}

async function resumeAll(cfg, meta, log) {
  const remaining = [];
  let ok = 0;
  for (const id of cfg.state.pausedCampaigns || []) {
    try { await meta.setObjectStatus(id, "ACTIVE"); ok++; }
    catch (err) { remaining.push(id); log?.warn?.(`ad-delivery: religar ${id} falhou: ${String(err.message || err).slice(0, 120)}`); }
  }
  cfg.state.pausedCampaigns = remaining;
  if (!remaining.length) { cfg.state.pauseReason = ""; cfg.state.pausedAt = ""; }
  if (ok) logLine(cfg, "agendaFull", "religou", `${ok} campanha${ok > 1 ? "s" : ""} na virada do dia`);
  return ok;
}

// Ajuste diário de orçamento: fator único proporcional sobre quem CARREGA
// orçamento diário (campanha CBO ou conjunto ABO de campanha viva), travado em
// ±maxStepPct. lifetime_budget fica de fora (a Meta faz o pacing dele sozinha).
async function adjustBudgets(cfg, meta, adAccount, { target, booked, cost, today }, log) {
  const step = cfg.rules.budget.maxStepPct / 100;
  if (cost.costPerCall == null || cost.calls < 3) {
    cfg.state.lastBudgetDay = today;
    logLine(cfg, "budget", "pulou", `sem base: ${cost.calls} call${cost.calls === 1 ? "" : "s"} de origem Meta na janela de ${cfg.rules.budget.windowDays}d`);
    return;
  }
  const [campaigns, adsets] = await Promise.all([meta.listCampaigns(adAccount), meta.listAccountAdsets(adAccount)]);
  const rulePaused = new Set(cfg.state.pausedCampaigns || []);
  const liveCampaigns = campaigns.filter((c) => c.status === "ACTIVE" || rulePaused.has(c.id));
  const liveIds = new Set(liveCampaigns.map((c) => c.id));
  const carriers = [
    ...liveCampaigns.filter((c) => Number(c.dailyBudget) > 0).map((c) => ({ id: c.id, budget: Number(c.dailyBudget) })),
    ...adsets.filter((s) => Number(s.dailyBudget) > 0 && s.status === "ACTIVE" && liveIds.has(s.campaignId)).map((s) => ({ id: s.id, budget: Number(s.dailyBudget) })),
  ];
  const total = Math.round(carriers.reduce((a, c) => a + c.budget, 0) * 100) / 100;
  if (!carriers.length || total <= 0) {
    cfg.state.lastBudgetDay = today;
    logLine(cfg, "budget", "pulou", "nenhuma campanha/conjunto vivo com orçamento diário");
    return;
  }
  const vagas = Math.max(0, target - booked);
  const alvoTotal = Math.round(vagas * cost.costPerCall * 100) / 100;
  const factor = Math.min(1 + step, Math.max(1 - step, total > 0 ? alvoTotal / total : 1));
  if (Math.abs(factor - 1) < 0.02) {
    cfg.state.lastBudgetDay = today;
    logLine(cfg, "budget", "manteve", `${brl(total)}/dia já está no alvo (${vagas} vaga${vagas === 1 ? "" : "s"} × ${brl(cost.costPerCall)}/call = ${brl(alvoTotal)})`);
    return;
  }
  let applied = 0, newTotal = 0;
  for (const c of carriers) {
    const next = Math.max(1, Math.round(c.budget * factor * 100) / 100);
    try { await meta.setObjectBudget(c.id, next); applied++; newTotal += next; }
    catch (err) { newTotal += c.budget; log?.warn?.(`ad-delivery: orçamento ${c.id} falhou: ${String(err.message || err).slice(0, 120)}`); }
  }
  cfg.state.lastBudgetDay = today;
  logLine(cfg, "budget", factor > 1 ? "subiu" : "desceu",
    `${brl(total)} → ${brl(Math.round(newTotal * 100) / 100)}/dia em ${applied} objeto${applied === 1 ? "" : "s"} ` +
    `(alvo ${brl(alvoTotal)} = ${vagas} vaga${vagas === 1 ? "" : "s"} × ${brl(cost.costPerCall)}/call · trava ±${cfg.rules.budget.maxStepPct}%)`);
}

// ── O tick ──────────────────────────────────────────────────────────────────
// Roda pra cada produto com conta Meta. `now` injetável = testável em qualquer
// dia/hora. Uma passada garante o invariante do momento; escreve o config UMA
// vez no fim, e só quando algo mudou.
export async function adDeliveryTick(repo, { meta = defaultMeta, saas = "", now = wallNow(), log } = {}) {
  const products = (await repo.list("products")).filter((p) => p.metaAdAccount && (!saas || p.id === saas));
  const report = {};
  for (const product of products) {
    const cfg = await loadDeliveryCfg(repo, product.id);
    const anyOn = Object.values(cfg.rules).some((r) => r.enabled);
    if (!anyOn && !cfg._exists) { report[product.id] = { skipped: true }; continue; }

    const before = JSON.stringify({ state: cfg.state, log: cfg.log[0] || null });
    const today = ymdOf(now);
    const dow = now.getUTCDay();
    const winDays = fillWindow(now, cfg.rules.agendaFull.horizon);
    const offToday = cfg.rules.weekendOff.enabled && cfg.rules.weekendOff.days.includes(dow);

    // Sexta curta ANTES de ler os bloqueios: o bloqueio recém-criado/ajustado
    // já entra na capacidade desta mesma passada.
    const users = await repo.list("users");
    try {
      const changedBlock = await syncShortFridayBlock(repo, { saas: product.id, rule: cfg.rules.shortFriday, users });
      if (changedBlock) logLine(cfg, "shortFriday", changedBlock, `bloqueio semanal de sexta depois das ${cfg.rules.shortFriday.lastCallHour}h`);
    } catch (err) {
      log?.warn?.(`ad-delivery: bloqueio de sexta falhou (${product.id}): ${String(err.message || err).slice(0, 120)}`);
    }
    const [blocks, leads, insights] = await Promise.all([
      repo.list("agenda_blocks"), repo.list("leads"), repo.list("ad_insights"),
    ]);

    // Virada do dia: zera a marca de "pausei hoje pela agenda".
    if (cfg.state.day !== today) { cfg.state.day = today; cfg.state.agendaPausedDay = ""; }

    const metaOk = typeof meta.configured === "function" ? meta.configured() : true;
    if (metaOk) {
      // 1) Janela morta: garante pausado — UMA tentativa por dia da janela, pra
      //    não brigar com quem religar na mão de propósito.
      if (offToday && cfg.state.weekendPausedDay !== today) {
        cfg.state.weekendPausedDay = today;
        if (!(cfg.state.pausedCampaigns || []).length) {
          try { await pauseAll(cfg, meta, product.metaAdAccount, "fim de semana", "janela morta (sem agenda no dia seguinte)", log); }
          catch (err) { cfg.state.weekendPausedDay = ""; log?.warn?.(`ad-delivery: pausa de janela falhou (${product.id}): ${String(err.message || err).slice(0, 120)}`); }
        }
      }

      // 2) Fora da janela e não pausamos HOJE pela agenda: o que a regra pausou
      //    volta (é a virada — retry automático enquanto restar campanha presa).
      if (!offToday && (cfg.state.pausedCampaigns || []).length && cfg.state.agendaPausedDay !== today) {
        try { await resumeAll(cfg, meta, log); }
        catch (err) { log?.warn?.(`ad-delivery: religar falhou (${product.id}): ${String(err.message || err).slice(0, 120)}`); }
      }

      // 3) Orçamento do dia (1x, na primeira passada depois da virada) — as
      //    vagas são as da JANELA inteira (par de dias), mesma régua da pausa.
      if (!offToday && cfg.rules.budget.enabled && cfg.state.lastBudgetDay !== today) {
        const win = windowStats({ users, blocks, leads, products, saas: product.id, days: winDays, callsPerCloser: cfg.rules.agendaFull.callsPerCloser });
        const cost = costPerCall({ leads, insights, saas: product.id, now, windowDays: cfg.rules.budget.windowDays });
        try { await adjustBudgets(cfg, meta, product.metaAdAccount, { target: win.target, booked: win.booked, cost, today }, log); }
        catch (err) { log?.warn?.(`ad-delivery: ajuste de orçamento falhou (${product.id}): ${String(err.message || err).slice(0, 120)}`); }
      }

      // 4) A janela bateu o alvo → pausa (e não religa até a virada). Com o par
      //    de dias, segunda lotada segura a pausa enquanto a terça tem buraco.
      if (!offToday && cfg.rules.agendaFull.enabled && cfg.state.agendaPausedDay !== today && !(cfg.state.pausedCampaigns || []).length) {
        const win = windowStats({ users, blocks, leads, products, saas: product.id, days: winDays, callsPerCloser: cfg.rules.agendaFull.callsPerCloser });
        if (win.target > 0 && win.booked >= win.target) {
          try {
            const porDia = win.days.map((d) => `${ddmm(d.day)} ${d.booked}/${d.target}`).join(" · ");
            const n = await pauseAll(cfg, meta, product.metaAdAccount, "agenda cheia",
              `janela (${windowLabel(winDays)}) com ${win.booked}/${win.target} calls · ${porDia} · ${win.capacity} desbloqueado${win.capacity === 1 ? "" : "s"}`, log);
            if (n >= 0) cfg.state.agendaPausedDay = today;
          } catch (err) {
            log?.warn?.(`ad-delivery: pausa por agenda falhou (${product.id}): ${String(err.message || err).slice(0, 120)}`);
          }
        }
      }
    }

    const after = JSON.stringify({ state: cfg.state, log: cfg.log[0] || null });
    if (after !== before || (!cfg._exists && anyOn)) await saveDeliveryCfg(repo, product.id, cfg);
    report[product.id] = { state: cfg.state };
  }
  return report;
}

// Prévia pros olhos (tela Publicidade): os números que as regras enxergam AGORA,
// sem tocar na Meta — a janela de preenchimento (par de dias), alvo somado e
// por dia, e o custo por call da janela móvel.
export async function deliveryPreview(repo, { saas, rules, now = wallNow() }) {
  const [users, blocks, leads, insights, products] = await Promise.all([
    repo.list("users"), repo.list("agenda_blocks"), repo.list("leads"), repo.list("ad_insights"), repo.list("products"),
  ]);
  const winDays = fillWindow(now, rules.agendaFull.horizon);
  const win = windowStats({ users, blocks, leads, products, saas, days: winDays, callsPerCloser: rules.agendaFull.callsPerCloser });
  const cost = costPerCall({ leads, insights, saas, now, windowDays: rules.budget.windowDays });
  const dow = now.getUTCDay();
  return {
    today: ymdOf(now),
    window: winDays, days: win.days,
    booked: win.booked, target: win.target, capacity: win.capacity,
    offToday: rules.weekendOff.enabled && rules.weekendOff.days.includes(dow),
    cost,
  };
}

// ── Rotas ───────────────────────────────────────────────────────────────────
export function registerAdDeliveryRoutes(app, repo, { meta = defaultMeta } = {}) {
  app.get("/api/marketing/:saas/delivery-rules", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const cfg = await loadDeliveryCfg(repo, product.id);
    const preview = await deliveryPreview(repo, { saas: product.id, rules: cfg.rules });
    return { rules: cfg.rules, state: cfg.state, log: cfg.log.slice(0, 40), preview, metaConfigured: typeof meta.configured === "function" ? meta.configured() : false };
  });

  app.put("/api/marketing/:saas/delivery-rules", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const cfg = await loadDeliveryCfg(repo, product.id);
    const beforeRules = JSON.stringify(cfg.rules);
    cfg.rules = sanitizeRules(req.body?.rules);
    if (JSON.stringify(cfg.rules) !== beforeRules) logLine(cfg, "config", "editou", resumoRegras(cfg.rules));
    // Sexta curta reflete NA HORA (criar/ajustar/remover o bloqueio), não no
    // próximo tick — quem desliga o toggle quer ver a agenda liberada já.
    const users = await repo.list("users");
    const changedBlock = await syncShortFridayBlock(repo, { saas: product.id, rule: cfg.rules.shortFriday, users });
    if (changedBlock) logLine(cfg, "shortFriday", changedBlock, `bloqueio semanal de sexta depois das ${cfg.rules.shortFriday.lastCallHour}h`);
    await saveDeliveryCfg(repo, product.id, cfg);
    const preview = await deliveryPreview(repo, { saas: product.id, rules: cfg.rules });
    return { rules: cfg.rules, state: cfg.state, log: cfg.log.slice(0, 40), preview, metaConfigured: typeof meta.configured === "function" ? meta.configured() : false };
  });

  // Passada manual (botão "checar agora" da tela) — o mesmo tick do runner.
  app.post("/api/marketing/:saas/delivery-rules/tick", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const report = await adDeliveryTick(repo, { meta, saas: product.id, log: req.log });
    const cfg = await loadDeliveryCfg(repo, product.id);
    return { ok: true, report: report[product.id] || null, state: cfg.state, log: cfg.log.slice(0, 40) };
  });
}

function resumoRegras(r) {
  const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  return [
    `agenda cheia ${r.agendaFull.enabled ? `ON (${r.agendaFull.callsPerCloser}/closer · ${r.agendaFull.horizon === "day" ? "dia seguinte" : "par de dias"})` : "off"}`,
    `janela ${r.weekendOff.enabled ? `ON (${r.weekendOff.days.map((d) => dias[d]).join("+") || "sem dia"})` : "off"}`,
    `sexta curta ${r.shortFriday.enabled ? `ON (${r.shortFriday.lastCallHour}h)` : "off"}`,
    `orçamento ${r.budget.enabled ? `ON (±${r.budget.maxStepPct}%/dia · ${r.budget.windowDays}d)` : "off"}`,
  ].join(" · ");
}

// ── Runner (index.js) ───────────────────────────────────────────────────────
const DEFAULT_INTERVAL_MS = 60_000;

export function startAdDelivery(repo, { meta = defaultMeta, intervalMs = DEFAULT_INTERVAL_MS, log, immediate = true } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await adDeliveryTick(repo, { meta, log }); }
    catch (err) { log?.warn?.(`ad-delivery: tick falhou: ${String(err.message || err).slice(0, 200)}`); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  if (immediate) tick();
  return { tick, stop: () => clearInterval(timer) };
}
