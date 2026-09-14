// Dublê da API pro preview de telas (14/09). NÃO entra no build de produção:
// só o vite.preview.config.js troca lib/api.js por este arquivo, pra conferir
// o desenho de uma tela sem subir a API nem tocar em banco nenhum.
const DIA = 86400000;
const hoje = new Date();
const emHoras = (h, m = 0) => { const d = new Date(hoje); d.setHours(h, m, 0, 0); return d.toISOString(); };
const emDias = (n, h = 9) => { const d = new Date(hoje.getTime() + n * DIA); d.setHours(h, 0, 0, 0); return d.toISOString(); };

export const LEADS_FAKE = [
  // confirmar call (call hoje, dono != closer)
  { id: "l1", saas: "leverads", name: "Juliana Alves", company: "Sul Importados", stage: "Call marcada", owner: "leo", closer: "lucas", amount: 3100, phone: "5541999990001", callAt: emHoras(15, 50), createdAt: emDias(-3), stageSince: emDias(-1), accounts: "1", listings: "500-2k" },
  // compromisso marcado (call hoje, dono = closer)
  { id: "l2", saas: "leverads", name: "Bruno Teixeira", company: "Auto Peças Já", stage: "Call marcada", owner: "leo", closer: "leo", amount: 2600, phone: "5541999990002", callAt: emHoras(16, 0), createdAt: emDias(-5), stageSince: emDias(-2) , accounts: "2", listings: "2-10k" },
  // leads novos
  { id: "l3", saas: "leverads", name: "Fernanda Dias", company: "Casa & Cia", stage: "Novo lead", owner: "leo", amount: 1900, phone: "5541999990003", createdAt: emDias(0, 8), accounts: "3-5", listings: "10k+" },
  { id: "l4", saas: "leverads", name: "Marcos Lima", company: "MegaPeças RP", stage: "Novo lead", owner: "leo", amount: 4200, phone: "5541999990004", createdAt: emDias(0, 10), accounts: "6-10", listings: "≤100" },
  // retomadas (toque vencido, fase sdr)
  { id: "l5", saas: "leverads", name: "Carla Nunes", company: "Casa Bela Utilidades", stage: "Qualificação", owner: "leo", amount: 2300, phone: "5541999990005", nextActionAt: emHoras(9, 30), createdAt: emDias(-8), stageSince: emDias(-4), stageAttempts: 2 , accounts: "10+", listings: "100-500" },
  { id: "l6", saas: "leverads", name: "Diego Martins", company: "Eletro Sul", stage: "Qualificação", owner: "leo", amount: 1500, phone: "5541999990006", nextActionAt: emHoras(11, 30), createdAt: emDias(-9), stageSince: emDias(-5), stageAttempts: 3 , accounts: "1", listings: "500-2k" },
  // follow-up do closer
  { id: "l7", saas: "leverads", name: "Pedro Rocha", company: "Leões do Bebê", stage: "Proposta", owner: "leo", closer: "lucas", amount: 5400, phone: "5541999990007", nextActionAt: emDias(-1, 18), createdAt: emDias(-14), stageSince: emDias(-6), stageAttempts: 4 , accounts: "2", listings: "2-10k" },
  { id: "l8", saas: "leverads", name: "Rafael Duarte", company: "Ferragens Duarte", stage: "Proposta", owner: "leo", closer: "lucas", amount: 3300, phone: "5541999990008", nextActionAt: emDias(-2, 11), createdAt: emDias(-20), stageSince: emDias(-9), stageAttempts: 5 , accounts: "3-5", listings: "10k+" },
  // feito hoje (fica na fila, riscado)
  { id: "l9", saas: "leverads", name: "Aline Souza", company: "Vitrine Pet", stage: "Qualificação", owner: "leo", amount: 1200, phone: "5541999990009", nextActionAt: emHoras(10, 0), lastActivityAt: emHoras(10, 5), lastActivityType: "whatsapp", createdAt: emDias(-6), stageSince: emDias(-3) , accounts: "6-10", listings: "≤100" },
  // sem data
  { id: "l10", saas: "leverads", name: "Thiago Barros", company: "Barros Ferramentas", stage: "Qualificação", owner: "leo", amount: 2100, phone: "5541999990010", createdAt: emDias(-11), stageSince: emDias(-7) , accounts: "10+", listings: "100-500" },
  { id: "l11", saas: "leverads", name: "Lívia Castro", company: "Castro Bebidas", stage: "Proposta", owner: "leo", closer: "lucas", amount: 4800, phone: "5541999990011", createdAt: emDias(-13), stageSince: emDias(-8) , accounts: "1", listings: "500-2k" },
  // amanhã e próximos dias
  { id: "l12", saas: "leverads", name: "Ricardo Nunes", company: "RN Distribuidora", stage: "Call marcada", owner: "leo", closer: "leo", amount: 4800, phone: "5541999990012", callAt: emDias(1, 17), createdAt: emDias(-4), stageSince: emDias(-1) , accounts: "2", listings: "2-10k" },
  { id: "l13", saas: "leverads", name: "Renata Prado", company: "Moda Prado", stage: "Call marcada", owner: "leo", closer: "leo", amount: 2900, phone: "5541999990013", callAt: emDias(3, 15), createdAt: emDias(-4), stageSince: emDias(-1) , accounts: "3-5", listings: "10k+" },
  { id: "l14", saas: "leverads", name: "Otávio Braga", company: "Braga Ferramentas", stage: "Call marcada", owner: "leo", closer: "leo", amount: 2850, phone: "5541999990014", callAt: emDias(4, 16), createdAt: emDias(-4), stageSince: emDias(-1) , accounts: "6-10", listings: "≤100" },
];

