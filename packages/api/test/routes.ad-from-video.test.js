// Rota "criar anúncio clonando": recebe o vídeo (multipart), duplica o conjunto
// de origem, renomeia pra "<número> [dor]" e troca só o vídeo do anúncio
// clonado. meta injetada grava a sequência de chamadas.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerMarketingRoutes } = await import("../src/routes.marketing.js");

// Corpo multipart mínimo: campos de texto + um "vídeo" com filename.
function buildMultipart(fields, file) {
  const boundary = "----cockpitTestBoundary";
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${file.name}"\r\nContent-Type: video/mp4\r\n\r\n`));
    chunks.push(Buffer.from(file.bytes || "FAKEVIDEO"));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function fakeMeta(overrides = {}) {
  const calls = [];
  const base = {
    configured: () => true,
    async uploadVideo(acct, o) { calls.push(["uploadVideo", acct, o.filename, o.title]); return "vid_1"; },
    async videoThumbnail(id) { calls.push(["videoThumbnail", id]); return "https://thumb"; },
    async copyAdSet(id, o) { calls.push(["copyAdSet", id, o]); return { adsetId: "as_copy", adIds: ["ad_copy"] }; },
    async renameObject(id, name) { calls.push(["renameObject", id, name]); return { id, name }; },
    async getAdCreativeSpec(id) { calls.push(["getAdCreativeSpec", id]); return { spec: { page_id: "1", video_data: { video_id: "v_old" } }, urlTags: "" }; },
    async createVideoCreativeFromSpec(acct, o) { calls.push(["createVideoCreativeFromSpec", acct, o]); return "cr_new"; },
    async updateAd(id, o) { calls.push(["updateAd", id, o]); return { id, name: o.name }; },
    async setObjectBudget(id, brl) { calls.push(["setObjectBudget", id, brl]); return { id, dailyBudget: brl }; },
  };
  const meta = { ...base, ...overrides };
  meta.calls = calls;
  return meta;
}

async function buildApp(meta) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [], metaAdAccount: "act_9", painMap: { A: "dor A" } });
  const app = Fastify();
  await app.register(multipart);
  registerMarketingRoutes(app, repo, { meta });
  return { app, repo };
}

// A rota responde 202 na hora (vídeo grande + Meta lenta = 502 do proxy se a
// requisição ficar aberta) e o trabalho segue em background; o front — e estes
// testes — acompanham pelo endpoint de polling.
async function submit(app, fields, file) {
  const mp = buildMultipart(fields, file);
  const res = await app.inject({ method: "POST", url: "/api/marketing/leverads/ad-from-video", headers: { "content-type": mp.contentType }, payload: mp.body });
  if (res.statusCode !== 202) return { res, job: null };
  for (let i = 0; i < 400; i++) {
    const job = (await app.inject({ url: `/api/marketing/job/${res.json().jobId}` })).json();
    if (job.status !== "running") return { res, job };
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("o trabalho não terminou a tempo");
}

test("clona conjunto, renomeia «1303 [B]» e troca só o vídeo; nasce pausado", async () => {
  const meta = fakeMeta();
  const { app, repo } = await buildApp(meta);
  const { res, job } = await submit(app, { painCode: "B", painLabel: "Medo de banimento", sourceAdsetId: "as_src" }, { name: "1303.mp4" });
  assert.equal(res.statusCode, 202, res.body);
  assert.equal(job.status, "done", job.error || "");
  const b = job.result;
  assert.equal(b.adsetId, "as_copy");
  assert.equal(b.adsetName, "1303 [B]");
  assert.equal(b.number, "1303");
  assert.equal(b.code, "B");
  assert.equal(b.status, "PAUSED");
  assert.deepEqual(b.ads, [{ id: "ad_copy", name: "1303 [B]" }]);

  // sequência: copyAdSet pausado → rename → getSpec → createCreative → updateAd
  const seq = meta.calls.map((c) => c[0]);
  assert.deepEqual(seq, ["uploadVideo", "videoThumbnail", "copyAdSet", "renameObject", "getAdCreativeSpec", "createVideoCreativeFromSpec", "updateAd"]);
  assert.deepEqual(meta.calls.find((c) => c[0] === "copyAdSet")[2], { statusOption: "PAUSED" });
  assert.equal(meta.calls.find((c) => c[0] === "renameObject")[2], "1303 [B]");
  const create = meta.calls.find((c) => c[0] === "createVideoCreativeFromSpec")[2];
  assert.equal(create.videoId, "vid_1");
  assert.equal(create.imageUrl, "https://thumb");
  assert.match(create.urlTags, /utm_source=meta/); // sem url_tags de origem → usa a convenção
  const upd = meta.calls.find((c) => c[0] === "updateAd");
  assert.equal(upd[2].creativeId, "cr_new");
  assert.equal(upd[2].name, "1303 [B]");

  // dor nova entrou no mapa do produto
  const prod = await repo.get("products", "leverads");
  assert.equal(prod.painMap.B, "Medo de banimento");
});

test("número pode vir avulso quando o arquivo não tem número", async () => {
  const meta = fakeMeta();
  const { app } = await buildApp(meta);
  const { job } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "7" }, { name: "depoimento.mp4" });
  assert.equal(job.status, "done", job.error || "");
  assert.equal(job.result.adsetName, "7 [A]");
});

