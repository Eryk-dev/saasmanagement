// Clonagem de anúncio na Meta (client): duplicar conjunto (deep copy), ler o
// spec do criativo, criar criativo novo trocando só o vídeo, e atualizar o
// anúncio. fetch mockado grava as chamadas.

import test from "node:test";
import assert from "node:assert/strict";

const { makeMeta } = await import("../src/meta.js");

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
  assert.match(decodeURIComponent(f.calls[0].url), /creative\{object_story_spec,url_tags\}/);
});

test("createVideoCreativeFromSpec: troca só o vídeo/thumb e preserva o resto", async () => {
  const f = recorder(() => ({ id: "cr_new" }));
  const meta = makeMeta({ fetch: f, accessToken: "tok" });
  const sourceSpec = { page_id: "10", instagram_user_id: "20", video_data: { video_id: "v_old", image_url: "old", message: "copy mantida", call_to_action: { type: "LEARN_MORE", value: { link: "https://x" } } } };
  const id = await meta.createVideoCreativeFromSpec("act_9", { name: "1303 [B]", sourceSpec, videoId: "v_new", imageUrl: "thumb_new", urlTags: "utm_source=meta" });
  assert.equal(id, "cr_new");
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

const { metaErrorText } = await import("../src/meta.js");

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
  const mod = await import("../src/meta.js");
  const daFabrica = Object.keys(makeMeta({ accessToken: "t" }));
  assert.ok(daFabrica.length > 15);
  assert.deepEqual(daFabrica.filter((k) => typeof mod.meta[k] !== "function"), []);
});