const TAREFAS = [
  { id: "t1", saas: "leverads", title: "Refazer o roteiro de objeção de preço", assignees: ["leo"], dueDate: new Date(hoje.getTime() - 2 * DIA).toISOString().slice(0, 10), column: "todo", board: "b1", priority: "P1" },
  { id: "t2", saas: "leverads", title: "Gravar vídeo da dor estoque parado", assignees: ["leo"], dueDate: new Date(hoje.getTime() + 4 * DIA).toISOString().slice(0, 10), column: "todo", board: "b1" },
  { id: "t3", saas: "leverads", title: "Ligar para o financeiro da RN Distribuidora", assignees: ["leo"], dueDate: new Date(hoje).toISOString().slice(0, 10), column: "todo", board: "b1" },
  { id: "t4", saas: "leverads", title: "Página de planos com a tabela nova", assignees: ["leo"], column: "doing", board: "b1" },
  { id: "t5", saas: "leverads", title: "Texto do e-mail de boas-vindas", assignees: ["leo"], column: "todo", board: "b1" },
];

const RESPOSTAS = {
  list: (col) => col === "leads" ? LEADS_FAKE : col === "tasks" ? TAREFAS : col === "task_boards" ? [{ id: "b1", saas: "leverads", columns: [{ key: "todo", name: "A fazer" }, { key: "doing", name: "Em andamento" }, { key: "done", name: "Concluído", done: true }] }] : [],
  desempenho: () => ({ logs: { leo: { socialSelling: 6 } } }),
  scoreboard: () => ({ sdr: [{ user: "leo", contacted: 6, callsBooked: 3, leadsNew: 4 }], closer: [] }),
  listActivities: () => [],
  consultations: () => [],
};

const vazio = () => Promise.resolve(null);

export const api = new Proxy({}, {
  get(_, nome) {
    if (nome === "list") return (col) => Promise.resolve(RESPOSTAS.list(col));
    if (nome === "bootstrap") return () => Promise.resolve(window.SEED);
    if (nome === "listUsers") return () => Promise.resolve(window.SEED.USERS);
    if (RESPOSTAS[nome]) return (...a) => Promise.resolve(RESPOSTAS[nome](...a));
    if (nome === "then") return undefined;
    return (...a) => { console.info("[preview] api." + String(nome), a); return vazio(); };
  },
});

export const getKey = () => "preview";
export const setKey = () => {};
export const clearKey = () => {};
export const assetUrl = (p) => p;
export const eventsUrl = () => "";
export const upload = () => Promise.resolve(null);
export default api;
