// Fase 0 da organização da API por domínio: move os arquivos de
// packages/api/src para pastas por domínio (git mv, preserva histórico) e
// reescreve todo caminho relativo que aponte para um arquivo movido, ou que
// saia de um arquivo movido: import, import() e new URL(..., import.meta.url),
// em api/src, api/test, api/scripts e no web (src, preview, scripts, test).
// Só caminhos: nenhuma linha de lógica muda. Uso único, rodar da raiz do repo:
//   node packages/api/scripts/2026-10-05-api-por-dominio.mjs [--dry]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const DRY = process.argv.includes("--dry");
const ROOT = process.cwd();
const SRC = join(ROOT, "packages/api/src");

// Ficam na raiz de src: a entrada (Dockerfile, start.sh, compose e testes
// apontam pra ela), o orquestrador das rotas e o build-info (o fingerprint
// percorre a pasta dele). assets/ continua compartilhada na raiz.
const STAY = new Set(["index.js", "routes.js", "build-info.js"]);

const DOMAINS = {
  platform: ["db.js", "seed-data.js", "seed-cli.js", "migrations.js", "changes.js", "http-status.js", "ttl-cache.js", "compute-cache.js", "business-hours.js", "openapi.js"],
  // Isomórficos: o web importa direto (e os Dockerfiles copiam só esta pasta).
  shared: ["lead-grade.js", "plan-cycles.js", "plan-resources.js", "followup-contacts.js"],
  auth: ["auth.js", "screens.js", "support-scope.js"],
  crm: ["stages.js", "lead-flow.js", "lead-dedup.js", "classificacao.js", "levercopy.js", "followup-config.js", "cadencia-nutricao.js", "cadencia-runner.js", "cadencia-stages.js", "agenda-slots.js"],
  sdr: ["sdr-agenda.js", "sdr-brain.js", "sdr-flow.js", "sdr-handoff-reminder.js", "sdr-replay.js", "sdr-signals.js", "sdr-templates.leverads.js", "routes.sdr.js", "sales-whatsapp.js"],
  whatsapp: ["whatsapp.js", "wa-automations.js", "wa-call-flow.js", "wa-flows.js", "wa-health.js", "wa-store.js", "wa-transcribe.js", "wa-waiting-reminder.js", "routes.whatsapp.js", "transcribe.js", "off-hours-duty.js"],
  calls: ["call-summaries.js", "integration-brief.js", "copilot.js", "routes.pitch.js", "consultations.js", "routes.consultations.js", "deliverables.js", "manual-page.js"],
  google: ["google.js", "google-user.js", "routes.google.js"],
  forms: ["forms.js", "form-page.js", "form-ab.js", "forms-v2.leverads.js", "lead-questions.leverads.js", "lead-questions.produtos.js", "routes.forms.js", "elo.js", "integration-form.js", "integration-form-page.js", "fiscal-form.js", "routes.integration-forms.js"],
  proposals: ["proposal.js", "proposal-catalog.js", "proposal-page.js", "proposal-oem-page.js", "proposal-slides-page.js", "routes.proposals.js", "cases.js", "cases-live.js", "routes.cases.js"],
  billing: ["billing.js", "billing-runner.js", "plan-catalog.js", "plan-history.js", "entitlements.js", "leverads-access.js", "churn.js", "upsell.js", "routes.billing.js"],
  payments: ["mp.js", "mp-payments.js", "mp-subscriptions.js", "routes.mp.js", "payment-links.js", "routes.offers.js", "routes.fin.js"],
  customers: ["customer-milestones.js", "customer-reports.js", "client-pending.js", "nps.js", "nps-page.js", "routes.nps.js", "routes.customer-results.js", "leverads-results.js", "referrals.js", "routes.referrals.js", "mentoria.js", "routes.integrations.js"],
  support: ["tickets-core.js", "tickets-sla.js", "ticket-linear.js", "ticket-linear-runner.js", "ticket-sla-runner.js", "routes.tickets.js", "routes.support-portal.js", "support-page.js", "quick-replies.js", "linear.js"],
  tasks: ["tasks-core.js", "task-reminder.js", "routes.tasks.js", "routes.routine.js"],
  training: ["routes.flashcards.js", "fsrs.js", "flashcard-decks.leverads.js", "training-reminder.js", "company.leverads.js"],
  marketing: ["routes.marketing.js", "meta.js", "meta-accounts.js", "meta-capi.js", "ad-delivery.js", "attribution.js", "routes.disparos.js", "disparos-util.js", "drip-runner.js", "routes.sequences.js", "social.js", "social-comments.js", "social-stories.js", "routes.social.js", "shopify.js", "routes.webhooks.js"],
  blog: ["blog-config.js", "blog-digest.js", "blog-engine.js", "blog-knowledge.js", "blog-lint.js", "blog-markdown.js", "blog-page.js", "blog-posts.js", "routes.blog.js", "routes.blog-public.js"],
  metrics: ["metrics-core.js", "metrics-reader.js", "routes.metrics.js", "routes.funnel-metrics.js", "routes.pipeline-pace.js", "routes.scoreboard.js", "routes.metas.js", "routes.desempenho.js", "ai-costs.js"],
  comp: ["comp-plan.js", "comp-months.js", "routes.comp.js"],
  integrations: ["anthropic.js", "discord.js", "mailer.js"],
};

