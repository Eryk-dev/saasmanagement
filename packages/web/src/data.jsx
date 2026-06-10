import React from "react";
import { api } from "./lib/api.js";
import { computeFunnel } from "./charts.jsx";
// Central data layer: load window.SEED from the API, hydrate derived fields, and
// expose a context so any screen can mutate (create/edit/delete) and refresh.
//
// hydrateSeed lives here (not at saas_dashboard module-import time) so a refresh
// after a write re-derives decomp for the fresh records too.

function funnelAvgConv(s) {
  const fn = computeFunnel(s);
  return fn.length ? Math.round(fn.reduce((a, f) => a + f.conv, 0) / fn.length * 100) : 0;
}

// Attach the weighted-health decomposition every product card/health tab expects.
// Pesos vêm de product.healthWeights (em %, editados em Ajustes); fallback 25/25/25/25.
export function hydrateSeed(seed) {
  (seed?.SAAS || []).forEach((s) => {
    const hw = s.healthWeights || {};
    const w = (k) => (Number.isFinite(Number(hw[k])) ? Number(hw[k]) : 25) / 100;
    s.decomp = [
      { k: "Funil",   v: funnelAvgConv(s),                              w: w("funil") },
      { k: "Vendas",  v: Math.round(Math.min(100, (s.winRate || 0) * 200)),    w: w("vendas") },
      { k: "Cliente", v: Math.round(Math.min(100, (s.nrr || 0) * 70)),         w: w("cliente") },
      { k: "Uso",     v: Math.round(Math.min(100, (s.activation || 0) * 100)), w: w("uso") },
    ];
  });
}

// Fetch the whole dataset into window.SEED and hydrate it. Used at boot and on
// every refresh after a mutation.
export async function loadSeed() {
  const seed = await api.bootstrap();
  window.SEED = seed;
  hydrateSeed(seed);
  return seed;
}

// Provided by App. Screens consume the parts they need.
export const DataContext = React.createContext({
  version: 0,
  refresh: async () => {},
  openForm: () => {},
  openDelete: () => {},
});

export function useData() {
  return React.useContext(DataContext);
}
