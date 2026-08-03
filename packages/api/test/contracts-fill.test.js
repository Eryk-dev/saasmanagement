// Migração dos modelos de contrato pro preenchimento na tela: os espaços em
// branco (______) viram tokens {{chave}} e o doc ganha `fields`. O replace é
// tolerante a tamanho de linha em branco e a whitespace — o corpo vive no banco
// e pode ter sido reformatado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateContractFillTokens } from "../src/migrations.js";

// Trechos REAIS do corpo do co_consultoria_logistica (como inserido em prod),
// com contagens de underscore variadas de propósito.
const BODY = `<table class="quadro">
  <tr>
    <th>Contratante</th>
    <td>
      Razão social / Nome: ______________________________________________<br>
      CNPJ / CPF: ____________________<br>
      Endereço da operação (local das visitas): ______________________________________________<br>
      Representante legal: ______________________________________________<br>
      E-mail: ______________________________ &nbsp; WhatsApp: ______________________________
    </td>
  </tr>
  <tr>
    <th>Investimento</th>
    <td>
      Valor total: R$ ______________ ( ______________________________________________ )<br>
      Forma de pagamento: &nbsp; ☐ PIX à vista &nbsp;&nbsp; ☐ Cartão de crédito em ____x de R$ ______________ &nbsp;&nbsp; ☐ Boleto faturado em ____x de R$ ______________<br>
      Vencimento(s): ______________________________________________
    </td>
  </tr>
  <tr>
    <th>Despesas de deslocamento</th>
    <td>☐ Incluídas no valor total &nbsp;&nbsp; ☐ Por conta do CONTRATANTE, mediante reembolso comprovado (deslocamento, hospedagem e alimentação da equipe da LEVER)</td>
  </tr>
  <tr>
    <th>Prazo estimado</th>
    <td>Conclusão do escopo em ______ dias corridos (estimativa de referência: 45 a 90 dias), contados na forma da Cláusula 8ª.</td>
  </tr>
</table>
<p class="local-data">____________________________, ______ de ______________________ de 20______.</p>`;

function makeRepo(docs) {
  const store = new Map(docs.map((d) => [d.id, { ...d }]));
  return {
    get: async (_c, id) => store.get(id) || null,
    update: async (_c, id, patch) => {
      const next = { ...store.get(id), ...patch };
      store.set(id, next);
      return next;
    },
    _store: store,
  };
}

test("contratos: brancos viram tokens e fields só traz campo presente no corpo", async () => {
  const repo = makeRepo([{ id: "co_consultoria_logistica", saas: "leverads", body: BODY }]);
  const n = await migrateContractFillTokens(repo);
  assert.equal(n, 1);
  const c = repo._store.get("co_consultoria_logistica");
  for (const tk of ["razao_social", "cnpj_cpf", "endereco", "representante", "email", "whatsapp", "valor_total", "valor_extenso", "forma_pagamento", "vencimentos", "despesas", "prazo_dias", "local_data"]) {
    assert.ok(c.body.includes(`{{${tk}}}`), `token {{${tk}}} ausente`);
  }
  // Nenhuma linha em branco de preenchimento sobra no corpo migrado (as linhas
  // de assinatura não entram neste trecho).
  assert.ok(!/_{4,}/.test(c.body), "sobrou linha em branco não tokenizada");
  const keys = c.fields.map((f) => f.key);
  assert.ok(keys.includes("despesas") && keys.includes("prazo_dias"));
  // Este modelo não tem os campos exclusivos dos outros (plano, contas etc.).
  assert.ok(!keys.includes("plano") && !keys.includes("contas_ml"));
});

test("contratos: migração é idempotente e não mexe em corpo editado sem os padrões", async () => {
  const repo = makeRepo([{ id: "co_consultoria_logistica", saas: "leverads", body: BODY }]);
  await migrateContractFillTokens(repo);
  assert.equal(await migrateContractFillTokens(repo), 0); // 2ª volta: nada a fazer

  const custom = makeRepo([{ id: "co_leverwms", saas: "leverads", body: "<h1>Corpo reescrito pelo time</h1>" }]);
  assert.equal(await migrateContractFillTokens(custom), 0);
  assert.equal(custom._store.get("co_leverwms").fields, undefined); // sem token, sem formulário
});
