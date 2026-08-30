// Resultado REAL dos clientes do LeverAds dentro do deck da proposta.
//
// O slide `impacto` compara o custo de 1 funcionário com o que a plataforma
// gera hoje. Os números vêm do MESMO lugar que a página Resultados do produto
// (a que o closer abre na call de fechamento): a função SQL
// `public.dashboard_portfolio(uuid[])` do Levercopy, que mora no schema
// `public` deste mesmo Postgres. Usar a função (e não uma consulta própria)
// garante que o deck e a tela do produto nunca contem histórias diferentes.
//
// Semântica de cada token (a mesma do produto):
//   resClientes     clientes RODANDO (org com 1ª venda dentro da janela que a
//                   função varre) — é o "23" do topo do card
//   resContas       contas com venda ALL-TIME, incluindo a nossa operação
//   resMes          o que os anúncios da Lever venderam nos ÚLTIMOS 30 DIAS
//                   (clientes + a nossa operação) — é o número do card, porque
//                   numa operação nova o acumulado esconde a velocidade
//   resMesClientes  a fatia dos clientes nesses 30 dias
//   resMesNosso     a fatia da nossa operação nesses 30 dias
//   resGerado       GMV all-time gerado nas contas dos CLIENTES (a nossa
//                   operação fica fora) — o nome antigo, mantido porque os
//                   decks já compartilhados com cliente usam ele
//   resGeradoClientes  o mesmo número, com o nome que diz o que é
//   resGeradoTudo   clientes + a NOSSA operação: é o número que a página
//                   Resultados do produto mostra
//   resGeradoNosso  só a nossa operação (a Lever Money, onde a ferramenta
//                   nasceu — é prova, não é resultado de cliente)
//   resRitmo        MEDIANA de R$/mês por cliente desde a 1ª venda influenciada
//                   (só clientes com ≥7 dias; a média é puxada por 2 outliers)
//   resDias         mediana de dias entre conectar a conta e a 1ª venda Lever
//   resAnuncios     anúncios de destino distintos criados pela plataforma
//   resHoras        resAnuncios × 15 min (o mesmo minuto por anúncio do produto)
//   resParticipacao fatia do faturamento do período que passou pela Lever
//
// POR QUE O TOTAL NÃO SAI DA `dashboard_portfolio` (Leo, 17/08): ela varre 180
// dias de `platform_orders` e só devolve org com 1ª venda DENTRO dessa janela,
// então o cliente que vendeu e parou sumia da soma — o deck mostrava R$ 688 mil
// enquanto a página Resultados do produto mostrava quase R$ 1 milhão. O total
// (e os anúncios) agora vêm de `org_revenue_generated`, a MESMA tabela que a
// página do produto soma; mediana, dias e clientes rodando seguem na função,
// que é quem tem a janela e a data da 1ª venda.
//
// CACHE É OBRIGATÓRIO, não otimização: `dashboard_portfolio` varre 180 dias de
// `platform_orders` e o Levercopy divide este projeto Supabase com o cockpit
// (a cota de egress já caiu uma vez, ver db.js). Por isso o padrão aqui é
// stale-while-revalidate: a página NUNCA espera a consulta — ela devolve o que
// tem em memória e dispara o recálculo por fora. Enquanto não há valor, os
// tokens saem vazios e o deck mostra o literal do `{{calc.x||fallback}}`, então
// falha de banco degrada pro número escrito no slide, nunca pra buraco.

import { rawQuery, makePool } from "./db.js";

// De qual banco vêm os números: com os projetos SEPARADOS (cockpit num Supabase
// próprio), este job é o único ponto do cockpit que ainda lê o Levercopy — e o
// faz por LEVERCOPY_DB_URL, uma credencial SOMENTE-LEITURA no projeto do
// produto, restrita ao que a query usa (orgs, platform_orders,
// org_revenue_generated, dashboard_portfolio). Sem a env, cai no pool do
// cockpit: é o comportamento de sempre enquanto os dois moram no mesmo banco.
let _levercopyPool;
function levercopyQuery(sql, params = []) {
  if (!process.env.LEVERCOPY_DB_URL) return rawQuery(sql, params);
  _levercopyPool ||= makePool(process.env.LEVERCOPY_DB_URL);
  return _levercopyPool.query(sql, params).then(({ rows }) => rows);
}

