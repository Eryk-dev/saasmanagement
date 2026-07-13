import React from "react";
import { PageHead, Pill } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { CreativeEditor } from "./creative.jsx";

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

const fmtNum = (n) => {
  if (n == null) return "–";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(".", ",")} mi`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(".", ",")} mil`;
  return String(n);
};

function SocialScreen() {
  const [product] = useActiveSaas();
  const [sum, setSum] = useS(null);
  const [posts, setPosts] = useS([]);
  const [err, setErr] = useS(null);
  const [wizard, setWizard] = useS(false);

  async function load() {
    if (!product?.id) return;
    setErr(null);
    try {
      const [s, p] = await Promise.all([api.socialSummary(product.id), api.socialPosts(product.id)]);
      setSum(s);
      setPosts(p || []);
    } catch (e) { setErr(e.message); }
  }
  useE(() => { setSum(null); setPosts([]); load(); }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const tile = { flex: "1 1 150px", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "12px 14px" };
  const ins = sum?.insights || {};
  const eng = sum?.engagement;
  const growth = sum?.followerGrowth;

  // Fileira principal (números que importam de cara). Seguidores mostra o
  // ganho líquido do período quando o Instagram libera a métrica.
  const headline = [
    ["Seguidores · IG", sum?.account?.followers_count, growth != null ? growth : undefined],
    ["Alcance · 30d", ins.reach],
    ["Contas engajadas · 30d", ins.accounts_engaged],
    ["Seguidores · página FB", sum?.page?.followers_count ?? sum?.page?.fan_count],
  ];
  // Fileira secundária (contexto do perfil e da atividade).
  const secondary = [
    ["Visitas ao perfil · 30d", ins.profile_views],
    ["Cliques no site · 30d", ins.website_clicks],
    ["Interações · 30d", ins.total_interactions],
    ["Posts no perfil", sum?.account?.media_count],
    ["Seguindo", sum?.account?.follows_count],
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead
        title="Mídia social"
        sub={sum?.account?.username ? `@${sum.account.username}${sum?.page?.name ? ` · ${sum.page.name}` : ""}` : "Instagram e página do Facebook do produto"}>
        <button onClick={() => setWizard(true)}
          style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12, fontWeight: 600 }}>
          ＋ criar post
        </button>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)", display: "flex", flexDirection: "column", gap: 16 }}>
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        {!sum && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando métricas…</div>}
        {sum && sum.configured === false && (
          <EmptyState title="Meta não conectada" hint="Defina META_ACCESS_TOKEN no servidor (o mesmo token da Publicidade) com as permissões de Instagram/página." />
        )}
        {sum && sum.configured && (
          <>
            {sum.errors?.setup && <div className="mono" style={{ fontSize: 11.5, color: "var(--warn)" }}>{sum.errors.setup}</div>}

            {/* Fileira principal */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {headline.map(([label, v, delta]) => (
                <div key={label} style={tile}>
                  <div className="mono" style={kicker}>{label}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                    <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700 }}>{fmtNum(v)}</span>
                    {delta !== undefined && delta !== null && (
                      <span className="mono tnum" style={{ fontSize: 11.5, fontWeight: 600, color: delta > 0 ? "var(--pos)" : delta < 0 ? "var(--neg)" : "var(--fg-4)" }}>
                        {delta > 0 ? "▲" : delta < 0 ? "▼" : ""}{delta > 0 ? "+" : ""}{fmtNum(delta)} · 30d
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Fileira secundária, mais discreta */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {secondary.map(([label, v]) => (
                <div key={label} style={{ ...tile, flex: "1 1 120px", padding: "10px 12px", background: "var(--bg-inset)" }}>
                  <div className="mono" style={{ ...kicker, fontSize: 9.5 }}>{label}</div>
                  <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700, marginTop: 3 }}>{fmtNum(v)}</div>
                </div>
              ))}
            </div>

            {/* Faixa de engajamento dos últimos posts */}
            {eng && (
              <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "12px 14px" }}>
                <div className="mono" style={{ ...kicker, marginBottom: 10 }}>Engajamento dos últimos {eng.posts} posts</div>
                <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
                  {[
                    ["Média de curtidas", `♥ ${fmtNum(eng.avgLikes)}`],
                    ["Média de comentários", `💬 ${String(eng.avgComments).replace(".", ",")}`],
                    ["Taxa de engajamento", eng.rate != null ? `${String(eng.rate).replace(".", ",")}%` : "–"],
                  ].map(([label, v]) => (
                    <div key={label}>
                      <div className="mono" style={{ ...kicker, fontSize: 9.5 }}>{label}</div>
                      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 20, fontWeight: 700, marginTop: 2 }}>{v}</div>
                    </div>
                  ))}
                  {eng.top && (
                    <a href={eng.top.permalink || "#"} target="_blank" rel="noopener noreferrer"
                      style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}>
                      <div>
                        <div className="mono" style={{ ...kicker, fontSize: 9.5, textAlign: "right" }}>Post que mais engajou</div>
                        <div className="mono" style={{ fontSize: 11, color: "var(--fg-2)", textAlign: "right", marginTop: 3 }}>
                          ♥ {fmtNum(eng.top.likes)} · 💬 {fmtNum(eng.top.comments)}
                        </div>
                      </div>
                      {eng.top.mediaUrl && (
                        <img src={eng.top.mediaUrl} alt="" referrerPolicy="no-referrer"
                          style={{ width: 44, height: 44, borderRadius: "var(--r-2)", objectFit: "cover", border: "1px solid var(--line-1)" }} />
                      )}
                    </a>
                  )}
                </div>
              </div>
            )}

            {sum.media?.length > 0 && (
              <div>
                <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Últimos posts no Instagram</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                  {sum.media.map((m) => (
                    <a key={m.id} href={m.permalink || "#"} target="_blank" rel="noopener noreferrer"
                      style={{ display: "block", textDecoration: "none", color: "inherit", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", overflow: "hidden", background: "var(--bg-1)" }}>
                      <div style={{ aspectRatio: "1", background: "var(--bg-3)", overflow: "hidden" }}>
                        {/* referrerPolicy no-referrer: o CDN do Instagram devolve
                            403 se a requisição carrega Referer do nosso domínio. */}
                        {m.mediaUrl && <img src={m.mediaUrl} alt="" loading="lazy" referrerPolicy="no-referrer"
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                      </div>
                      <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", padding: "5px 8px", display: "flex", gap: 8 }}>
                        <span>♥ {fmtNum(m.likes)}</span>
                        <span>💬 {fmtNum(m.comments)}</span>
                        <span style={{ marginLeft: "auto" }}>{m.type === "VIDEO" ? "▶" : ""}</span>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
            {sum.errors?.media && <div className="mono dim" style={{ fontSize: 11 }}>posts do IG indisponíveis: {sum.errors.media}</div>}
            {sum.errors?.insights && <div className="mono dim" style={{ fontSize: 11 }}>alcance indisponível: {sum.errors.insights}</div>}

            <div>
              <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Publicações feitas pelo cockpit</div>
              {posts.length === 0 && <div className="mono dim" style={{ fontSize: 11.5 }}>nenhuma ainda · o histórico do "criar post" aparece aqui</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {posts.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-1)", padding: "8px 12px", flexWrap: "wrap" }}>
                    <span className="mono dim" style={{ fontSize: 10.5, flexShrink: 0 }}>
                      {new Date(p.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <Pill tone="mut">{FORMATS.find((f) => f.id === p.format)?.label || p.format}</Pill>
                    <Pill tone="mut">{KIND_LABELS[p.kind] || p.kind}</Pill>
                    <span style={{ fontSize: 12, color: "var(--fg-2)", flex: 1, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.caption || ""}</span>
                    {Object.entries(p.results || {}).map(([net, r]) => (
                      r.ok && r.permalink
                        ? <a key={net} href={r.permalink} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 10.5, color: "var(--pos)", textDecoration: "none" }}>{net} ✓ ↗</a>
                        : <span key={net} className="mono" title={r.error || ""} style={{ fontSize: 10.5, color: r.ok ? "var(--pos)" : "var(--neg)" }}>{net} {r.ok ? "✓" : "✕"}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {wizard && (
        <PostWizard
          saas={product?.id}
          pains={sum?.pains || []}
          aiConfigured={!!sum?.aiConfigured}
          onClose={() => setWizard(false)}
          onPublished={load}
        />
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
  const primary = { ...btn, background: "var(--accent)", color: "var(--accent-fg)", border: "1px solid var(--accent)", fontWeight: 600 };

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

export { SocialScreen };
