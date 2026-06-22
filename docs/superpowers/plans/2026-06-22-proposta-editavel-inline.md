# Contas no lead + Proposta editável inline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o nº de contas que não chega no lead/proposta (chave do form driftou) e trocar o painel flutuante do closer por edição inline (clica no número → ajusta → auto-salva), com contas em FAIXA e preço pelo topo da faixa.

**Architecture:** Fix do builder trava a chave de pergunta existente (causa do drift). Domínio da proposta ganha `state.accounts` (faixa) com `state.seats` derivado do topo via `calc.seatsMap`. O renderer exibe a faixa e torna os 5 valores (contas/volume/ciclo/preço/validade) clicáveis no modo closer (`?k`), auto-salvando pelo PATCH que já existe. Uma migração idempotente conserta a chave do form + faz backfill dos 8 leads/propostas e reconfigura o template `pt_leverads`.

**Tech Stack:** Node 22 + Fastify 5 + pg (Supabase, schema `cockpit`, schemaless JSONB), React 18 SPA (Vite). Testes: `node:test` + Fastify `inject` + repo in-memory (sem Postgres). Renderer da proposta = template literal gigante em `api/src/proposal-page.js`.

**Contexto canônico:** `docs/PLANO-REWORK.md`. **Spec desta entrega:** `docs/superpowers/specs/2026-06-22-proposta-editavel-inline-design.md`.

**⚠️ Deploy:** o repo está em `main` e **prod auto-deploya no push** (`docs/PLANO-REWORK.md` §10), usando o **mesmo Supabase** do dev local. Portanto: (1) trabalhar numa branch, commits LOCAIS; **não dar push sem o dono aprovar**. (2) A migração (Task E) escreve no DB compartilhado = mexe em prod na hora; rodar **só depois** do código estar no ar, senão o renderer velho vê dados novos (degrada). (3) Testes da API usam repo in-memory — não tocam prod.

---

## File Structure

| Arquivo | Mudança |
|---|---|
| `packages/web/src/screens/forms.jsx` | Builder não reescreve mais a chave de pergunta existente (sentinela `_keyAuto`). |
| `packages/api/src/proposal.js` | `initialState()` grava `state.accounts` (faixa) e deriva `seats` do topo. |
| `packages/api/src/routes.proposals.js` | PATCH aceita `accounts` (recalcula `seats` no servidor); `previewFromTemplate` ganha `accounts`. |
| `packages/api/src/proposal-page.js` | Interpolação liga `answers.<seatsKey/volumeKey>` → spans de estado; remove painel flutuante; adiciona edição inline + auto-save + CSS. |
| `packages/web/src/screens/proposals.jsx` | Rótulo do editor de `seatsMap` deixa claro que é o topo da faixa. |
| `packages/api/scripts/2026-06-22-fix-accounts-key.mjs` | **Novo.** Migração idempotente: renomeia chave do form, backfill leads/propostas, reconfigura `pt_leverads`. |
| `packages/api/test/routes.proposals.test.js` | Asserts novos: `state.accounts` na geração; PATCH `accounts` → `seats` do topo. |

---

## Task 0: Branch de trabalho

- [ ] **Step 1: Criar a branch (commits ficam locais; sem push)**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager"
git checkout -b fix/contas-faixa-proposta-inline
```
Expected: `Switched to a new branch 'fix/contas-faixa-proposta-inline'`

---

## Task 1: Builder não reescreve chave de pergunta existente

**Files:**
- Modify: `packages/web/src/screens/forms.jsx:383` e `:461`

Causa do drift: ao editar o RÓTULO, a chave é re-derivada de `slug(label)` sempre que `!_keyTouched` (flag de sessão, `undefined` ao carregar). Fix: derivar só quando a chave veio em branco (pergunta nova) — sentinela `_keyAuto`.

- [ ] **Step 1: Travar a chave de pergunta carregada**

Edit `packages/web/src/screens/forms.jsx` — trocar a linha 383:

De:
```jsx
                  if (!q._keyTouched) patch.key = slug(e.target.value);
```
Para:
```jsx
                  if (!q._keyTouched && (q._keyAuto || !String(q.key || "").trim())) patch.key = slug(e.target.value);
```

- [ ] **Step 2: Pergunta nova nasce com `_keyAuto` (preserva auto-preencher ao digitar)**

Edit `packages/web/src/screens/forms.jsx` — na linha 461, dentro do `onChange` do botão "+ adicionar pergunta":

De:
```jsx
      <button type="button" onClick={() => onChange([...questions, { key: "", label: "", type: "text", required: false, options: [] }])} style={addBtnStyle}>+ adicionar pergunta</button>
```
Para:
```jsx
      <button type="button" onClick={() => onChange([...questions, { key: "", label: "", type: "text", required: false, options: [], _keyAuto: true }])} style={addBtnStyle}>+ adicionar pergunta</button>
```

- [ ] **Step 3: Conferir que o build do SPA passa**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager" && npm run build
```
Expected: build conclui sem erro (Vite gera `packages/web/dist`).

> Verificação funcional é manual (sem infra de teste de front) e fica na Task 8.

- [ ] **Step 4: Commit (local)**

```bash
git add packages/web/src/screens/forms.jsx
git commit -m "fix(forms): editar rótulo não reescreve chave de pergunta existente"
```

---

## Task 2: `initialState` grava a faixa (`state.accounts`) e deriva os assentos

**Files:**
- Modify: `packages/api/src/proposal.js:84-96`
- Test: `packages/api/test/routes.proposals.test.js:68` (assert novo)

- [ ] **Step 1: Escrever o assert que falha**

Edit `packages/api/test/routes.proposals.test.js` — logo após a linha 68 (`assert.equal(proposal.data.answers.accounts, "3-5");`), adicionar:
```js
  assert.equal(proposal.state.accounts, "3-5");      // faixa escolhida fica no estado
```

