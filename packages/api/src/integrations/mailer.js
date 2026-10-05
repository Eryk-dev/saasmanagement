// Mailer — camada fina de envio de e-mail, ponto ÚNICO de troca de provedor.
// Hoje envia pela conta Google conectada (Gmail API, escopo gmail.send). Trocar
// por um ESP (Resend/SES/SendGrid) no futuro = só reescrever `send`/`ready`
// aqui; disparos e sequências chamam sempre `mailer.send(...)`.
export function makeMailer({ google } = {}) {
  return {
    provider: "gmail",
    // Pronto pra enviar? (conta conectada COM o escopo gmail.send concedido).
    async ready() {
      return google?.gmailReady ? !!(await google.gmailReady()) : false;
    },
    // { to, subject, text|html, fromName?, headers? } → { id } | lança em falha.
    async send(msg) {
      if (!google?.sendGmail) throw new Error("mailer: provedor de e-mail indisponível");
      return google.sendGmail(msg);
    },
  };
}
