// Oito pessoas fictícias para conferir densidade, papéis e super metas.
// Ativado somente no preview: /?shell=1&team=1#overview.
const people = [
  ["ana", "Ana Martins", ["sdr"]],
  ["bruno", "Bruno Oliveira", ["closer", "integrator"]],
  ["carla", "Carla Souza", ["closer"]],
  ["daniel", "Daniel Almeida", ["closer"]],
  ["elisa", "Elisa Fernandes", ["closer"]],
  ["fabio", "Fábio Albuquerque de Oliveira", ["closer"]],
  ["gabriel", "Gabriel Lima", ["integrator"]],
  ["helena", "Helena Santos", ["social"]],
];
const person = id => ({ user: `team-${id}`, name: people.find(p => p[0] === id)[1] });
const goal = (target, level = 3) => ({ target, period: "month", scope: "remuneracao", level });
const closer = (id, revenue, won, target = 180000, contracts = 35) => ({
  ...person(id), revenue, won, contracted: revenue + 12000, callsShown: 24, conversaoCall: 33,
  goals: { revenue: goal(target), won: goal(contracts), callsShown: goal(40), conversaoCall: goal(33) },
});

export const teamPreviewScore = {
  sdr: [{ ...person("ana"), revenue: 85800, won: 19, callsBooked: 42, contactRate: 82, bookingRate: 36, showRate: 78,
    goals: { revenue: goal(225000, 2), won: goal(55, 2), callsBooked: goal(60) } }],
  closer: [
    closer("bruno", 230000, 44),
    closer("carla", 188000, 36),
    closer("daniel", 14700, 5, 90000, 20),
    closer("elisa", 0, 0, 90000, 20),
    closer("fabio", 4500, 1, 0, 0),
  ],
  cs: [
    { ...person("bruno"), activeAccounts: 16, retentionRate: 98, nps: 84, npsCount: 8, referrals: 2, goals: {} },
    { ...person("gabriel"), activeAccounts: 28, retentionRate: 96, nps: 88, npsCount: 12, referrals: 4, goals: {} },
  ],
  social: [{ ...person("helena"), postsPerMonth: 14, storiesPerMonth: 36, adsPerMonth: 8,
    goals: { postsPerMonth: goal(24), storiesPerMonth: goal(60), adsPerMonth: goal(10) } }],
};

export function setupTeamPreview(seed) {
  seed.USERS.push(...people.map(([id, name, roles]) => ({ id: `team-${id}`, name, roles, saas: "leverads" })));
}
