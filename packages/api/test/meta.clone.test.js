// Clonagem de anúncio na Meta (client): duplicar conjunto (deep copy), ler o
// spec do criativo, criar criativo novo trocando só o vídeo, e atualizar o
// anúncio. fetch mockado grava as chamadas.

import test from "node:test";
import assert from "node:assert/strict";

const { makeMeta } = await import("../src/marketing/meta.js");

function recorder(responder) {
  const calls = [];
  const f = async (url, opts) => {
    const body = opts?.body ? Object.fromEntries(new URLSearchParams(opts.body)) : null;
    calls.push({ url: String(url), method: opts?.method || "GET", body });
    const out = responder(String(url), body);
    return { status: 200, text: async () => JSON.stringify(out) };
  };
  f.calls = calls;
  return f;
}

test("copyAdSet: deep copy pausado; parseia copied_adset_id e só os ad_object AD", async () => {
  const f = recorder(() => ({
    copied_adset_id: "as_copy",
    ad_object_ids: [
      { ad_object_type: "AD", source_id: "ad_src", copied_id: "ad_copy" },
      { ad_object_type: "CREATIVE", source_id: "cr_src", copied_id: "cr_copy" },
    ],
  }));
  const meta = makeMeta({ fetch: f, accessToken: "tok" });
  const r = await meta.copyAdSet("as_src", { statusOption: "PAUSED" });
  assert.deepEqual(r, { adsetId: "as_copy", adIds: ["ad_copy"] });
  const c = f.calls[0];
  assert.match(c.url, /\/as_src\/copies$/);
  assert.equal(c.body.deep_copy, "true");
  assert.equal(c.body.status_option, "PAUSED");
});

test("getAdCreativeSpec: devolve object_story_spec + url_tags", async () => {
  const f = recorder(() => ({ creative: { object_story_spec: { page_id: "1", video_data: { video_id: "v_old", image_url: "old" } }, url_tags: "utm_source=meta" } }));
  const meta = makeMeta({ fetch: f, accessToken: "tok" });
  const { spec, urlTags } = await meta.getAdCreativeSpec("ad_copy");
  assert.equal(spec.video_data.video_id, "v_old");
  assert.equal(urlTags, "utm_source=meta");
  assert.match(f.calls[0].url, /\/ad_copy\?/);
  assert.match(decodeURIComponent(f.calls[0].url), /creative\{object_story_spec,asset_feed_spec,degrees_of_freedom_spec,url_tags\}/);
});

