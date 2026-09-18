// Boot sequence: load tokens, install fmt on window, then fetch the dataset into
// window.SEED AND download the app chunk in parallel (17/09/2026: esperar o
// bootstrap pra só então pedir o app.js custava um round-trip inteiro a mais).
// The App only renders after both settle, so components still find SEED — but
// NO module may read window.SEED at import time (only inside functions).
//
// Auth: if the API answers 401, we show a small unlock screen. The entered key is
// stored (localStorage) and every request carries it from then on.

import "./tokens.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { fmt } from "./lib/format.js";
import { loadSeed } from "./data.jsx";
import { api, setKey } from "./lib/api.js";
import { AppStartup } from "./components/screen-loading.jsx";

// O cockpit NÃO usa service worker. Um SW zumbi (registrado por site que morou
// no domínio antes) intercepta a navegação e serve um shell velho do cache pra
// QUALQUER caminho, mesmo com o servidor atualizado — em 25/07 isso prendeu o
// navegador do Leo num build antigo. Desregistra qualquer um e limpa os caches
// dele; o /sw.js mata-zumbi (public/) cobre as abas que nem chegam a rodar
// este código.
try {
  navigator.serviceWorker?.getRegistrations?.().then((rs) => {
    if (!rs.length) return;
    rs.forEach((r) => r.unregister());
    window.caches?.keys?.().then((ks) => ks.forEach((k) => caches.delete(k)));
  }).catch(() => {});
} catch { /* navegador sem suporte: nada a limpar */ }

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

function StartupError({ error }) {
  if (error?.status === 401) return <Login />;
  return <Shell>
    <div role="alert" style={{ maxWidth: 360, padding: 20, textAlign: "center", fontSize: 13 }}>
      Não foi possível carregar o cockpit. Tente novamente em instantes.
    </div>
    <button type="button" onClick={() => location.reload()} style={{ padding: "10px 16px", borderRadius: "var(--r-2)", background: "var(--btn-bg)", color: "var(--btn-fg)" }}>Tentar novamente</button>
  </Shell>;
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
        <button type="submit" disabled={busy} style={{ height: 34, background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </Shell>
  );
}

async function loadApp() {
  const [, { App }] = await Promise.all([loadSeed(), import("./app.jsx")]);
  return App;
}

window.fmt = fmt;
root.render(<AppStartup loadApp={loadApp} renderError={(error) => <StartupError error={error} />} />);
