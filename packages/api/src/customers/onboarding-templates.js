// Modelos de checklist da integração (Lever CRM, Fase 3): cada tipo de
// integração nasce com os itens que a Lever e o cliente precisam entregar.
// O padrão mora aqui; cada produto pode trocar pelos seus em
// `app_config/onboarding_templates_<saas>` (PUT só com etiqueta admin). Um
// modelo pode valer só para alguns planos (`planCodes`): o do plano do
// cliente vence o genérico do tipo.

export const templatesId = (saas) => `onboarding_templates_${saas}`;

export const DEFAULT_TEMPLATES = [
  { id: "implantacao", kind: "implantacao", name: "Implantação inicial", items: [
    { title: "Formulário de integração respondido", side: "cliente" },
    { title: "Acesso às contas dos marketplaces", side: "cliente" },
    { title: "Kickoff com o cliente", side: "lever" },
    { title: "Contas conectadas e configuração feita", side: "lever" },
    { title: "Primeira entrega no ar (anúncios ou regras)", side: "lever" },
    { title: "Treinamento do time do cliente", side: "lever" },
    { title: "Go-live confirmado com o cliente", side: "lever" },
  ] },
  { id: "novo_produto", kind: "novo_produto", name: "Produto novo", items: [
    { title: "Acesso ao produto novo liberado", side: "lever" },
    { title: "Configuração inicial do produto", side: "lever" },
    { title: "Treinamento do produto novo", side: "lever" },
    { title: "Go-live confirmado com o cliente", side: "lever" },
  ] },
  { id: "reintegracao", kind: "reintegracao", name: "Reintegração", items: [
    { title: "Diagnóstico do que parou", side: "lever" },
    { title: "Acessos revalidados", side: "cliente" },
    { title: "Configuração refeita", side: "lever" },
    { title: "Cliente confirma que voltou a operar", side: "cliente" },
  ] },
  { id: "migracao", kind: "migracao", name: "Migração", items: [
    { title: "Levantamento do que migrar", side: "lever" },
    { title: "Acesso à origem", side: "cliente" },
    { title: "Migração executada e conferida", side: "lever" },
    { title: "Cliente valida o resultado", side: "cliente" },
  ] },
  { id: "treinamento", kind: "treinamento", name: "Treinamento", items: [
    { title: "Pauta combinada com o cliente", side: "cliente" },
    { title: "Treinamento realizado", side: "lever" },
    { title: "Material enviado ao cliente", side: "lever" },
  ] },
];

export async function templatesOf(repo, saas) {
  const doc = saas ? await repo.get("app_config", templatesId(saas)).catch(() => null) : null;
  return Array.isArray(doc?.templates) && doc.templates.length ? doc.templates : DEFAULT_TEMPLATES;
}

// O modelo do plano do cliente vence o genérico do mesmo tipo.
export function templateFor(templates, { kind, planCode = "" }) {
  const ofKind = templates.filter((t) => t.kind === kind);
  return ofKind.find((t) => planCode && (t.planCodes || []).includes(planCode)) || ofKind.find((t) => !(t.planCodes || []).length) || null;
}

const s = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function cleanTemplates(list) {
  if (!Array.isArray(list) || list.length > 40) throw Object.assign(new Error("Envie até 40 modelos."), { statusCode: 400 });
  return list.map((t, i) => {
    const items = (Array.isArray(t?.items) ? t.items : []).map((it) => ({ title: s(it?.title, 200), side: it?.side === "cliente" ? "cliente" : "lever" })).filter((it) => it.title);
    if (!s(t?.kind, 40) || !items.length) throw Object.assign(new Error(`Modelo ${i + 1} sem tipo ou sem itens.`), { statusCode: 400 });
    return { id: s(t.id, 60) || `${t.kind}_${i}`, kind: s(t.kind, 40), name: s(t.name, 80) || s(t.kind, 40), planCodes: (Array.isArray(t.planCodes) ? t.planCodes : []).map((c) => s(c, 60)).filter(Boolean), items };
  });
}