- [ ] **Step 2: Rodar e ver falhar**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager/packages/api" && npm test -- --test-name-pattern="dispatcher: template publicado"
```
Expected: FAIL — `proposal.state.accounts` é `undefined`, esperado `"3-5"`.

- [ ] **Step 3: Implementar `state.accounts` + `seats` derivado**

Edit `packages/api/src/proposal.js` — substituir a função `initialState` (linhas 84-96):

De:
```js
export function initialState(calc, answers) {
  const c = { ...CALC_DEFAULTS, ...(calc || {}) };
  const seatsAns = c.seatsKey ? answers[c.seatsKey] : null;
  const seats = Number(c.seatsMap?.[seatsAns]) || c.plans?.[c.defaultCycle]?.included || 2;
  const volume = (c.volumeKey && answers[c.volumeKey]) || Object.keys(c.volumeMid || {})[0] || "";
  const valid = new Date(Date.now() + (Number(c.validDays) || 7) * 86400_000);
  return {
    seats, volume, cycle: c.defaultCycle,
    customPriceCents: 0,
    validUntil: valid.toLocaleDateString("pt-BR"),
    frozen: false,
  };
}
```
Para:
```js
export function initialState(calc, answers) {
  const c = { ...CALC_DEFAULTS, ...(calc || {}) };
  const seatsAns = c.seatsKey ? answers[c.seatsKey] : null;
  // `accounts` = a FAIXA escolhida (ex. "3-5"); `seats` = nº de contas usado na
  // fórmula, derivado do topo da faixa via seatsMap (fallback = incluídas do plano).
  const accounts = seatsAns != null ? String(seatsAns) : "";
  const seats = Number(c.seatsMap?.[accounts]) || c.plans?.[c.defaultCycle]?.included || 2;
  const volume = (c.volumeKey && answers[c.volumeKey]) || Object.keys(c.volumeMid || {})[0] || "";
  const valid = new Date(Date.now() + (Number(c.validDays) || 7) * 86400_000);
  return {
    accounts, seats, volume, cycle: c.defaultCycle,
    customPriceCents: 0,
    validUntil: valid.toLocaleDateString("pt-BR"),
    frozen: false,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager/packages/api" && npm test -- --test-name-pattern="dispatcher: template publicado"
```
Expected: PASS (inclui `state.accounts === "3-5"` e `state.seats === 4` do fixture).

- [ ] **Step 5: Commit (local)**

```bash
git add packages/api/src/proposal.js packages/api/test/routes.proposals.test.js
git commit -m "feat(proposta): state.accounts (faixa) + seats derivado do topo"
```

---

## Task 3: PATCH aceita a faixa e deriva os assentos no servidor

**Files:**
- Modify: `packages/api/src/routes.proposals.js:82-96`
- Test: `packages/api/test/routes.proposals.test.js` (teste novo)

- [ ] **Step 1: Escrever o teste que falha**

Edit `packages/api/test/routes.proposals.test.js` — adicionar este teste logo após o teste do PATCH existente (depois da linha 172, antes do teste "aceite:"):
```js
test("PATCH: faixa de contas é autoritativa — deriva seats do topo (seatsMap)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { ...LEAD });
  await app.inject({ method: "POST", url: "/api/leads/le_p1/proposal" });
  const { proposta_id } = await repo.get("leads", "le_p1");
  const { editKey } = await repo.get("proposals", proposta_id);

  const ok = await app.inject({
    method: "PATCH", url: `/public/proposals/${proposta_id}`,
    payload: { k: editKey, accounts: "6-10" },
  });
  assert.equal(ok.statusCode, 200);
  const p = await repo.get("proposals", proposta_id);
  assert.equal(p.state.accounts, "6-10");
  assert.equal(p.state.seats, 8); // seatsMap["6-10"] do fixture

  // faixa fora do seatsMap é ignorada (não corrompe o estado)
  await app.inject({ method: "PATCH", url: `/public/proposals/${proposta_id}`, payload: { k: editKey, accounts: "999" } });
  const p2 = await repo.get("proposals", proposta_id);
  assert.equal(p2.state.accounts, "6-10");
  await app.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager/packages/api" && npm test -- --test-name-pattern="faixa de contas é autoritativa"
```
Expected: FAIL — `p.state.accounts` é `undefined` (PATCH ignora `accounts`).

- [ ] **Step 3: Implementar o ramo `accounts` no PATCH**

Edit `packages/api/src/routes.proposals.js` — no handler `app.patch("/public/proposals/:id", ...)`, substituir o bloco que monta `state` (linhas 87-94):

De:
```js
    const state = { ...(p.state || {}) };
    if (Number.isFinite(Number(body.seats)) && Number(body.seats) >= 1) state.seats = Number(body.seats);
    if (typeof body.volume === "string") state.volume = body.volume;
    if (["monthly", "quarterly", "semiannual", "annual"].includes(body.cycle)) state.cycle = body.cycle;
    if (Number.isFinite(Number(body.customPriceCents)) && Number(body.customPriceCents) >= 0) state.customPriceCents = Number(body.customPriceCents);
    if (typeof body.validUntil === "string") state.validUntil = body.validUntil.slice(0, 20);
    if (typeof body.frozen === "boolean") state.frozen = body.frozen;
    const updated = await repo.update("proposals", p.id, { state });
```
Para:
```js
    const state = { ...(p.state || {}) };
    if (Number.isFinite(Number(body.seats)) && Number(body.seats) >= 1) state.seats = Number(body.seats);
    if (typeof body.volume === "string") state.volume = body.volume;
    if (["monthly", "quarterly", "semiannual", "annual"].includes(body.cycle)) state.cycle = body.cycle;
    if (Number.isFinite(Number(body.customPriceCents)) && Number(body.customPriceCents) >= 0) state.customPriceCents = Number(body.customPriceCents);
    if (typeof body.validUntil === "string") state.validUntil = body.validUntil.slice(0, 20);
    if (typeof body.frozen === "boolean") state.frozen = body.frozen;
    // A FAIXA de contas é autoritativa: deriva os assentos do topo da faixa via o
    // seatsMap do snapshot (faixa → nº de contas usado na fórmula de preço/custo).
    const seatsMap = (p.calc && p.calc.seatsMap) || {};
    if (typeof body.accounts === "string" && seatsMap[body.accounts] != null) {
      state.accounts = body.accounts;
      state.seats = Number(seatsMap[body.accounts]);
    }
    const updated = await repo.update("proposals", p.id, { state });
```

- [ ] **Step 4: Rodar e ver passar (e a suíte inteira de propostas)**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager/packages/api" && npm test -- --test-name-pattern="proposals|faixa de contas|dispatcher|PATCH"
```
Expected: PASS — o novo teste + o PATCH antigo (`seats: 9`) continuam verdes.

- [ ] **Step 5: Commit (local)**

```bash
git add packages/api/src/routes.proposals.js packages/api/test/routes.proposals.test.js
git commit -m "feat(proposta): PATCH aceita faixa de contas e deriva seats do topo"
```

---

## Task 4: Preview do template mostra a faixa

**Files:**
- Modify: `packages/api/src/routes.proposals.js:25-32` (`previewFromTemplate`)

Sem isso, o preview (`/p/t/:id` e o iframe do builder) renderiza `{{state.accounts}}` em branco.

- [ ] **Step 1: Adicionar `accounts` ao estado de exemplo**

Edit `packages/api/src/routes.proposals.js` — em `previewFromTemplate`, substituir o objeto `state` default (linhas 25-32):

De:
```js
    state: state || {
      seats: t.calc?.plans?.[t.calc?.defaultCycle]?.included || 2,
      volume: Object.keys(t.calc?.volumeMid || {})[0] || "",
      cycle: t.calc?.defaultCycle || "monthly",
      customPriceCents: 0,
      validUntil: new Date(Date.now() + 7 * 86400_000).toLocaleDateString("pt-BR"),
      frozen: false,
    },
```
Para:
```js
    state: state || {
      accounts: Object.keys(t.calc?.seatsMap || {})[0] || "",
      seats: Number((t.calc?.seatsMap || {})[Object.keys(t.calc?.seatsMap || {})[0]]) || t.calc?.plans?.[t.calc?.defaultCycle]?.included || 2,
      volume: Object.keys(t.calc?.volumeMid || {})[0] || "",
      cycle: t.calc?.defaultCycle || "monthly",
      customPriceCents: 0,
      validUntil: new Date(Date.now() + 7 * 86400_000).toLocaleDateString("pt-BR"),
      frozen: false,
    },
```

- [ ] **Step 2: Conferir que os testes de preview seguem verdes**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager/packages/api" && npm test -- --test-name-pattern="preview|/p/t/"
```
Expected: PASS (html com `__PROPOSAL__`, `Proposta LeverAds`, `Empresa Exemplo`, `Preview do template`).

- [ ] **Step 3: Commit (local)**

```bash
git add packages/api/src/routes.proposals.js
git commit -m "feat(proposta): preview do template inclui a faixa de contas no estado"
```

---

## Task 5: Renderer — exibir a faixa em qualquer lugar da página

**Files:**
- Modify: `packages/api/src/proposal-page.js` — interpolação (`fmt` + builder `custom`) e declarações de topo.

`{{answers.<seatsKey>}}` e `{{answers.<volumeKey>}}` passam a virar spans dinâmicos (`state.accounts`/`state.volume`) — assim o hero/card mostram a faixa e ficam clicáveis no modo closer. Centraliza num helper `interpPath` usado pelos dois pontos de interpolação.

- [ ] **Step 1: Declarar `EDIT_FIELD` e `afterEdit` no topo do script**

Edit `packages/api/src/proposal-page.js` — logo após a linha `var root = document.getElementById('root');` (linha 386), inserir:
```js
  // Hook que a grade de planos chama pra auto-salvar no modo closer (setado por
  // mountInlineEdit; null fora do modo edição).
  var afterEdit = null;
  // Spans data-fill que viram clicáveis no modo closer → campo editável.
  var EDIT_FIELD = {
    'state.accounts': 'accounts', 'calc.assentos': 'accounts',
    'state.volume': 'volume', 'calc.volume': 'volume',
    'calc.preco': 'price', 'state.validUntil': 'valid',
    'calc.plano': 'cycle', 'calc.ciclo': 'cycle'
  };
```

- [ ] **Step 2: Adicionar o helper `interpPath` (antes de `fmt`)**

Edit `packages/api/src/proposal-page.js` — logo antes de `// Interpolação: {{calc.x}}...` (a função `fmt`, linha ~459), inserir:
```js
  // Resolve um caminho de interpolação. calc./state. viram spans dinâmicos; uma
  // resposta que mapeia o campo editável de contas/volume também vira span de
  // estado (faixa) — assim "X contas" aparece e é clicável onde quer que esteja.
  function interpPath(path) {
    if (path.indexOf('calc.') === 0 || path.indexOf('state.') === 0) return '<span data-fill="' + path + '"></span>';
    if (CALC.seatsKey && path === 'answers.' + CALC.seatsKey) return '<span data-fill="state.accounts"></span>';
    if (CALC.volumeKey && path === 'answers.' + CALC.volumeKey) return '<span data-fill="state.volume"></span>';
    return esc(String(getPath(DATA, path)));
  }
```

- [ ] **Step 3: `fmt` usa `interpPath`**

Edit `packages/api/src/proposal-page.js` — substituir a função `fmt` (linhas ~461-471):

De:
```js
  function fmt(s) {
    var out = esc(s);
    out = out.replace(/\\{\\{\\s*([a-zA-Z0-9_.]+)\\s*\\}\\}/g, function (_, path) {
      if (path.indexOf('calc.') === 0 || path.indexOf('state.') === 0) {
        return '<span data-fill="' + path + '"></span>';
      }
      return esc(String(getPath(DATA, path)));
    });
    out = out.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
    return out;
  }
```
Para:
```js
  function fmt(s) {
    var out = esc(s);
    out = out.replace(/\\{\\{\\s*([a-zA-Z0-9_.]+)\\s*\\}\\}/g, function (_, path) { return interpPath(path); });
    out = out.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
    return out;
  }
```

- [ ] **Step 4: O builder `custom` também usa `interpPath`**

Edit `packages/api/src/proposal-page.js` — no builder `custom` (linhas ~755-760), substituir:

De:
```js
      var raw = String(s.html || '');
      raw = raw.replace(/\\{\\{\\s*([a-zA-Z0-9_.]+)\\s*\\}\\}/g, function (_, path) {
        if (path.indexOf('calc.') === 0 || path.indexOf('state.') === 0) return '<span data-fill="' + path + '"></span>';
        return esc(String(getPath(DATA, path)));
      });
      holder.innerHTML = raw;
```
Para:
```js
      var raw = String(s.html || '');
      raw = raw.replace(/\\{\\{\\s*([a-zA-Z0-9_.]+)\\s*\\}\\}/g, function (_, path) { return interpPath(path); });
      holder.innerHTML = raw;
```

- [ ] **Step 5: Conferir que a página ainda renderiza nos testes**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager/packages/api" && npm test -- --test-name-pattern="GET /p/|preview|/p/t/"
```
Expected: PASS (os testes batem `__PROPOSAL__`, `"editable":false/true`, `Empresa Exemplo`).

- [ ] **Step 6: Commit (local)**

```bash
git add packages/api/src/proposal-page.js
git commit -m "feat(proposta): interpolação liga answers de contas/volume ao estado (faixa)"
```

---

## Task 6: Renderer — edição inline substitui o painel flutuante

**Files:**
- Modify: `packages/api/src/proposal-page.js` — CSS (bloco do painel + print), `renderPlanOptions` (auto-save), `mountEditor` → `mountInlineEdit`, call site.

- [ ] **Step 1: Trocar o CSS do painel pelo CSS de edição inline**

Edit `packages/api/src/proposal-page.js` — substituir o bloco inteiro do painel (linhas 330-346, de `/* Painel do closer (modo edição via ?k=token) */` até `body.editing { padding-top: 30px; }`):

De:
```css
  /* Painel do closer (modo edição via ?k=token) */
  .closer-panel { position: fixed; right: 18px; bottom: 18px; z-index: 80; width: 300px; max-width: calc(100vw - 36px);
    background: color-mix(in oklab, var(--bg) 92%, var(--fg)); border: 1px solid var(--accent-line); border-radius: var(--radius);
    box-shadow: 0 16px 40px rgba(0,0,0,.45); padding: 18px; color: var(--fg); }
  .closer-panel h4 { font-family: var(--font-mono); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }
  .cp-min { cursor: pointer; color: var(--ink-3); font-size: 14px; }
  .cp-field { margin-bottom: 12px; }
  .cp-field label { display: block; font-family: var(--font-mono); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 5px; }
  .cp-field input, .cp-field select { width: 100%; padding: 9px 11px; background: var(--bg); border: 1px solid var(--line); border-radius: calc(var(--radius) - 6px); color: var(--fg); font-size: 14px; font-family: var(--font-display); }
  .cp-field input:focus, .cp-field select:focus { outline: none; border-color: var(--accent); box-shadow: var(--glow); }
  .cp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .cp-save { width: 100%; margin-top: 6px; padding: 11px; background: var(--accent); color: var(--accent-fg); border-radius: calc(var(--radius) - 6px); font-weight: 700; font-size: 14px; }
  .cp-save:disabled { opacity: .5; cursor: default; }
  .cp-status { margin-top: 8px; font-size: 12px; color: var(--accent); min-height: 16px; text-align: center; }
  .cp-toggle { position: fixed; right: 18px; bottom: 18px; z-index: 79; background: var(--accent); color: var(--accent-fg); border-radius: var(--r-full); padding: 11px 16px; font-weight: 700; font-size: 13px; box-shadow: 0 10px 30px rgba(0,0,0,.4); display: none; }
  .edit-banner { position: fixed; top: 0; left: 0; right: 0; z-index: 81; background: var(--accent-soft); border-bottom: 1px solid var(--accent-line); color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; text-align: center; padding: 7px; }
  body.editing { padding-top: 30px; }
```
Para:
```css
  /* Edição inline (modo closer via ?k=token) + banner de preview reaproveitam estas duas regras */
  .edit-banner { position: fixed; top: 0; left: 0; right: 0; z-index: 81; background: var(--accent-soft); border-bottom: 1px solid var(--accent-line); color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; text-align: center; padding: 7px; }
  body.editing { padding-top: 30px; }
  /* Valor editável: parece texto normal; afford discreta só no hover (modo closer) */
  .pe { cursor: pointer; border-bottom: 1px dashed var(--accent-line); border-radius: 3px; transition: background .12s var(--ease-out); }
  .pe:hover { background: var(--accent-soft); }
  .pe::after { content: '✎'; font-size: .62em; opacity: .55; margin-left: 3px; vertical-align: super; }
  .edit-pop { position: absolute; z-index: 90; background: color-mix(in oklab, var(--bg) 92%, var(--fg)); border: 1px solid var(--accent-line); border-radius: var(--radius); box-shadow: 0 14px 36px rgba(0,0,0,.45); padding: 10px; }
  .edit-pop select, .edit-pop input { padding: 9px 11px; background: var(--bg); border: 1px solid var(--line); border-radius: calc(var(--radius) - 6px); color: var(--fg); font-family: var(--font-display); font-size: 15px; min-width: 140px; }
  .edit-pop select:focus, .edit-pop input:focus { outline: none; border-color: var(--accent); box-shadow: var(--glow); }
  .save-tag { position: fixed; right: 16px; bottom: 16px; z-index: 95; padding: 8px 14px; border-radius: var(--r-full); background: color-mix(in oklab, var(--bg) 88%, var(--fg)); border: 1px solid var(--accent-line); color: var(--accent); font-family: var(--font-mono); font-size: 12px; opacity: 0; transform: translateY(8px); transition: opacity .2s, transform .2s; pointer-events: none; }
  .save-tag.show { opacity: 1; transform: translateY(0); }
  .save-tag.err { color: var(--error); border-color: var(--error); }
```

- [ ] **Step 2: Ajustar o CSS de print (some popover/tag; neutraliza afford)**

Edit `packages/api/src/proposal-page.js` — no bloco `@media print` (linha ~349), substituir:

De:
```css
    .nav, .closer-panel, .cp-toggle, .edit-banner, .accept-row, .slide-media video { display: none !important; }
    body { background: #fff; color: #000; padding-top: 0; }
```
Para:
```css
    .nav, .edit-pop, .save-tag, .edit-banner, .accept-row, .slide-media video { display: none !important; }
    .pe { border-bottom: 0 !important; }
    .pe::after { content: none !important; }
    body { background: #fff; color: #000; padding-top: 0; }
```

- [ ] **Step 3: A grade de planos auto-salva no modo closer**

Edit `packages/api/src/proposal-page.js` — em `renderPlanOptions`, no handler de clique do card de ciclo (linhas ~506-512), substituir:

De:
```js
      box.querySelectorAll('[data-cycle]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (state.cycle === btn.getAttribute('data-cycle')) return;
          state.cycle = btn.getAttribute('data-cycle');
          fillDynamic();
        });
      });
```
Para:
```js
      box.querySelectorAll('[data-cycle]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (state.cycle === btn.getAttribute('data-cycle')) return;
          state.cycle = btn.getAttribute('data-cycle');
          fillDynamic();
          if (afterEdit) afterEdit();
        });
      });