test("createVideoCreativeFromSpec: troca só o vídeo/thumb e preserva o resto", async () => {
  const f = recorder(() => ({ id: "cr_new" }));
  const meta = makeMeta({ fetch: f, accessToken: "tok" });
  const sourceSpec = { page_id: "10", instagram_user_id: "20", video_data: { video_id: "v_old", image_url: "old", message: "copy mantida", call_to_action: { type: "LEARN_MORE", value: { link: "https://x" } } } };
  const freedom = { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_IN" }, image_touchups: { enroll_status: "OPT_OUT" } } };
  const id = await meta.createVideoCreativeFromSpec("act_9", { name: "1303 [B]", sourceSpec, freedom, videoId: "v_new", imageUrl: "thumb_new", urlTags: "utm_source=meta" });
  assert.equal(id, "cr_new");
  assert.deepEqual(JSON.parse(f.calls[0].body.degrees_of_freedom_spec), { creative_features_spec: { image_touchups: { enroll_status: "OPT_OUT" } } }, "melhorias iguais às do original, sem a chave descontinuada");
  const spec = JSON.parse(f.calls[0].body.object_story_spec);
  assert.equal(spec.video_data.video_id, "v_new");   // trocou
  assert.equal(spec.video_data.image_url, "thumb_new");
  assert.equal(spec.video_data.message, "copy mantida"); // preservou
  assert.equal(spec.page_id, "10");
  assert.equal(spec.instagram_user_id, "20");
  assert.equal(f.calls[0].body.url_tags, "utm_source=meta");
  // objeto de origem intocado (deep clone)
  assert.equal(sourceSpec.video_data.video_id, "v_old");
});

test("createVideoCreativeFromSpec: recusa spec sem video_data (não é vídeo)", async () => {
  const meta = makeMeta({ fetch: recorder(() => ({})), accessToken: "tok" });
  await assert.rejects(
    () => meta.createVideoCreativeFromSpec("act_9", { name: "x", sourceSpec: { page_id: "1", link_data: {} }, videoId: "v", imageUrl: "t" }),
    /não é um anúncio de vídeo/,
  );
});

test("updateAd: manda nome e creative do jeito da Graph", async () => {
  const f = recorder(() => ({ success: true }));
  const meta = makeMeta({ fetch: f, accessToken: "tok" });
  await meta.updateAd("ad_copy", { name: "1303 [B]", creativeId: "cr_new" });
  assert.equal(f.calls[0].body.name, "1303 [B]");
  assert.equal(JSON.parse(f.calls[0].body.creative).creative_id, "cr_new");
});

test("renameObject: POST {name} no nó", async () => {
  const f = recorder(() => ({ success: true }));
  const meta = makeMeta({ fetch: f, accessToken: "tok" });
  const r = await meta.renameObject("as_copy", "1303 [B]");
  assert.deepEqual(r, { id: "as_copy", name: "1303 [B]" });
  assert.equal(f.calls[0].body.name, "1303 [B]");
});

test("adCreativeMedia: vídeo → busca o source (2ª chamada); imagem → sem 2ª chamada", async () => {
  // Anúncio de VÍDEO: creative traz object_story_spec.video_data.video_id.
  const fv = recorder((url) => {
    if (url.includes("/vid123")) return { source: "https://video.fbcdn/xyz.mp4" };
    return { name: "1300 [B]", creative: { object_story_spec: { video_data: { video_id: "vid123", image_url: "https://thumb.jpg" } } } };
  });
  const v = await makeMeta({ fetch: fv, accessToken: "t" }).adCreativeMedia("ad_1");
  assert.equal(v.type, "video");
  assert.equal(v.videoUrl, "https://video.fbcdn/xyz.mp4");
  assert.equal(v.thumbnail, "https://thumb.jpg");
  assert.equal(v.title, "1300 [B]");
  assert.equal(fv.calls.length, 2); // ad + video source

  // Anúncio de IMAGEM: link_data.image_url, sem vídeo → uma chamada só.
  const fi = recorder(() => ({ name: "1258 [A]", creative: { object_story_spec: { link_data: { image_url: "https://img.jpg" } } } }));
  const i = await makeMeta({ fetch: fi, accessToken: "t" }).adCreativeMedia("ad_2");
  assert.equal(i.type, "image");
  assert.equal(i.imageUrl, "https://img.jpg");
  assert.equal(fi.calls.length, 1);

  // Sem mídia → type "none".
  const fn = recorder(() => ({ name: "x", creative: {} }));
  const n = await makeMeta({ fetch: fn, accessToken: "t" }).adCreativeMedia("ad_3");
  assert.equal(n.type, "none");
});

// ── Upload de vídeo em pedaços ──────────────────────────────────────────────
// A borda da Meta recusa POST único de vídeo grande com 413 e corpo VAZIO (foi
// o que derrubou o upload de 143 MB do time). Acima de 20 MB o client usa o
// protocolo start/transfer/finish, que a Meta guia pelos offsets.

test("uploadVideo: vídeo grande sobe em pedaços (start/transfer/finish) e devolve o id da sessão", async () => {
  const size = 25 * 1024 * 1024;   // acima do limiar
  const chunk = 8 * 1024 * 1024;
  const calls = [];
  const f = async (url, opts) => {
    const fd = opts.body;
    const phase = fd.get("upload_phase");
    const piece = fd.get("video_file_chunk");
    calls.push({ phase, start: Number(fd.get("start_offset") || 0), bytes: piece?.size ?? null, title: fd.get("title") });
    let out;
    if (phase === "start") out = { video_id: "v_big", upload_session_id: "s1", start_offset: "0", end_offset: String(chunk) };
    else if (phase === "transfer") {
      const next = Number(fd.get("start_offset")) + piece.size;
      out = { start_offset: String(next), end_offset: String(Math.min(next + chunk, size)) };
    } else out = { success: true };
    return { status: 200, text: async () => JSON.stringify(out) };
  };
  const meta = makeMeta({ fetch: f, accessToken: "t" });

  const progress = [];
  const id = await meta.uploadVideo("act_1", {
    buffer: Buffer.alloc(size), filename: "grande.mp4", title: "1330 [A]",
    onProgress: (p) => progress.push(p),
  });

  assert.equal(id, "v_big");                                   // id vem da fase start
  assert.equal(calls[0].phase, "start");
  assert.equal(calls.at(-1).phase, "finish");
  assert.equal(calls.at(-1).title, "1330 [A]");                // título só no fim
  const transfers = calls.filter((c) => c.phase === "transfer");
  assert.equal(transfers.length, 4);                           // 25 MB em pedaços de 8
  assert.deepEqual(transfers.map((t) => t.start), [0, chunk, chunk * 2, chunk * 3]);
  assert.equal(transfers.reduce((s, t) => s + t.bytes, 0), size); // o arquivo inteiro, sem sobra
  assert.equal(progress.at(-1), 1);
});

test("uploadVideo: pedaço que falha é reenviado do MESMO offset", async () => {
  const size = 25 * 1024 * 1024;
  const chunk = 20 * 1024 * 1024;
  const seen = [];
  let failed = false;
  const f = async (url, opts) => {
    const fd = opts.body;
    const phase = fd.get("upload_phase");
    if (phase === "start") return { status: 200, text: async () => JSON.stringify({ video_id: "v2", upload_session_id: "s2", start_offset: "0", end_offset: String(chunk) }) };
    if (phase === "finish") return { status: 200, text: async () => JSON.stringify({ success: true }) };
    const start = Number(fd.get("start_offset"));
    seen.push(start);
    if (start === 0 && !failed) { failed = true; return { status: 500, text: async () => JSON.stringify({ error: { message: "oops" } }) }; }
    const next = start + fd.get("video_file_chunk").size;
    return { status: 200, text: async () => JSON.stringify({ start_offset: String(next), end_offset: String(Math.min(next + chunk, size)) }) };
  };
  const meta = makeMeta({ fetch: f, accessToken: "t", sleep: async () => {} });
  assert.equal(await meta.uploadVideo("act_1", { buffer: Buffer.alloc(size) }), "v2");
  assert.deepEqual(seen, [0, 0, chunk]); // repetiu o offset 0 e seguiu
});

test("uploadVideo: vídeo pequeno continua num POST só", async () => {
  const calls = [];
  const f = async (url, opts) => {
    calls.push(opts.body.get("upload_phase"));
    return { status: 200, text: async () => JSON.stringify({ id: "v_small" }) };
  };
  const meta = makeMeta({ fetch: f, accessToken: "t" });
  assert.equal(await meta.uploadVideo("act_1", { buffer: Buffer.alloc(1024), filename: "p.mp4" }), "v_small");
  assert.deepEqual(calls, [null]); // sem fases: caminho direto
});

// ── Erro da Meta legível ────────────────────────────────────────────────────
// "Invalid parameter" sozinho não diz nada a quem está na tela; a Graph manda
// o motivo de gente em error_user_msg e o par code/subcode pra documentação.

const { metaErrorText } = await import("../src/marketing/meta.js");

test("metaErrorText: junta mensagem técnica, motivo de gente e códigos", () => {
  assert.equal(
    metaErrorText({ message: "Invalid parameter", error_user_msg: "O conjunto de origem usa orçamento de campanha", code: 100, error_subcode: 1885183 }),
    "Invalid parameter · O conjunto de origem usa orçamento de campanha · [código 100/1885183]",
  );
  // sem detalhe humano, não inventa nada além do código
  assert.equal(metaErrorText({ message: "Invalid parameter", code: 100 }), "Invalid parameter · [código 100]");
  // detalhe repetido não aparece duas vezes
  assert.equal(metaErrorText({ message: "Limite atingido", error_user_title: "Limite atingido" }), "Limite atingido");
  // erro sem corpo cai no texto cru da resposta
  assert.equal(metaErrorText(null, "<html>502</html>"), "<html>502</html>");
});

test("erro da Graph chega no chamador com o motivo de gente junto", async () => {
  const f = async () => ({
    status: 400,
    text: async () => JSON.stringify({ error: { message: "Invalid parameter", error_user_msg: "Não dá pra copiar um conjunto arquivado", code: 100, error_subcode: 1487390 } }),
  });
  const meta = makeMeta({ fetch: f, accessToken: "t" });
  await assert.rejects(
    () => meta.copyAdSet("as_1", {}),
    (e) => e.message === "Meta API -> 400: Invalid parameter · Não dá pra copiar um conjunto arquivado · [código 100/1487390]",
  );
});

// Esta é a rede que faltava: `adsOfAdSet` foi pra fábrica e não pra fachada de
// produção, então os testes (que injetam meta falso) passavam e a tela dizia
// "meta.adsOfAdSet is not a function". A fachada agora repassa tudo — e este
// teste falha se alguém voltar a escrever a lista à mão e esquecer uma linha.
test("fachada de produção expõe TODO método da fábrica", async () => {
  const mod = await import("../src/marketing/meta.js");
  const daFabrica = Object.keys(makeMeta({ accessToken: "t" }));
  assert.ok(daFabrica.length > 15);
  assert.deepEqual(daFabrica.filter((k) => typeof mod.meta[k] !== "function"), []);
});

// ── Limite de chamadas da conta ─────────────────────────────────────────────
// É temporário e some sozinho, mas derrubava a leva: subir 5 criativos
// multiplica as chamadas e o 2º pegava "User request limit reached". Agora
// espera e tenta de novo, em vez de perder o vídeo que já subiu.

const limite = (code = 17) => ({
  status: 400,
  text: async () => JSON.stringify({ error: { message: "User request limit reached", code, is_transient: true, error_user_msg: "There have been too many calls from this ad-account." } }),
});

test("limite de chamadas: espera e tenta de novo até passar", async () => {
  let chamadas = 0;
  const esperas = [];
  const f = async () => (++chamadas <= 2 ? limite() : { status: 200, text: async () => JSON.stringify({ data: [{ id: "as1", name: "1331 [A]" }] }) });
  const meta = makeMeta({ fetch: f, accessToken: "t", sleep: async (ms) => esperas.push(ms) });
  const out = await meta.listAdsets("c1");
  assert.equal(out[0].id, "as1");
  assert.equal(chamadas, 3);                     // duas recusas + a que passou
  assert.deepEqual(esperas, [30_000, 60_000]);   // espera crescente
});

test("limite de chamadas: avisa quem está acompanhando a cada espera", async () => {
  const avisos = [];
  let chamadas = 0;
  const f = async () => (++chamadas === 1 ? limite(613) : { status: 200, text: async () => JSON.stringify({ data: [] }) });
  const meta = makeMeta({ fetch: f, accessToken: "t", sleep: async () => {}, onThrottle: (i) => avisos.push(i) });
  await meta.listAdsets("c1");
  assert.deepEqual(avisos, [{ waitMs: 30_000, attempt: 1, total: 4 }]);
});

test("limite de chamadas: desiste depois das tentativas, com recado claro", async () => {
  const meta = makeMeta({ fetch: async () => limite(), accessToken: "t", sleep: async () => {} });
  await assert.rejects(() => meta.listAdsets("c1"), (e) => {
    assert.equal(e.rateLimited, true);
    assert.match(e.message, /segue no limite depois de 4 tentativas/);
    return true;
  });
});

test("erro que NÃO é limite falha de primeira (não fica tentando à toa)", async () => {
  let chamadas = 0;
  const f = async () => { chamadas++; return { status: 400, text: async () => JSON.stringify({ error: { message: "Invalid parameter", code: 100 } }) }; };
  const meta = makeMeta({ fetch: f, accessToken: "t", sleep: async () => {} });
  await assert.rejects(() => meta.listAdsets("c1"), /Invalid parameter/);
  assert.equal(chamadas, 1);
});

// ── Cópia recusada por posicionamento em par (08/10/2026) ─────────────────────
// Caso real do Leo ao clonar "1436 [PRICE]": "Invalid parameter · To place ads
// in Instagram Explore Home, please also select Instagram Explore · [código
// 100/2490392]". Regra dele: clone EXATO, o cockpit não ajusta nada; o erro
// diz o que fazer no conjunto de origem.
const { placementPairHint, freedomSpecForCopy } = await import("../src/marketing/meta.js");
const EXPLORE_ERR = { message: "Invalid parameter", error_user_msg: "To place ads in Instagram Explore Home, please also select Instagram Explore.", code: 100, error_subcode: 2490392 };

test("placementPairHint: extrai a dica da Meta; outra mensagem não é par", () => {
  assert.equal(placementPairHint("Meta API -> 400: Invalid parameter · To place ads in Instagram Explore Home, please also select Instagram Explore. · [código 100/2490392]"), "To place ads in Instagram Explore Home, please also select Instagram Explore");
  assert.equal(placementPairHint("Invalid parameter [código 100]"), null);
});

test("copyAdSet: recusa por par de posicionamento NÃO recria nem altera nada; o erro diz o que ajustar na origem", async () => {
  const f = recorder((url) => (/\/as_src\/copies$/.test(url) ? { error: EXPLORE_ERR } : { id: "nunca" }));
  const meta = makeMeta({ fetch: f, accessToken: "tok" });
  await assert.rejects(() => meta.copyAdSet("as_src", { deepCopy: false }), (err) => {
    assert.match(err.message, /2490392/);
    assert.match(err.message, /copia o conjunto exatamente como está/);
    assert.match(err.message, /ajuste o conjunto de origem no Gerenciador \(To place ads in Instagram Explore Home, please also select Instagram Explore\)/);
    return true;
  });
  assert.equal(f.calls.length, 1, "uma chamada só: nada de ler o conjunto nem criar outro");
  // Outro erro sobe como está.
  const f2 = recorder(() => ({ error: { message: "Invalid parameter", code: 100, error_subcode: 1815857 } }));
  await assert.rejects(() => makeMeta({ fetch: f2, accessToken: "tok" }).copyAdSet("as_src", { deepCopy: false }), (err) => !/Gerenciador/.test(err.message) && /1815857/.test(err.message));
});

test("freedomSpecForCopy: melhorias do original vão como estão; só standard_enhancements (descontinuada) sai", () => {
  const src = { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_IN" }, image_touchups: { enroll_status: "OPT_OUT" }, enhance_cta: { enroll_status: "OPT_OUT" }, text_optimizations: { enroll_status: "OPT_IN" } } };
  assert.deepEqual(freedomSpecForCopy(src), { creative_features_spec: { image_touchups: { enroll_status: "OPT_OUT" }, enhance_cta: { enroll_status: "OPT_OUT" }, text_optimizations: { enroll_status: "OPT_IN" } } });
  assert.deepEqual(src.creative_features_spec.standard_enhancements, { enroll_status: "OPT_IN" }, "origem intocada");
  assert.equal(freedomSpecForCopy(null), null);
  assert.equal(freedomSpecForCopy({ creative_features_spec: { standard_enhancements: { enroll_status: "OPT_OUT" } } }), null, "só a descontinuada = nada a mandar");
});

// ── Texto no asset_feed_spec (08/10/2026) ─────────────────────────────────────
// O "1491 [PRICE]" subiu sem texto principal, título e descrição: o anúncio de
// origem guardava tudo no asset_feed_spec e o clone só olhava o video_data.
const { assetFeedWithVideo } = await import("../src/marketing/meta.js");
const FEED = {
  ad_formats: ["SINGLE_VIDEO"],
  bodies: [{ text: "Texto principal do 1436", adlabels: [{ id: "l1", name: "body_a" }] }],
  titles: [{ text: "Headline do 1436" }],
  descriptions: [{ text: "Descrição" }],
  link_urls: [{ website_url: "https://leverads.com.br/diagnostico", display_url: "leverads.com.br" }],
  call_to_action_types: ["LEARN_MORE"],
  videos: [{ video_id: "v_old", thumbnail_url: "old", adlabels: [{ id: "l9", name: "video_a" }] }, { video_id: "v_old2", adlabels: [{ id: "l9", name: "video_a" }, { id: "l8", name: "video_b" }] }],
  additional_data: { x: 1 }, autotranslate: ["pt"], id: "afs1",
};

test("getAdCreativeSpec: lê também o asset_feed_spec", async () => {
  const f = recorder(() => ({ creative: { object_story_spec: { page_id: "1", video_data: { video_id: "v_old" } }, asset_feed_spec: FEED, degrees_of_freedom_spec: { creative_features_spec: { enhance_cta: { enroll_status: "OPT_OUT" } } }, url_tags: "utm_source=meta" } }));
  const meta = makeMeta({ fetch: f, accessToken: "tok" });
  const r = await meta.getAdCreativeSpec("ad_src");
  assert.deepEqual(r.assetFeed, FEED);
  assert.deepEqual(r.freedom, { creative_features_spec: { enhance_cta: { enroll_status: "OPT_OUT" } } });
  assert.match(decodeURIComponent(f.calls[0].url), /creative\{object_story_spec,asset_feed_spec,degrees_of_freedom_spec,url_tags\}/);
});

test("assetFeedWithVideo: mantém textos/links/CTA, troca os vídeos pelo novo com os rótulos, tira o que a escrita recusa", () => {
  const feed = assetFeedWithVideo(FEED, { videoId: "v_new", imageUrl: "thumb_new" });
  assert.deepEqual(feed.bodies, FEED.bodies);
  assert.deepEqual(feed.titles, FEED.titles);
  assert.deepEqual(feed.descriptions, FEED.descriptions);
  assert.deepEqual(feed.link_urls, FEED.link_urls);
  assert.deepEqual(feed.call_to_action_types, ["LEARN_MORE"]);
  assert.deepEqual(feed.videos, [{ video_id: "v_new", thumbnail_url: "thumb_new", adlabels: [{ id: "l9", name: "video_a" }, { id: "l8", name: "video_b" }] }]);
  assert.equal(feed.additional_data, undefined);
  assert.equal(feed.autotranslate, undefined);
  assert.equal(feed.id, undefined);
  assert.equal(FEED.videos.length, 2, "origem intocada");
  // Sem texto no feed (ou sem feed), segue pelo video_data.
  assert.equal(assetFeedWithVideo(null, { videoId: "v" }), null);
  assert.equal(assetFeedWithVideo({ videos: [{ video_id: "v_old" }] }, { videoId: "v" }), null);
  // Feed sem ad_formats ganha SINGLE_VIDEO.
  assert.deepEqual(assetFeedWithVideo({ bodies: [{ text: "x" }] }, { videoId: "v" }).ad_formats, ["SINGLE_VIDEO"]);
});

test("createVideoCreativeFromSpec: com texto no asset_feed_spec, cria com o feed e o object_story_spec só de página/Instagram", async () => {
  const f = recorder(() => ({ id: "cr_feed" }));
  const meta = makeMeta({ fetch: f, accessToken: "tok" });
  const sourceSpec = { page_id: "10", instagram_user_id: "20", video_data: { video_id: "v_old", image_url: "old", call_to_action: { type: "LEARN_MORE", value: { link: "https://x" } } } };
  const freedom = { creative_features_spec: { enhance_cta: { enroll_status: "OPT_OUT" } } };
  const id = await meta.createVideoCreativeFromSpec("act_9", { name: "1491 [PRICE]", sourceSpec, assetFeed: FEED, freedom, videoId: "v_new", imageUrl: "thumb_new", urlTags: "utm_source=meta" });
  assert.equal(id, "cr_feed");
  const b = f.calls[0].body;
  assert.deepEqual(JSON.parse(b.degrees_of_freedom_spec), freedom);
  assert.deepEqual(JSON.parse(b.object_story_spec), { page_id: "10", instagram_user_id: "20" }, "sem video_data junto do feed");
  const feed = JSON.parse(b.asset_feed_spec);
  assert.equal(feed.bodies[0].text, "Texto principal do 1436");
  assert.equal(feed.titles[0].text, "Headline do 1436");
  assert.equal(feed.videos[0].video_id, "v_new");
  assert.equal(b.url_tags, "utm_source=meta");
  assert.equal(b.name, "1491 [PRICE]");
  // Origem sem página: erro claro.
  await assert.rejects(() => meta.createVideoCreativeFromSpec("act_9", { name: "x", sourceSpec: { video_data: {} }, assetFeed: FEED, videoId: "v", imageUrl: "t" }), /não tem página/);
});
