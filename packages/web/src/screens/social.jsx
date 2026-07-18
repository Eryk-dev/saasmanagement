import React from "react";
import { PageHead, Pill, Card, StatTile } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { ErrorBoundary } from "../components/error-boundary.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useData } from "../data.jsx";
import { CreativeEditor } from "./creative.jsx";
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
const POSTS_GRID = "2fr .7fr .6fr .55fr .55fr .5fr .6fr .5fr .6fr .55fr .7fr";
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

function SocialScreen() {
  const [product] = useActiveSaas();
  const [sum, setSum] = useS(null);
  const [posts, setPosts] = useS([]);
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
    setSum(null); setErr(null);
    Promise.all([api.socialSummary(product.id, days), api.socialPosts(product.id)])
      .then(([s, p]) => { if (alive) { setSum(s); setPosts(p || []); } })
      .catch((e) => alive && setErr(e.message));
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
  const formatMax = Math.max(1, ...(sum?.formats || []).map((f) => Number(f.avgReach) || 0));
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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
              <Card title="Crescimento de seguidores" hint="acumulado · 30 dias">
                <div style={{ padding: "8px 16px 12px" }}>
                  <AreaLine series={sum.followerSeries || []} cumulative valueLabel="seguidores" />
                </div>
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
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 10 }}>Alcance médio por formato</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(sum.formats || []).map((f) => (
                        <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ width: 80, fontSize: 12.5, color: "var(--fg-3)" }}>{f.label}</span>
                          <div style={{ flex: 1, height: 14, background: "var(--bg-2)", borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${Math.max(3, ((Number(f.avgReach) || 0) / formatMax) * 100)}%`, height: "100%", background: "var(--accent)", borderRadius: 4 }} /></div>
                          <span className="tnum" style={{ width: 66, textAlign: "right", fontSize: 12.5, fontWeight: 600 }}>{fmtNum(f.avgReach)}</span>
                        </div>
                      ))}
                      {!sum.formats?.length && <span style={{ color: "var(--fg-4)", fontSize: 12.5 }}>sem dados por formato</span>}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {sum.errors?.media && <div className="mono dim" style={{ fontSize: 11 }}>posts do IG indisponíveis: {sum.errors.media}</div>}
            {sum.errors?.insights && <div className="mono dim" style={{ fontSize: 11 }}>alcance indisponível: {sum.errors.insights}</div>}

            <Card title="Publicações recentes" hint={'o histórico do "criar post" aparece aqui'} style={{ overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: POSTS_GRID, gap: 12, padding: "10px 24px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
                <span>Post</span><span>Formato</span><span style={{ textAlign: "right" }}>Alcance</span><span style={{ textAlign: "right" }}>Curtidas</span><span style={{ textAlign: "right" }}>Coment.</span><span style={{ textAlign: "right" }}>Salvos</span><span style={{ textAlign: "right" }}>Compart.</span><span style={{ textAlign: "right" }}>Eng.</span><span style={{ textAlign: "right" }} title="tempo médio assistido ÷ duração do vídeo">Retenção</span><span style={{ textAlign: "right" }} title="% de views que passaram dos 3 primeiros segundos">Play 3s</span><span style={{ textAlign: "right" }}>Publicado</span>
              </div>
              {recent.map((item) => (
                <div key={item.id} style={{ display: "grid", gridTemplateColumns: POSTS_GRID, gap: 12, padding: "13px 24px", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 13.5 }}>
                  {item.permalink ? <a href={item.permalink} target="_blank" rel="noreferrer" style={{ color: "inherit", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{postTitle(item)}</a> : <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{postTitle(item)}</span>}
                  <span><Pill tone="mut">{formatLabel(item)}</Pill></span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.reach != null ? fmtNum(item.reach) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.likes != null ? fmtNum(item.likes) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.comments != null ? fmtNum(item.comments) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.saved != null ? fmtNum(item.saved) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{item.shares != null ? fmtNum(item.shares) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }}>{engRate(item) ?? "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }} title={item.avgWatchMs > 0 ? `tempo médio ${(item.avgWatchMs / 1000).toFixed(1).replace(".", ",")}s${durations[item.id] ? ` de ${Math.round(durations[item.id])}s` : " (duração do vídeo indisponível)"}` : undefined}>{retentionRate(item, durations[item.id]) ?? "—"}</span>
                  <span className="tnum" style={{ textAlign: "right" }} title={item.skipRate != null ? `${fmtPct(Number(item.skipRate))} pularam nos 3 primeiros segundos` : undefined}>{play3sRate(item) ?? "—"}</span>
                  <span className="tnum" style={{ textAlign: "right", color: "var(--fg-3)" }}>{item.at ? new Date(item.at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : "—"}</span>
                </div>
              ))}
              {!recent.length && <div style={{ padding: "18px 24px", borderTop: "1px solid var(--line-1)", color: "var(--fg-4)", fontSize: 13 }}>nenhuma publicação ainda</div>}
            </Card>
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

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: step === 2 && kind !== "video" ? "hidden" : "auto" }}>
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