```

- [ ] **Step 4: Substituir `mountEditor` por `mountInlineEdit`**

Edit `packages/api/src/proposal-page.js` — substituir a função inteira `mountEditor` (do comentário `// ── Painel do closer (modo edição) ...` na linha ~814 até o `}` de fechamento na linha ~879) por:
```js
  // ── Edição inline (modo closer via ?k) ────────────────────────────────────
  // Sem painel: o closer clica direto no número (contas/volume/ciclo/preço/
  // validade), escolhe no popover e a página recalcula + auto-salva (PATCH).
  function mountInlineEdit() {
    var token = new URLSearchParams(location.search).get('k') || '';
    document.body.classList.add('editing');
    document.body.appendChild(el('div', 'edit-banner', '✏️ Modo closer · clique nos números p/ ajustar · salva sozinho'));

    var tag = el('div', 'save-tag', '');
    document.body.appendChild(tag);
    var saveTimer = null;
    function flash(text, cls) { tag.textContent = text; tag.className = 'save-tag show' + (cls ? ' ' + cls : ''); }
    function doSave() {
      flash('salvando…', '');
      fetch('/public/proposals/' + encodeURIComponent(P.id), {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ k: token, accounts: state.accounts, volume: state.volume, cycle: state.cycle, customPriceCents: state.customPriceCents, validUntil: state.validUntil, frozen: true })
      }).then(function (r) { if (!r.ok) throw new Error('falha'); return r.json(); })
        .then(function () { flash('salvo ✓', 'ok'); setTimeout(function () { tag.className = 'save-tag'; }, 1600); })
        .catch(function () { flash('✕ erro ao salvar', 'err'); });
    }
    function scheduleSave() {
      state.frozen = true;
      if (saveTimer) clearTimeout(saveTimer);
      flash('salvando…', '');
      saveTimer = setTimeout(doSave, 600);
    }
    afterEdit = scheduleSave; // grade de planos também salva

    // Monta o controle do campo, ligado ao state; chama done() a cada alteração.
    function control(field, done) {
      var ctl, k, o, dp, vp;
      if (field === 'accounts') {
        ctl = document.createElement('select');
        for (k in (CALC.seatsMap || {})) { o = document.createElement('option'); o.value = k; o.textContent = k + ' contas'; if (k === state.accounts) o.selected = true; ctl.appendChild(o); }
        ctl.addEventListener('change', function () { state.accounts = ctl.value; state.seats = Number((CALC.seatsMap || {})[ctl.value]) || state.seats; done(); });
      } else if (field === 'volume') {
        ctl = document.createElement('select');
        for (k in (CALC.volumeMid || {})) { o = document.createElement('option'); o.value = k; o.textContent = k; if (k === state.volume) o.selected = true; ctl.appendChild(o); }
        ctl.addEventListener('change', function () { state.volume = ctl.value; done(); });
      } else if (field === 'cycle') {
        ctl = document.createElement('select');
        CYCLE_ORDER.forEach(function (c) { if (!(CALC.plans || {})[c]) return; o = document.createElement('option'); o.value = c; o.textContent = CYCLE_NAME[c]; if (c === state.cycle) o.selected = true; ctl.appendChild(o); });
        ctl.addEventListener('change', function () { state.cycle = ctl.value; done(); });
      } else if (field === 'price') {
        ctl = document.createElement('input'); ctl.type = 'number'; ctl.min = '0'; ctl.step = '1'; ctl.placeholder = 'auto';
        ctl.value = state.customPriceCents ? Math.round(state.customPriceCents / 100) : '';
        ctl.addEventListener('input', function () { var v = parseInt(ctl.value, 10); state.customPriceCents = v > 0 ? v * 100 : 0; done(); });
      } else if (field === 'valid') {
        ctl = document.createElement('input'); ctl.type = 'date';
        if (state.validUntil && /^\\d{2}\\/\\d{2}\\/\\d{4}$/.test(state.validUntil)) { dp = state.validUntil.split('/'); ctl.value = dp[2] + '-' + dp[1] + '-' + dp[0]; }
        ctl.addEventListener('change', function () { if (ctl.value) { vp = ctl.value.split('-'); state.validUntil = vp[2] + '/' + vp[1] + '/' + vp[0]; done(); } });
      }
      return ctl;
    }

    var pop = null;
    function closePop() { if (pop) { pop.remove(); pop = null; } }
    function openPop(span, field) {
      closePop();
      var ctl = control(field, function () { fillDynamic(); scheduleSave(); });
      if (!ctl) return;
      pop = el('div', 'edit-pop');
      pop.appendChild(ctl);
      document.body.appendChild(pop);
      var r = span.getBoundingClientRect();
      pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
      pop.style.left = (window.scrollX + Math.min(r.left, window.innerWidth - 200)) + 'px';
      if (ctl.focus) ctl.focus();
    }
    document.addEventListener('click', function (e) {
      if (pop && !pop.contains(e.target) && !(e.target.classList && e.target.classList.contains('pe'))) closePop();
    });

    document.querySelectorAll('[data-fill]').forEach(function (span) {
      var field = EDIT_FIELD[span.getAttribute('data-fill')];
      if (!field || span.classList.contains('pe')) return;
      span.classList.add('pe');
      span.addEventListener('click', function (e) { e.stopPropagation(); openPop(span, field); });
    });
  }
```

