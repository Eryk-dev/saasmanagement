import React from "react";
import { PageHead, Pill, Card, StatTile } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { ErrorBoundary } from "../components/error-boundary.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useData } from "../data.jsx";
import { CreativeEditor } from "./creative.jsx";
import { useIsMobile } from "../lib/responsive.js";
import { AreaLine, fmtNum } from "./social-metrics.jsx";

// Mídia social — métricas do perfil (Instagram + página do Facebook) e o fluxo
// de publicação orgânica direto do cockpit:
//   Criar post → formato (Feed/Story/Reels) → tipo (Estático/Carrossel/Vídeo)
//   → conteúdo (editor de Estáticos embedado com preview grande, ou upload de
//   vídeo) → legenda + redes → publicar.
// A publicação passa pela API (/api/social/publish): o PNG do editor vira
// asset público que a Meta baixa na criação do container. Story não tem
// legenda (a Graph ignora) e página do FB só recebe post de feed.

const { useState: useS, useEffect: useE, useRef: useR } = React;

const FORMATS = [
  { id: "feed", label: "Feed", hint: "post fixo no perfil", kinds: ["image", "carousel", "video"] },
  { id: "story", label: "Story", hint: "tela cheia, 24h", kinds: ["image", "sequence", "video"] },
  { id: "reel", label: "Reels", hint: "vídeo vertical", kinds: ["video"] },
];
const KIND_LABELS = { image: "Estático", carousel: "Carrossel · 4 slides", sequence: "Sequência · 4 stories", video: "Vídeo" };
const KIND_HINTS = {
  image: "criado aqui, com a marca",
  carousel: "criado aqui, com a marca",
  sequence: "4 stories em sequência, com a marca",
  video: "upload de arquivo",
};
// Só os tipos "criados aqui" abrem o editor (e ganham dor + copy por IA).
const CREATED_HERE = new Set(["image", "carousel", "sequence"]);
// Colunas da tabela de publicações (header e linhas compartilham o grid).
const POSTS_GRID = "2fr .7fr .55fr .55fr .55fr .55fr .5fr .55fr .6fr .5fr .55fr .5fr .6fr .55fr .55fr .7fr";
// Colunas da tabela de stories (histórico capturado).
const STORIES_GRID = "1.5fr .55fr .55fr .65fr .6fr .55fr .55fr .6fr .55fr .5fr .5fr .85fr";
const fmtPct = (x) => `${(Math.round(x * 10) / 10).toFixed(1).replace(".", ",")}%`;
// Engajamento do post = interações totais ÷ alcance. null sem dados (posts do
// histórico local ainda sem espelho no IG) — a célula mostra "—".
function engRate(item) {
  const reach = Number(item.reach), inter = Number(item.totalInteractions);
  if (!Number.isFinite(reach) || reach <= 0 || !Number.isFinite(inter)) return null;
  return fmtPct((inter / reach) * 100);
}
// Retenção do vídeo = tempo médio assistido (Graph, ms) ÷ duração. A Graph não
// expõe a duração, então ela vem dos metadados do próprio arquivo, lidos no
// navegador (useVideoDurations). null enquanto falta um dos lados.
function retentionRate(item, durationSec) {
  const avg = Number(item.avgWatchMs);
  if (!(avg > 0) || !(durationSec > 0)) return null;
  return fmtPct(Math.min(100, (avg / 1000 / durationSec) * 100));
}
// Play de 3s = quem NÃO pulou o reel nos 3 primeiros segundos (100 − skip rate
// da Graph). Só existe pra reels; null nos outros formatos.
function play3sRate(item) {
  if (item.skipRate == null || !Number.isFinite(Number(item.skipRate))) return null;
  return fmtPct(Math.max(0, Math.min(100, 100 - Number(item.skipRate))));
}
// Duração (s) por id de post: carrega só os METADADOS do arquivo de vídeo num
// <video> descartável e lê .duration (funciona cross-origin; o arquivo não é
// baixado inteiro). Fail-soft: vídeo que não carrega fica de fora e a coluna
// de retenção mostra "—".
function useVideoDurations(items) {
  const [durs, setDurs] = useS({});
  const tried = useR(new Set());
  const key = items.map((m) => m.id).join(",");
  useE(() => {
    let alive = true;
    for (const m of items) {
      if (!m.videoUrl || m.avgWatchMs == null || tried.current.has(m.id)) continue;
      tried.current.add(m.id);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        if (alive && Number.isFinite(v.duration) && v.duration > 0) setDurs((d) => ({ ...d, [m.id]: v.duration }));
        v.removeAttribute("src");
      };
      v.src = m.videoUrl;
    }
    return () => { alive = false; };
  }, [key]);
  return durs;
}
// Dores base da LeverAds — usadas quando o produto ainda não tem painMap; se o
// produto tiver dores cadastradas (product.painMap), elas entram junto.
const DEFAULT_PAINS = [
  "Perde tempo subindo anúncio um por um em cada conta",
  "Anúncio some ou fica desatualizado em algumas contas",
  "Não consegue escalar pra mais contas sem contratar gente",
  "Retrabalho de atributo e SKU entre as contas",
  "Pouca exposição: mesmo produto, poucas contas ativas",
  "Medo de perder a operação por erro manual",
];

