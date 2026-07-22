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
    async adsOfAdSet(id) { calls.push(["adsOfAdSet", id]); return [{ id: "ad_src", name: "1300 [A]" }]; },
    async createAd(acct, o) { calls.push(["createAd", acct, o]); return { id: "ad_novo", status: "PAUSED" }; },
    async copyAdSet(id, o) { calls.push(["copyAdSet", id, o]); return { adsetId: "as_copy", adIds: [] }; },
    async renameObject(id, name) { calls.push(["renameObject", id, name]); return { id, name }; },
    async getAdCreativeSpec(id) { calls.push(["getAdCreativeSpec", id]); return { spec: { page_id: "1", video_data: { video_id: "v_old" } }, urlTags: "" }; },
    async createVideoCreativeFromSpec(acct, o) { calls.push(["createVideoCreativeFromSpec", acct, o]); return "cr_new"; },
    async updateAd(id, o) { calls.push(["updateAd", id, o]); return { id, name: o.name }; },
    async setObjectBudget(id, brl) { calls.push(["setObjectBudget", id, brl]); return { id, dailyBudget: brl }; },
    async setObjectStatus(id, status) { calls.push(["setObjectStatus", id, status]); return { id, status }; },
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
  const { res, job } = await submit(app, { painCode: "B", painLabel: "Medo de banimento", sourceAdsetId: "as_src", activate: "0" }, { name: "1303.mp4" });
  assert.equal(res.statusCode, 202, res.body);
  assert.equal(job.status, "done", job.error || "");
  const b = job.result;
  assert.equal(b.adsetId, "as_copy");
  assert.equal(b.adsetName, "1303 [B]");
  assert.equal(b.number, "1303");
  assert.equal(b.code, "B");
  assert.equal(b.status, "PAUSED");
  assert.deepEqual(b.ads, [{ id: "ad_novo", name: "1303 [B]" }]);

  // O conjunto é copiado SEM os anúncios e o anúncio novo é montado por cima:
  // cópia profunda recria o criativo antigo e a Meta recusa criativo com o
  // campo de "melhorias padrão" que ela mesma descontinuou (100/3858504).
  const seq = meta.calls.map((c) => c[0]);
  assert.deepEqual(seq, ["adsOfAdSet", "getAdCreativeSpec", "uploadVideo", "videoThumbnail", "copyAdSet", "renameObject", "createVideoCreativeFromSpec", "createAd"]);
  assert.deepEqual(meta.calls.find((c) => c[0] === "copyAdSet")[2], { statusOption: "PAUSED", deepCopy: false }); // activate=0 no envio
  assert.equal(meta.calls.find((c) => c[0] === "getAdCreativeSpec")[1], "ad_src"); // spec vem do anúncio DE ORIGEM
  assert.equal(meta.calls.find((c) => c[0] === "renameObject")[2], "1303 [B]");
  const create = meta.calls.find((c) => c[0] === "createVideoCreativeFromSpec")[2];
  assert.equal(create.videoId, "vid_1");
  assert.equal(create.imageUrl, "https://thumb");
  assert.match(create.urlTags, /utm_source=meta/); // sem url_tags de origem → usa a convenção
  const novo = meta.calls.find((c) => c[0] === "createAd")[2];
  assert.equal(novo.adsetId, "as_copy");   // no conjunto NOVO, não no de origem
  assert.equal(novo.creativeId, "cr_new");
  assert.equal(novo.name, "1303 [B]");

  // dor nova entrou no mapa do produto
  const prod = await repo.get("products", "leverads");
  assert.equal(prod.painMap.B, "Medo de banimento");
});

test("número pode vir avulso quando o arquivo não tem número", async () => {
  const meta = fakeMeta();
  const { app } = await buildApp(meta);
  const { job } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "7", activate: "0" }, { name: "depoimento.mp4" });
  assert.equal(job.status, "done", job.error || "");
  assert.equal(job.result.adsetName, "7 [A]");
});

