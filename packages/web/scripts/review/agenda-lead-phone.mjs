import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';

// Card aberto pela Agenda: o telefone do cliente aparece ao lado do nome, sem
// borda e centrado no nome (com ou sem selo de nota), e um clique
// copia o número formatado (sem diálogo nativo); lead sem telefone não mostra
// o botão. Desktop, celular e tema escuro.
const h = await reviewHarness('agenda', 'Agenda', async () => {});
const card = (p, name) => p.locator(`.agenda-day-col [role=button][title*="${name}"]`).first();
const drawer = (p, name) => p.getByRole('dialog', { name: `Lead · ${name}`, exact: true });
// Centro óptico (meio da altura da maiúscula/dígito) do texto do nome e do
// telefone: o que o olho compara, não a caixa de cada um.
const centers = (p) => p.evaluate(() => {
  const mid = (el, sample) => {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    const r = document.createRange(); r.selectNodeContents(node);
    const box = r.getBoundingClientRect(), cs = getComputedStyle(el);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = c.measureText(sample);
    const base = box.top + (box.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    return base - m.actualBoundingBoxAscent / 2;
  };
  return [mid(document.querySelector('.lead-panel-title'), 'H'), mid(document.querySelector('.lead-panel-phone .tnum'), '0')];
});

try {
  for (const [width, q] of [[1440, ''], [390, ''], [1440, '&theme=dark']]) {
    const p = await h.open(width, q);
    p.on('dialog', (d) => { h.errors.push(`diálogo nativo: ${d.message()}`); d.dismiss(); });
    await card(p, 'Caio Menezes').click();
    const d = drawer(p, 'Caio Menezes');
    const phone = d.getByRole('button', { name: 'Copiar telefone +55 (11) 98765-4321', exact: true });
    await phone.waitFor();
    // Ao lado do nome (mesma linha no desktop), acima da empresa e sem borda.
    const title = await d.locator('.lead-panel-title').boundingBox();
    const btn = await phone.boundingBox();
    const sub = await d.locator('.lead-panel-subtitle').boundingBox();
    assert.ok(btn.y + btn.height <= sub.y + 1, 'telefone acima da empresa');
    if (width === 1440) {
      assert.ok(btn.x >= title.x + title.width, 'telefone à direita do nome');
      // Centrados: o meio das letras do nome e o dos dígitos na mesma altura.
      const [nameMid, phoneMid] = await centers(p);
      await d.locator('.lead-panel-title-row').screenshot({ path: `${h.output}/lead-phone-head.png` });
      assert.ok(Math.abs(nameMid - phoneMid) <= 0.6, `telefone centrado no nome (${nameMid} vs ${phoneMid})`);
    }
    assert.ok(btn.x >= 0 && btn.x + btn.width <= width, 'telefone dentro da tela');
    const style = await phone.evaluate((el) => { const c = getComputedStyle(el); return [c.borderTopWidth, c.boxShadow]; });
    assert.deepEqual(style, ['0px', 'none'], 'telefone sem borda');
    assert.equal(await phone.evaluate((el) => getComputedStyle(el).cursor), 'pointer', 'cursor de link');
    await phone.click();
    await d.getByText('copiado', { exact: true }).waitFor();
    await p.getByText('Telefone copiado', { exact: true }).waitFor();
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), '+55 (11) 98765-4321');
    await h.capture(p, `lead-phone-${width}${q ? '-dark' : ''}`);
    await d.getByRole('button', { name: 'Fechar lead', exact: true }).click();
    await d.waitFor({ state: 'hidden' });

    // Selo de nota legada (com "L") antes do nome: continua centrado no nome.
    // E sem telefone, sem botão.
    if (!q && width === 1440) {
      await p.locator('.agenda-day-col [draggable=true][title*="Marina Kern"]').click();
      const mk = drawer(p, 'Marina Kern');
      await mk.locator('.lead-grade-legacy').waitFor();
      const [nm, pm] = await centers(p);
      assert.ok(Math.abs(nm - pm) <= 0.6, `com selo legado, centrado (${nm} vs ${pm})`);
      await mk.locator('.lead-panel-title-row').screenshot({ path: `${h.output}/lead-phone-head-legacy.png` });
      await mk.getByRole('button', { name: 'Fechar lead', exact: true }).click();
      await mk.waitFor({ state: 'hidden' });
      await card(p, 'Helena Vitta').click();
      const hv = drawer(p, 'Helena Vitta');
      await hv.locator('.lead-panel-title').waitFor();
      assert.equal(await hv.locator('.lead-panel-phone').count(), 0);
      await hv.getByRole('button', { name: 'Fechar lead', exact: true }).click();
    }
    await p.close();
  }
  assert.deepEqual(h.errors, []);
  console.log('Agenda: telefone no topo do card, copiar com um clique (desktop, celular, escuro) e sem telefone sem botão OK.');
} finally { await h.close(); }
