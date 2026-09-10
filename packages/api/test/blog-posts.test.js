// Documento do blog: slug único/reservado, UTM no CTA, máquina de estados,
// derivados e os acessores públicos (só publicado sai, sem body na lista).
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  newPostId, isValidSlug, uniqueSlug, injectUtm, TRANSITIONS, canTransition, withDerived, pushHistory,
  toPublicPost, listPublished, getPublishedBySlug, RESERVED_SLUGS, slugify,
} from "../src/blog-posts.js";

test("newPostId: prefixo bp_ e ids distintos", () => {
  const a = newPostId(), b = newPostId();
  assert.match(a, /^bp_[a-z0-9]{6,}[0-9a-f]{6}$/);
  assert.notEqual(a, b);
});

test("isValidSlug: regex, tamanho e reservados", () => {
  assert.equal(isValidSlug("como-vender-em-2-contas"), true);
  assert.equal(isValidSlug("Maiusculo"), false);
  assert.equal(isValidSlug("com--duplo"), false);
  assert.equal(isValidSlug("-inicio"), false);
  assert.equal(isValidSlug(""), false);
  assert.equal(isValidSlug("a".repeat(81)), false);
  for (const r of RESERVED_SLUGS) assert.equal(isValidSlug(r), false, r);
});

test("uniqueSlug: normaliza, desempata com -2/-3 e foge dos reservados", () => {
  assert.equal(uniqueSlug("Como operar 3 contas no Mercado Livre"), "como-operar-3-contas-no-mercado-livre");
  assert.equal(uniqueSlug("Estoque integrado", ["estoque-integrado"]), "estoque-integrado-2");
  assert.equal(uniqueSlug("Estoque integrado", ["estoque-integrado", "estoque-integrado-2"]), "estoque-integrado-3");
  assert.equal(uniqueSlug("preview"), "preview-blog");
  assert.equal(uniqueSlug(""), "post");
  const long = uniqueSlug("x".repeat(100), ["x".repeat(80)]);
  assert.ok(long.length <= 80 && long.endsWith("-2"));
  assert.equal(slugify("Ação & Título!"), "acao-titulo");
});

test("injectUtm: só links do host do CTA, idempotente, preserva o resto", () => {
  const cta = "https://levermoney.com.br/f/fo_diagnostico_leverads";
  const body = "Veja [o diagnóstico](https://levermoney.com.br/f/fo_diagnostico_leverads) e [o ML](https://mercadolivre.com.br/x).";
  const out = injectUtm(body, cta, "meu-post");
  assert.ok(out.includes("utm_source=blog&utm_medium=organic&utm_campaign=blog&utm_content=meu-post"));
  assert.ok(out.includes("[o ML](https://mercadolivre.com.br/x)"));
  assert.equal(injectUtm(out, cta, "outro"), out); // já tem utm_source: não mexe
  const keep = injectUtm("[x](https://levermoney.com.br/f/a?utm_source=ig)", cta, "s");
  assert.ok(keep.includes("utm_source=ig") && !keep.includes("utm_content"));
  assert.equal(injectUtm(body, "", "s"), body);
  assert.equal(injectUtm("[a](nao-e-url)", cta, "s"), "[a](nao-e-url)");
});

test("TRANSITIONS: topologia do plano", () => {
  assert.deepEqual(Object.keys(TRANSITIONS), ["pauta", "rascunho", "agendado", "publicado", "arquivado"]);
  assert.equal(canTransition("pauta", "rascunho"), true);
  assert.equal(canTransition("pauta", "publicado"), false);
  assert.equal(canTransition("rascunho", "agendado"), true);
  assert.equal(canTransition("agendado", "rascunho"), true);
  assert.equal(canTransition("publicado", "rascunho"), true);
  assert.equal(canTransition("publicado", "agendado"), false);
  assert.equal(canTransition("arquivado", "pauta"), true);
  assert.equal(canTransition("arquivado", "publicado"), false);
  assert.equal(canTransition("inexistente", "pauta"), false);
});

test("withDerived e pushHistory", () => {
  const d = withDerived({ body: "## Título\n\n" + "palavra ".repeat(450) });
  assert.equal(d.wordCount, 451);
  assert.equal(d.readingMin, 2);
  let h = pushHistory({}, { by: "leo", action: "approve" });
  assert.equal(h.length, 1);
  assert.equal(h[0].by, "leo");
  assert.ok(h[0].at);
  for (let i = 0; i < 40; i++) h = pushHistory({ history: h }, { action: `a${i}` });
  assert.equal(h.length, 30);
  assert.equal(h[29].action, "a39"); // mais recente no fim
});

test("toPublicPost: só campos públicos, autor default", () => {
  const p = toPublicPost({ id: "bp_1", slug: "s", title: "T", body: "corpo com cinco palavras aqui", sources: [{ type: "wa" }], lint: [{ code: "x" }], author: "cockpit", faq: [{ q: "q", a: "a" }, { q: "" }] });
  assert.equal(p.author, "Equipe LeverAds");
  assert.equal(p.sources, undefined);
  assert.equal(p.lint, undefined);
  assert.equal(p.faq.length, 1);
  assert.equal(p.wordCount, 5);
  assert.equal(p.readingMin, 1);
  assert.equal(toPublicPost(null), null);
});

test("listPublished/getPublishedBySlug: só publicado, ordem por publishedAt, sem body na lista", async () => {
  const repo = makeMemRepo();
  await repo.create("blog_posts", { id: "bp_a", saas: "leverads", status: "publicado", slug: "velho", title: "Velho", body: "b", publishedAt: "2026-09-01T12:00:00.000Z" });
  await repo.create("blog_posts", { id: "bp_b", saas: "leverads", status: "publicado", slug: "novo", title: "Novo", body: "b", publishedAt: "2026-09-08T12:00:00.000Z" });
  await repo.create("blog_posts", { id: "bp_c", saas: "leverads", status: "rascunho", slug: "rascunho", title: "R", body: "b" });
  await repo.create("blog_posts", { id: "bp_d", saas: "outro", status: "publicado", slug: "outro", title: "O", body: "b", publishedAt: "2026-09-09T12:00:00.000Z" });
  const list = await listPublished(repo, "leverads");
  assert.deepEqual(list.map((p) => p.slug), ["novo", "velho"]);
  assert.equal(list[0].body, ""); // projeção sem body
  assert.equal((await getPublishedBySlug(repo, "leverads", "novo")).title, "Novo");
  assert.equal((await getPublishedBySlug(repo, "leverads", "novo")).body, "b");
  assert.equal(await getPublishedBySlug(repo, "leverads", "rascunho"), null);
  assert.equal(await getPublishedBySlug(repo, "leverads", "outro"), null);
  assert.equal(await getPublishedBySlug(repo, "leverads", ""), null);
});