- [ ] **Step 5: Atualizar o call site**

Edit `packages/api/src/proposal-page.js` — perto do fim do script (linha ~911):

De:
```js
  if (P.editable) mountEditor();
```
Para:
```js
  if (P.editable) mountInlineEdit();
```

- [ ] **Step 6: Conferir que não sobrou referência ao painel antigo**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager/packages/api" && grep -n "mountEditor\|closer-panel\|cp-save\|cp-field\|cp-toggle\|cp-status" src/proposal-page.js || echo "OK — nada do painel antigo"
```
Expected: `OK — nada do painel antigo`

- [ ] **Step 7: Conferir que os testes de render seguem verdes**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager/packages/api" && npm test
```
Expected: toda a suíte PASS (nenhum teste dependia do painel; render e PATCH cobertos).

- [ ] **Step 8: Commit (local)**

```bash
git add packages/api/src/proposal-page.js
git commit -m "feat(proposta): edição inline (clica-no-número, auto-save) substitui painel do closer"
```

---

## Task 7: Rótulo do editor de seatsMap no builder

**Files:**
- Modify: `packages/web/src/screens/proposals.jsx:507`

- [ ] **Step 1: Deixar claro que o valor é o topo da faixa**

Edit `packages/web/src/screens/proposals.jsx` — linha 507:

