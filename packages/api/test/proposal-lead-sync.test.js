import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { attributionPain } from "../src/attribution.js";
import { syncProposalLeadSnapshot } from "../src/proposal.js";

const calc = { catalog: { pains: { A: {}, B: {}, C: {}, D: {}, E: {}, none: {} } } };

test("attributionPain procura a dor em anúncio, conjunto e campanha, nessa ordem", () => {
  assert.equal(attributionPain({ adName: "004", adsetName: "1338 [E] - Copy", campaignName: "[D]" }), "E");
  assert.equal(attributionPain({ adName: "v2 [B]", adsetName: "[E]", campaignName: "[D]" }), "B");
  assert.equal(attributionPain({ adName: "004", adsetName: "Copy", campaignName: "Escala [D]" }), "D");
  assert.equal(attributionPain({ adName: "[TESTE]", adsetName: "Copy", campaignName: "Escala" }), "");
});

test("snapshot antigo puxa empresa atual do lead e recupera dor pelo conjunto do anúncio", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", {
    id: "le_1", saas: "leverads", name: "Victor Dantas", company: "Azul Pet",
    utm: { content: "ad_1" },
  });
  await repo.create("ad_insights", {
    id: "ai_1", saas: "leverads", adId: "ad_1", date: "2026-08-01",
    adName: "004", adsetName: "1338 [E] - Copy", campaignName: "[E]",
  });
  const old = await repo.create("proposals", {
    id: "pr_1", lead: "le_1", calc,
    data: { lead: { name: "Victor", firstName: "Victor", company: "" }, answers: {} },
    state: {},
  });

  const synced = await syncProposalLeadSnapshot(repo, old);
  assert.equal(synced.data.lead.name, "Victor Dantas");
  assert.equal(synced.data.lead.company, "Azul Pet");
  assert.equal(synced.state.pain, "E");
  assert.equal((await repo.get("proposals", "pr_1")).state.pain, "E", "sincroniza no snapshot persistido");
});

test("dor escolhida manualmente na tela zero não é sobrescrita pela origem", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "le_1", saas: "leverads", name: "Ana", company: "Loja", sourcePain: "E" });
  const proposal = await repo.create("proposals", {
    id: "pr_1", lead: "le_1", calc,
    data: { lead: { name: "Ana", firstName: "Ana", company: "" }, answers: {} },
    state: { pain: "B" },
  });

  const synced = await syncProposalLeadSnapshot(repo, proposal);
  assert.equal(synced.data.lead.company, "Loja");
  assert.equal(synced.state.pain, "B");
});
