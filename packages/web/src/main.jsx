// Boot sequence: load tokens, install fmt on window, fetch the full dataset from
// the API into window.SEED, THEN dynamically import the app. The dynamic import
// guarantees every (faithful) component module evaluates after window.SEED/window.fmt
// exist — so modules that read window.SEED at import time keep working unchanged.
//
// Auth: if the API answers 401, we show a small unlock screen. The entered key is
// stored (localStorage) and every request carries it from then on.

import "./tokens.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { fmt } from "./lib/format.js";
import { loadSeed } from "./data.jsx";
import { api, setKey } from "./lib/api.js";
import { ErrorBoundary } from "./components/error-boundary.jsx";

const root = createRoot(document.getElementById("root"));

function Shell({ children }) {
  return (
    <div style={{
      height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 14, color: "var(--fg-3)", fontFamily: "var(--sans)", background: "var(--bg-0)",
    }}>
      <div style={{ fontSize: 14, color: "var(--fg-1)", fontWeight: 600 }}>Cockpit</div>
      {children}
    </div>
  );
}

function Loading({ error }) {
  return (
    <Shell>
      {error
        ? <div style={{ fontSize: 12, color: "var(--neg)", maxWidth: 420, textAlign: "center" }}>
            Could not reach the API.<br />Is it running on the configured base? <br />
            <span className="mono" style={{ fontSize: 11 }}>{String(error.message || error)}</span>
          </div>
        : <div style={{ fontSize: 12 }}>loading portfolio…</div>}
    </Shell>
  );
}

// Login do time (substitui a tela de chave). O token de sessão vai pro mesmo
// localStorage/header da key, então o resto do app não muda.
function Login() {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const inputStyle = { height: 34, padding: "0 10px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13 };

  async function submit(e) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true); setError(null);
    try {
      const { token, user } = await api.login(username.trim(), password);
      setKey(token);
      try { localStorage.setItem("cockpit_user", JSON.stringify(user)); } catch { /* ignore */ }
      // Reload completo (não boot() in-place): re-render a partir de um handler
      // deixava a árvore nova sem responder a cliques reais — recarregar relê o
      // token do localStorage e sobe o app limpo.
      location.reload();
    } catch (err) {
      setBusy(false);
      setError(err.status === 401 ? "usuário ou senha inválidos" : (err.message || String(err)));
    }
  }
  return (
    <Shell>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, width: 280, alignItems: "stretch" }}>
        <div className="mono dim" style={{ fontSize: 12, textAlign: "center" }}>Acesso restrito · entre com seu usuário</div>
        <input
          value={username} autoFocus placeholder="usuário" autoComplete="username"
          onChange={(e) => setUsername(e.target.value)} style={inputStyle}
        />
        <input
          type="password" value={password} placeholder="senha" autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} style={inputStyle}
        />
        {error && <div className="mono" style={{ fontSize: 11, color: "var(--neg)", textAlign: "center" }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ height: 34, background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </Shell>
  );
}

async function boot() {
  try {
    await loadSeed();
    const { App } = await import("./app.jsx");
    // Rede de segurança final: se algo na árvore quebrar sem ser contido por uma
    // fronteira mais interna, mostra um cartão em vez da tela branca.
    root.render(<ErrorBoundary label="app"><App /></ErrorBoundary>);
  } catch (err) {
    if (err && err.status === 401) { root.render(<Login />); return; }
    console.error(err);
    root.render(<Loading error={err} />);
  }
}

window.fmt = fmt;
root.render(<Loading />);
boot();