De:
```jsx
        <MapEditor label="Resposta de contas → nº de contas (seatsMap)" map={calc.seatsMap || {}} onChange={(m) => set("seatsMap", m)} />
```
Para:
```jsx
        <MapEditor label="Faixa de contas → nº de contas na fórmula (topo da faixa)" map={calc.seatsMap || {}} onChange={(m) => set("seatsMap", m)} />
```

- [ ] **Step 2: Commit (local)**

```bash
git add packages/web/src/screens/proposals.jsx
git commit -m "docs(proposta): rótulo do seatsMap deixa claro que é o topo da faixa"
```

---

## Task 8: Verificação manual no browser (dev)

> Sem infra de teste de front; este passo é manual. Usa o DB compartilhado, então
> cria/usa um lead de teste e remove no fim para não sujar o funil real.
>
> **Dependência de ordem:** os Steps 2 (builder) e 4 (inline edit) podem rodar já.
> O **Step 3** (lead novo → `accounts`) só funciona **depois** da chave do form ter
> sido renomeada — execute a Task 9 (ou ao menos o Step 1+3 dela) antes do Step 3.
> Os Steps 1-2 da Task 9 (form rename, seatsMap, backfill de leads/propostas) são
> seguros pré-deploy; a troca do slide pra `{{state.accounts}}` é o único item que
> degrada o renderer velho — por isso a Task 9 inteira só vai pra prod junto/depois
> do deploy.

