import assert from "node:assert/strict";
import { reviewHarness } from "./harness.mjs";

const h = await reviewHarness("contracts", "Contratos", async (page) => {
  await page.getByRole("button", { name: /^Comercial/ }).click();
  await page.getByRole("button", { name: "Contratos", exact: true }).click();
});
const measurements = [];
const model = (page) =>
  page.getByRole("dialog", { name: "Modelo de contrato", exact: true });
const menu = (page) =>
  model(page).getByRole("button", { name: "⋯", exact: true });
async function openModel(page) {
  await page
    .getByRole("button", { name: "Usar →", exact: true })
    .first()
    .click();
  await model(page).waitFor();
  return model(page);
}
async function fillModel(page) {
  const dialog = await openModel(page);
  await dialog.getByRole("combobox").selectOption("c0");
  await dialog.getByLabel("CNPJ / CPF", { exact: true }).fill("12345678901");
  await dialog.getByLabel("Valor total", { exact: true }).fill("7.188,00");
  await dialog
    .getByLabel("Forma de pagamento", { exact: true })
    .fill("12x no cartão");
  await dialog.getByLabel("Vigência", { exact: true }).fill("12 meses");
  return dialog;
}
async function measure(page, reference, drawer) {
  return page.evaluate(
    ({ reference, drawer }) => {
      const title = [...document.querySelectorAll("h1")].find(
        (e) => e.textContent === "Contratos" && e.getClientRects().length,
      );
      const root = reference
        ? title.closest("header").parentElement
        : document.querySelector(".contracts-page");
      const models = root.children[1],
        history = root.children[2];
      const modelTable = models.children[1].children[0],
        historyTable = history.children[1].children[0];
      function gridRow(table) {
        let row = table.querySelector("button");
        while (row && getComputedStyle(row).display !== "grid")
          row = row.parentElement;
        return row;
      }
      const modelRow = reference ? gridRow(modelTable) : modelTable.children[1];
      const historyRow = reference
        ? gridRow(historyTable)
        : historyTable.children[1];
      const elements = {
        title,
        header: root.children[0],
        models,
        modelHeading: models.children[0],
        modelHead: modelTable.children[0],
        modelRow,
        history,
        historyHeading: history.children[0],
        historyHead: historyTable.children[0],
        historyRow,
        search: history.children[0].lastElementChild,
      };
      for (const [name, row] of [
        ["model", modelRow],
        ["history", historyRow],
      ])
        [...row.children].forEach((e, i) => (elements[`${name}Cell${i}`] = e));
      if (drawer) {
        const panel = reference
          ? [...document.querySelectorAll("aside")].find(
              (e) =>
                e.getClientRects().length &&
                e.textContent.includes("modelo de contrato"),
            )
          : document.querySelector('[aria-label="Modelo de contrato"]');
        const content = reference ? panel : panel.firstElementChild;
        elements.drawer = panel;
        elements.drawerHead = content.children[0];
        elements.drawerBody = content.children[1];
        elements.drawerFooter = content.children[2];
        [...content.children[1].children]
          .slice(0, 2)
          .forEach((e, i) => (elements[`step${i}`] = e));
      }
      return Object.fromEntries(
        Object.entries(elements).map(([key, e]) => {
          const r = e.getBoundingClientRect();
          return [key, { x: r.x, y: r.y, width: r.width, height: r.height }];
        }),
      );
    },
    { reference, drawer },
  );
}
async function compare(app, ref, width, drawer = false) {
  const pair = {
    width,
    drawer,
    app: await measure(app, false, drawer),
    reference: await measure(ref, true, drawer),
  };
  measurements.push(pair);
  await h.write("geometry.json", measurements);
  for (const [name, box] of Object.entries(pair.reference))
    for (const [key, value] of Object.entries(box)) {
      assert.ok(
        Math.abs(pair.app[name][key] - value) <= 1,
        `${width} ${name}.${key}: ${pair.app[name][key]} vs ${value}`,
      );
    }
}

