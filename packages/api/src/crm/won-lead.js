import { customerPlanState, planFieldsFromDeal, recordPlanChange, stampSubscriptionPlan, syncCustomerPlanFromSub } from "../billing/plan-history.js";
import { closedInstallments, closedSubscriptionSpec, createClosedSubscription, createInstallmentSchedule, syncClosedInstallments, syncCustomerArr } from "../billing/billing.js";
import { CLOSED_PLAN_ANNUAL_FACTOR, CLOSED_PLAN_LABEL } from "../shared/plan-cycles.js";
import { DEAL_PRODUCT_LABEL } from "../proposals/proposal-catalog.js";
import { MENTORIA_LABEL } from "../customers/mentoria.js";
import { metaCapi as defaultMetaCapi } from "../marketing/meta-capi.js";
import { isPostSaleStage, isWon } from "./stages.js";
import { CREATE_DEFAULTS } from "./create-defaults.js";
import { newManual, sameFamily } from "../calls/deliverables.js";
import { logActivity } from "./lead-flow.js";

// Conversão lead → cliente: quando um lead chega no estágio de ganho (kind
// `ganho` no funil do produto; fallback por nome "Ganho"/"Closed Won" pra SaaS
// sem funil configurado), nasce o customer com `startedAt` (base dos marcos de
// pós-venda e do CAC) e o link bidirecional lead.customerId / customer.leadId.
// Idempotente: se o lead já gerou cliente, não duplica.
// Valor e plano vêm do gate de fechamento (lead.amount + lead.planClosed):
// `arr` guarda o ANUAL (a tabela mostra MRR = arr/12), então o valor do negócio
// é anualizado pelo plano fechado. Assinatura criada depois manda mais — toda
// mutação de assinatura reescreve o arr via syncCustomerArr.
// O produto do catálogo da apresentação (Lever OEM/Ads/Price × pacote,
// lead.dealProduct) entra na frente do ciclo na coluna Plano do cliente:
// "Ads Escala · Anual". Venda antiga (FULL/OEM/Parcial) segue nomeada
// pelos rótulos legados do DEAL_PRODUCT_LABEL.
// Produto Personalizado (gate de fechamento): dealProduct fora do catálogo é o
// próprio nome livre que o closer escreveu — vale como rótulo do jeito que veio.
// Fechamento com MAIS DE UM produto (Próximo passo das Atividades, 05/10/2026):
// `lead.dealItems` = [{ product, planClosed, amount }], o 1º espelhado em
// dealProduct/planClosed e `lead.amount` = a soma (é a venda inteira: meta,
// receita do closer, Purchase da Meta). Sem lista (ou com um item só), o
// fechamento é o de sempre: um item com os campos do lead.
export function dealItemsOf(lead) {
  const rows = Array.isArray(lead?.dealItems) ? lead.dealItems.filter((i) => i && (String(i.product || "").trim() || Number(i.amount) > 0)) : [];
  if (rows.length > 1) {
    return rows.map((i) => ({ dealProduct: String(i.product || "").trim(), planClosed: String(i.planClosed || ""), amount: Number(i.amount) || 0 }));
  }
  return [{ dealProduct: lead?.dealProduct || "", planClosed: lead?.planClosed || "", amount: Number(lead?.amount) || 0 }];
}

const itemLabelOf = (it) => [
  DEAL_PRODUCT_LABEL[it.dealProduct] || MENTORIA_LABEL[it.dealProduct]
    || String(it.dealProduct || "").trim(),
  CLOSED_PLAN_LABEL[it.planClosed],
].filter(Boolean).join(" · ");

const planLabelOf = (lead) => dealItemsOf(lead).map(itemLabelOf).filter(Boolean).join(" + ");

// ARR do fechamento: cada item anualizado pelo próprio plano (com um item só,
// é o amount × fator de sempre).
const closedArrOf = (lead) => Math.round(dealItemsOf(lead).reduce((sum, it) => sum + it.amount * (CLOSED_PLAN_ANNUAL_FACTOR[it.planClosed] || 1), 0));