// A org interna da Lever fica fora: número de teste nosso não é resultado de
// cliente. Mesmo default do `portfolio_exclude_org_ids` do Levercopy.
const EXCLUDE = String(process.env.LEVERADS_PORTFOLIO_EXCLUDE || "00000000-0000-0000-0000-000000000001")
  .split(",").map((s) => s.trim()).filter(Boolean);

const TTL_MS = 6 * 3_600_000;
const MIN_PACE_DAYS = 7;   // <7 dias anualiza um dia bom; o produto usa a mesma régua
const MINUTES_PER_LISTING = 15;

const SQL = `
with p as (select public.dashboard_portfolio($1::uuid[]) as j),
     o as (select jsonb_array_elements(j->'orgs') as org from p),
     m as (
       select (org->>'since_gmv')::numeric        as gmv,
              (org->>'since_leverads')::numeric   as lev,
              (org->>'generated_total')::numeric  as gerado,
              (org->>'listings_created')::int     as anuncios,
              case when (org->>'post_days')::int >= $2
                   then (org->>'since_leverads')::numeric / (org->>'post_days')::int * 30 end as ritmo,
              case when (org->>'first_sale') is not null and (org->>'joined_at') is not null
                   then (org->>'first_sale')::date - (org->>'joined_at')::date end as dias
       from o),
     -- RITMO dos últimos 30 dias: é o número que o card mostra. Numa operação
     -- nova o acumulado esconde a velocidade — nos 30 dias anteriores a estes
     -- foram R$ 164 mil, e nestes 30, R$ 798 mil. Sem filtro de plataforma, pra
     -- casar com o all-time abaixo (que soma ML + Shopee).
     d30 as (
       select coalesce(sum(x.gmv_clone), 0)                                    as mes,
              coalesce(sum(x.gmv_clone) filter (where x.org_id <> all($1)), 0) as mes_clientes,
              coalesce(sum(x.gmv_clone) filter (where x.org_id = any($1)), 0)  as mes_nosso
       from public.platform_orders x
       join public.orgs g2 on g2.id = x.org_id and g2.active = true
       where x.date_created >= now() - interval '30 days'
     ),
     -- Total ALL-TIME por org: a mesma tabela que a página Resultados do
     -- produto soma. A org interna (a nossa operação) entra separada, nunca
     -- misturada no número dos clientes.
     r as (
       select coalesce(sum(v.gmv_total), 0)                                          as gerado,
              coalesce(sum(v.gmv_total) filter (where v.org_id <> all($1)), 0)       as gerado_clientes,
              coalesce(sum(v.gmv_total) filter (where v.org_id = any($1)), 0)        as gerado_nosso,
              count(*) filter (where v.gmv_total > 0)                                as contas,
              coalesce(sum(v.items_counted), 0)                                      as anuncios
       from public.org_revenue_generated v
       join public.orgs g on g.id = v.org_id and g.active = true
     )
select (select count(*) from m)::int                                          as clientes,
       d30.mes::float8                                                        as mes,
       d30.mes_clientes::float8                                               as mes_clientes,
       d30.mes_nosso::float8                                                  as mes_nosso,
       r.gerado::float8                                                       as gerado,
       r.gerado_clientes::float8                                              as gerado_clientes,
       r.gerado_nosso::float8                                                 as gerado_nosso,
       r.contas::int                                                          as contas,
       r.anuncios::bigint                                                     as anuncios,
       (select percentile_cont(0.5) within group (order by ritmo) from m)::float8 as ritmo,
       (select percentile_cont(0.5) within group (order by dias) filter (where dias >= 0) from m)::float8 as dias,
       (select case when sum(gmv) > 0 then sum(lev) / sum(gmv) * 100 end from m)::float8 as participacao
from r, d30`;

