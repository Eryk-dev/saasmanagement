// Captura e histórico de stories — snapshot que ATUALIZA enquanto o story
// vive, preserva a última leitura boa quando a métrica some, e throttle.

import test from "node:test";
import assert from "node:assert/strict";
import { syncStories, listStories, invalidateStoriesSync } from "../src/social-stories.js";

function makeMemRepo() {
  const data = new Map();
  const key = (c, id) => `${c}:${id}`;
  return {
    async get(c, id) { return data.get(key(c, id)) || null; },
    async list(c) { return [...data.entries()].filter(([k]) => k.startsWith(`${c}:`)).map(([, v]) => v); },
    async create(c, row) { data.set(key(c, row.id), { ...row }); return row; },
    async update(c, id, row) { data.set(key(c, id), { ...data.get(key(c, id)), ...row }); return row; },
  };
}

test("syncStories: captura o vivo, atualiza na 2ª passada e preserva métrica que sumiu", async () => {
  const repo = makeMemRepo();
  invalidateStoriesSync("leverads");
  let pass = 0;
  const social = {
    async igStories() {
      pass++;
      return pass === 1
        ? [{ id: "s1", at: "2026-07-25T22:09:30+0000", type: "IMAGE", reach: 16, views: 22, navForward: 10 }]
        // 2ª leitura: reach cresceu; views veio null (Graph falhou o combo) e
        // NÃO pode apagar o 22 da primeira.
        : [{ id: "s1", at: "2026-07-25T22:09:30+0000", type: "IMAGE", reach: 31, views: null, navForward: 14 }];
    },
  };
  await syncStories(repo, social, { saas: "leverads", igUserId: "ig1", force: true });
  await syncStories(repo, social, { saas: "leverads", igUserId: "ig1", force: true });
  const row = await repo.get("social_stories", "s1");
  assert.equal(row.reach, 31);
  assert.equal(row.views, 22); // preservado
  assert.equal(row.navForward, 14);
  assert.equal(row.saas, "leverads");
});

test("syncStories: throttle segura a 2ª chamada sem force", async () => {
  const repo = makeMemRepo();
  invalidateStoriesSync("leverads");
  let hits = 0;
  const social = { async igStories() { hits++; return []; } };
  await syncStories(repo, social, { saas: "leverads", igUserId: "ig1" });
  const second = await syncStories(repo, social, { saas: "leverads", igUserId: "ig1" });
  assert.equal(second.skipped, true);
  assert.equal(hits, 1);
});

test("listStories: mais novos primeiro, filtrado por produto", async () => {
  const repo = makeMemRepo();
  await repo.create("social_stories", { id: "a", saas: "leverads", at: "2026-07-24T10:00:00Z" });
  await repo.create("social_stories", { id: "b", saas: "leverads", at: "2026-07-25T10:00:00Z" });
  await repo.create("social_stories", { id: "c", saas: "outro", at: "2026-07-26T10:00:00Z" });
  const rows = await listStories(repo, { saas: "leverads" });
  assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
});