// Mapa absoluto antigo → novo, conferindo que todo arquivo solto tem destino.
const moves = new Map();
for (const [domain, files] of Object.entries(DOMAINS)) {
  for (const f of files) {
    const from = join(SRC, f);
    if (!existsSync(from)) throw new Error(`não existe: src/${f}`);
    if (moves.has(from)) throw new Error(`duplicado: ${f}`);
    moves.set(from, join(SRC, domain, f));
  }
}
const loose = readdirSync(SRC).filter((f) => f.endsWith(".js") && !STAY.has(f) && !moves.has(join(SRC, f)));
if (loose.length) throw new Error(`sem domínio no mapa: ${loose.join(", ")}`);

// Arquivos cujos caminhos relativos podem precisar de ajuste.
const SCAN = ["packages/api/src", "packages/api/test", "packages/api/scripts", "packages/web/src", "packages/web/preview", "packages/web/scripts", "packages/web/test"];
const EXT = /\.(m?js|jsx)$/;
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}
const files = SCAN.flatMap((d) => walk(join(ROOT, d)));

const toPosix = (p) => p.split(sep).join("/");
const newOf = (abs) => moves.get(abs) || abs;
const self = resolve(process.argv[1]);

// "./x.js", "../src/x.js", `./assets/${nome}`, "../../../api/src/x.js?url"…
const LITERAL = /(["'`])(\.\.?\/[^"'`\n]*?)\1/g;
let changedFiles = 0, rewrites = 0;
const dirRewrites = [];

for (const file of files) {
  if (file === self) continue;
  const src = readFileSync(file, "utf8");
  const fileNew = newOf(file);
  const out = src.replace(LITERAL, (whole, q, spec) => {
    const dyn = spec.indexOf("${");
    const fixed = dyn >= 0 ? spec.slice(0, dyn) : spec;
    const [pathPart, query = ""] = fixed.split(/(?=\?)/);
    const rest = dyn >= 0 ? spec.slice(dyn) : "";
    const target = resolve(dirname(file), pathPart);
    if (!existsSync(target)) return whole;
    const isDir = statSync(target).isDirectory();
    const targetNew = newOf(target);
    if (targetNew === target && fileNew === file) return whole;
    let rel = toPosix(relative(dirname(fileNew), targetNew)) || ".";
    if (!rel.startsWith(".")) rel = `./${rel}`;
    if (pathPart.endsWith("/") && !rel.endsWith("/")) rel += "/";
    const next = `${rel}${query}${rest}`;
    if (next === spec) return whole;
    rewrites++;
    if (isDir) dirRewrites.push(`${toPosix(relative(ROOT, file))}: ${spec} → ${next}`);
    return `${q}${next}${q}`;
  });
  if (out !== src) {
    changedFiles++;
    if (!DRY) writeFileSync(file, out);
  }
}

console.log(`${rewrites} caminho(s) reescrito(s) em ${changedFiles} arquivo(s)`);
if (dirRewrites.length) console.log(`caminhos de pasta (conferir):\n  ${dirRewrites.join("\n  ")}`);

if (!DRY) {
  for (const [from, to] of moves) {
    mkdirSync(dirname(to), { recursive: true });
    execFileSync("git", ["mv", from, to], { cwd: ROOT });
  }
  console.log(`${moves.size} arquivo(s) movido(s) com git mv`);
}
