// Boot sequence: load tokens, install fmt on window, fetch the full dataset from
// the API into window.SEED, THEN dynamically import the app. The dynamic import
// guarantees every (faithful) component module evaluates after window.SEED/window.fmt
// exist — so modules that read window.SEED at import time (e.g. saas_dashboard's
// health decomposition hydration) keep working unchanged.

import "./tokens.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { fmt } from "./lib/format.js";
import { api } from "./lib/api.js";

const root = createRoot(document.getElementById("root"));

function Loading({ error }) {
  return (
    <div style={{
      height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 10, color: "var(--fg-3)", fontFamily: "var(--sans)",
    }}>
      <div style={{ fontSize: 14, color: "var(--fg-1)", fontWeight: 600 }}>Cockpit · Portfolio OS</div>
      {error
        ? <div style={{ fontSize: 12, color: "var(--neg)", maxWidth: 420, textAlign: "center" }}>
            Could not reach the API.<br />Is it running on the configured base? <br />
            <span className="mono" style={{ fontSize: 11 }}>{String(error.message || error)}</span>
          </div>
        : <div style={{ fontSize: 12 }}>loading portfolio…</div>}
    </div>
  );
}

(async () => {
  window.fmt = fmt;
  root.render(<Loading />);
  try {
    window.SEED = await api.bootstrap();
    const { App } = await import("./app.jsx");
    root.render(<App />);
  } catch (err) {
    console.error(err);
    root.render(<Loading error={err} />);
  }
})();