try {
  for (const width of process.env.REVIEW_FLOWS ? [] : [1440, 1920]) {
    const app = await h.open(width),
      ref = await h.open(width, "", true);
    await app.locator(".contracts-issue-row").first().waitFor();
    await h.capture(app, `app-${width}`);
    await h.capture(ref, `reference-${width}`);
    await compare(app, ref, width);
    await openModel(app);
    await ref
      .getByRole("button", { name: "Usar →", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await h.capture(app, `drawer-${width}`);
    await h.capture(ref, `reference-drawer-${width}`);
    await compare(app, ref, width, true);
    await app.close();
    await ref.close();
  }

  const page = await h.open(1440);
  await page.locator(".contracts-issue-row").first().waitFor();
  assert.equal(await page.locator(".contracts-model-row").count(), 4);
  assert.equal(await page.locator(".contracts-issue-row").count(), 8);
  const search = page.getByRole("textbox", {
    name: "Buscar no histórico de contratos",
  });
  await search.fill("Studio");
  assert.equal(await page.locator(".contracts-issue-row").count(), 1);
  await page.getByRole("button", { name: "Abrir", exact: true }).click();
  const viewer = page.getByRole("dialog", {
    name: "Contrato gerado",
    exact: true,
  });
  assert.ok(
    (await viewer.locator("iframe").getAttribute("srcdoc")).includes(
      "Studio Kern",
    ),
  );
  await viewer.getByRole("button", { name: "Imprimir / PDF" }).click();
  assert.equal(await page.evaluate(() => window.__reviewPrints.length), 1);
  assert.equal(await page.evaluate(() => window.__reviewMutations.length), 0);
  await page.keyboard.press("Escape");
  await viewer.waitFor({ state: "hidden" });
  assert.equal(await search.inputValue(), "Studio");
  assert.equal(
    await page
      .getByRole("button", { name: "Abrir", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await search.fill("inexistente");
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  const dialog = await fillModel(page);
  await dialog
    .getByRole("button", { name: "Imprimir em branco · não registra" })
    .click();
  assert.equal(await page.evaluate(() => window.__reviewMutations.length), 0);
  assert.ok(
    (await page.evaluate(() => window.__reviewPrints.at(-1))).includes(
      "______________________",
    ),
  );
  await dialog
    .getByRole("button", { name: "Registrar e gerar PDF", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Registrado no histórico ✓" })
    .waitFor();
  assert.ok(
    await page.evaluate(() =>
      window.__reviewMutations.some(
        (m) =>
          m.col === "contract_issues" &&
          m.data.customerId === "c0" &&
          m.data.values.razao_social === "Galante Holding",
      ),
    ),
  );
  await dialog
    .getByRole("button", { name: "Copiar HTML", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Copiado ✓", exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__reviewMutations.length), 1);
  assert.ok(
    (await page.evaluate(() => navigator.clipboard.readText())).includes(
      "Galante Holding",
    ),
  );
  await menu(page).click();
  await page
    .getByRole("button", { name: "Ver documento completo", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Documento completo" }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  await menu(page).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar .html", exact: true }).click();
  assert.ok((await download).suggestedFilename().endsWith(".html"));
  await page.waitForFunction(
    () => !document.querySelector(".contract-peek-head > button").disabled,
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("button", { name: "Usar →", exact: true })
      .first()
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page
    .getByRole("button", { name: "Duplicar", exact: true })
    .first()
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".contracts-model-row").length === 5,
  );
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Excluir", exact: true })
    .last()
    .click();
  assert.equal(await page.locator(".contracts-model-row").count(), 5);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Excluir", exact: true })
    .last()
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".contracts-model-row").length === 4,
  );
  await page.getByRole("button", { name: "Criar modelo", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Novo modelo", exact: true });
  await editor
    .getByRole("button", { name: "Salvar modelo", exact: true })
    .click();
  await editor.getByRole("alert").waitFor();
  await editor.getByLabel("Nome do modelo").fill("Modelo de revisão");
  await editor
    .getByLabel("Corpo do modelo em HTML")
    .fill("<h1>Teste</h1><p>{{nome_cliente}}</p>");
  await editor.getByRole("button", { name: "Cancelar", exact: true }).focus();
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  assert.equal(await editor.isVisible(), true);
  await editor
    .getByRole("button", { name: "Salvar modelo", exact: true })
    .click();
  await editor.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Modelo de revisão", exact: true })
    .click();
  await model(page).getByLabel("nome cliente").fill("Texto preservado");
  page.once("dialog", (d) => d.dismiss());
  await model(page).getByRole("button", { name: "Fechar modelo" }).click();
  assert.equal(
    await model(page).getByLabel("nome cliente").inputValue(),
    "Texto preservado",
  );
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Escape");
  await page.close();

  for (const collection of ["contracts", "contract_issues"]) {
    const fail = await h.open(1440, `&failOnce=list:${collection}`);
    await fail.getByRole("alert").waitFor();
    if (collection === "contract_issues")
      assert.equal(
        await fail.locator(".contracts-count").first().innerText(),
        "—",
      );
    await fail.getByRole("button", { name: "Tentar novamente" }).click();
    await fail.locator(".contracts-issue-row").first().waitFor();
    await fail.locator(".contracts-model-row").first().waitFor();
    await fail.close();
  }
  const fail = await h.open(1440, "&failOnce=create:contract_issues");
  const filled = await fillModel(fail);
  await filled
    .getByRole("button", { name: "Registrar e gerar PDF", exact: true })
    .click();
  await filled.getByRole("alert").waitFor();
  assert.equal(
    await filled.getByLabel("Valor total", { exact: true }).inputValue(),
    "7.188,00",
  );
  await filled
    .getByRole("button", { name: "Registrar e gerar PDF", exact: true })
    .click();
  await filled
    .getByRole("button", { name: "Registrado no histórico ✓" })
    .waitFor();
  await h.capture(fail, "save-retry");
  await fail.close();
  const editFail = await h.open(1440, "&failOnce=update:contracts");
  await openModel(editFail);
  await menu(editFail).click();
  await editFail
    .getByRole("button", { name: "Editar modelo", exact: true })
    .click();
  const edit = editFail.getByRole("dialog", {
    name: "Editar modelo",
    exact: true,
  });
  await edit.getByLabel("Nome do modelo").fill("Novo nome");
  await edit
    .getByRole("button", { name: "Salvar modelo", exact: true })
    .click();
  await edit.getByRole("alert").waitFor();
  assert.equal(
    await edit.getByLabel("Nome do modelo").inputValue(),
    "Novo nome",
  );
  await edit
    .getByRole("button", { name: "Salvar modelo", exact: true })
    .click();
  await edit.waitFor({ state: "hidden" });
  await editFail
    .getByRole("button", { name: "Novo nome", exact: true })
    .waitFor();
  await editFail.close();
  const removeFail = await h.open(1440, "&failOnce=remove:contract_issues");
  await removeFail
    .getByRole("button", { name: "Abrir", exact: true })
    .first()
    .click();
  const record = removeFail.getByRole("dialog", {
    name: "Contrato gerado",
    exact: true,
  });
  removeFail.once("dialog", (d) => d.accept());
  await record.getByRole("button", { name: "Excluir registro" }).click();
  await record.getByRole("alert").waitFor();
  removeFail.once("dialog", (d) => d.accept());
  await record.getByRole("button", { name: "Excluir registro" }).click();
  await record.waitFor({ state: "hidden" });
  await removeFail.close();
  const hold = await h.open(1440, "&holdSave");
  const held = await fillModel(hold);
  await held
    .getByRole("button", { name: "Registrar e gerar PDF", exact: true })
    .click();
  await held.getByRole("button", { name: "Registrando…" }).waitFor();
  assert.equal(
    await held.getByRole("button", { name: "Fechar modelo" }).isEnabled(),
    false,
  );
  await hold.keyboard.press("Escape");
  assert.equal(await held.isVisible(), true);
  await hold.evaluate(() => window.__releaseSave());
  await held
    .getByRole("button", { name: "Registrado no histórico ✓" })
    .waitFor();
  assert.equal(await hold.evaluate(() => window.__reviewMutations.length), 1);
  await hold.close();
  const slow = await h.open(1440, "&historyFail&holdHistory");
  await slow.getByRole("alert").waitFor();
  await slow.getByRole("button", {name:"Tentar novamente"}).click();
  await slow.getByText("Carregando histórico…", { exact: true }).waitFor();
  assert.equal(await slow.locator(".contracts-count").first().innerText(), "—");
  await openModel(slow);
  await slow.evaluate(() => window.__releaseHistory());
  await slow.close();
  const clipboard = await h.open(1440, "&clipboardFail");
  const copying = await fillModel(clipboard);
  await copying
    .getByRole("button", { name: "Copiar HTML", exact: true })
    .click();
  await copying.getByRole("alert").waitFor();
  assert.equal(
    await clipboard.evaluate(() => window.__reviewMutations.length),
    0,
  );
  await clipboard.close();
  const blocked = await h.open(1440, "&blockedPrint");
  const blockedDialog = await fillModel(blocked);
  await blockedDialog
    .getByRole("button", { name: "Registrar e gerar PDF", exact: true })
    .click();
  await blocked
    .getByText(/O navegador bloqueou a janela de impressão/)
    .waitFor();
  assert.equal(
    await blocked.evaluate(() => window.__reviewMutations.length),
    0,
  );
  await blocked.close();
  const many = await h.open(1440, "&state=many");
  await many
    .getByRole("button", { name: "+16 registros", exact: true })
    .click();
  assert.equal(await many.locator(".contracts-issue-row").count(), 28);
  await many.close();
  const empty = await h.open(1440, "&state=empty");
  await empty.getByText("Nenhum modelo ainda.", { exact: false }).waitFor();
  await h.capture(empty, "empty");
  await empty.close();
  const mobile = await h.open(390);
  await mobile.locator(".contracts-issue-row").first().waitFor();
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.ok(
    await mobile
      .locator(".contracts-models .tbl-x")
      .evaluate((e) => e.scrollWidth > e.clientWidth),
  );
  await h.capture(mobile, "mobile");
  const mobileDialog = await fillModel(mobile);
  await h.capture(mobile, "mobile-drawer");
  const bounds = await mobileDialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await mobileDialog
    .getByRole("button", { name: "Registrar e gerar PDF", exact: true })
    .click();
  await mobileDialog
    .getByRole("button", { name: "Registrado no histórico ✓" })
    .waitFor();
  await mobile.keyboard.press("Escape");
  await mobile
    .getByRole("button", { name: "Criar modelo", exact: true })
    .click();
  const mobileEditor = mobile.getByRole("dialog", {
    name: "Novo modelo",
    exact: true,
  });
  await mobileEditor.getByLabel("Nome do modelo").fill("Modelo mobile");
  await h.capture(mobile, "mobile-editor");
  await mobileEditor
    .getByRole("button", { name: "Salvar modelo", exact: true })
    .click();
  await mobileEditor.waitFor({ state: "hidden" });
  await mobile.close();
  const dark = await h.open(1440, "&theme=dark");
  await openModel(dark);
  await h.capture(dark, "dark");
  await dark.close();
  assert.deepEqual(h.errors, []);
  console.log(
    "Contratos: geometria, modelos, snapshots, geração, cópia, confirmação, falhas e mobile conferidos.",
  );
} finally {
  await h.close();
}
