// Cenários de marketing isolados: /?shell=1&marketing=1#blog (sem API real).
const ago = (days = 0) => new Date(Date.now() - days * 86400000).toISOString();
const clone = (value) => structuredClone(value);
const questions = [
  { key: 'name', label: 'Como você se chama?', type: 'text', required: true },
  { key: 'company', label: 'Qual o nome da empresa?', type: 'text', required: true },
  { key: 'email', label: 'Qual seu e-mail?', type: 'email', required: true },
];
const form = { id: 'diagnostico-preview', saas: 'leverads', name: 'Diagnóstico de operação', status: 'published', questions,
  welcome: { title: 'Sua operação está pronta para crescer?', button: 'Começar diagnóstico', variants: [{ id: 'A', title: 'Sua operação está pronta para crescer?' }, { id: 'B', title: 'Quanto tempo você perde gerenciando contas?' }] },
  ending: { title: 'Diagnóstico recebido', body: 'Nossa equipe vai entrar em contato.' }, mapping: { name: 'name', email: 'email', company: 'company' } };
export const marketingCollections = {
  forms: [form, { ...clone(form), id: 'pesquisa-preview', name: 'Pesquisa de crescimento', status: 'draft' }],
  form_submissions: [{ id: 'sub-preview', saas: 'leverads', form: form.id, createdAt: ago(), name: 'Cliente de demonstração', email: 'demo@example.com', company: 'Loja de demonstração', answers: { name: 'Cliente de demonstração', email: 'demo@example.com', company: 'Loja de demonstração' }, utm: { source: 'instagram' } }],
  campaigns: [{ id: 'camp-preview', saas: 'leverads', name: 'Retomada do diagnóstico', status: 'draft', stages: ['Qualificação'], channels: { whatsapp: true, email: false }, wa: { text: 'Oi {{nome}}! Vamos conversar sobre a operação da {{empresa}}?' }, email: { subject: 'Seu diagnóstico', body: 'Oi {{nome}}, podemos retomar seu diagnóstico?' }, sent: {}, createdAt: ago(3), createdBy: 'leo' }],
  sequences: [], sequence_enrollments: [], drip_templates: [],
};
let rules = { enabled: true, autoPauta: true, autoRascunho: true, autoPublicar: false, cadenciaSemanal: 3, horaPublicacao: '09:00', minPautas: 5, minRascunhos: 2, diasPublicacao: ['seg', 'qua', 'sex'], categorias: ['Operação', 'Marketplaces'], ctaUrl: 'https://example.com/diagnostico' };
let posts = ['rascunho', 'rascunho', 'pauta', 'agendado', 'publicado'].map((status, i) => ({
  id: `post-preview-${i}`, saas: 'leverads', status, title: ['Como organizar várias contas de marketplace', 'O custo de atualizar anúncios manualmente', 'Quando automatizar a operação', 'Checklist para uma operação organizada', 'Como reduzir o retrabalho no catálogo'][i],
  slug: `operacao-marketplace-${i}`, description: 'Um guia para organizar as rotinas da sua operação nos marketplaces.', keyword: 'gestão de marketplaces', category: 'Operação', intent: 'informacional', tags: ['operação'],
  body: status === 'pauta' ? '' : '## Comece pela rotina\n\nMapeie as atividades que se repetem e acompanhe o tempo gasto em cada etapa.\n\n## Organize o catálogo\n\nRevise os anúncios antes de expandir sua operação.', wordCount: 34,
  lint: i === 1 ? [{ level: 'erro', msg: 'Revise o termo não permitido antes de publicar.' }] : [], faq: [], history: [], createdAt: ago(5 + i), updatedAt: ago(i), ...(status === 'agendado' ? { scheduledAt: ago(-1) } : {}), ...(status === 'publicado' ? { publishedAt: ago(3) } : {}),
}));
const postById = (id) => { const p = posts.find((p) => p.id === id); if (!p) throw new Error('Post não encontrado na prévia'); return p; };
const state = { lastTickAt: ago(), lastMineAt: ago(1), lastDraftAt: ago(), lastPublishAt: ago(3) };
const funnel = { views: 1200, starts: 780, submits: 168, leads: 168, callsShown: 30, won: 6, revenue: 19800, lastSubmitAt: ago(), questions: [], sources: [], daily: [],
  variants: [{ id: 'A', views: 600, starts: 420, submits: 96, leads: 96, calls: 28, won: 4, revenue: 13200, grades: { A: 30, B: 42, C: 24 } }, { id: 'B', views: 600, starts: 360, submits: 72, leads: 72, calls: 18, won: 2, revenue: 6600, grades: { A: 20, B: 30, C: 22 } }] };