export async function convertWonLead(repo, lead, { metaCapi = defaultMetaCapi } = {}) {
  if (!lead || !lead.saas) return null;
  const product = await repo.get("products", lead.saas);
  // Vira cliente ao FECHAR. Etapa pós-venda (entrega/CS) também dispara: com o
  // Ganho antes da Integração, arrastar direto pra entrega é fechar a venda, e
  // sem isso o lead ficaria contando receita sem cliente nem assinatura.
  if (!isWon(product, lead.stage) && !isPostSaleStage(product, lead.stage)) return null;
  const customers = await repo.list("customers");
  const existing = customers.find((c) => c.leadId === lead.id);
  if (existing) {
    // Re-fechou depois de um desfazer que PRESERVOU o cliente (billing real no
    // meio): re-vincula o lead ao cliente de sempre em vez de duplicar.
    if (lead.customerId !== existing.id || !lead.wonAt) {
      await repo.update("leads", lead.id, { customerId: existing.id, wonAt: lead.wonAt || existing.startedAt || new Date().toISOString() });
    }
    return null;
  }
  if (lead.customerId && customers.some((c) => c.id === lead.customerId)) return null;
  // CS automático: o integrador do lead (escolhido no bloco Entrega do card)
  // nasce como owner do cliente; sem ele, com UM integrador no escopo do
  // produto, é esse. É por customer.owner que o placar de CS agrupa e que a
  // régua de marcos atribui tarefa (sem owner o pós-venda não conta pra
  // ninguém). Ambíguo (0 ou 2+ e lead sem integrador) fica vazio e aparece em
  // "Sem dono" na tela de Clientes; o backfill de migrations.js usa a mesma regra.
  const csUsers = await repo.list("users").catch(() => []);
  const csCandidates = csUsers.filter((u) => (u.roles || []).includes("integrator") && (!u.saas || u.saas === lead.saas));
  const csOwner = (lead.integrator && csUsers.some((u) => u.id === lead.integrator))
    ? lead.integrator
    : (csCandidates.length === 1 ? csCandidates[0].id : "");
  // Plano contratado de forma estruturada (código do catálogo, ciclo e retrato
  // do plano na venda); o rótulo `plan` abaixo segue igual.
  const planFields = await planFieldsFromDeal(repo, lead).catch(() => null);
  const customer = await repo.create("customers", {
    ...(CREATE_DEFAULTS.customers || {}),
    name: lead.company || lead.name || "Cliente",
    contact: lead.name || "",
    saas: lead.saas,
    email: lead.email || "",
    phone: lead.phone || "",
    // Mentoria (UniqueKids): o "plano" do cliente é o PACOTE comprado.
    plan: lead.saas === "uniquekids"
      ? `Mentoria · ${Number(lead.consultPackage) === 4 ? 4 : 8} consultas`
      : (planLabelOf(lead) || ""),
    arr: closedArrOf(lead),
    leadId: lead.id,
    ...(csOwner ? { owner: csOwner } : {}),
    ...(lead.dealProduct ? { dealProduct: lead.dealProduct } : {}), // produto do catálogo (FULL/OEM/Parcial)
    ...(lead.paymentMethod ? { paymentMethod: lead.paymentMethod } : {}), // modo como fechou (PIX/boleto/cartão 12x)
    ...(planFields?.customer || {}),
    startedAt: new Date().toISOString(),
  });
  let wonSubId = "";
  // `customerId` marca QUE vendeu, `wonAt` marca QUANDO. Os dois precisam ser
  // do lead e não do card: `stageSince` é recarimbado a cada movimento, então
  // seguir pra Integração jogaria a venda pro mês da integração.
  await repo.update("leads", lead.id, { customerId: customer.id, wonAt: customer.startedAt });
  // Assinatura ativa nasce junto do cliente (plano fechado + meio de pagamento
  // → ciclo/preço; fatura inicial paga), UMA POR ITEM recorrente vendido: o
  // plano vive na assinatura e o cliente pode ter um produto em cada uma.
  // Best-effort: o cliente já existe.
  try {
    const items = dealItemsOf(lead);
    const created = [];
    const subProducts = new Set();
    for (const [i, it] of items.entries()) {
      const itemFields = i === 0 ? planFields : await planFieldsFromDeal(repo, { saas: lead.saas, ...it }).catch(() => null);
      // Uma assinatura viva por produto: o segundo plano recorrente do mesmo
      // produto não abre outra (o gate não deixa escolher; aqui só não duplica).
      const subProduct = itemFields?.subscription?.planSnapshot?.product || "";
      const spec = closedSubscriptionSpec({ ...lead, planClosed: it.planClosed, amount: it.amount });
      if (spec && subProduct && subProducts.has(subProduct)) continue;
      const sub = await createClosedSubscription(repo, {
        customerId: customer.id, saas: lead.saas,
        planClosed: it.planClosed, amount: it.amount, paymentMethod: lead.paymentMethod,
        paymentInstallments: lead.paymentInstallments, planFields: itemFields?.subscription,
      });
      if (sub) { created.push(sub); if (subProduct) subProducts.add(subProduct); }
      // Serviço único faturado em Nx: não há recorrência (spec null, arr manual),
      // mas o cronograma de parcelas existe do mesmo jeito, preso só ao cliente.
      if (!sub && closedInstallments(lead) && it.amount > 0) {
        await createInstallmentSchedule(repo, {
          customerId: customer.id, saas: lead.saas, total: it.amount,
          installments: closedInstallments(lead), startAt: customer.startedAt,
          method: lead.paymentMethod,
        });
      }
    }
    const sub = created[0] || null;
    wonSubId = sub?.id || "";
    // Recorrência AUTORIZADA no card do lead (link de assinatura do Mercado
    // Pago gerado antes do Ganho): a assinatura que acabou de nascer adota o
    // preapproval — daqui em diante a cobrança mensal dá baixa na fatura e
    // cancelar/pausar aqui vale no MP. Só quando está autorizada: recorrência
    // ainda pendente não é dinheiro, e carimbar travaria o desfazer do ganho.
    if (sub && lead.mpPreapprovalId && lead.mpPreapprovalStatus === "authorized") {
      await repo.update("subscriptions", sub.id, {
        mpPreapprovalId: lead.mpPreapprovalId,
        mpStatus: lead.mpPreapprovalStatus,
        payerEmail: lead.mpPayerEmail || lead.email || "",
        ...(lead.mpChargeUrl ? { mpInitPoint: lead.mpChargeUrl } : {}),
      });
    }
    // Mais de um produto: o cadastro lista todos e espelha a assinatura principal.
    if (items.length > 1 && created.length) await syncCustomerPlanFromSub(repo, created[created.length - 1]).catch(() => null);
  } catch { /* assinatura é best-effort */ }
  await recordPlanChange(repo, {
    type: "start", saas: lead.saas, customer: customer.id, subscription: wonSubId, lead: lead.id,
    at: customer.startedAt, from: null,
    to: customerPlanState((await repo.get("customers", customer.id)) || customer),
    listPrice: planFields?.customer.planSnapshot?.listPrice, priceVersion: planFields?.customer.planSnapshot?.priceVersion,
    amount: Number(lead.amount) || 0, source: "won", author: lead.closer || lead.owner || "",
  });
  // UniqueKids: o ganho É a compra do pacote de consultas (mentoria 1:1). A
  // jornada inteira nasce aqui SEM data (n=1..N + packageTotal); o time marca
  // cada consulta na tela Consultas, e o PATCH do `at` espelha na agenda Google
  // da responsável. O Manual da Família (que as gravações preenchem) nasce
  // junto. Idempotente: família que já tem consulta de pacote não ganha outro.
  if (lead.saas === "uniquekids") {
    try {
      const family = { customerId: customer.id, leadId: lead.id, clientName: lead.name || customer.name || "" };
      const consults = (await repo.list("consultations")).filter((c) => sameFamily(c, family));
      if (!consults.some((c) => Number(c.packageTotal) > 0)) {
        const total = Number(lead.consultPackage) === 4 ? 4 : 8;
        for (let n = 1; n <= total; n++) {
          await repo.create("consultations", {
            saas: lead.saas, customerId: customer.id, leadId: lead.id,
            clientName: family.clientName, childName: "", phone: lead.phone || "",
            n, packageTotal: total, at: "", durationMin: 60, status: "scheduled",
            notes: "", owner: lead.closer || "", meetUrl: "", meetEventId: "", meetScheduledAt: "",
            calEventId: "", calEventUser: "", summary: null, summaryDoneFor: "", summaryAt: "",
            transcriptUrl: "", createdAt: new Date().toISOString(),
          });
        }
        const manuals = await repo.list("deliverables");
        if (!manuals.some((m) => sameFamily(m, family))) {
          await repo.create("deliverables", newManual({
            saas: lead.saas, customerId: customer.id, leadId: lead.id,
            clientName: family.clientName, childName: "",
          }));
        }
      }
    } catch { /* pacote de consultas é best-effort; dá pra criar na tela */ }
  }
  try {
    await logActivity(repo, {
      saas: lead.saas, lead: lead.id, type: "system",
      meta: { event: "customer_created", customerId: customer.id },
    });
  } catch { /* timeline é best-effort */ }
  // A venda volta pra Meta (CAPI "Purchase" com o valor do negócio) — sem isso a
  // otimização para no "Lead" e o algoritmo persegue lead barato, não lead que
  // fecha. Idempotente: o guard de customer acima garante que só roda no 1º
  // ganho, e o eventId won:{id} deduplica na Meta. Lead interno (teste da
  // equipe) não suja o sinal, igual ao skip do Lead em routes.forms.js.
  if (!lead.internal) {
    try {
      await metaCapi.sendPurchase({
        eventId: `won:${lead.id}`,
        leadId: lead.id,
        email: lead.email,
        phone: lead.phone,
        fbp: lead.fbp || undefined, // cookies do Pixel persistidos no submit do
        fbc: lead.fbc || undefined, // form — melhoram o match do Purchase
        value: Number(lead.amount) || 0,
        pixelId: product?.metaPixelId,
      });
    } catch { /* best-effort — a conversão local nunca depende da Meta */ }
  }
  return customer;
}

