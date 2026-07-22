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
