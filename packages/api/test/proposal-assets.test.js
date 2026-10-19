import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { migrateProposalAssetsUrl, OLD_PROPOSAL_ASSETS, NEW_PROPOSAL_ASSETS } from "../src/platform/migrations.js";
import { proposalSlidesPageHtml } from "../src/proposals/proposal-slides-page.js";

// Fotos da proposta saíram do bucket do Supabase Cloud do produto (19/10/2026).

const PUBLIC = fileURLToPath(new URL("../../web/public", import.meta.url));

test("migrateProposalAssetsUrl: troca a URL do bucket em propostas e modelos, aninhada ou não; roda uma vez", async () => {
  const repo = makeMemRepo();
  const foto = `${OLD_PROPOSAL_ASSETS}leverads/ig-netair-full.jpg`;
  await repo.create("proposals", { id: "p1", slides: [{ key: "nossa_operacao", images: [foto, `${OLD_PROPOSAL_ASSETS}leverads/operacao-time.jpg`] }], title: "A" });
  await repo.create("proposals", { id: "p2", slides: [{ key: "capa", image: "https://outro.host/x.jpg" }], title: "B" });
  await repo.create("proposal_templates", { id: "t1", hero: foto });
  assert.equal(await migrateProposalAssetsUrl(repo), 2);
  const p1 = await repo.get("proposals", "p1");
  assert.deepEqual(p1.slides[0].images, [`${NEW_PROPOSAL_ASSETS}leverads/ig-netair-full.jpg`, `${NEW_PROPOSAL_ASSETS}leverads/operacao-time.jpg`]);
  assert.equal(p1.title, "A");
  assert.equal((await repo.get("proposals", "p2")).slides[0].image, "https://outro.host/x.jpg");
  assert.equal((await repo.get("proposal_templates", "t1")).hero, `${NEW_PROPOSAL_ASSETS}leverads/ig-netair-full.jpg`);
  assert.equal(await migrateProposalAssetsUrl(repo), 0);
});

test("fotos da proposta: o deck não aponta mais para o Supabase e todo arquivo citado existe no public do web", () => {
  const html = proposalSlidesPageHtml({
    id: "pr_1", name: "Proposta", layout: "slides", theme: {}, slides: [], calc: {},
    data: { lead: { name: "Ana", company: "Lupa" }, answers: { niche: "autopecas" }, cases: [] },
    state: {}, accepted: false,
  }, { editable: false });
  assert.doesNotMatch(html, /supabase\.co/);
  const citados = [...new Set(html.match(/\/proposal-assets\/[A-Za-z0-9_./-]+/g) || [])];
  assert.ok(citados.length >= 3, "o deck cita as fotos da operação");
  for (const caminho of citados) assert.ok(existsSync(`${PUBLIC}${caminho}`), `falta ${caminho} em packages/web/public`);
});
