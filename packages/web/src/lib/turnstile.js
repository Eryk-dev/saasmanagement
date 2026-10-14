// Cloudflare Turnstile nos formulários do LeverId (entrar, esqueci a senha e
// confirmar a senha atual na troca), atrás de VITE_TURNSTILE_SITE_KEY.
//
// Com o captcha do GoTrue ligado (CAPTCHA_ENABLED no LeverId), toda chamada de
// senha ao GoTrue pelo navegador precisa do token: sem ele a identidade
// responde 500 ("no captcha response"), com token recusado 400
// (captcha_failed). Cada token vale uma verificação: quem usa desenha um
// widget novo depois de cada tentativa (`key` do componente). Sem a chave,
// nada é carregado e as telas ficam como sempre foram. O que o servidor do
// cockpit chama no GoTrue vai com a chave de serviço, que o captcha dispensa.

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let siteKey = (import.meta.env && import.meta.env.VITE_TURNSTILE_SITE_KEY) || "";
let loading = null;

const api = () => globalThis.turnstile;

// Só para testes: troca a chave de build.
export function setTurnstileKeyForTest(key) { siteKey = key; }

export const turnstileEnabled = () => !!siteKey;

function load() {
  loading ??= new Promise((resolve, reject) => {
    if (api()) return resolve(api());
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (api() ? resolve(api()) : reject(new Error("turnstile")));
    script.onerror = () => reject(new Error("turnstile"));
    document.head.appendChild(script);
  }).catch((err) => {
    loading = null; // sem rede: a próxima tela tenta de novo
    throw err;
  });
  return loading;
}

// Desenha o widget em `el`; `onToken` recebe o token, ou "" quando ele expira
// ou o desafio falha. Devolve a função que remove o widget.
export function renderTurnstile(el, onToken, action = "login") {
  let id = null;
  let alive = true;
  load()
    .then((t) => {
      if (!alive) return;
      id = t.render(el, {
        sitekey: siteKey,
        action,
        language: "pt-br",
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    })
    .catch(() => onToken(""));
  return () => {
    alive = false;
    if (id) api()?.remove(id);
  };
}

// Mensagem para a recusa do captcha pelo GoTrue (null = não é captcha).
export function captchaError(err) {
  if (!err) return null;
  if (err.code === "captcha_failed" || /captcha/i.test(err.message || "")) {
    return "a verificação anti-robô não passou — espere ela concluir e tente de novo";
  }
  return null;
}