// Orçamento no conjunto novo: o clone nasce com o do conjunto de origem e o
// time quer poder testar a dor com outro valor sem abrir o Gerenciador.
test("orçamento diário pedido é aplicado no conjunto clonado (aceita «R$ 89,90»)", async () => {
  const meta = fakeMeta();
  const { app } = await buildApp(meta);
  const { job } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "1330", dailyBudget: "R$ 89,90" }, { name: "1330.mp4" });
  assert.equal(job.status, "done", job.error || "");
  assert.equal(job.warning, null);
  assert.equal(job.result.dailyBudget, 89.9);
  const budget = meta.calls.find((c) => c[0] === "setObjectBudget");
  assert.deepEqual([budget[1], budget[2]], ["as_copy", 89.9]); // no conjunto NOVO
  // e depois do rename, pra não brigar com a cópia
  assert.ok(meta.calls.findIndex((c) => c[0] === "setObjectBudget") > meta.calls.findIndex((c) => c[0] === "renameObject"));
});

test("orçamento vazio não toca no orçamento herdado do conjunto de origem", async () => {
  const meta = fakeMeta();
  const { app } = await buildApp(meta);
  const { job } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "1330", dailyBudget: "", activate: "0" }, { name: "1330.mp4" });
  assert.equal(job.status, "done", job.error || "");
  assert.equal(meta.calls.find((c) => c[0] === "setObjectBudget"), undefined);
});

// Campanha com orçamento na CAMPANHA (CBO) recusa orçamento no conjunto. O
// anúncio já existe nessa hora — perder o trabalho seria pior que avisar.
test("orçamento recusado (CBO) com anúncio ATIVO: sobe pausado por segurança", async () => {
  const meta = fakeMeta({ async setObjectBudget() { throw new Error("Ad set budget is not allowed when campaign budget optimization is on"); } });
  const { app } = await buildApp(meta);
  const { job } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "1331", dailyBudget: "80" }, { name: "1331.mp4" });
  assert.equal(job.status, "done");                       // o anúncio existe
  assert.equal(job.result.status, "PAUSED");              // mas NÃO entrega
  assert.match(job.warning, /subiu PAUSADO por segurança/);
  assert.match(job.warning, /orçamento da campanha/);     // diz por quê
  assert.equal(meta.calls.find((c) => c[0] === "createAd")[2].status, "PAUSED");
  assert.deepEqual(meta.calls.find((c) => c[0] === "setObjectStatus")?.slice(1), ["as_copy", "PAUSED"]);
});

test("orçamento recusado com anúncio já pausado é só aviso", async () => {
  const meta = fakeMeta({ async setObjectBudget() { throw new Error("CBO on"); } });
  const { app } = await buildApp(meta);
  const { job } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "1331", dailyBudget: "80", activate: "0" }, { name: "1331.mp4" });
  assert.equal(job.status, "done");
  assert.match(job.warning, /não colou/);
  assert.ok(meta.calls.some((c) => c[0] === "createAd"));  // seguiu até o fim
});