// Orçamento no conjunto novo: o clone nasce com o do conjunto de origem e o
// time quer poder testar a dor com outro valor sem abrir o Gerenciador.
test("orçamento diário pedido é aplicado no conjunto clonado (aceita «R$ 149,90»)", async () => {
  const meta = fakeMeta();
  const { app } = await buildApp(meta);
  const { job } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "1330", dailyBudget: "R$ 149,90" }, { name: "1330.mp4" });
  assert.equal(job.status, "done", job.error || "");
  assert.equal(job.warning, null);
  assert.equal(job.result.dailyBudget, 149.9);
  const budget = meta.calls.find((c) => c[0] === "setObjectBudget");
  assert.deepEqual([budget[1], budget[2]], ["as_copy", 149.9]); // no conjunto NOVO
  // e depois do rename, pra não brigar com a cópia
  assert.ok(meta.calls.findIndex((c) => c[0] === "setObjectBudget") > meta.calls.findIndex((c) => c[0] === "renameObject"));
});

test("orçamento vazio não toca no orçamento herdado do conjunto de origem", async () => {
  const meta = fakeMeta();
  const { app } = await buildApp(meta);
  const { job } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "1330", dailyBudget: "" }, { name: "1330.mp4" });
  assert.equal(job.status, "done", job.error || "");
  assert.equal(meta.calls.find((c) => c[0] === "setObjectBudget"), undefined);
});

// Campanha com orçamento na CAMPANHA (CBO) recusa orçamento no conjunto. O
// anúncio já existe nessa hora — perder o trabalho seria pior que avisar.
test("orçamento recusado pela Meta vira aviso, não derruba o anúncio", async () => {
  const meta = fakeMeta({ async setObjectBudget() { throw new Error("Ad set budget is not allowed when campaign budget optimization is on"); } });
  const { app } = await buildApp(meta);
  const { job } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "1331", dailyBudget: "200" }, { name: "1331.mp4" });
  assert.equal(job.status, "done");
  assert.match(job.warning, /orçamento de R\$ 200 não colou/);
  assert.equal(job.result.adsetName, "1331 [A]");
  assert.ok(meta.calls.some((c) => c[0] === "updateAd")); // seguiu até o fim
});

test("sem número (nem no arquivo nem avulso) = 400; conjunto sem anúncio = trabalho com erro", async () => {
  const { app } = await buildApp(fakeMeta());
  const mp1 = buildMultipart({ painCode: "A", sourceAdsetId: "as_src" }, { name: "video.mp4" });
  const r1 = await app.inject({ method: "POST", url: "/api/marketing/leverads/ad-from-video", headers: { "content-type": mp1.contentType }, payload: mp1.body });
  assert.equal(r1.statusCode, 400);
  assert.match(r1.json().error, /número/);

  const metaEmpty = fakeMeta({ async copyAdSet() { return { adsetId: "as_copy", adIds: [] }; } });
  const { app: app2 } = await buildApp(metaEmpty);
  const { job } = await submit(app2, { painCode: "A", sourceAdsetId: "as_src" }, { name: "1303.mp4" });
  assert.equal(job.status, "error");
  assert.match(job.error, /não tem anúncio/);
});

test("trabalho inexistente responde 404 legível (o servidor pode ter reiniciado)", async () => {
  const { app } = await buildApp(fakeMeta());
  const r = await app.inject({ url: "/api/marketing/job/vj_nao_existe" });
  assert.equal(r.statusCode, 404);
  assert.match(r.json().error, /Gerenciador/);
});

test("dor obrigatória e conjunto de origem obrigatório", async () => {
  const { app } = await buildApp(fakeMeta());
  const mp = buildMultipart({ sourceAdsetId: "as_src" }, { name: "1303.mp4" });
  const r = await app.inject({ method: "POST", url: "/api/marketing/leverads/ad-from-video", headers: { "content-type": mp.contentType }, payload: mp.body });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /dor/);

  const mp2 = buildMultipart({ painCode: "B" }, { name: "1303.mp4" });
  const r2 = await app.inject({ method: "POST", url: "/api/marketing/leverads/ad-from-video", headers: { "content-type": mp2.contentType }, payload: mp2.body });
  assert.equal(r2.statusCode, 400);
  assert.match(r2.json().error, /conjunto de origem/);
});