// Fechamento EDITADO depois do ganho — o gate da Integração deixa conferir e
// ajustar plano/valor/pagamento com o cliente já criado, então o ajuste precisa
// chegar no cliente e na assinatura que NASCERAM do fechamento (senão Clientes/
// MRR ficam com o número velho). Só mexe no cliente vinculado a este lead
// (customer.leadId); assinatura presa no Mercado Pago (preapproval) ou cliente
// com 2+ assinaturas é gestão manual — não adivinha.
export async function syncWonLeadDeal(repo, lead) {
  if (!lead?.customerId) return null;
  const customer = await repo.get("customers", lead.customerId);
  if (!customer || customer.leadId !== lead.id) return null;
  const planFields = await planFieldsFromDeal(repo, lead).catch(() => null);
  // Mesmo plano e mesmo ciclo: o retrato da venda original fica (preço de
  // tabela e versão são os do dia do fechamento, não os de hoje).
  if (planFields?.customer.planSnapshot && customer.planSnapshot
    && customer.planCode === planFields.customer.planCode && (customer.planCycle || "") === planFields.customer.planCycle) {
    planFields.customer.planSnapshot = customer.planSnapshot;
    planFields.subscription.planSnapshot = customer.planSnapshot;
  }
  const patch = {
    plan: lead.saas === "uniquekids"
      ? `Mentoria · ${Number(lead.consultPackage) === 4 ? 4 : 8} consultas`
      : (planLabelOf(lead) || customer.plan || ""),
    ...(lead.dealProduct ? { dealProduct: lead.dealProduct } : {}),
    ...(lead.paymentMethod ? { paymentMethod: lead.paymentMethod } : {}),
    ...(planFields?.customer || {}),
  };
  const manualArr = () => closedArrOf(lead);
  // Fechamento com mais de um produto: as assinaturas de cada um são gestão
  // da ficha do cliente (Gerenciar cobranças); aqui só o cadastro acompanha.
  if (dealItemsOf(lead).length > 1) {
    const saved = await repo.update("customers", customer.id, patch);
    await recordPlanChange(repo, {
      type: "deal_edit", saas: lead.saas, customer: customer.id, lead: lead.id,
      from: customerPlanState(customer), to: customerPlanState(saved),
      amount: Number(lead.amount) || 0, source: "deal", author: lead.closer || lead.owner || "",
    });
    return saved;
  }
  const spec = closedSubscriptionSpec(lead);
  const subs = (await repo.list("subscriptions")).filter((s) => s.customer === customer.id && s.status !== "canceled");
  if (subs.length === 1 && !subs[0].mpPreapprovalId) {
    if (spec) {
      if (Number(subs[0].price) !== spec.price || subs[0].cycle !== spec.cycle) {
        await repo.update("subscriptions", subs[0].id, { price: spec.price, cycle: spec.cycle, pendingChange: null });
        await syncCustomerArr(repo, customer.id);
      }
    } else if (lead.planClosed === "unico") {
      // Virou serviço único DE PROPÓSITO: encerra a recorrência nascida do
      // fechamento e o valor do negócio vira o arr direto (cliente sem
      // assinatura = arr manual). Lead SEM planClosed (fechamento legado,
      // pré-gate de plano) cai fora deste ramo: cancelar a assinatura de um
      // cliente real por falta de campo seria chute — não se mexe.
      await repo.update("subscriptions", subs[0].id, { status: "canceled", canceledAt: new Date().toISOString() });
      await syncCustomerArr(repo, customer.id);
      patch.arr = manualArr();
    }
  } else if (subs.length === 0) {
    if (spec) {
      await createClosedSubscription(repo, {
        customerId: customer.id, saas: lead.saas,
        planClosed: lead.planClosed, amount: lead.amount, paymentMethod: lead.paymentMethod,
        paymentInstallments: lead.paymentInstallments, planFields: planFields?.subscription,
        startAt: lead.wonAt || customer.startedAt,
      });
    } else if (Number(lead.amount) > 0) {
      patch.arr = manualArr();
    }
  }
  // Cronograma do faturado acompanha a edição: parcela PAGA fica (dinheiro que
  // entrou); as abertas são refeitas pro valor/parcelamento novos; sem
  // parcelamento (virou à vista/cartão), as abertas somem. Faturas de renovação
  // do desenho antigo saem do caminho: abertas são removidas e a inicial
  // auto-paga (paidAt === dueDate, sem pagamento real do MP) também — renovação
  // paga de verdade fica e o valor dela desconta do cronograma. Assinatura
  // presa no MP ou cliente com 2+ assinaturas segue gestão manual.
  if (subs.length === 0 || (subs.length === 1 && !subs[0].mpPreapprovalId)) {
    try {
      const n = closedInstallments(lead);
      const subId = subs[0]?.id || "";
      let alreadyPaid = 0;
      if (n && subId) {
        for (const inv of (await repo.list("invoices")).filter((i) => i.subscription === subId && i.kind === "renewal")) {
          if (inv.status !== "paid" || (!inv.mpPaymentId && inv.paidAt === inv.dueDate)) await repo.remove("invoices", inv.id);
          else alreadyPaid += Number(inv.amount) || 0;
        }
      }
      await syncClosedInstallments(repo, {
        customerId: customer.id, saas: lead.saas, subscription: subId,
        total: Math.max(0, (Number(lead.amount) || 0) - alreadyPaid),
        installments: n, startAt: lead.wonAt || customer.startedAt, method: lead.paymentMethod,
      });
    } catch { /* cronograma é best-effort — nunca quebra o espelho */ }
  }
  const saved = await repo.update("customers", customer.id, patch);
  // A assinatura que nasceu do fechamento acompanha o plano reeditado, e a
  // reedição entra no histórico (só quando produto, ciclo ou valor mudou).
  if (planFields && subs.length === 1 && !subs[0].mpPreapprovalId) {
    const plan = planFields.subscription.plan ? { id: planFields.subscription.plan, code: planFields.subscription.planCode } : null;
    await stampSubscriptionPlan(repo, customer.id, plan, planFields.customer.planSnapshot).catch(() => null);
  }
  await recordPlanChange(repo, {
    type: "deal_edit", saas: lead.saas, customer: customer.id, subscription: subs.length === 1 ? subs[0].id : "", lead: lead.id,
    from: customerPlanState(customer), to: customerPlanState(saved),
    listPrice: planFields?.customer.planSnapshot?.listPrice, priceVersion: planFields?.customer.planSnapshot?.priceVersion,
    amount: Number(lead.amount) || 0, source: "deal", author: lead.closer || lead.owner || "",
  });
  return saved;
}
