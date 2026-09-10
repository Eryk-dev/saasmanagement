// Configuração da redação: defaults, sanitização e persistência em app_config.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { BLOG_DEFAULT_RULES, mergeBlogRules, blogCfgId, loadBlogCfg, saveBlogCfg, logLine } from "../src/blog-config.js";

test("defaults do plano: aprovação humana, 2 por semana ter/qui 09:00", () => {
  const r = mergeBlogRules(undefined);
  assert.equal(r.autoPublicar, false);
  assert.equal(r.autoPauta, true);
  assert.equal(r.cadenciaSemanal, 2);
  assert.deepEqual(r.diasPublicacao, ["ter", "qui"]);
  assert.equal(r.horaPublicacao, "09:00");
  assert.equal(r.categorias.length, 8);
  assert.ok(r.ctaUrl.startsWith("https://levermoney.com.br/f/"));
  assert.notEqual(r.diasPublicacao, BLOG_DEFAULT_RULES.diasPublicacao); // cópia, não referência
});

test("mergeBlogRules: sanitiza faixas, dias, hora, categorias e ctaUrl", () => {
  const r = mergeBlogRules({
    enabled: 0, autoPublicar: "sim", cadenciaSemanal: 99, minPautas: -3, pautasPorRodada: "abc",
    diasPublicacao: ["Segunda", "xx", "sex", "sex"], horaPublicacao: "25:00",
    categorias: ["  A  ", "", "B".repeat(60)], ctaUrl: "http://inseguro", lixo: 1,
  });
  assert.equal(r.enabled, false);
  assert.equal(r.autoPublicar, true);
  assert.equal(r.cadenciaSemanal, 7);
  assert.equal(r.minPautas, 0);
  assert.equal(r.pautasPorRodada, BLOG_DEFAULT_RULES.pautasPorRodada);
  assert.deepEqual(r.diasPublicacao, ["seg", "sex"]);
  assert.equal(r.horaPublicacao, "09:00");
  assert.deepEqual(r.categorias, ["A", "B".repeat(40)]);
  assert.equal(r.ctaUrl, BLOG_DEFAULT_RULES.ctaUrl);
  assert.equal("lixo" in r, false);
  assert.equal(mergeBlogRules({ horaPublicacao: "18:30", ctaUrl: "https://x.com/y" }).horaPublicacao, "18:30");
  assert.equal(mergeBlogRules({ diasPublicacao: [] }).diasPublicacao.length, 2); // vazio cai no default
});

test("loadBlogCfg/saveBlogCfg: cria, atualiza e preserva regra editada", async () => {
  const repo = makeMemRepo();
  const cfg = await loadBlogCfg(repo, "leverads");
  assert.equal(cfg._exists, false);
  assert.equal(cfg.id, blogCfgId("leverads"));
  assert.equal(cfg.state.pautaRounds, 0);
  cfg.rules.autoPublicar = true;
  cfg.state.lastTickAt = "2026-09-10T12:00:00.000Z";
  logLine(cfg, "tick", "primeira rodada");
  await saveBlogCfg(repo, "leverads", cfg);
  assert.equal(cfg._exists, true);
  const again = await loadBlogCfg(repo, "leverads");
  assert.equal(again._exists, true);
  assert.equal(again.rules.autoPublicar, true);
  assert.equal(again.state.lastTickAt, "2026-09-10T12:00:00.000Z");
  assert.equal(again.log[0].action, "tick");
  again.state.rascunhos = 2;
  await saveBlogCfg(repo, "leverads", again, { silent: true });
  assert.equal((await repo.get("app_config", "blog_leverads")).state.rascunhos, 2);
  assert.equal((await repo.get("app_config", "blog_leverads")).saas, "leverads");
});

test("logLine: mais recente primeiro e teto de 100", () => {
  const cfg = { log: [] };
  for (let i = 0; i < 120; i++) logLine(cfg, `a${i}`);
  assert.equal(cfg.log.length, 100);
  assert.equal(cfg.log[0].action, "a119");
});
