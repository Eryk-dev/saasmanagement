// Views salvas (Lever CRM, transversais): um seletor com as views da pessoa
// naquela tela, "salvar os filtros atuais" e apagar a que está aplicada. Fica
// no servidor (/api/views), então segue a pessoa de máquina em máquina.

import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { SelectPopover } from "./select-popover.jsx";
import { toast } from "../atoms.jsx";

const SAVE = "__salvar__";
const DELETE = "__apagar__";

export function SavedViewsPicker({ screen, filters, onApply }) {
  const [views, setViews] = useState([]);
  const [current, setCurrent] = useState("");
  const load = () => api.savedViews(screen).then((r) => setViews(r.views || [])).catch(() => {});
  useEffect(() => { load(); }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(v) {
    if (v === SAVE) {
      const name = window.prompt("Nome da view (os filtros atuais ficam salvos com ela):");
      if (!name || !name.trim()) return;
      try {
        const saved = await api.saveView(screen, name.trim(), filters);
        await load();
        setCurrent(saved.id);
        toast(`View "${saved.name}" salva`, "pos");
      } catch (e) { toast(`${e.message || "Não foi possível salvar"} · tente de novo`, "neg"); }
      return;
    }
    if (v === DELETE) {
      const view = views.find((x) => x.id === current);
      if (!view || !window.confirm(`Apagar a view "${view.name}"? Os filtros da tela não mudam.`)) return;
      try { await api.deleteView(view.id); setCurrent(""); await load(); }
      catch (e) { toast(`${e.message || "Não foi possível apagar"} · tente de novo`, "neg"); }
      return;
    }
    const view = views.find((x) => x.id === v);
    if (!view) return;
    setCurrent(view.id);
    onApply(view.filters || {});
  }

  const options = [
    ...views.map((v) => ({ value: v.id, label: v.name })),
    { value: SAVE, label: "Salvar os filtros atuais…", hint: "nova view" },
    ...(current ? [{ value: DELETE, label: "Apagar esta view", tone: "neg" }] : []),
  ];
  return <SelectPopover label="Views salvas" value={current} onChange={pick} width={240} placeholder="Views"
    style={{ height: 34, border: 0, padding: "0 15px", borderRadius: 999, background: current ? "var(--accent-soft)" : "var(--bg-2)", fontWeight: 600, color: current ? "var(--accent)" : "var(--fg-2)" }}
    options={options} />;
}