// ── Audiência: quem é o público (demografia) + melhor horário ────────────────
const GENDER_LABEL = { M: "Homens", F: "Mulheres", U: "Não informado" };
// Rótulos dos breakdowns de perfil (raio-x dos 30 dias).
const REACH_FORMAT_LABEL = { FEED: "Feed", POST: "Feed", REELS: "Reels", REEL: "Reels", STORY: "Story", AD: "Anúncio", CAROUSEL_CONTAINER: "Carrossel", IGTV: "IGTV", LIVE: "Live" };
const INTERACTION_LABEL = { likes: "Curtidas", comments: "Comentários", saves: "Salvos", shares: "Compartilhamentos", replies: "Respostas de story" };
const TAP_LABEL = { WEBSITE: "site", EMAIL: "e-mail", CALL: "ligação", TEXT: "mensagem", DIRECTION: "rotas", BOOK_NOW: "reserva", INSTANT_EXPERIENCE: "experiência", UNDEFINED: "outros" };
const GENDER_COLOR = ["var(--accent)", "#7C6FF0", "var(--line-2)"];
const COUNTRY_LABEL = { BR: "Brasil", PT: "Portugal", US: "Estados Unidos", AR: "Argentina", CL: "Chile", CO: "Colômbia", MX: "México", PY: "Paraguai", UY: "Uruguai", ES: "Espanha", IT: "Itália", DE: "Alemanha", FR: "França", GB: "Reino Unido", JP: "Japão", CA: "Canadá", AU: "Austrália", AO: "Angola", MZ: "Moçambique" };
const AUD_SUBLABEL = { fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 10 };
const hasDemo = (d) => !!(d && ((d.genders || []).length || (d.ages || []).length || (d.cities || []).length || (d.countries || []).length));
// Paleta das fatias dos donuts; "Outros" usa a linha neutra. Cores escolhidas
// pra ler bem no tema claro e no escuro.
const DONUT_RAMP = ["var(--accent)", "#7C6FF0", "#E8A13A", "#4C8DD6", "#E4677E", "#3FAE7C", "#C98BDB"];
// Vira os itens (key/value já ordenados pelo maior) em fatias com % e cor,
// somando o resto em "Outros" — pro donut não virar confete de fatias mínimas.
const toSegments = (items, { topN = 5, label = (k) => k, othersLabel = "Outros", palette = DONUT_RAMP } = {}) => {
  const all = (items || []).map((i) => ({ key: i.key, value: Number(i.value) || 0 })).filter((i) => i.value > 0);
  const total = all.reduce((s, i) => s + i.value, 0) || 1;
  const top = all.slice(0, topN);
  const rest = all.slice(topN).reduce((s, i) => s + i.value, 0);
  const segs = top.map((i, idx) => ({ label: label(i.key), value: i.value, pct: Math.round((i.value / total) * 100), color: palette[idx % palette.length] }));
  if (rest > 0) segs.push({ label: othersLabel, value: rest, pct: Math.round((rest / total) * 100), color: "var(--line-2)" });
  return segs;
};
// Donut SVG: anel de fatias (dasharray por fatia) com furo no meio destacando a
// maior. Gira -90° pra começar no topo; a legenda fica ao lado (DonutBlock).
function Donut({ segments, size = 116, thickness = 17 }) {
  const total = segments.reduce((s, x) => s + (Number(x.value) || 0), 0) || 1;
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  const top = segments[0];
  let offset = 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-2)" strokeWidth={thickness} />
        {segments.map((seg, i) => {
          const len = ((Number(seg.value) || 0) / total) * c;
          const dash = Math.max(0, len - 2); // gap de 2px entre fatias, pra separar
          const node = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color} strokeWidth={thickness} strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} />;
          offset += len;
          return node;
        })}
      </svg>
      {top && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, padding: "0 14px" }}>
          <span className="tnum" style={{ fontSize: 21, fontWeight: 700, lineHeight: 1, color: "var(--fg-1)" }}>{top.pct}%</span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--fg-4)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(top.label).split(",")[0]}</span>
        </div>
      )}
    </div>
  );
}
// Donut + legenda (rótulo · valor · %); cada linha da legenda ecoa a cor da fatia.
function DonutBlock({ title, segments }) {
  if (!segments.length) return null;
  return (
    <div>
      {title ? <div style={AUD_SUBLABEL}>{title}</div> : null}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Donut segments={segments} />
        <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0, flex: 1 }}>
          {segments.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flex: "0 0 auto" }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-2)" }} title={s.label}>{s.label}</span>
              <b className="tnum" style={{ flex: "0 0 auto" }}>{fmtNum(s.value)}</b>
              <span className="tnum" style={{ color: "var(--fg-4)", width: 32, textAlign: "right", flex: "0 0 auto" }}>{s.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AudiencePanel({ audience }) {
  const sets = [
    ["follower", "Seguidores", audience?.demographics],
    ["reached", "Alcançados", audience?.reached],
    ["engaged", "Engajados", audience?.engaged],
  ].filter(([, , d]) => hasDemo(d));
  const [which, setWhich] = React.useState("follower");
  const active = sets.find(([id]) => id === which) || sets[0];
  const demo = active?.[2];
  if (!audience || !hasDemo(demo)) return null;

  return (
    <Card title="Quem é o seu público" hint="perfil da audiência no Instagram" style={{ flexShrink: 0 }}>
      {/* Card não tem padding próprio de conteúdo — sem este wrapper os donuts
          encostam nas bordas ("estourando os limites"). */}
      <div style={{ padding: "14px var(--inset-x) 24px" }}>
        {sets.length > 1 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
            {sets.map(([id, label]) => {
              const on = (active?.[0] || sets[0]?.[0]) === id;
              return (
                <button key={id} onClick={() => setWhich(id)} className="mono"
                  title={id === "follower" ? "quem te segue" : id === "reached" ? "quem você alcançou nos últimos 30 dias" : "quem interagiu nos últimos 30 dias"}
                  style={{ fontSize: 11, padding: "4px 11px", borderRadius: 999, cursor: "pointer", border: `1px solid ${on ? "var(--accent-line)" : "var(--line-2)"}`, background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-3)" }}>{label}</button>
              );
            })}
          </div>
        )}
        {hasDemo(demo) ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 290px), 340px))", justifyContent: "center", gap: "28px 48px" }}>
            {(demo.genders || []).length > 0 && (
              <DonutBlock title="Gênero" segments={toSegments(demo.genders, { topN: 3, label: (k) => GENDER_LABEL[k] || k, palette: GENDER_COLOR })} />
            )}
            {(demo.ages || []).length > 0 && (
              <DonutBlock title="Faixa etária" segments={toSegments(demo.ages, { topN: 6 })} />
            )}
            {(demo.cities || []).length > 0 && (
              <DonutBlock title="Principais cidades" segments={toSegments(demo.cities, { topN: 5, label: (k) => String(k).split(",")[0] })} />
            )}
            {(demo.countries || []).length > 0 && (
              <DonutBlock title="Principais países" segments={toSegments(demo.countries, { topN: 4, label: (k) => COUNTRY_LABEL[k] || k })} />
            )}
          </div>
        ) : <div className="mono dim" style={{ fontSize: 12, padding: "8px 0" }}>demografia indisponível (o Instagram só libera com ~100+ seguidores)</div>}
      </div>
    </Card>
  );
}

