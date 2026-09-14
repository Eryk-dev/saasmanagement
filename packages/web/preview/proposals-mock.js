const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const template = (id, name, status) => ({ id, name, saas: 'leverads', status, slides: [{ type: 'cover', title: 'Sua operação pode vender mais', subtitle: 'Proposta de exemplo' }], theme: { bg: '#f6f7f9', fg: '#0c1d2b', accent: '#0f766e' }, calc: {} });
export const proposalCollections = {
  proposal_templates: [template('tpl-pro', 'Proposta LeverAds · Pro', 'published'), template('tpl-start', 'Proposta de entrada', 'draft')],
  proposals: [
    { id: 'prop-1', saas: 'leverads', template: 'tpl-pro', createdAt: iso(-3), views: 0, data: { lead: { name: 'Pedro Rocha', company: 'Leões do Bebê', phone: '5541999990007' } } },
    { id: 'prop-2', saas: 'leverads', template: 'tpl-pro', createdAt: iso(-5), views: 3, data: { lead: { name: 'Juliana Alves', company: 'Sul Importados', phone: '5541999990001' } } },
    { id: 'prop-3', saas: 'leverads', template: 'tpl-pro', createdAt: iso(-8), views: 4, accepted: true, data: { lead: { name: 'Otávio Braga', company: 'Braga Ferramentas' } } },
  ],
};
export const proposalsMock = { proposalPreview: () => ({ html: '<!doctype html><html lang="pt-BR"><body style="font-family:sans-serif;padding:32px;background:#f6f7f9;color:#0c1d2b"><p>LEVERADS</p><h1>Sua operação pode vender mais</h1><p>Prévia com dados fictícios</p></body></html>' }) };
