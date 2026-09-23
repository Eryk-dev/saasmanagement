// Cliente da API do Linear (GraphQL). Factory com fetch injetável, no mesmo
// molde de shopify.js/meta.js/whatsapp.js: sem LINEAR_API_KEY o cliente fica
// DORMENTE (configured() = false) e todo o espelhamento de tickets vira no-op.
//
// Só o que o espelho precisa: catálogo (times, projetos, estados) pra tela de
// configuração, criar/atualizar issue, comentar, ler uma issue e listar as
// issues mudadas desde X (reconciliação). Nada de mutação destrutiva — o
// cockpit nunca apaga issue do Linear.
//
// Prioridade no Linear é número: 0 sem prioridade, 1 urgente, 2 alta,
// 3 média, 4 baixa (ver ticket-linear.js para o de-para com o ticket).

const ENDPOINT = "https://api.linear.app/graphql";

// Chave pessoal (`lin_api_…`) vai CRUA no Authorization; token de OAuth
// (`lin_oauth_…`) vai como Bearer. Mandar Bearer numa chave pessoal dá 400.
const authHeader = (key) => (String(key).startsWith("lin_oauth") ? `Bearer ${key}` : String(key));

const ISSUE_FIELDS = `
  id identifier url title description priority updatedAt
  state { id name type }
  project { id name }
  team { id key name }
  assignee { id name }
  labels { nodes { name } }`;

// `apiKey` aceita string OU função. A função é o que salva o cliente padrão: o
// index.js só chama `dotenv.config()` DEPOIS de avaliar os imports (ESM avalia
// as dependências primeiro), então ler process.env na criação do módulo pegava
// sempre vazio — a API subia achando que não havia chave mesmo com ela no .env.
export function makeLinear({ fetch: f = globalThis.fetch, apiKey = "", endpoint = ENDPOINT } = {}) {
  const key = () => String((typeof apiKey === "function" ? apiKey() : apiKey) || "");
  const configured = () => !!key();

  // O Linear responde 200 com { errors } em erro de GraphQL — por isso os dois
  // caminhos (status e errors) viram a MESMA exceção, com a mensagem legível.
  async function gql(query, variables = {}) {
    if (!configured()) throw new Error("Linear sem LINEAR_API_KEY");
    const res = await f(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: authHeader(key()) },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = {}; }
    if (res.status >= 400 || body.errors?.length) {
      const detail = body.errors?.map((e) => e.message).join("; ") || text.slice(0, 200);
      const err = new Error(`Linear -> ${res.status}: ${detail}`);
      err.status = res.status;
      throw err;
    }
    return body.data || {};
  }

  // Catálogo pra tela de configuração: time → estados do fluxo e projetos.
  //
  // O Linear cobra a COMPLEXIDADE da query pelo produto dos `first` aninhados
  // (times × projetos × estados) e devolve 400 "Query too complex" quando passa
  // do teto — foi o que aconteceu no workspace real com 50×100. Então os
  // limites são modestos e, se ainda assim estourar, a busca se divide em uma
  // query por time (mais chamadas, cada uma barata).
  const shapeTeam = (t) => ({
    id: t.id, key: t.key, name: t.name,
    states: (t.states?.nodes || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((s) => ({ id: s.id, name: s.name, type: s.type })),
    projects: (t.projects?.nodes || []).map((p) => ({ id: p.id, name: p.name, state: p.state })),
  });
  const TEAM_BODY = `id key name
    states(first: $states) { nodes { id name type position } }
    projects(first: $projects) { nodes { id name state } }`;

  async function catalog({ teams = 25, projects = 25, states = 30 } = {}) {
    try {
      const data = await gql(`query Catalog($teams: Int!, $projects: Int!, $states: Int!) {
        teams(first: $teams) { nodes { ${TEAM_BODY} } }
      }`, { teams, projects, states });
      return (data.teams?.nodes || []).map(shapeTeam);
    } catch (err) {
      if (!/too complex/i.test(err.message || "")) throw err;
      const base = await gql("query Times($teams: Int!) { teams(first: $teams) { nodes { id key name } } }", { teams });
      const out = [];
      for (const t of base.teams?.nodes || []) {
        const d = await gql(`query Time($id: String!, $projects: Int!, $states: Int!) {
          team(id: $id) { ${TEAM_BODY} }
        }`, { id: t.id, projects, states });
        out.push(d.team ? shapeTeam(d.team) : { id: t.id, key: t.key, name: t.name, states: [], projects: [] });
      }
      return out;
    }
  }

  async function createIssue(input) {
    const data = await gql(`mutation Create($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } }
    }`, { input });
    if (!data.issueCreate?.success || !data.issueCreate?.issue) throw new Error("Linear recusou a criação da issue");
    return data.issueCreate.issue;
  }

  async function updateIssue(id, input) {
    const data = await gql(`mutation Update($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } }
    }`, { id, input });
    if (!data.issueUpdate?.success) throw new Error("Linear recusou a atualização da issue");
    return data.issueUpdate.issue;
  }

  async function createComment(issueId, body) {
    const data = await gql(`mutation Comment($input: CommentCreateInput!) {
      commentCreate(input: $input) { success comment { id createdAt } }
    }`, { input: { issueId, body } });
    if (!data.commentCreate?.success) throw new Error("Linear recusou o comentário");
    return data.commentCreate.comment;
  }

  // Uma issue por id OU por identificador legível (ENG-123) — o atendente cola
  // qualquer um dos dois ao vincular um ticket a uma issue que já existe.
  async function issue(idOrKey) {
    const data = await gql(`query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id: String(idOrKey) });
    return data.issue || null;
  }

  // A issue com a descrição e os comentários — é o que a aba Linear do ticket
  // mostra, sempre do jeito que está LÁ (o ticket guarda só o espelho).
  async function issueWithComments(idOrKey, { comments = 100 } = {}) {
    const data = await gql(`query IssueFull($id: String!, $comments: Int!) {
      issue(id: $id) {
        ${ISSUE_FIELDS}
        createdAt
        comments(first: $comments) { nodes { id body createdAt url user { id name } } }
      }
    }`, { id: String(idOrKey), comments });
    if (!data.issue) return null;
    const { comments: c, ...issue } = data.issue;
    return { issue, comments: c?.nodes || [] };
  }

  // Reconciliação: issues do projeto (ou do time) mudadas depois de `since`,
  // com os comentários recentes — é o que repõe uma entrega de webhook perdida.
  async function issuesUpdatedSince(since, { teamId = "", projectId = "", first = 50, comments = 20 } = {}) {
    const filter = { updatedAt: { gt: since } };
    if (projectId) filter.project = { id: { eq: projectId } };
    else if (teamId) filter.team = { id: { eq: teamId } };
    const data = await gql(`query Recent($filter: IssueFilter!, $first: Int!, $comments: Int!) {
      issues(first: $first, filter: $filter, orderBy: updatedAt) {
        nodes {
          ${ISSUE_FIELDS}
          comments(first: $comments) { nodes { id body createdAt user { id name } } }
        }
      }
    }`, { filter, first, comments });
    return data.issues?.nodes || [];
  }

  // Quem é a chave (a tela mostra pra confirmar que conectou na conta certa).
  async function viewer() {
    const data = await gql("query { viewer { id name email } organization { id name urlKey } }");
    return { user: data.viewer || null, organization: data.organization || null };
  }

  return { configured, gql, catalog, createIssue, updateIssue, createComment, issue, issueWithComments, issuesUpdatedSince, viewer };
}

export const defaultLinear = makeLinear({ apiKey: () => process.env.LINEAR_API_KEY || "" });