// ── Radar do mercado: concorrentes, quem marcou a conta e hashtags ──────────
// Listas (igCompetitors/igHashtags) moram no PRODUTO e são editáveis aqui
// mesmo; o radar recarrega a cada mudança. Tudo fail-soft por item.
function DiscoveryPanel({ product, sum }) {
  const [disc, setDisc] = React.useState(null);
  const [comps, setComps] = React.useState(() => (Array.isArray(product?.igCompetitors) ? product.igCompetitors : []));
  const [tags, setTags] = React.useState(() => (Array.isArray(product?.igHashtags) ? product.igHashtags : []));
  const [compIn, setCompIn] = React.useState("");
  const [tagIn, setTagIn] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => {
    if (!product?.id) return;
    api.socialDiscovery(product.id).then(setDisc).catch(() => setDisc(null));
  }, [product?.id]);
  React.useEffect(() => { setDisc(null); load(); }, [load]);

  async function save(patch, apply) {
    if (busy) return;
    setBusy(true);
    try { await api.update("products", product.id, patch); apply(); setDisc(null); load(); }
    catch { /* mantém a lista anterior */ }
    setBusy(false);
  }
  const addComp = () => {
    const u = compIn.trim().replace(/^@/, "");
    if (!u || comps.includes(u)) { setCompIn(""); return; }
    const next = [...comps, u].slice(0, 6);
    save({ igCompetitors: next }, () => { setComps(next); setCompIn(""); });
  };
  const rmComp = (u) => { const next = comps.filter((x) => x !== u); save({ igCompetitors: next }, () => setComps(next)); };
  const addTag = () => {
    const h = tagIn.trim().replace(/^#/, "");
    if (!h || tags.includes(h)) { setTagIn(""); return; }
    const next = [...tags, h].slice(0, 5);
    save({ igHashtags: next }, () => { setTags(next); setTagIn(""); });
  };
  const rmTag = (h) => { const next = tags.filter((x) => x !== h); save({ igHashtags: next }, () => setTags(next)); };

  const inputStyle = { flex: 1, minWidth: 0, fontSize: 12.5, padding: "6px 10px", border: "1px solid var(--line-2)", borderRadius: 8, background: "var(--bg-1)", color: "var(--fg-1)" };
  const addBtn = { fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent-line)", background: "var(--accent-soft)", color: "var(--accent)", cursor: "pointer" };
  const rowStyle = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "7px 0", borderTop: "1px solid var(--line-faint)" };
  const dim = { color: "var(--fg-4)", fontSize: 12 };

  // Linha "nós" pro comparativo (dados que a tela já tem).
  const eng = sum?.engagement;
  const us = {
    username: sum?.account?.username || "nós", followers: sum?.account?.followers_count,
    avgLikes: eng?.avgLikes, avgComments: eng?.avgComments,
    postsPerWeek: eng?.posts != null ? Math.round((eng.posts / 4.35) * 10) / 10 : null,
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 16 }}>
      <Card title="Concorrentes" hint="dados públicos · curtidas e comentários por post">
        <div style={{ padding: "10px var(--inset-x) 18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr .8fr .7fr .7fr .6fr 24px", gap: 8, fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--fg-4)", padding: "4px 0" }}>
            <span>Conta</span><span style={{ textAlign: "right" }}>Seguidores</span><span style={{ textAlign: "right" }}>Curt./post</span><span style={{ textAlign: "right" }}>Com./post</span><span style={{ textAlign: "right" }}>Posts/sem</span><span />
          </div>
          {[{ ...us, us: true }, ...(disc?.competitors || [])].map((c) => (
            <div key={c.username} style={{ ...rowStyle, display: "grid", gridTemplateColumns: "1.4fr .8fr .7fr .7fr .6fr 24px" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: c.us ? 700 : 500, color: c.us ? "var(--accent)" : "var(--fg-1)" }}>@{c.username}</span>
              {c.error
                ? <span style={{ ...dim, gridColumn: "span 4" }}>não é conta business ou não existe</span>
                : <>
                    <span className="tnum" style={{ textAlign: "right" }}>{c.followers != null ? fmtNum(c.followers) : "—"}</span>
                    <span className="tnum" style={{ textAlign: "right" }}>{c.avgLikes != null ? fmtNum(c.avgLikes) : "—"}</span>
                    <span className="tnum" style={{ textAlign: "right" }}>{c.avgComments != null ? String(c.avgComments).replace(".", ",") : "—"}</span>
                    <span className="tnum" style={{ textAlign: "right" }}>{c.postsPerWeek != null ? String(c.postsPerWeek).replace(".", ",") : "—"}</span>
                  </>}
              {c.us ? <span /> : <button onClick={() => rmComp(c.username)} title="remover" style={{ border: "none", background: "none", color: "var(--fg-4)", cursor: "pointer", fontSize: 13 }}>✕</button>}
            </div>
          ))}
          {!comps.length && <div style={{ ...dim, padding: "8px 0" }}>adicione contas concorrentes pra comparar (precisa ser conta business)</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input value={compIn} onChange={(e) => setCompIn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComp()} placeholder="@concorrente" style={inputStyle} />
            <button onClick={addComp} disabled={busy} style={addBtn}>Adicionar</button>
          </div>
        </div>
      </Card>

      <Card title="Marcaram você" hint="posts de terceiros marcando a conta">
        <div style={{ padding: "10px var(--inset-x) 18px" }}>
          {(disc?.tagged || []).slice(0, 6).map((t) => (
            <div key={t.id} style={rowStyle}>
              <span style={{ fontWeight: 600, flex: "0 0 auto" }}>@{t.username || "?"}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-3)" }}>{(t.caption || "").split("\n")[0] || "sem legenda"}</span>
              <span className="tnum" style={dim}>{fmtNum(t.likes)} ♥</span>
              {t.permalink && <a href={t.permalink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent)" }}>abrir</a>}
            </div>
          ))}
          {disc && !(disc.tagged || []).length && <div style={{ ...dim, padding: "8px 0" }}>ninguém marcou a conta ainda</div>}
          {!disc && <div style={{ ...dim, padding: "8px 0" }}>carregando…</div>}
        </div>
      </Card>

      <Card title="Hashtags" hint="top posts públicos · até 5 monitoradas">
        <div style={{ padding: "10px var(--inset-x) 18px" }}>
          {(disc?.hashtags || []).map((h) => (
            <div key={h.name} style={rowStyle}>
              <span style={{ fontWeight: 600, flex: "0 0 auto" }}>#{h.name}</span>
              {h.error
                ? <span style={{ ...dim, flex: 1 }}>indisponível</span>
                : <span style={{ ...dim, flex: 1 }}>top {h.top} · mediana <b className="tnum" style={{ color: "var(--fg-2)" }}>{fmtNum(h.medianLikes)}</b> curtidas · pico <b className="tnum" style={{ color: "var(--fg-2)" }}>{fmtNum(h.maxLikes)}</b></span>}
              <button onClick={() => rmTag(h.name)} title="remover" style={{ border: "none", background: "none", color: "var(--fg-4)", cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
          ))}
          {!tags.length && <div style={{ ...dim, padding: "8px 0" }}>monitore hashtags do teu nicho (ex.: mercadolivre)</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input value={tagIn} onChange={(e) => setTagIn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTag()} placeholder="#hashtag" style={inputStyle} />
            <button onClick={addTag} disabled={busy} style={addBtn}>Adicionar</button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SocialScreen() {
  const [product] = useActiveSaas();
  const [sum, setSum] = useS(null);
  const [posts, setPosts] = useS([]);
  const [audience, setAudience] = useS(null); // demografia + melhor horário (endpoint à parte, caro)
  const [stories, setStories] = useS([]);     // histórico capturado (endpoint à parte, dispara a captura)
  const days = 30;
  const [err, setErr] = useS(null);
  const [wizard, setWizard] = useS(false);
  const [tab, setTab] = useS("painel");
  // Fila de comentários pendentes — some no badge da aba. Carregada junto com o
  // painel pra o número já aparecer sem abrir a aba.
  const [pending, setPending] = useS(null);

  // O handoff fixa a visão em 30 dias.
  useE(() => {
    if (!product?.id) return;
    let alive = true;
    setSum(null); setErr(null); setAudience(null);
    Promise.all([api.socialSummary(product.id, days), api.socialPosts(product.id)])
      .then(([s, p]) => { if (alive) { setSum(s); setPosts(p || []); } })
      .catch((e) => alive && setErr(e.message));
    // Audiência (demografia + melhor horário) carrega em paralelo, sem travar o
    // painel — são chamadas caras e não dependem do período.
    api.socialAudience(product.id).then((a) => alive && setAudience(a)).catch(() => {});
    // Stories: a chamada também DISPARA a captura dos que estão no ar (a Graph
    // só entrega métrica de story vivo — abrir a tela é o gatilho).
    api.socialStories(product.id).then((r) => alive && setStories(r?.stories || [])).catch(() => {});
    return () => { alive = false; };
  }, [product?.id]);

  // Contagem de comentários pendentes pro badge da aba. Fora do carregamento do
  // painel de propósito: varrer os comentários na Meta é lento e não pode
  // atrasar as métricas.
  useE(() => {
    if (!product?.id) return;
    let alive = true;
    api.socialComments(product.id, "pending")
      .then((r) => alive && setPending(r?.insights?.pending ?? null))
      .catch(() => alive && setPending(null));
    return () => { alive = false; };
  }, [product?.id]);

  // Após publicar um post pelo wizard: recarrega summary + histórico (mesmo fetch
  // dos efeitos acima). Substitui o antigo load() removido no refactor de período.
  function reloadSocial() {
    if (!product?.id) return;
    Promise.all([api.socialSummary(product.id, days), api.socialPosts(product.id)])
      .then(([s, p]) => { setSum(s); setPosts(p || []); })
      .catch((e) => setErr(e.message));
  }

  const ins = sum?.insights || {};
  const eng = sum?.engagement;
  const growth = sum?.followerGrowth;
  const rb = sum?.reachBreakdown;
  const reachTotal = (Number(rb?.follower) || 0) + (Number(rb?.nonFollower) || 0);
  const followerPct = reachTotal ? Math.round((rb.follower / reachTotal) * 100) : 0;
  const nonFollowerPct = reachTotal ? 100 - followerPct : 0;
  // Alcance por formato: preferimos o OFICIAL da conta (reachByFormat, inclui
  // story/anúncio); a barra escala pelo maior valor da lista MOSTRADA.
  const officialFormats = (sum?.reachByFormat || [])
    .filter((f) => Number(f.value) > 0)
    .map((f) => ({ label: REACH_FORMAT_LABEL[f.key] || String(f.key).toLowerCase(), value: Number(f.value) || 0 }));
  const formatMax = Math.max(1, ...(officialFormats.length
    ? officialFormats.map((f) => f.value)
    : (sum?.formats || []).map((f) => Number(f.avgReach) || 0)));
  // Interações do período por tipo → donut (mesma linguagem da audiência).
  const interactionSegs = toSegments(
    Object.entries(sum?.interactionTypes || {}).map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value),
    { topN: 5, label: (k) => INTERACTION_LABEL[k] || k },
  );
  const recent = (sum?.media?.length ? sum.media : posts).slice(0, 6);
  const durations = useVideoDurations(recent);
  const formatLabel = (item) => item.format
    ? (FORMATS.find((f) => f.id === item.format)?.label || item.format)
    : item.type === "VIDEO" ? "Reels" : item.type === "CAROUSEL_ALBUM" ? "Carrossel" : "Estático";
  const postTitle = (item) => (item.caption || "Publicação sem legenda").split("\n")[0].trim();

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead
        title="Redes sociais"
        sub={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>métricas do perfil · <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-2)", fontSize: 12.5, fontWeight: 500 }}><span style={{ width: 6, height: 6, borderRadius: 99, background: sum?.configured ? "var(--pos)" : "var(--fg-4)" }} />{sum?.configured ? `conectado${sum?.account?.username ? ` · @${sum.account.username}` : ""}` : "não conectado"}</span></span>}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[["painel", "Painel", null], ["comentarios", "Comentários", pending]].map(([id, label, badge]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{
                height: 32, padding: "0 12px", borderRadius: "var(--r-2)", fontSize: 13,
                fontWeight: tab === id ? 600 : 500,
                display: "inline-flex", alignItems: "center", gap: 6,
                border: "1px solid " + (tab === id ? "var(--accent-line)" : "var(--line-2)"),
                background: tab === id ? "var(--accent-soft)" : "transparent",
                color: tab === id ? "var(--fg-1)" : "var(--fg-3)",
              }}>
              {label}
              {badge > 0 && (
                <span className="tnum" style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 99, background: "var(--warn)", color: "var(--bg-0)", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>
              )}
            </button>
          ))}
          <button onClick={() => setWizard(true)}
            style={{ height: 32, padding: "0 14px", marginLeft: 6, borderRadius: "var(--r-2)", background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 13, fontWeight: 600 }}>
            + criar post
          </button>
        </div>
      </PageHead>

      {tab === "comentarios" ? (
        <ErrorBoundary label="comentarios">
          <CommentsPanel saas={product?.id} onCount={setPending} />
        </ErrorBoundary>
      ) : (
      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        {!sum && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando métricas…</div>}
        {sum && sum.configured === false && (
          <EmptyState title="Meta não conectada" hint="Defina META_ACCESS_TOKEN no servidor (o mesmo token da Publicidade) com as permissões de Instagram/página." />
        )}
        {sum && sum.configured && (
          <>
            {sum.errors?.setup && <div className="mono" style={{ fontSize: 11.5, color: "var(--warn)" }}>{sum.errors.setup}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <StatTile label="Seguidores" value={fmtNum(sum?.account?.followers_count)} delta={growth != null ? `${growth > 0 ? "+" : ""}${fmtNum(growth)} no período` : "variação indisponível"} />
              <StatTile label="Alcance · 30 dias" value={fmtNum(ins.reach)} delta={reachTotal ? `${nonFollowerPct}% não-seguidores` : "divisão indisponível"} />
              <StatTile label="Engajamento médio" value={eng?.rate != null ? `${String(eng.rate).replace(".", ",")}%` : "—"} delta={eng?.posts != null ? `${eng.posts} posts no período` : "sem posts no período"} />
              <StatTile label="Posts no mês" value={fmtNum(eng?.posts ?? 0)} delta={`de 12 · meta mensal`} />
            </div>

            {/* Segunda faixa: as demais métricas de perfil que o Instagram libera
                no período (já vêm do igInsights). "–" = a conta não expõe. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <StatTile label="Views · 30 dias" value={fmtNum(ins.views)} delta="visualizações totais" />
              <StatTile label="Visitas ao perfil" value={fmtNum(ins.profile_views)} delta="no período" />
              <StatTile label="Contas engajadas" value={fmtNum(ins.accounts_engaged)} delta="curtiram, comentaram, salvaram…" />
              <StatTile label="Interações · 30 dias" value={fmtNum(ins.total_interactions)} delta="curtidas + coment. + salvos + compart." />
              <StatTile label="Cliques no link" value={fmtNum((ins.profile_links_taps != null || ins.website_clicks != null) ? (ins.profile_links_taps || 0) + (ins.website_clicks || 0) : null)} delta="no perfil e na bio" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16 }}>
              <Card title="Crescimento de seguidores" hint="acumulado · 30 dias">
                <div style={{ padding: "8px 16px 12px" }}>
                  <AreaLine series={sum.followerSeries || []} cumulative valueLabel="seguidores" />
                </div>
                {/* Bruto do período: o líquido do gráfico esconde o churn. */}
                {sum.followsBreakdown && (sum.followsBreakdown.follows > 0 || sum.followsBreakdown.unfollows > 0) && (
                  <div style={{ padding: "0 24px 18px", fontSize: 13, color: "var(--fg-2)", display: "flex", gap: 18, flexWrap: "wrap" }}>
                    <span><b className="tnum" style={{ color: "var(--pos)" }}>+{fmtNum(sum.followsBreakdown.follows)}</b> seguiram</span>
                    <span><b className="tnum" style={{ color: "var(--neg)" }}>−{fmtNum(sum.followsBreakdown.unfollows)}</b> deixaram de seguir</span>
                  </div>
                )}
              </Card>

              <Card title="Alcance: seguidores × não-seguidores" hint="quanto do alcance é gente nova">
                <div style={{ padding: "18px 24px 22px" }}>
                  <div style={{ display: "flex", height: 34, borderRadius: 6, overflow: "hidden", gap: 2, background: "var(--bg-2)" }}>
                    <div style={{ width: `${followerPct}%`, background: "var(--fg-3)" }} />
                    <div style={{ width: `${nonFollowerPct}%`, background: "var(--accent)" }} />
                  </div>
                  <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
                    {[["Seguidores", rb?.follower, followerPct, "var(--fg-3)"], ["Não-seguidores", rb?.nonFollower, nonFollowerPct, "var(--accent)"]].map(([label, value, pct, color]) => (
                      <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />{label} <b className="tnum">{fmtNum(value)}</b> <span className="tnum" style={{ color: "var(--fg-4)", fontSize: 12 }}>{pct}%</span></span>
                    ))}
                  </div>
                  {/* Preferência pro número OFICIAL da conta por formato (inclui
                      story e anúncio); sem ele, cai na média derivada dos posts. */}
                  {(officialFormats.length > 0 || sum.formats?.length > 0) && (
                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 10 }}>
                        {officialFormats.length ? "Alcance por formato · 30 dias" : "Alcance médio por formato"}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {(officialFormats.length ? officialFormats : (sum.formats || []).map((f) => ({ label: f.label, value: f.avgReach }))).map((f) => (
                          <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ width: 80, fontSize: 12.5, color: "var(--fg-3)" }}>{f.label}</span>
                            <div style={{ flex: 1, height: 14, background: "var(--bg-2)", borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${Math.max(3, ((Number(f.value) || 0) / formatMax) * 100)}%`, height: "100%", background: "var(--accent)", borderRadius: 4 }} /></div>
                            <span className="tnum" style={{ width: 66, textAlign: "right", fontSize: 12.5, fontWeight: 600 }}>{fmtNum(f.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* Raio-x das interações: o total do tile aberto por tipo, e os
                  cliques do perfil por botão. Some sem dado (conta não expõe). */}
              {interactionSegs.length > 0 && (
                <Card title="Interações · por tipo" hint="30 dias">
                  <div style={{ padding: "14px 24px 20px" }}>
                    <DonutBlock title="" segments={interactionSegs} />
                    {(sum.linkTaps || []).length > 0 && (
                      <div style={{ marginTop: 16, fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.6 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-4)", marginRight: 8 }}>Cliques no perfil</span>
                        {sum.linkTaps.slice(0, 4).map((t) => `${TAP_LABEL[t.key] || String(t.key).toLowerCase()} ${fmtNum(t.value)}`).join(" · ")}
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </div>

            {/* Audiência: quem é o público (demografia). Some sozinho se a
                conta não libera (endpoint à parte). */}
            <AudiencePanel audience={audience} />

            {sum.errors?.media && <div className="mono dim" style={{ fontSize: 11 }}>posts do IG indisponíveis: {sum.errors.media}</div>}
            {sum.errors?.insights && <div className="mono dim" style={{ fontSize: 11 }}>alcance indisponível: {sum.errors.insights}</div>}

            {/* flexShrink 0 é OBRIGATÓRIO: overflow:hidden zera o min-height
                automático e o flex column do scroll ESMAGA o card quando o
                conteúdo passa da altura da janela — a tabela era comprimida
                até sumir e a página "não rolava" pra mostrar o resto. */}
            <Card title="Publicações recentes" hint={'o histórico do "criar post" aparece aqui'} style={{ overflow: "hidden", flexShrink: 0 }}>
             {/* .tbl-x: as colunas de métricas (todas as que o Instagram libera)
                 rolam na horizontal. */}
             <div className="tbl-x"><div style={{ minWidth: 1500 }}>
              <div style={{ display: "grid", gridTemplateColumns: POSTS_GRID, gap: 12, padding: "10px 24px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
                <span>Post</span><span>Formato</span><span style={{ textAlign: "right" }} title="contas únicas que viram o conteúdo">Alcance</span><span style={{ textAlign: "right" }} title="visualizações totais (impressões) — vale pra todos os formatos">Views</span><span style={{ textAlign: "right" }}>Curtidas</span><span style={{ textAlign: "right" }}>Coment.</span><span style={{ textAlign: "right" }}>Salvos</span><span style={{ textAlign: "right" }}>Compart.</span><span style={{ textAlign: "right" }} title="interações totais do post (curtidas + comentários + salvos + compartilhamentos)">Interações</span><span style={{ textAlign: "right" }} title="interações totais ÷ alcance">Eng.</span><span style={{ textAlign: "right" }} title="visitas ao perfil vindas deste post">Visitas</span><span style={{ textAlign: "right" }} title="novos seguidores ganhos a partir deste post">Seguiu</span><span style={{ textAlign: "right" }} title="tempo médio assistido ÷ duração do vídeo">Retenção</span><span style={{ textAlign: "right" }} title="% de views que passaram dos 3 primeiros segundos">Play 3s</span><span style={{ textAlign: "right" }} title="quantas vezes o reel foi reassistido">Replays</span><span style={{ textAlign: "right" }}>Publicado</span>
              </div>
              {recent.map((item) => (
                <div key={item.id} style={{ display: "grid", gridTemplateColumns: POSTS_GRID, gap: 12, padding: "13px 24px", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 13.5 }}>
                  {item.permalink ? <a href={item.permalink} target="_blank" rel="noreferrer" style={{ color: "inherit", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{postTitle(item)}</a> : <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{postTitle(item)}</span>}
                  <span><Pill tone="mut">{formatLabel(item)}</Pill></span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.reach != null ? fmtNum(item.reach) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.views != null ? fmtNum(item.views) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.likes != null ? fmtNum(item.likes) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.comments != null ? fmtNum(item.comments) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.saved != null ? fmtNum(item.saved) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.shares != null ? fmtNum(item.shares) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.totalInteractions != null ? fmtNum(item.totalInteractions) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{engRate(item) ?? "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.profileVisits != null ? fmtNum(item.profileVisits) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.follows != null ? fmtNum(item.follows) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }} title={item.avgWatchMs > 0 ? `tempo médio ${(item.avgWatchMs / 1000).toFixed(1).replace(".", ",")}s${durations[item.id] ? ` de ${Math.round(durations[item.id])}s` : " (duração do vídeo indisponível)"}` : undefined}>{retentionRate(item, durations[item.id]) ?? "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }} title={item.skipRate != null ? `${fmtPct(Number(item.skipRate))} pularam nos 3 primeiros segundos` : undefined}>{play3sRate(item) ?? "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }} title={item.totalWatchMs > 0 ? `tempo total assistido ${Math.round(item.totalWatchMs / 1000)}s` : undefined}>{item.replays != null ? fmtNum(item.replays) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right", color: "var(--fg-3)" }}>{item.at ? new Date(item.at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : "—"}</span>
                </div>
              ))}
              {!recent.length && <div style={{ padding: "18px 24px", borderTop: "1px solid var(--line-1)", color: "var(--fg-4)", fontSize: 13 }}>nenhuma publicação ainda</div>}
             </div></div>
            </Card>

            {/* Stories capturados: o Instagram só entrega métrica de story VIVO
                (24h) — o cockpit fotografa quando a tela abre e guarda o
                histórico. flexShrink 0 pelo mesmo motivo da tabela de posts. */}
            <Card title="Stories" hint="capturados enquanto no ar · histórico" style={{ overflow: "hidden", flexShrink: 0 }}>
             <div className="tbl-x"><div style={{ minWidth: 1150 }}>
              <div style={{ display: "grid", gridTemplateColumns: STORIES_GRID, gap: 12, padding: "10px 24px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
                <span>Story</span><span style={{ textAlign: "right" }}>Alcance</span><span style={{ textAlign: "right" }}>Views</span><span style={{ textAlign: "right" }} title="respostas por DM">Respostas</span><span style={{ textAlign: "right" }}>Compart.</span><span style={{ textAlign: "right" }} title="visitas ao perfil vindas do story">Visitas</span><span style={{ textAlign: "right" }} title="novos seguidores vindos do story">Seguiu</span><span style={{ textAlign: "right" }} title="toques pra avançar">Avançou</span><span style={{ textAlign: "right" }} title="toques pra voltar (reassistiu)">Voltou</span><span style={{ textAlign: "right" }} title="fechou os stories aqui">Saiu</span><span style={{ textAlign: "right" }} title="pulou pra próxima conta">Pulou</span><span style={{ textAlign: "right" }}>Publicado</span>
              </div>
              {stories.map((s) => (
                <div key={s.id} style={{ display: "grid", gridTemplateColumns: STORIES_GRID, gap: 12, padding: "13px 24px", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 13.5 }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(s.caption || "").split("\n")[0].trim() || `Story · ${s.type === "VIDEO" ? "vídeo" : "imagem"}`}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{s.reach != null ? fmtNum(s.reach) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{s.views != null ? fmtNum(s.views) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{s.replies != null ? fmtNum(s.replies) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{s.shares != null ? fmtNum(s.shares) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{s.profileVisits != null ? fmtNum(s.profileVisits) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{s.follows != null ? fmtNum(s.follows) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{s.navForward != null ? fmtNum(s.navForward) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{s.navBack != null ? fmtNum(s.navBack) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{s.navExit != null ? fmtNum(s.navExit) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{s.navNext != null ? fmtNum(s.navNext) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right", color: "var(--fg-3)" }}>{s.at ? new Date(s.at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "") : "—"}</span>
                </div>
              ))}
              {!stories.length && <div style={{ padding: "18px 24px", borderTop: "1px solid var(--line-1)", color: "var(--fg-4)", fontSize: 13 }}>nenhum story capturado ainda · o cockpit fotografa os que estiverem no ar quando a tela abre</div>}
             </div></div>
            </Card>

            {/* Radar do mercado: concorrentes, marcações e hashtags. */}
            <DiscoveryPanel key={product?.id} product={product} sum={sum} />
          </>
        )}
      </div>
      )}

      {wizard && (
        <ErrorBoundary variant="modal" label="criar-post" onReset={() => setWizard(false)}>
          <PostWizard
            saas={product?.id}
            pains={sum?.pains || []}
            aiConfigured={!!sum?.aiConfigured}
            onClose={() => setWizard(false)}
            onPublished={reloadSocial}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

// ── Wizard "Criar post" ──────────────────────────────────────────────────────
function PostWizard({ saas, pains = [], aiConfigured, onClose, onPublished }) {
  const isMobile = useIsMobile();
  const [step, setStep] = useS(1);
  const [format, setFormat] = useS("feed");
  const [kind, setKind] = useS("image");
  const editorRef = useR(null);
  const [videoFile, setVideoFile] = useS(null);
  const [videoUrl, setVideoUrl] = useS("");
  const [caption, setCaption] = useS("");
  const [nets, setNets] = useS({ instagram: true, facebook: false });
  const [busy, setBusy] = useS(null);
  const [result, setResult] = useS(null);
  // Copy por IA: dor escolhida + sugestão livre pra criação.
  const [dor, setDor] = useS("");
  const [suggestion, setSuggestion] = useS("");
  const [aiBusy, setAiBusy] = useS(false);
  const [aiErr, setAiErr] = useS(null);
  const [aiDone, setAiDone] = useS(false);

  // Lista de dores: as do produto (painMap) + as base, sem repetir.
  const dorOptions = [...new Set([...(pains || []).map((p) => p.label), ...DEFAULT_PAINS])];

  async function generateCopy() {
    setAiBusy(true); setAiErr(null);
    try {
      const ed = editorRef.current;
      if (!ed) throw new Error("editor não carregou");
      const { fields, caption: cap } = await api.socialAiCopy({
        saas, dor, suggestion,
        formatLabel: ed.formatLabel, templateName: ed.templateName,
        fields: ed.fieldsSpec(),
      });
      ed.applyVals(fields);
      if (cap) setCaption(cap);
      setAiDone(true);
    } catch (e) { setAiErr(e.message); }
    finally { setAiBusy(false); }
  }

  useE(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  const fmt = FORMATS.find((f) => f.id === format);
  const editorGroups = format === "story"
    ? (kind === "sequence" ? ["storyseq"] : ["story"])
    : kind === "carousel" ? ["car"] : ["post"];
  const fbAllowed = format === "feed";
  const hasCaption = format !== "story";
  const contentReady = kind === "video" ? !!videoFile : true;
  const netsPicked = nets.instagram || (nets.facebook && fbAllowed);

  function pickFormat(id) {
    setFormat(id);
    const allowed = FORMATS.find((f) => f.id === id).kinds;
    if (!allowed.includes(kind)) setKind(allowed[0]);
    if (id !== "feed") setNets((n) => ({ ...n, facebook: false }));
  }

  function onVideo(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
  }

  async function publish() {
    setResult(null);
    try {
      let assetIds = [];
      if (kind === "video") {
        if (!videoFile) throw new Error("escolha o vídeo antes de publicar");
        setBusy("enviando o vídeo…");
        const up = await api.socialUpload(videoFile, videoFile.name || "video.mp4", saas);
        assetIds = [up.id];
      } else {
        setBusy("gerando as artes…");
        const blobs = await editorRef.current.getBlobs();
        const wanted = kind === "carousel" || kind === "sequence" ? blobs : blobs.slice(0, 1);
        if (!wanted.length) throw new Error("nenhuma arte gerada — o editor carregou?");
        let n = 0;
        for (const b of wanted) {
          setBusy(`enviando arte ${++n}/${wanted.length}…`);
          const up = await api.socialUpload(b.blob, b.name, saas);
          assetIds.push(up.id);
        }
      }
      setBusy("publicando na Meta…");
      const networks = [nets.instagram && "instagram", nets.facebook && fbAllowed && "facebook"].filter(Boolean);
      const res = await api.socialPublish({ saas, format, kind, assetIds, caption: hasCaption ? caption : "", networks });
      setResult(res);
      if (res.ok) onPublished && onPublished();
    } catch (e) {
      setResult({ ok: false, results: { erro: { ok: false, error: e.message } } });
    } finally {
      setBusy(null);
    }
  }

  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const bigChip = (on) => ({
    padding: "12px 16px", borderRadius: "var(--r-3)", textAlign: "left", minWidth: 150,
    border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"),
    background: on ? "var(--accent-soft)" : "var(--bg-1)",
    color: "var(--fg-1)",
  });
  const btn = { height: 30, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12.5 };
  const primary = { ...btn, background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", border: "1px solid var(--btn-bg, var(--accent))", fontWeight: 600 };

  const stepLabel = ["", "formato", kind === "video" ? "vídeo" : "arte", "publicar"][step];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "color-mix(in srgb, var(--bg-0) 70%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }}>
      <div style={{ width: "min(1400px, 100%)", height: "min(92vh, 100%)", background: "var(--bg-0)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line-1)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700 }}>Criar post</span>
          <span className="mono dim" style={{ fontSize: 11 }}>passo {step}/3 · {stepLabel}</span>
          <button onClick={onClose} className="mono dim" style={{ marginLeft: "auto", fontSize: 15 }}>✕</button>
        </div>

        {/* No mobile o passo 2 (editor empilhado) precisa rolar; o hidden é só
            pro editor lado a lado do desktop controlar o próprio scroll. */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: step === 2 && kind !== "video" && !isMobile ? "hidden" : "auto" }}>
          {step === 1 && (
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Onde vai o post?</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {FORMATS.map((f) => (
                    <button key={f.id} onClick={() => pickFormat(f.id)} style={bigChip(format === f.id)}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{f.label}</div>
                      <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>{f.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Que tipo de conteúdo?</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {fmt.kinds.map((k) => (
                    <button key={k} onClick={() => setKind(k)} style={bigChip(kind === k)}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{KIND_LABELS[k]}</div>
                      <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>{KIND_HINTS[k]}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dor + sugestão só valem pra conteúdo criado aqui (o vídeo é
                  upload pronto). A IA usa isso pra escrever a copy no passo 2. */}
              {CREATED_HERE.has(kind) && (
                <div style={{ borderTop: "1px solid var(--line-1)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 620 }}>
                  <div>
                    <label className="mono" style={{ ...kicker, display: "block", marginBottom: 6 }}>Sobre qual dor é esse post?</label>
                    <select value={dor} onChange={(e) => setDor(e.target.value)}
                      style={{ width: "100%", height: 34, padding: "0 10px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13 }}>
                      <option value="">sem dor específica (valor central da LeverAds)</option>
                      {dorOptions.map((d, i) => <option key={i} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mono" style={{ ...kicker, display: "block", marginBottom: 6 }}>Sugestão pra criação (opcional)</label>
                    <textarea rows={2} value={suggestion} onChange={(e) => setSuggestion(e.target.value)}
                      placeholder="ex.: cita o case da conta que fez +105%, tom mais provocativo, fala com quem tem 5+ contas…"
                      style={{ width: "100%", padding: "8px 10px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, lineHeight: 1.4, resize: "vertical", fontFamily: "inherit" }} />
                  </div>
                  <div className="mono dim" style={{ fontSize: 10.5 }}>
                    {aiConfigured
                      ? "no próximo passo tem o botão de gerar a copy com IA a partir disso"
                      : "IA não configurada no servidor: dá pra escrever a copy à mão no editor"}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && kind !== "video" && (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {aiConfigured && (
                <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={generateCopy} disabled={aiBusy} style={{ ...primary, height: 28, opacity: aiBusy ? 0.6 : 1 }}>
                    {aiBusy ? "escrevendo…" : aiDone ? "✨ gerar de novo" : "✨ gerar copy com IA"}
                  </button>
                  <span className="mono dim" style={{ fontSize: 11 }}>
                    dor: {dor ? (dor.length > 46 ? dor.slice(0, 46) + "…" : dor) : "valor central"}
                  </span>
                  {aiDone && !aiBusy && !aiErr && <span className="mono" style={{ fontSize: 11, color: "var(--pos)" }}>copy aplicada · edite à vontade</span>}
                  {aiErr && <span className="mono" style={{ fontSize: 11, color: "var(--neg)" }}>{aiErr}</span>}
                  <span className="mono dim" style={{ fontSize: 10.5, marginLeft: "auto" }}>troque o template e gere de novo se quiser</span>
                </div>
              )}
              <CreativeEditor groups={editorGroups} zoomIndex={2} apiRef={editorRef} />
            </div>
          )}

          {step === 2 && kind === "video" && (
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
              <div className="mono" style={kicker}>Vídeo {format === "reel" ? "do reel (vertical 9:16)" : format === "story" ? "do story (vertical 9:16)" : "do post"}</div>
              <label style={{ ...btn, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                {videoFile ? "trocar vídeo…" : "escolher vídeo…"}
                <input type="file" accept="video/mp4,video/quicktime" onChange={onVideo} style={{ display: "none" }} />
              </label>
              {videoFile && (
                <>
                  <span className="mono dim" style={{ fontSize: 11 }}>{videoFile.name} · {(videoFile.size / 1048576).toFixed(1)} MB (máx 80)</span>
                  <video src={videoUrl} controls style={{ maxHeight: "50vh", maxWidth: "100%", borderRadius: 10, background: "#000" }} />
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
              <div>
                <div className="mono" style={{ ...kicker, marginBottom: 6 }}>Resumo</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Pill tone="mut">{fmt.label}</Pill>
                  <Pill tone="mut">{KIND_LABELS[kind]}</Pill>
                  {(kind === "carousel" || kind === "sequence") && <Pill tone="mut">4 slides</Pill>}
                  {kind === "sequence" && <Pill tone="mut">publica um a um, em ordem</Pill>}
                  {kind === "video" && videoFile && <Pill tone="mut">{videoFile.name}</Pill>}
                </div>
              </div>

              {hasCaption ? (
                <label>
                  <span className="mono" style={{ ...kicker, display: "block", marginBottom: 4 }}>Legenda</span>
                  <textarea rows={5} value={caption} onChange={(e) => setCaption(e.target.value)}
                    placeholder={"Escreva a legenda…\n\n#hashtags entram aqui também"}
                    style={{ width: "100%", padding: "8px 10px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }} />
                </label>
              ) : (
                <div className="mono dim" style={{ fontSize: 11 }}>story não leva legenda</div>
              )}

              <div>
                <span className="mono" style={{ ...kicker, display: "block", marginBottom: 6 }}>Publicar em</span>
                <div style={{ display: "flex", gap: 14 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={nets.instagram} onChange={(e) => setNets((n) => ({ ...n, instagram: e.target.checked }))} />
                    Instagram
                  </label>
                  <label title={fbAllowed ? "" : "página do Facebook só recebe post de feed"}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, opacity: fbAllowed ? 1 : 0.45 }}>
                    <input type="checkbox" disabled={!fbAllowed} checked={nets.facebook && fbAllowed} onChange={(e) => setNets((n) => ({ ...n, facebook: e.target.checked }))} />
                    Página do Facebook
                  </label>
                </div>
              </div>

              {busy && <div className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>⏳ {busy}</div>}
              {result && (
                <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {Object.entries(result.results || {}).map(([net, r]) => (
                    <div key={net} style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: r.ok ? "var(--pos)" : "var(--neg)", fontWeight: 600 }}>{r.ok ? "✓" : "✕"} {net}</span>
                      {r.ok && r.permalink && <a href={r.permalink} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>ver publicação ↗</a>}
                      {!r.ok && <span className="dim" style={{ fontSize: 11.5 }}>{r.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "flex", gap: 8, alignItems: "center" }}>
          {step > 1 && !result?.ok && <button onClick={() => setStep(step - 1)} style={btn}>← voltar</button>}
          {step < 3 && (
            <button onClick={() => setStep(step + 1)} disabled={step === 2 && !contentReady}
              style={{ ...primary, opacity: step === 2 && !contentReady ? 0.5 : 1 }}>
              continuar →
            </button>
          )}
          {step === 3 && !result?.ok && (
            <button onClick={publish} disabled={!!busy || !netsPicked} style={{ ...primary, opacity: busy || !netsPicked ? 0.6 : 1 }}>
              {busy ? "publicando…" : "publicar agora"}
            </button>
          )}
          {result?.ok && <span className="mono" style={{ fontSize: 12, color: "var(--pos)" }}>publicado ✓</span>}
          <button onClick={onClose} className="mono dim" style={{ marginLeft: "auto", fontSize: 12 }}>fechar</button>
        </div>
      </div>
    </div>
  );
}

// ── Aba "Comentários" ────────────────────────────────────────────────────────
// Fila de comentários do Instagram e da página do Facebook, com resposta direto
// daqui. Comentário novo cai pelo webhook da Meta e a tela acende sozinha: o
// webhook escreve na collection, o SSE do cockpit bate no `version` e o efeito
// abaixo refaz o fetch. O botão "atualizar" força a varredura completa na Meta
// (o padrão tem throttle de 1 min no servidor).

const STATUSES = [
  { id: "pending", label: "Pendentes" },
  { id: "answered", label: "Respondidos" },
  { id: "all", label: "Todos" },
];
const NET_LABEL = { instagram: "Instagram", facebook: "Facebook" };

// "há 20 min" / "há 3h" / "há 2d" — a idade do comentário é o que decide a
// ordem de atendimento, então ela vem antes da data absoluta.
function ago(iso) {
  const t = new Date(iso || 0).getTime();
  if (!t) return "";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.round(h / 24)}d`;
}

function CommentsPanel({ saas, onCount }) {
  const { version } = useData();
  const [status, setStatus] = useS("pending");
  const [data, setData] = useS(null);
  const [err, setErr] = useS(null);
  const [busy, setBusy] = useS(false);
  // Qual comentário está com a caixa de resposta aberta, e o rascunho de cada um
  // (guardado por id: trocar de card não pode perder o que já foi escrito).
  const [open, setOpen] = useS("");
  const [drafts, setDrafts] = useS({});
  const [sending, setSending] = useS("");
  const [actionErr, setActionErr] = useS({});

  const load = React.useCallback(async (force = false) => {
    if (!saas) return;
    if (force) setBusy(true);
    try {
      const r = await api.socialComments(saas, status, force);
      setData(r); setErr(null);
      if (onCount) onCount(r?.insights?.pending ?? null);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }, [saas, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useE(() => { load(false); }, [load, version]);

  async function act(id, fn) {
    setSending(id);
    setActionErr((m) => ({ ...m, [id]: null }));
    try {
      await fn();
      setOpen("");
      setDrafts((d) => ({ ...d, [id]: "" }));
      await load(false);
    } catch (e) {
      setActionErr((m) => ({ ...m, [id]: e.message }));
    } finally { setSending(""); }
  }

  const list = data?.comments || [];
  const ins = data?.insights;
  const btn = { height: 28, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12.5 };
  const primary = { ...btn, background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", border: "1px solid var(--btn-bg, var(--accent))", fontWeight: 600 };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
      {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
      {data && data.configured === false && (
        <EmptyState title="Meta não conectada" hint="Defina META_ACCESS_TOKEN no servidor com instagram_manage_comments (Instagram) e pages_manage_engagement (página do Facebook)." />
      )}
      {data?.errors?.setup && <div className="mono" style={{ fontSize: 11.5, color: "var(--warn)" }}>{data.errors.setup}</div>}

      {ins && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <StatTile label="Esperando resposta" value={fmtNum(ins.pending)}
            delta={ins.oldestPendingHours != null ? `o mais antigo há ${ins.oldestPendingHours >= 24 ? `${Math.round(ins.oldestPendingHours / 24)}d` : `${ins.oldestPendingHours}h`}` : "fila zerada"} />
          <StatTile label="Tempo de resposta" value={ins.medianReplyMinutes == null ? "—" : ins.medianReplyMinutes >= 60 ? `${Math.round(ins.medianReplyMinutes / 60)}h` : `${ins.medianReplyMinutes} min`}
            delta={ins.replySample ? `mediana de ${ins.replySample} respostas` : "sem resposta no período"} />
          <StatTile label="Respondidos · 30 dias" value={ins.answeredRate == null ? "—" : `${ins.answeredRate}%`} delta={`${fmtNum(ins.answered)} de ${fmtNum(ins.inPeriod)} comentários`} />
          <StatTile label="Ocultos" value={fmtNum(ins.hidden)} delta="some pra todo mundo menos pra quem escreveu" />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {STATUSES.map((s) => (
          <button key={s.id} onClick={() => setStatus(s.id)}
            style={{ ...btn, ...(status === s.id ? { background: "var(--accent-soft)", border: "1px solid var(--accent-line)", color: "var(--fg-1)", fontWeight: 600 } : {}) }}>
            {s.label}
          </button>
        ))}
        <button onClick={() => load(true)} disabled={busy} style={{ ...btn, marginLeft: "auto", opacity: busy ? 0.6 : 1 }}>
          {busy ? "buscando na Meta…" : "↻ atualizar"}
        </button>
      </div>

      {/* Uma rede falhar não some com a outra: o Instagram continua na tela
          mesmo quando a página do Facebook recusa a leitura. */}
      {data?.errors?.instagram && <div className="mono dim" style={{ fontSize: 11 }}>Instagram indisponível: {data.errors.instagram}</div>}
      {data?.errors?.facebook && <div className="mono dim" style={{ fontSize: 11 }}>Facebook indisponível: {data.errors.facebook}</div>}

      {!data && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando comentários…</div>}

      {data && !list.length && (
        <EmptyState
          title={status === "pending" ? "Nenhum comentário esperando" : "Nada por aqui"}
          hint={status === "pending" ? "Tudo respondido. Comentário novo aparece aqui sozinho, sem precisar recarregar." : "Troque o filtro pra ver os outros comentários."} />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {list.map((c) => {
          const late = c.pending && c.waitingHours >= 24;
          return (
            <div key={c.id} style={{ border: "1px solid " + (late ? "var(--warn)" : "var(--line-1)"), borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Pill tone="mut">{NET_LABEL[c.network] || c.network}</Pill>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{c.author ? (c.network === "instagram" ? `@${c.author}` : c.author) : "alguém"}</span>
                <span className="mono dim" style={{ fontSize: 11 }}>{ago(c.at)}</span>
                {late && <Pill tone="warn">esperando há {c.waitingHours >= 48 ? `${Math.round(c.waitingHours / 24)} dias` : "mais de 1 dia"}</Pill>}
                {c.hidden && <Pill tone="mut">oculto</Pill>}
                {c.done && !c.answered && <Pill tone="mut">resolvido</Pill>}
                <span className="mono dim" style={{ fontSize: 11, marginLeft: "auto", maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.permalink ? <a href={c.permalink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{c.postTitle || "ver post"} ↗</a> : (c.postTitle || "")}
                </span>
              </div>

              <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.text || <span className="dim">(sem texto)</span>}</div>

              {c.reply && (
                <div style={{ borderLeft: "2px solid var(--accent-line)", paddingLeft: 10, marginLeft: 2, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="mono dim" style={{ fontSize: 10.5 }}>nossa resposta · {ago(c.reply.at)}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{c.reply.text}</span>
                </div>
              )}

              {open === c.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <textarea autoFocus rows={3} value={drafts[c.id] || ""} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                    placeholder={`Responder ${c.author ? (c.network === "instagram" ? "@" + c.author : c.author) : ""}…`}
                    style={{ width: "100%", padding: "8px 10px", background: "var(--bg-0)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }} />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button disabled={sending === c.id || !(drafts[c.id] || "").trim()}
                      onClick={() => act(c.id, () => api.socialCommentReply(c.id, drafts[c.id]))}
                      style={{ ...primary, opacity: sending === c.id || !(drafts[c.id] || "").trim() ? 0.6 : 1 }}>
                      {sending === c.id ? "publicando…" : "responder"}
                    </button>
                    <button onClick={() => setOpen("")} style={btn}>cancelar</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => setOpen(c.id)} style={primary}>responder</button>
                  {!c.answered && (
                    <button disabled={sending === c.id} onClick={() => act(c.id, () => api.socialCommentDone(c.id, !c.done))} style={btn}>
                      {c.done ? "reabrir" : "resolver sem responder"}
                    </button>
                  )}
                  <button disabled={sending === c.id} onClick={() => act(c.id, () => api.socialCommentHide(c.id, !c.hidden))}
                    title="ocultar tira o comentário da vista de todo mundo menos de quem escreveu"
                    style={btn}>
                    {c.hidden ? "mostrar de novo" : "ocultar"}
                  </button>
                </div>
              )}

              {actionErr[c.id] && <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{actionErr[c.id]}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { SocialScreen };
