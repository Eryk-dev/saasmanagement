// Boot sequence: load tokens, install fmt on window, then fetch the dataset into
// window.SEED AND download the app chunk in parallel (17/09/2026: esperar o
// bootstrap pra só então pedir o app.js custava um round-trip inteiro a mais).
// The App only renders after both settle, so components still find SEED — but
// NO module may read window.SEED at import time (only inside functions).
//
// Auth: if the API answers 401, we show the login screen. With VITE_AUTH_URL the
// login goes through the central identity (GoTrue, lib/identity.js); the old
// cockpit login stays available during the transition.

import "./tokens.css";
import "./capsule.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { fmt } from "./lib/format.js";
import { loadSeed } from "./data.jsx";
import { api, setKey } from "./lib/api.js";
import { clearCredentials, hasIdentitySession, identity, identityEnabled, readRecoveryHash, requestPasswordEmail, setPasswordFromRecovery } from "./lib/identity.js";
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

// Sessão da identidade guardada: sobe o cliente já no boot, para o auth-js
// renovar o access token (600 s) enquanto a aba estiver aberta.
if (hasIdentitySession()) identity();

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

// Login do time. Com a identidade central ligada (VITE_AUTH_URL), entra por
// e-mail e senha da conta Lever; o login antigo do cockpit (usuário + senha)
// fica disponível durante a transição. Depois do login, recarrega a página:
// re-render a partir de um handler deixava a árvore nova sem responder a
// cliques reais — recarregar relê a credencial e sobe o app limpo.
function Login() {
  const [lever, setLever] = React.useState(identityEnabled);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const inputStyle = { height: 34, padding: "0 10px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13 };

  // Esqueci a senha da conta Lever: o GoTrue manda o link de definir senha.
  async function forgot() {
    const email = username.trim();
    if (!email.includes("@")) { setError("digite seu e-mail acima e clique de novo"); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestPasswordEmail(email);
      setNotice(`se ${email} tiver conta Lever, chega um link para definir a senha`);
    } catch (err) { setError(err.message || String(err)); }
    setBusy(false);
  }

  const remember = (user) => { try { localStorage.setItem("cockpit_user", JSON.stringify(user)); } catch { /* ignore */ } };

  async function submitLever() {
    await clearCredentials();
    const { error: err } = await identity().signInWithPassword({ email: username.trim(), password });
    if (err) throw Object.assign(new Error(err.code === "invalid_credentials" ? "e-mail ou senha inválidos" : err.message), { shown: true });
    try {
      remember(await api.me());
    } catch (e) {
      await clearCredentials();
      if (e.status === 401) throw Object.assign(new Error("sua conta Lever ainda não tem acesso ao cockpit — peça a um admin para liberar"), { shown: true });
      throw e;
    }
  }

  async function submitLegacy() {
    await clearCredentials();
    const { token, user } = await api.login(username.trim(), password);
    setKey(token);
    remember(user);
  }

  async function submit(e) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true); setError(null);
    try {
      await (lever ? submitLever() : submitLegacy());
      location.reload();
    } catch (err) {
      setBusy(false);
      setError(err.shown ? err.message : err.status === 401 ? "usuário ou senha inválidos" : (err.message || String(err)));
    }
  }
  const switchMode = () => { setLever((v) => !v); setError(null); setNotice(null); setUsername(""); setPassword(""); };
  return (
    <Shell>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, width: 280, alignItems: "stretch" }}>
        <div className="mono dim" style={{ fontSize: 12, textAlign: "center" }}>
          {lever ? "Acesso restrito · entre com sua conta Lever" : "Acesso restrito · entre com seu usuário"}
        </div>
        <input
          value={username} autoFocus type={lever ? "email" : "text"} placeholder={lever ? "e-mail" : "usuário"} autoComplete={lever ? "email" : "username"}
          aria-label={lever ? "e-mail" : "usuário"}
          onChange={(e) => setUsername(e.target.value)} style={inputStyle}
        />
        <input
          type="password" value={password} placeholder="senha" autoComplete="current-password" aria-label="senha"
          onChange={(e) => setPassword(e.target.value)} style={inputStyle}
        />
        {error && <div role="alert" className="mono" style={{ fontSize: 11, color: "var(--neg)", textAlign: "center" }}>{error}</div>}
        {notice && <div role="status" className="mono" style={{ fontSize: 11, color: "var(--pos)", textAlign: "center" }}>{notice}</div>}
        <button type="submit" disabled={busy} style={{ height: 34, background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        {lever && (
          <button type="button" onClick={forgot} disabled={busy} className="mono dim" style={{ fontSize: 11, textDecoration: "underline" }}>
            esqueci minha senha
          </button>
        )}
        {identityEnabled && (
          <button type="button" onClick={switchMode} className="mono dim" style={{ fontSize: 11, textDecoration: "underline" }}>
            {lever ? "usar o login antigo do cockpit" : "entrar com a conta Lever"}
          </button>
        )}
      </form>
    </Shell>
  );
}

