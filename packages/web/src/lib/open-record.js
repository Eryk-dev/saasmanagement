// Abrir um registro de qualquer tela. O card do Negócio (lead), o do Cliente e
// o da Integração são os mesmos de onde quer que se abram (Fase 1B do plano do
// Lever CRM): a tela pede, o app.jsx atende — navega para Clientes, abre a
// ficha do lead ou o card da Integração. Nenhuma tela precisa receber o
// handler por props.

export const OPEN_RECORD_EVENT = "cockpit:open-record";
export const OPEN_CUSTOMER_KEY = "cockpit_customers_open";

export function openRecord(kind, id) {
  if (!id) return;
  window.dispatchEvent(new CustomEvent(OPEN_RECORD_EVENT, { detail: { kind, id: String(id) } }));
}

export const openCustomer = (id) => openRecord("customer", id);
export const openLeadById = (id) => openRecord("lead", id);
export const openOnboarding = (id) => openRecord("onboarding", id);

// O registro de uma atividade (tarefa com `record`, crm/activity-cards.js no
// servidor): { kind: lead|customer|onboarding|followup, id }. "lead" é o nome
// do evento de abrir a ficha; os outros já batem.
export const openActivityRecord = (record) => record?.id && openRecord(record.kind, record.id);

// Assina os pedidos de abrir; devolve a função que cancela a assinatura.
export function onOpenRecord(handler) {
  const fn = (e) => handler(e.detail || {});
  window.addEventListener(OPEN_RECORD_EVENT, fn);
  return () => window.removeEventListener(OPEN_RECORD_EVENT, fn);
}
