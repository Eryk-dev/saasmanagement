// Linear de mentira: guarda issues e comentários em memória e conta as chamadas
// (é como o teste enxerga "o que foi mandado pra lá"). Usado pelos testes do
// espelho (ticket-linear.test.js) e do Hermes (ticket-hermes.test.js).
//
// `states` e `people` são os do time de cada teste. `addComment` simula um
// comentário escrito LÁ por alguém (o dev, o Hermes) — o `createComment` é o
// que o cockpit manda, com o autor sendo o dono da chave (`viewer`).
export function makeFakeLinear({ configured = true, states, people = [], viewer = { id: "u1", name: "Bot do Cockpit" } } = {}) {
  const issues = new Map();
  const comments = [];
  const calls = { create: 0, update: 0, comment: 0 };
  let seq = 0;
  const shape = (i) => ({
    id: i.id, identifier: i.identifier, url: i.url, title: i.title, description: i.description,
    priority: i.priority, updatedAt: i.updatedAt,
    state: states.find((s) => s.id === i.stateId) || states[0],
    project: i.projectId ? { id: i.projectId, name: "Suporte" } : null,
    team: { id: "team_1", key: "ENG", name: "Engenharia" },
    assignee: i.assigneeId ? { id: i.assigneeId, name: people.find((p) => p.id === i.assigneeId)?.name || "?" } : null,
    labels: { nodes: (i.labels || []).map((name) => ({ name })) },
  });
  const commentOut = (c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, url: "", user: c.user || { id: viewer.id, name: viewer.name } });
  return {
    issues, comments, calls,
    configured: () => configured,
    catalog: async () => [{
      id: "team_1", key: "ENG", name: "Engenharia", states,
      projects: [{ id: "proj_1", name: "Suporte", state: "started" }],
    }],
    createIssue: async (input) => {
      calls.create++;
      seq += 1;
      const i = {
        id: `iss_${seq}`, identifier: `ENG-${seq}`, url: `https://linear.app/acme/issue/ENG-${seq}`,
        title: input.title, description: input.description, priority: input.priority ?? 0,
        projectId: input.projectId || "", stateId: input.stateId || states[0].id, updatedAt: new Date().toISOString(),
        assigneeId: input.assigneeId || null, labels: input.labels || [],
      };
      issues.set(i.id, i);
      return shape(i);
    },
    updateIssue: async (id, input) => {
      calls.update++;
      const i = issues.get(id);
      if (!i) throw new Error("issue não existe");
      Object.assign(i, input, { stateId: input.stateId || i.stateId, updatedAt: new Date().toISOString() });
      return shape(i);
    },
    createComment: async (issueId, body) => {
      calls.comment++;
      const c = { id: `cmt_${comments.length + 1}`, issueId, body, createdAt: new Date().toISOString() };
      comments.push(c);
      return c;
    },
    addComment: ({ issueId, body, user }) => {
      const c = { id: `cmt_${comments.length + 1}`, issueId, body, user, createdAt: new Date(Date.now() + comments.length).toISOString() };
      comments.push(c);
      return commentOut(c);
    },
    issue: async (idOrKey) => {
      const found = [...issues.values()].find((i) => i.id === idOrKey || i.identifier === idOrKey);
      return found ? shape(found) : null;
    },
    issueWithComments: async (id) => {
      const i = issues.get(id);
      if (!i) return null;
      return { issue: { ...shape(i), createdAt: i.updatedAt }, comments: comments.filter((c) => c.issueId === id).map(commentOut) };
    },
    issuesUpdatedSince: async () => [...issues.values()].map((i) => ({ ...shape(i), comments: { nodes: [] } })),
    viewer: async () => ({ user: viewer, organization: { id: "o1", name: "Acme" } }),
    users: async () => people,
    shape: (id) => shape(issues.get(id)),
  };
}
