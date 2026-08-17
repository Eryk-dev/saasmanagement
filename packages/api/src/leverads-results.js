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
//   resClientes     nº de orgs no portfólio (a org interna fica fora)
//   resGerado       GMV all-time dos pedidos que vieram de anúncio da Lever
//   resRitmo        MEDIANA de R$/mês por cliente desde a 1ª venda influenciada
//                   (só clientes com ≥7 dias; a média é puxada por 2 outliers)
//   resDias         mediana de dias entre conectar a conta e a 1ª venda Lever
//   resAnuncios     anúncios de destino distintos criados pela plataforma
//   resHoras        resAnuncios × 15 min (o mesmo minuto por anúncio do produto)
//   resParticipacao fatia do faturamento do período que passou pela Lever
//
// CACHE É OBRIGATÓRIO, não otimização: `dashboard_portfolio` varre 180 dias de
// `platform_orders` e o Levercopy divide este projeto Supabase com o cockpit
// (a cota de egress já caiu uma vez, ver db.js). Por isso o padrão aqui é
// stale-while-revalidate: a página NUNCA espera a consulta — ela devolve o que
// tem em memória e dispara o recálculo por fora. Enquanto não há valor, os
// tokens saem vazios e o deck mostra o literal do `{{calc.x||fallback}}`, então
// falha de banco degrada pro número escrito no slide, nunca pra buraco.

import { rawQuery } from "./db.js";

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
       from o)
select count(*)::int                                                          as clientes,
       coalesce(sum(gerado), 0)::float8                                       as gerado,
       coalesce(sum(anuncios), 0)::bigint                                     as anuncios,
       percentile_cont(0.5) within group (order by ritmo)::float8             as ritmo,
       percentile_cont(0.5) within group (order by dias) filter (where dias >= 0)::float8 as dias,
       case when sum(gmv) > 0 then (sum(lev) / sum(gmv) * 100)::float8 end    as participacao
from m`;

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
  if (Number(row.gerado) > 0) out.resGerado = money(row.gerado);
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

export async function refreshResults({ query = rawQuery, now = Date.now } = {}) {
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