- [ ] **Step 1: Subir dev**

Run (deixar rodando):
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager" && npm run dev
```
Expected: API em :8787, SPA em :5173.

- [ ] **Step 2: Builder — chave não dribla mais**

No SPA (http://localhost:5173) → Forms → abrir `fo_diagnostico_leverads` → editar o RÓTULO da pergunta de contas (ex. acrescentar "?"). Conferir que o campo **chave continua `accounts`** (não vira slug). Adicionar uma pergunta NOVA e digitar o rótulo → a chave auto-preenche enquanto digita. Não salvar (ou desfazer).

- [ ] **Step 3: Novo lead pega a faixa e a proposta calcula certo**

Enviar o form publicado (http://localhost:5173/f/fo_diagnostico_leverads), escolhendo **3-5 contas**. Depois, no DB, conferir o lead novo: `accounts === "3-5"`; a proposta gerada: `state.accounts === "3-5"`, `state.seats === 5` (topo, após Task E rodar — antes de E o seatsMap velho dá 4). Guardar o `id`/`editKey` da proposta.

Run (lê o último lead/proposta do form; ajuste o caminho do `.env`):
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager" && node -e '
const fs=require("fs"),pg=require("pg");
const env=Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const u=new URL(env.COCKPIT_DB_URL);u.searchParams.delete("sslmode");u.searchParams.delete("ssl");
const c=new pg.Client({connectionString:u.toString(),ssl:{rejectUnauthorized:false}});
(async()=>{await c.connect();
const l=(await c.query("select json from cockpit.leads where json->>\x27form\x27=\x27fo_diagnostico_leverads\x27 order by updated_at desc limit 1")).rows[0].json;
console.log("lead.accounts=",JSON.stringify(l.accounts),"proposta=",l.proposta_id);
if(l.proposta_id){const p=(await c.query("select json from cockpit.proposals where id=$1",[l.proposta_id])).rows[0].json;console.log("state.accounts=",JSON.stringify(p.state.accounts),"state.seats=",p.state.seats,"editKey=",p.editKey);}
await c.end();})();'
```
Expected: imprime `lead.accounts="3-5"`, `state.accounts="3-5"` e o `editKey`.