test("sem número (nem no arquivo nem avulso) = 400; conjunto sem anúncio = trabalho com erro", async () => {
  const { app } = await buildApp(fakeMeta());
  const mp1 = buildMultipart({ painCode: "A", sourceAdsetId: "as_src" }, { name: "video.mp4" });
  const r1 = await app.inject({ method: "POST", url: "/api/marketing/leverads/ad-from-video", headers: { "content-type": mp1.contentType }, payload: mp1.body });
  assert.equal(r1.statusCode, 400);
  assert.match(r1.json().error, /número/);

  const metaEmpty = fakeMeta({ async adsOfAdSet() { return []; } });
  const { app: app2 } = await buildApp(metaEmpty);
  const { job } = await submit(app2, { painCode: "A", sourceAdsetId: "as_src", activate: "0" }, { name: "1303.mp4" });
  assert.equal(job.status, "error");
  assert.match(job.error, /não tem anúncio/);
  assert.match(job.error, /lendo o anúncio de origem/); // o erro diz em que passo morreu
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

// ── Fila da leva ────────────────────────────────────────────────────────────
// Subir vários de uma vez é o fluxo do Leo (uma leva de criativos da mesma
// dor). Em PARALELO isso multiplica as chamadas na Meta e a conta bate o limite
// ("Ad Account Has Too Many API Calls"), derrubando a leva inteira. Então o
// servidor processa um por vez, por produto.
test("leva de vídeos: o servidor processa um por vez e avisa a posição na fila", async () => {
  let emVoo = 0, maxEmVoo = 0;
  const ordem = [];
  const meta = fakeMeta({
    async uploadVideo(_a, o) {
      emVoo += 1; maxEmVoo = Math.max(maxEmVoo, emVoo);
      await new Promise((r) => setTimeout(r, 40));
      ordem.push(o.title);
      emVoo -= 1;
      return "vid_1";
    },
  });
  const { app } = await buildApp(meta);

  const post = (n) => {
    const mp = buildMultipart({ painCode: "A", sourceAdsetId: "as_src", number: String(n), activate: "0" }, { name: `${n}.mp4` });
    return app.inject({ method: "POST", url: "/api/marketing/leverads/ad-from-video", headers: { "content-type": mp.contentType }, payload: mp.body });
  };
  const enviados = await Promise.all([post(1301), post(1302), post(1303)]);
  // As três requisições chegam concorrentes: a ORDEM de entrada não é dada,
  // mas cada uma sabe quantas tem na frente, e são 0, 1 e 2 — sem empate.
  const entrada = enviados.map((r) => ({ nome: r.json().name, queued: r.json().queued, jobId: r.json().jobId }));
  assert.deepEqual(entrada.map((e) => e.queued).sort(), [0, 1, 2]);

  const jobs = [];
  for (const e of entrada) {
    for (let i = 0; i < 400; i++) {
      const j = (await app.inject({ url: `/api/marketing/job/${e.jobId}` })).json();
      if (j.status !== "running") { jobs.push(j); break; }
      await new Promise((x) => setTimeout(x, 5));
    }
  }
  assert.deepEqual(jobs.map((j) => j.status), ["done", "done", "done"]);
  assert.equal(maxEmVoo, 1, "dois vídeos subiram pra Meta ao mesmo tempo");
  // Quem entrou primeiro na fila é quem subiu primeiro.
  assert.deepEqual(ordem, [...entrada].sort((a, b) => a.queued - b.queued).map((e) => e.nome));
});

test("leva: vídeo que falha não trava os outros da fila", async () => {
  const meta = fakeMeta({
    async uploadVideo(_a, o) {
      if (o.title.startsWith("1302")) throw new Error("Meta API -> 400: vídeo corrompido");
      return "vid_1";
    },
  });
  const { app } = await buildApp(meta);
  const post = (n) => {
    const mp = buildMultipart({ painCode: "A", sourceAdsetId: "as_src", number: String(n), activate: "0" }, { name: `${n}.mp4` });
    return app.inject({ method: "POST", url: "/api/marketing/leverads/ad-from-video", headers: { "content-type": mp.contentType }, payload: mp.body });
  };
  const res = await Promise.all([post(1301), post(1302), post(1303)]);
  const jobs = [];
  for (const r of res) {
    for (let i = 0; i < 400; i++) {
      const j = (await app.inject({ url: `/api/marketing/job/${r.json().jobId}` })).json();
      if (j.status !== "running") { jobs.push(j); break; }
      await new Promise((x) => setTimeout(x, 5));
    }
  }
  assert.deepEqual(jobs.map((j) => j.status), ["done", "error", "done"]);
  assert.match(jobs[1].error, /corrompido/);
});


// ── Anúncio nasce RODANDO + teto de orçamento ───────────────────────────────
// Decisão do Leo (22/07): o anúncio sobe ativo, já entregando. Como isso GASTA,
// o teto de R$ 100/dia por conjunto é obrigatório e vive no servidor.
test("por padrão o conjunto e o anúncio nascem ATIVOS", async () => {
  const meta = fakeMeta();
  const { app } = await buildApp(meta);
  const { job } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "1340", dailyBudget: "100" }, { name: "1340.mp4" });
  assert.equal(job.status, "done", job.error || "");
  assert.equal(job.result.status, "ACTIVE");
  assert.equal(meta.calls.find((c) => c[0] === "copyAdSet")[2].statusOption, "ACTIVE");
  assert.equal(meta.calls.find((c) => c[0] === "createAd")[2].status, "ACTIVE");
});

test("orçamento acima do teto é recusado antes de subir o vídeo", async () => {
  const meta = fakeMeta();
  const { app } = await buildApp(meta);
  const { res } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "1341", dailyBudget: "101" }, { name: "1341.mp4" });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /teto de R\$ 100/);
  assert.equal(meta.calls.length, 0); // nem chegou a falar com a Meta
});

test("anúncio ativo SEM orçamento é recusado (herdaria o do conjunto de origem)", async () => {
  const meta = fakeMeta();
  const { app } = await buildApp(meta);
  const { res } = await submit(app, { painCode: "A", sourceAdsetId: "as_src", number: "1342" }, { name: "1342.mp4" });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /precisa de orçamento diário/);
  assert.equal(meta.calls.length, 0);
});