const demo = { genders: [{ key: 'M', value: 640 }, { key: 'F', value: 360 }], ages: [{ key: '25-34', value: 550 }, { key: '35-44', value: 450 }], cities: [{ key: 'São Paulo', value: 430 }, { key: 'Curitiba', value: 260 }, { key: 'Rio de Janeiro', value: 180 }], countries: [{ key: 'BR', value: 950 }, { key: 'PT', value: 50 }] };
let creatives = 3;
export const marketingMock = {
  metrics: () => ({ window: { newCustomers: 6, cac: 1400 }, ltv: { value: 8400, months: 12, ltvCac: 6 } }),
  deliveryRules: () => ({ error: "Prévia sem veiculação: nenhuma regra executa anúncios reais." }),
  formFunnel: () => clone(funnel),
  formPreview: (draft) => ({ html: `<html lang="pt-BR"><body style="font:20px sans-serif;padding:32px"><h1>${String(draft.welcome?.title || 'Seu formulário').replace(/[<>&"]/g, '')}</h1><p>Prévia local com dados fictícios.</p></body></html>` }),
  blog: (saas) => ({ posts: clone(posts.filter((p) => p.saas === saas)), counts: Object.fromEntries(['pauta', 'rascunho', 'agendado', 'publicado', 'arquivado'].map((status) => [status, posts.filter((p) => p.saas === saas && p.status === status).length])), rules: clone(rules), state, aiConfigured: true, nextSlot: ago(-1) }),
  blogPost: (_, id) => clone(postById(id)),
  blogUpdate: (_, id, patch) => clone(Object.assign(postById(id), patch, { updatedAt: ago() })),
  blogSaveRules: (_, patch) => ({ rules: clone(rules = { ...rules, ...patch }), state }),
  blogNewPauta: (saas, data) => { const post = { ...data, id: `post-${Date.now()}`, saas, status: 'pauta', createdAt: ago(), updatedAt: ago(), lint: [], tags: [], faq: [] }; posts.unshift(post); return clone(post); },
  blogDigest: () => ({ builtAt: ago(), counts: { leads: 168, calls: 46 }, text: 'Cenário fictício: as dúvidas mais frequentes são organização do catálogo e redução do retrabalho.' }),
  blogTick: () => ({ mined: 0, drafted: 0, scheduled: 0, published: 0 }),
  blogMine: (saas) => ({ created: [marketingMock.blogNewPauta(saas, { title: 'Como revisar seu catálogo', keyword: 'catálogo', category: 'Operação' })] }),
  blogAction: (_, id, action) => { const p = postById(id); if (['approve', 'publish'].includes(action) && p.lint.some((l) => l.level === 'erro')) throw new Error('Revise os erros antes de publicar.'); p.status = ({ approve: 'agendado', publish: 'publicado', archive: 'arquivado', restore: 'rascunho', unschedule: 'rascunho', unpublish: 'rascunho' })[action] || p.status; return clone(p); },
  socialSummary: (saas) => saas !== 'leverads' ? { configured: false } : ({ configured: true, igUserId: 'ig-preview', account: { username: 'leverads_demo', followers_count: 2840 }, insights: { reach: 18320, views: 32700, profile_views: 890, accounts_engaged: 650, total_interactions: 1130 }, engagement: { rate: 4.8, posts: 8 }, followerGrowth: 284, followsBreakdown: { follows: 412, unfollows: 128 }, reachBreakdown: { follower: 5500, nonFollower: 12820 }, reachByFormat: [{ key: 'REELS', value: 11000 }, { key: 'FEED', value: 7320 }], interactionTypes: { likes: 640, comments: 150, saves: 210, shares: 130 }, followerSeries: Array.from({ length: 14 }, (_, i) => ({ date: ago(13 - i).slice(0, 10), value: 2556 + i * 22 })), media: [], errors: {} }),
  socialPosts: () => [], socialStories: () => ({ stories: [] }), socialAudience: () => ({ demographics: demo, reached: demo, engaged: demo }), socialDiscovery: () => ({ competitors: [], mentions: [], hashtags: [] }),
  socialComments: () => ({ comments: [], insights: { pending: 0 } }),
  desempenho: () => ({ logs: { leo: { creatives, socialSelling: 6 } } }),
  desempenhoLog: (_, { inc }) => ({ creatives: creatives += inc.creatives }),
  campaignMetrics: () => ({ campaigns: [{ id: 'camp-preview', name: 'Retomada do diagnóstico', sent: 32, advanced: 12, booked: 5, won: 2 }] }),
  sequenceMetrics: () => ({ sequences: [] }),
  waNumber: () => ({ tier: 'TIER_1000' }), waInsights: () => ({ costs: { messages: 100, cost: 42 } }),
  campaignAiCopy: () => ({ whatsapp: 'Oi {{nome}}! Podemos retomar o diagnóstico da {{empresa}}?', subject: 'Seu diagnóstico', body: 'Oi {{nome}}, vamos revisar sua operação?' }),
  lpSummary: () => ({ pages: [{ page: 'lp', sessions: 2100 }, { page: 'checkout', sessions: 420 }], sources: [{ source: 'instagram', sessions: 1500 }, { source: 'direto', sessions: 600 }], daily: [], ctaLabels: [{ label: 'Conhecer o Elo', clicks: 420 }], conversions: { by_utm: [{ source: 'instagram', campaign: 'Famílias', created: 48, approved: 24, revenue_cents: 477600 }, { source: 'direto', created: 22, approved: 16, revenue_cents: 318400 }], by_plan: [{ plan: 'annual', method: 'pix', created: 70, approved: 40, revenue_cents: 796000 }], daily: [] } }),
  marketingMetrics: () => ({ synced: true, totals: { spend: 8400, leads: 168, cpl: 50, won: 6, revenue: 19800, roas: 2.36, formViews: 1200 }, perStage: [{ stage: 'Novo lead', count: 168, costPer: 50 }, { stage: 'Call marcada', count: 46, costPer: 182.61 }, { stage: 'Proposta', count: 18, costPer: 466.67 }, { stage: 'Ganho', count: 6, costPer: 1400 }], origins: [{ key: 'instagram', label: 'Instagram', leads: 120, calls: 36, won: 4 }, { key: 'direct', label: 'Direto', leads: 48, calls: 10, won: 2 }], pains: [], campaigns: [], adsets: [], ads: [] }),
};

// CRUD das coleções de marketing, sem interferir nos cenários de outras telas.
const rowIn = (col, id) => {
  const row = marketingCollections[col].find((row) => row.id === id);
  if (!row) throw new Error("Registro não encontrado na prévia");
  return row;
};
export const marketingCrud = {
  list: (col, query = {}) => clone(marketingCollections[col].filter((row) => Object.entries(query).every(([key, value]) => !value || row[key] === value))),
  get: (col, id) => clone(rowIn(col, id)),
  update: (col, id, patch) => clone(Object.assign(rowIn(col, id), patch)),
  create: (col, data) => { const row = { ...data, id: `marketing-${Date.now()}`, createdAt: ago() }; marketingCollections[col].push(row); return clone(row); },
  remove: (col, id) => { marketingCollections[col] = marketingCollections[col].filter((row) => row.id !== id); return { ok: true }; },
};