- [ ] **Step 4: Edição inline no modo closer**

Abrir `http://localhost:5173/p/<proposta_id>?k=<editKey>`. Conferir:
- banner "Modo closer" no topo; números de contas/preço/etc com sublinhado pontilhado + ✎ no hover.
- clicar em "3-5 contas" → dropdown das faixas → escolher "6-10" → o preço/ROI recalculam ao vivo e aparece "salvo ✓".
- clicar no preço → digitar valor → recalcula; clicar no ciclo/validade/volume → idem.
- abrir `http://localhost:5173/p/<proposta_id>` (SEM `?k`) → mostra os valores salvos, **texto normal, sem afford**.

- [ ] **Step 5: Limpar o lead de teste**

Run (apaga o lead de teste e a proposta dele; confirme o id impreso no Step 3):
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager" && node -e '
const fs=require("fs"),pg=require("pg");const ID=process.argv[1];
const env=Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const u=new URL(env.COCKPIT_DB_URL);u.searchParams.delete("sslmode");u.searchParams.delete("ssl");
const c=new pg.Client({connectionString:u.toString(),ssl:{rejectUnauthorized:false}});
(async()=>{await c.connect();
const l=(await c.query("select json from cockpit.leads where json->>\x27form\x27=\x27fo_diagnostico_leverads\x27 order by updated_at desc limit 1")).rows[0].json;
if(l.proposta_id) await c.query("delete from cockpit.proposals where id=$1",[l.proposta_id]);
await c.query("delete from cockpit.form_submissions where json->>\x27lead\x27=$1",[l.id]);
await c.query("delete from cockpit.leads where id=$1",[l.id]);
console.log("removido lead",l.id,"e proposta",l.proposta_id);
await c.end();})();'
```
Expected: imprime o lead/proposta removidos.

---

## Task 9: Migração de dados (rodar SÓ depois do deploy)

**Files:**
- Create: `packages/api/scripts/2026-06-22-fix-accounts-key.mjs`

> **Pré-requisito:** o código (Tasks 1-7) tem que estar **no ar em prod** antes de
> rodar — a migração troca o slide de preço pra `{{state.accounts}}` e o seatsMap
> pros topos; com o renderer velho isso degrada a página. Idempotente: rodar de
> novo é no-op.

- [ ] **Step 1: Escrever o script de migração**

Create `packages/api/scripts/2026-06-22-fix-accounts-key.mjs`:
```js
// Migração única (2026-06-22). Conserta a chave de contas que driftou no form
// builder (slug do rótulo -> accounts), reconfigura o template pt_leverads pro
// modelo de FAIXA + preço por topo, e faz backfill dos leads/propostas já
// capturados. Idempotente. Roda da RAIZ do repo: lê .env e escreve no DB
// compartilhado (= prod). Uso: node packages/api/scripts/2026-06-22-fix-accounts-key.mjs
import fs from "node:fs";
import pg from "pg";

const OLD = "quantas_contas_de_marketplace_voce_opera";
const NEW = "accounts";
const FORM = "fo_diagnostico_leverads";
const TPL = "pt_leverads";
const TOPS = { "1": 1, "2": 2, "3-5": 5, "6-10": 10, "10+": 10 };

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const url = new URL(env.COCKPIT_DB_URL);
url.searchParams.delete("sslmode");
url.searchParams.delete("ssl");
const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

const get = async (t, id) => (await client.query('select json from cockpit."' + t + '" where id=$1', [id])).rows[0]?.json || null;
const put = async (t, id, json) => client.query('update cockpit."' + t + '" set json=$1::jsonb, updated_at=now() where id=$2', [JSON.stringify(json), id]);

