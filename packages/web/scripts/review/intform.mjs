import assert from "node:assert/strict";
import { reviewHarness } from "./harness.mjs";
const h = await reviewHarness(
  "intform",
  "Formulário de Integração",
  async (page) => {
    await page.getByRole("button", { name: /^Comercial/ }).click();
    await page
      .getByRole("button", { name: "Formulário de Integração", exact: true })
      .click();
  },
);
const measurements = [];
const drawer = (page) =>
  page.getByRole("dialog", { name: "respostas do formulário", exact: true });
async function ready(page) {
  await page.locator(".intform-table tbody tr").first().waitFor();
}
async function openPending(page) {
  await page.getByRole("button", { name: "Grupo Vante", exact: true }).click();
  await drawer(page).waitFor();
  return drawer(page);
}
async function measure(page, reference, pending) {
  return page.evaluate(
    ({ reference, pending }) => {
      const title = [...document.querySelectorAll("h1")].find(
          (e) =>
            e.textContent === "Formulário de Integração" &&
            e.getClientRects().length,
        ),
        root = reference
          ? title.closest("header").parentElement
          : document.querySelector(".intform-page");
      const header = root.children[0],
        summary = root.children[1],
        card = root.children[2],
        toolbar = card.children[0],
        table = card.children[1].children[0],
        values = summary.children[1];
      let row = reference
        ? table.querySelector("button")
        : table.querySelector("tbody tr");
      if (reference)
        while (row && getComputedStyle(row).display !== "grid")
          row = row.parentElement;
      const elements = {
        title,
        header,
        summary,
        values,
        waiting: values.children[0],
        longest: values.children[1],
        responded: values.children[2],
        charge: values.children[3],
        card,
        toolbar,
        tabs: toolbar.children[0],
        kind: toolbar.children[1],
        search: toolbar.children[2],
        head: reference ? table.children[0] : table.querySelector("thead tr"),
        row,
      };
      [...row.children].forEach((e, i) => (elements[`cell${i}`] = e));
      if (pending) {
        const panel = reference
          ? [...document.querySelectorAll("aside")].find(
              (e) =>
                e.getClientRects().length &&
                e.textContent.includes("aguardando o cliente"),
            )
          : document.querySelector('[aria-label="respostas do formulário"]');
        const content = reference ? panel : panel.firstElementChild;
        elements.drawer = panel;
        elements.drawerHead = content.children[0];
        elements.drawerBody = content.children[1];
        elements.drawerFooter = content.children[2];
      }
      return Object.fromEntries(
        Object.entries(elements).map(([key, e]) => {
          const r = e.getBoundingClientRect();
          return [key, { x: r.x, y: r.y, width: r.width, height: r.height }];
        }),
      );
    },
    { reference, pending },
  );
}
async function compare(app, ref, width, pending = false) {
  const pair = {
    width,
    pending,
    app: await measure(app, false, pending),
    reference: await measure(ref, true, pending),
  };
  measurements.push(pair);
  await h.write("geometry.json", measurements);
  for (const [name, box] of Object.entries(pair.reference))
    for (const [key, value] of Object.entries(box))
      assert.ok(
        Math.abs(pair.app[name][key] - value) <= 1,
        `${width} ${name}.${key}: ${pair.app[name][key]} vs ${value}`,
      );
}
try {
  for (const width of process.env.REVIEW_FLOWS ? [] : [1440, 1920]) {
    const app = await h.open(width),
      ref = await h.open(width, "", true);
    await ready(app);
    await h.capture(app, `app-${width}`);
    await h.capture(ref, `reference-${width}`);
    await compare(app, ref, width);
    await openPending(app);
    await ref
      .getByRole("button", { name: "Grupo Vante", exact: true })
      .filter({ visible: true })
      .click();
    await h.capture(app, `pending-${width}`);
    await h.capture(ref, `reference-pending-${width}`);
    await compare(app, ref, width, true);
    await app.close();
    await ref.close();
  }
  const page = await h.open(1440);
  await ready(page);
  assert.equal(await page.locator(".intform-table tbody tr").count(), 8);
  await page
    .getByRole("button", { name: "Cobrar 2 atrasados →", exact: true })
    .click();
  assert.equal(await page.locator(".intform-table tbody tr").count(), 4);
  assert.equal(
    await page
      .getByRole("button", { name: "Aguardando 4", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  const search = page.getByRole("searchbox", {
    name: "Buscar cliente ou resposta",
  });
  await search.fill("inexistente");
  await page
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Tipo de formulário" })
    .selectOption("nota_fiscal");
  assert.equal(await page.locator(".intform-table tbody tr").count(), 3);
  await page
    .getByRole("button", { name: "Respondidos 1", exact: true })
    .click();
  assert.equal(await page.locator(".intform-table tbody tr").count(), 1);
  await page
    .getByRole("button", { name: "Copiar respostas", exact: true })
    .click();
  await page.getByRole("button", { name: "Copiado ✓", exact: true }).waitFor();
  assert.ok(
    (await page.evaluate(() => navigator.clipboard.readText())).includes(
      "28.114.907/0001-33",
    ),
  );
  await page
    .getByRole("button", { name: "Ver respostas", exact: true })
    .click();
  const answer = drawer(page);
  await answer
    .getByText("Mercado Ponto Comércio de Alimentos LTDA", { exact: true })
    .waitFor();
  await answer.getByText("Ver termo assinado", { exact: true }).click();
  assert.ok(await answer.locator("details[open]").isVisible());
  await page.keyboard.press("Escape");
  await answer.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("button", { name: "Ver respostas", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  assert.equal(
    await page
      .getByRole("combobox", { name: "Tipo de formulário" })
      .inputValue(),
    "nota_fiscal",
  );
  await page
    .getByRole("button", { name: "Perguntas · nota fiscal", exact: true })
    .click();
  const questions = page.getByRole("dialog", {
    name: "Perguntas do formulário",
  });
  await questions.locator(".intform-questions section").first().waitFor();
  assert.ok(
    (
      await questions
        .getByRole("link", { name: "Abrir prévia pública ↗" })
        .getAttribute("href")
    ).endsWith("kind=nota_fiscal"),
  );
  await questions
    .getByRole("button", { name: "integração", exact: true })
    .click();
  await page.waitForFunction(
    () => window.__reviewReads.at(-1)?.kind === "integracao",
  );
  await page.keyboard.press("Escape");
  await questions.waitFor({ state: "hidden" });
  await page
    .getByRole("combobox", { name: "Tipo de formulário" })
    .selectOption("todos");
  await page.getByRole("button", { name: "Todos 8", exact: true }).click();
  const pending = await openPending(page);
  await pending.locator(".intform-questions section").first().waitFor();
  assert.ok(
    (
      await pending
        .getByRole("link", { name: "Cobrar no WhatsApp" })
        .getAttribute("href")
    ).includes(encodeURIComponent("/fi/fi-3")),
  );
  await pending
    .getByRole("button", { name: "Copiar a mensagem", exact: true })
    .click();
  await pending
    .getByRole("button", { name: "Copiado ✓", exact: true })
    .waitFor();
  assert.ok(
    (await page.evaluate(() => navigator.clipboard.readText())).includes(
      "/fi/fi-3",
    ),
  );
  page.once("dialog", (d) => d.dismiss());
  await pending
    .getByRole("button", { name: "Excluir formulário", exact: true })
    .click();
  assert.equal(await pending.isVisible(), true);
  page.once("dialog", (d) => d.accept());
  await pending
    .getByRole("button", { name: "Excluir formulário", exact: true })
    .click();
  await pending.waitFor({ state: "hidden" });
  assert.equal(await page.locator(".intform-table tbody tr").count(), 7);
  await page
    .getByRole("button", { name: "Solicitar formulário", exact: true })
    .click();
  const ask = page.getByRole("dialog", {
    name: "solicitar formulário",
    exact: true,
  });
  await ask.getByRole("radio", { name: /Dados para nota fiscal/ }).click();
  await ask
    .getByRole("searchbox", { name: "Buscar destinatário do formulário" })
    .fill("Studio Kern");
  await ask.getByRole("button", { name: /^Studio Kern/ }).click();
  await ask
    .getByText("Link criado para Studio Kern", { exact: true })
    .waitFor();
  assert.ok(
    await page.evaluate(() =>
      window.__reviewMutations.some(
        (m) =>
          m.method === "create" &&
          m.data.kind === "nota_fiscal" &&
          m.data.customerId === "int-c0" &&
          m.data.saas === "leverads",
      ),
    ),
  );
  await ask.getByRole("button", { name: "Copiar link", exact: true }).click();
  assert.ok(
    (await page.evaluate(() => navigator.clipboard.readText())).includes(
      "/fi/new-7",
    ),
  );
  await ask.getByRole("button", { name: "Fechar", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Solicitar formulário", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page
    .getByRole("button", { name: "Solicitar formulário", exact: true })
    .click();
  await ask
    .getByRole("button", { name: "Lead que fechou", exact: true })
    .click();
  await ask.getByRole("button", { name: /^Unique Baby/ }).click();
  await ask
    .getByText("Link criado para Unique Baby", { exact: true })
    .waitFor();
  assert.ok(
    await page.evaluate(() =>
      window.__reviewMutations.some(
        (m) =>
          m.method === "create" &&
          m.data.leadId === "int-l1" &&
          m.data.kind === "integracao",
      ),
    ),
  );
  await page.close();
  const failure = await h.open(1440, "&failOnce=list");
  await failure.getByRole("alert").waitFor();
  assert.equal(await failure.locator(".intform-stats").count(), 0);
  await failure.getByRole("button", { name: "Tentar novamente" }).click();
  await ready(failure);
  await failure.close();
  const slow = await h.open(1440, "&failOnce=list&holdList");
  await slow.getByRole("button", { name: "Tentar novamente" }).click();
  await slow.getByText("Carregando formulários…", { exact: true }).waitFor();
  await slow
    .getByRole("button", { name: "Solicitar formulário", exact: true })
    .click();
  await slow.getByRole("dialog", { name: "solicitar formulário" }).waitFor();
  await slow.evaluate(() => window.__releaseList());
  await slow.close();
  const createFail = await h.open(1440, "&failOnce=create");
  await createFail
    .getByRole("button", { name: "Solicitar formulário", exact: true })
    .click();
  const creation = createFail.getByRole("dialog", {
    name: "solicitar formulário",
  });
  await creation.getByRole("searchbox").fill("Studio");
  await creation.getByRole("button", { name: /^Studio Kern/ }).click();
  await creation.getByRole("alert").waitFor();
  assert.equal(await creation.getByRole("searchbox").inputValue(), "Studio");
  await creation.getByRole("button", { name: /^Studio Kern/ }).click();
  await creation
    .getByText("Link criado para Studio Kern", { exact: true })
    .waitFor();
  await createFail.close();
  const hold = await h.open(1440, "&holdCreate");
  await hold
    .getByRole("button", { name: "Solicitar formulário", exact: true })
    .click();
  const holding = hold.getByRole("dialog", { name: "solicitar formulário" });
  await holding.getByRole("button", { name: /^Studio Kern/ }).click();
  await holding.getByText("Criando formulário…", { exact: true }).waitFor();
  assert.equal(await holding.getByRole("searchbox").isEnabled(), false);
  await hold.keyboard.press("Escape");
  assert.equal(await holding.isVisible(), true);
  await hold.evaluate(() => window.__releaseCreate());
  await holding
    .getByText("Link criado para Studio Kern", { exact: true })
    .waitFor();
  assert.equal(await hold.evaluate(() => window.__reviewMutations.length), 1);
  await hold.close();
  const removeFail = await h.open(1440, "&failOnce=remove");
  const deleting = await openPending(removeFail);
  removeFail.once("dialog", (d) => d.accept());
  await deleting
    .getByRole("button", { name: "Excluir formulário", exact: true })
    .click();
  await deleting.getByRole("alert").waitFor();
  assert.equal(await deleting.isVisible(), true);
  removeFail.once("dialog", (d) => d.accept());
  await deleting
    .getByRole("button", { name: "Excluir formulário", exact: true })
    .click();
  await deleting.waitFor({ state: "hidden" });
  await removeFail.close();
  const holdRemove = await h.open(1440, "&holdRemove");
  const removing = await openPending(holdRemove);
  holdRemove.once("dialog", (d) => d.accept());
  await removing
    .getByRole("button", { name: "Excluir formulário", exact: true })
    .click();
  await removing
    .getByRole("button", { name: "Excluindo…", exact: true })
    .waitFor();
  assert.equal(
    await removing
      .getByRole("button", { name: "Fechar respostas" })
      .isEnabled(),
    false,
  );
  await holdRemove.keyboard.press("Escape");
  assert.equal(await removing.isVisible(), true);
  await holdRemove.evaluate(() => window.__releaseRemove());
  await removing.waitFor({ state: "hidden" });
  assert.equal(
    await holdRemove.evaluate(() => window.__reviewMutations.length),
    1,
  );
  await holdRemove.close();
  const noPhone = await h.open(1440);
  await noPhone
    .getByRole("button", { name: "Ver pedido", exact: true })
    .click();
  const noPhoneDrawer = drawer(noPhone);
  assert.equal(
    await noPhoneDrawer
      .getByRole("link", { name: "Cobrar no WhatsApp" })
      .count(),
    0,
  );
  await noPhoneDrawer
    .getByRole("button", { name: "Copiar link", exact: true })
    .click();
  await noPhoneDrawer
    .getByRole("button", { name: "Copiado ✓", exact: true })
    .waitFor();
  assert.ok(
    (await noPhone.evaluate(() => navigator.clipboard.readText())).endsWith(
      "/fi/fi-6",
    ),
  );
  for (let i = 0; i < 12; i++) await noPhone.keyboard.press("Tab");
  assert.equal(
    await noPhoneDrawer.evaluate((e) => e.contains(document.activeElement)),
    true,
  );
  await noPhone.close();
  const questionFail = await h.open(1440, "&failOnce=questions");
  await questionFail
    .getByRole("button", { name: "Perguntas · integração", exact: true })
    .click();
  const questionDialog = questionFail.getByRole("dialog", {
    name: "Perguntas do formulário",
  });
  await questionDialog.getByRole("alert").waitFor();
  await questionDialog
    .getByRole("button", { name: "Tentar novamente" })
    .click();
  await questionDialog.locator(".intform-questions section").first().waitFor();
  await questionFail.close();
  const copyFail = await h.open(1440, "&clipboardFail");
  await ready(copyFail);
  await copyFail
    .getByRole("button", { name: "Copiar link", exact: true })
    .first()
    .click();
  await copyFail
    .getByText("Não foi possível copiar. Tente novamente.", { exact: true })
    .waitFor();
  assert.equal(
    await copyFail
      .getByRole("button", { name: "Copiado ✓", exact: true })
      .count(),
    0,
  );
  await copyFail.close();
  const empty = await h.open(1440, "&state=empty");
  await empty
    .getByText("Nenhum formulário pedido ainda", { exact: false })
    .waitFor();
  await h.capture(empty, "empty");
  await empty.close();
  const many = await h.open(1440, "&state=many");
  await many
    .getByRole("button", { name: "Mostrar mais · 50 de 63", exact: true })
    .click();
  assert.equal(await many.locator(".intform-table tbody tr").count(), 63);
  await many.close();
  const mobile = await h.open(390, "&long");
  await ready(mobile);
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.ok(
    await mobile
      .locator(".intform-card .tbl-x")
      .evaluate((e) => e.scrollWidth > e.clientWidth),
  );
  await h.capture(mobile, "mobile");
  await mobile
    .getByRole("button", { name: "Studio Kern", exact: true })
    .click();
  await h.capture(mobile, "mobile-answer");
  assert.ok(
    await drawer(mobile).evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  const bounds = await drawer(mobile).boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await drawer(mobile)
    .getByRole("button", { name: "Copiar respostas", exact: true })
    .click();
  await drawer(mobile)
    .getByRole("button", { name: "Copiado ✓", exact: true })
    .waitFor();
  await mobile.keyboard.press("Escape");
  await mobile
    .getByRole("button", { name: "Solicitar formulário", exact: true })
    .click();
  await h.capture(mobile, "mobile-create");
  await mobile.close();
  const dark = await h.open(1440, "&theme=dark");
  await openPending(dark);
  await h.capture(dark, "dark");
  await dark.close();
  assert.deepEqual(h.errors, []);
  console.log(
    "Formulário de Integração: geometria, filtros, snapshots, perguntas, pedido, cópia, exclusão, falhas e mobile conferidos.",
  );
} finally {
  await h.close();
}