const nf = (min, max) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });

// Número curto no tom do deck: uma casa decimal só quando ela informa (10,4 mil
// diz algo; 685,5 mil só polui).
function short(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1e6) {
    const m = v / 1e6;
    return `${nf(0, 1).format(m)} ${m < 2 ? "milhão" : "milhões"}`;
  }
  if (v >= 1e3) {
    const k = v / 1e3;
    return `${(k < 100 ? nf(0, 1) : nf(0, 0)).format(k)} mil`;
  }
  return nf(0, 0).format(v);
}

const money = (n) => `R$ ${short(n)}`;

// Linha do banco → tokens de texto prontos pra interpolação no slide. Métrica
// sem base honesta (ex.: nenhum cliente com 7 dias) sai FORA do objeto, e não
// como "0": token ausente é o que aciona o fallback escrito no deck.
export function resultTokens(row) {
  if (!row || !(Number(row.clientes) > 0)) return null;
  const out = { resClientes: nf(0, 0).format(Number(row.clientes)) };
  if (Number(row.contas) > 0) out.resContas = nf(0, 0).format(Number(row.contas));
  if (Number(row.mes) > 0) out.resMes = money(row.mes);
  if (Number(row.mes_clientes) > 0) out.resMesClientes = money(row.mes_clientes);
  if (Number(row.mes_nosso) > 0) out.resMesNosso = money(row.mes_nosso);
  if (Number(row.gerado) > 0) out.resGeradoTudo = money(row.gerado);
  if (Number(row.gerado_clientes) > 0) {
    // Dois nomes pro MESMO número de propósito: `resGerado` é o token que os
    // decks já compartilhados com cliente usam ("R$ X já gerados"), e ali a
    // frase fala das contas dos clientes. O nome novo é pro deck atual.
    out.resGerado = money(row.gerado_clientes);
    out.resGeradoClientes = money(row.gerado_clientes);
  }
  if (Number(row.gerado_nosso) > 0) out.resGeradoNosso = money(row.gerado_nosso);
  if (Number(row.ritmo) > 0) out.resRitmo = money(row.ritmo);
  if (row.dias != null && Number(row.dias) >= 0) out.resDias = nf(0, 0).format(Math.round(Number(row.dias)));
  if (Number(row.anuncios) > 0) {
    out.resAnuncios = short(row.anuncios);
    out.resHoras = short(Number(row.anuncios) * MINUTES_PER_LISTING / 60);
  }
  if (Number(row.participacao) > 0) out.resParticipacao = `${nf(0, 1).format(Number(row.participacao))}%`;
  return out;
}

let cache = { tokens: null, at: 0 };
let inFlight = null;

export async function refreshResults({ query = levercopyQuery, now = Date.now } = {}) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const rows = await query(SQL, [EXCLUDE, MIN_PACE_DAYS]);
      const tokens = resultTokens(rows?.[0]);
      // Consulta que volta sem base (portfólio vazio) não apaga o que já temos:
      // deck com número velho é melhor que deck sem número.
      if (tokens) cache = { tokens, at: now() };
      return tokens;
    } catch (e) {
      // Fail-open: sem os tokens o slide cai no literal do template.
      console.warn("[leverads-results] falhou:", e.message);
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// O que o renderer recebe. NUNCA espera a consulta: devolve o cache (mesmo
// vencido) e manda recalcular por fora quando passou do TTL.
export function leveradsResults({ now = Date.now, ttlMs = TTL_MS, refresh = refreshResults } = {}) {
  if (!cache.tokens || now() - cache.at > ttlMs) {
    Promise.resolve(refresh()).catch(() => {});
  }
  return cache.tokens;
}

// Só pros testes: zera o estado de módulo entre casos.
export function _resetResultsCache() {
  cache = { tokens: null, at: 0 };
  inFlight = null;
}