async function main() {
  await client.connect();
  const log = [];

  // 1) form: renomeia a chave da pergunta de contas
  const form = await get("forms", FORM);
  if (form) {
    let changed = false;
    for (const q of (form.questions || [])) { if (q.key === OLD) { q.key = NEW; changed = true; } }
    if (changed) { await put("forms", FORM, form); }
    log.push("form: " + (changed ? OLD + " -> " + NEW : "já ok"));
  } else { log.push("form: não encontrado"); }

  // 2) template: seatsMap = topos + slide de preço usa {{state.accounts}}
  const tpl = await get("proposal_templates", TPL);
  if (tpl) {
    tpl.calc = tpl.calc || {};
    tpl.calc.seatsMap = { ...TOPS };
    for (const s of (tpl.slides || [])) {
      if (typeof s.sub === "string") s.sub = s.sub.replace(/\{\{\s*state\.seats\s*\}\}/g, "{{state.accounts}}");
    }
    await put("proposal_templates", TPL, tpl);
    log.push("template: seatsMap=topos + sub usa state.accounts");
  } else { log.push("template: não encontrado"); }

  // 3) leads: accounts <- valor antigo; remove a chave antiga
  const leads = (await client.query("select json from cockpit.leads where json->>'form'=$1", [FORM])).rows.map((r) => r.json);
  let nLead = 0;
  for (const lead of leads) {
    if (lead[OLD] == null) continue;
    if (lead[NEW] == null) lead[NEW] = lead[OLD];
    delete lead[OLD];
    await put("leads", lead.id, lead);
    nLead++;
  }
  log.push("leads backfill: " + nLead);

  // 4) propostas do template: conserta answers e (se não-frozen) recalcula state
  const props = (await client.query("select json from cockpit.proposals where json->>'template'=$1", [TPL])).rows.map((r) => r.json);
  let nProp = 0;
  for (const p of props) {
    const ans = (p.data && p.data.answers) || {};
    const val = ans[NEW] != null ? ans[NEW] : ans[OLD];
    let changed = false;
    if (ans[OLD] != null) { if (ans[NEW] == null) ans[NEW] = ans[OLD]; delete ans[OLD]; changed = true; }
    if (!(p.state && p.state.frozen) && val != null) {
      p.state = p.state || {};
      p.state.accounts = String(val);
      if (TOPS[String(val)] != null) p.state.seats = TOPS[String(val)];
      changed = true;
    }
    if (changed) { await put("proposals", p.id, p); nProp++; }
  }
  log.push("propostas backfill: " + nProp);

  console.log(log.join("\n"));
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run de leitura (confirmar alvos antes de escrever)**

Run (só LÊ — confirma quantos leads/propostas serão tocados):
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager" && node -e '
const fs=require("fs"),pg=require("pg");
const env=Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const u=new URL(env.COCKPIT_DB_URL);u.searchParams.delete("sslmode");u.searchParams.delete("ssl");
const c=new pg.Client({connectionString:u.toString(),ssl:{rejectUnauthorized:false}});
(async()=>{await c.connect();
const L=(await c.query("select count(*) n from cockpit.leads where json ? \x27quantas_contas_de_marketplace_voce_opera\x27")).rows[0].n;
const P=(await c.query("select count(*) n from cockpit.proposals where json->>\x27template\x27=\x27pt_leverads\x27")).rows[0].n;
console.log("leads c/ chave antiga:",L,"| propostas pt_leverads:",P);await c.end();})();'
```
Expected: imprime as contagens (esperado ~8 leads).

- [ ] **Step 3: Rodar a migração**

Run (da RAIZ do repo):
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager" && node packages/api/scripts/2026-06-22-fix-accounts-key.mjs
```
Expected (algo como):
```
form: quantas_contas_de_marketplace_voce_opera -> accounts
template: seatsMap=topos + sub usa state.accounts
leads backfill: 8
propostas backfill: <n>
```

- [ ] **Step 4: Verificar o resultado**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager" && node -e '
const fs=require("fs"),pg=require("pg");
const env=Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const u=new URL(env.COCKPIT_DB_URL);u.searchParams.delete("sslmode");u.searchParams.delete("ssl");
const c=new pg.Client({connectionString:u.toString(),ssl:{rejectUnauthorized:false}});
(async()=>{await c.connect();
const bad=(await c.query("select count(*) n from cockpit.leads where json ? \x27quantas_contas_de_marketplace_voce_opera\x27")).rows[0].n;
const acc=(await c.query("select count(*) n from cockpit.leads where json->>\x27form\x27=\x27fo_diagnostico_leverads\x27 and json ? \x27accounts\x27")).rows[0].n;
const sm=(await c.query("select json->\x27calc\x27->\x27seatsMap\x27 sm from cockpit.proposal_templates where id=\x27pt_leverads\x27")).rows[0].sm;
console.log("leads ainda c/ chave antiga:",bad,"(esperado 0)");
console.log("leads do form c/ accounts:",acc);
console.log("seatsMap do template:",JSON.stringify(sm));
await c.end();})();'
```
Expected: `chave antiga: 0`, `seatsMap` = `{"1":1,"2":2,"3-5":5,"6-10":10,"10+":10}`.

- [ ] **Step 5: Commit (local) do script**

```bash
git add packages/api/scripts/2026-06-22-fix-accounts-key.mjs
git commit -m "chore(migração): conserta chave de contas + faixa/topo no pt_leverads (one-off)"
```

---

## Task 10: Verificação final

- [ ] **Step 1: Suíte completa da API verde**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager/packages/api" && npm test
```
Expected: tudo PASS, incluindo os 2 asserts novos (`state.accounts` na geração e no PATCH).

- [ ] **Step 2: Build do SPA**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager" && npm run build
```
Expected: build sem erro.

- [ ] **Step 3: Revisar o diff inteiro**

Run:
```bash
cd "/Volumes/SSD Eryk/SAAS MANAGER/saas-manager" && git log --oneline main..HEAD && git diff --stat main..HEAD
```
Expected: commits das Tasks 1-9; arquivos esperados tocados (forms.jsx, proposal.js, routes.proposals.js, proposal-page.js, proposals.jsx, test, script).

- [ ] **Step 4: Deploy (decisão do dono)**

Não dar `git push` sem o dono aprovar (push em `main` = auto-deploy em prod). Quando aprovado: push → esperar o build do Easypanel (~4-5 min) → **só então** rodar a Task 9 (migração) contra o DB de prod.

---

## Self-Review (preenchido na escrita do plano)

**Cobertura da spec:**
- 1.1 builder key-lock → Task 1. 1.2 renomear chave → Task 9 (script). 1.3 backfill → Task 9.
- 2 faixa+topo: `state.accounts`/seats derivado → Tasks 2,3; renderer exibe faixa → Task 5; inline edit + sem painel + auto-save → Task 6; preview → Task 4; seatsMap topos + slide sub → Task 9; builder label → Task 7.
- Verificação (metas da spec) → Tasks 8,10.

**Sem placeholders:** todo step tem código/comando exatos.

**Consistência de tipos/nomes:** `state.accounts` (string faixa) e `state.seats` (int) usados igual em proposal.js, routes.proposals.js, proposal-page.js; `EDIT_FIELD`/`afterEdit`/`interpPath`/`mountInlineEdit`/`scheduleSave` referenciados de forma consistente dentro de proposal-page.js; `calc.seatsMap` (faixa→topo) idêntico em initialState, PATCH, renderer e migração.