// Volta do link "defina sua senha" (e-mail da conta Lever). O hash traz a
// sessão do link: sai da barra de endereço na hora (não fica no histórico) e
// só vive na memória até a senha nova ser gravada.
function SetPassword({ recovery }) {
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [noAccess, setNoAccess] = React.useState(false);
  React.useEffect(() => { try { history.replaceState(null, "", location.pathname + location.search); } catch { /* ignore */ } }, []);
  const inputStyle = { height: 34, padding: "0 10px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13 };
  const toLogin = () => location.reload();

  if (recovery.error || noAccess) {
    return <Shell>
      <div role="alert" className="mono" style={{ maxWidth: 300, fontSize: 12, textAlign: "center", color: noAccess ? "var(--fg-2)" : "var(--neg)" }}>
        {noAccess ? "senha definida · sua conta Lever ainda não tem acesso ao cockpit — peça a um admin para liberar"
          : "o link expirou ou já foi usado — peça outro em “esqueci minha senha”"}
      </div>
      <button type="button" onClick={toLogin} className="mono dim" style={{ fontSize: 11, textDecoration: "underline" }}>ir para o login</button>
    </Shell>;
  }

  async function submit(e) {
    e.preventDefault();
    if (password.length < 8) { setError("a senha precisa de 8+ caracteres"); return; }
    if (password !== confirm) { setError("as duas senhas não conferem"); return; }
    setBusy(true); setError(null);
    try {
      await setPasswordFromRecovery(recovery, password);
      try { localStorage.setItem("cockpit_user", JSON.stringify(await api.me())); }
      catch (err) {
        if (err.status === 401) { await clearCredentials(); setNoAccess(true); return; }
        throw err;
      }
      location.reload();
    } catch (err) {
      setBusy(false);
      setError(err.message || String(err));
    }
  }
  return (
    <Shell>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, width: 280, alignItems: "stretch" }}>
        <div className="mono dim" style={{ fontSize: 12, textAlign: "center" }}>Defina a senha da sua conta Lever</div>
        <input type="password" value={password} autoFocus placeholder="senha nova (8+)" autoComplete="new-password" aria-label="senha nova"
          onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
        <input type="password" value={confirm} placeholder="repita a senha" autoComplete="new-password" aria-label="repita a senha"
          onChange={(e) => setConfirm(e.target.value)} style={inputStyle} />
        {error && <div role="alert" className="mono" style={{ fontSize: 11, color: "var(--neg)", textAlign: "center" }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ height: 34, background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Salvando…" : "Salvar senha e entrar"}
        </button>
      </form>
    </Shell>
  );
}

async function loadApp() {
  const [, { App }] = await Promise.all([loadSeed(), import("./app.jsx")]);
  // Sessão que caiu no meio do uso (lib/api.js apagou a credencial): volta ao login.
  window.addEventListener("cockpit:session-lost", () => location.reload(), { once: true });
  return App;
}

window.fmt = fmt;
const recovery = identityEnabled ? readRecoveryHash() : null;
root.render(recovery
  ? <SetPassword recovery={recovery} />
  : <AppStartup loadApp={loadApp} renderError={(error) => <StartupError error={error} />} />);
