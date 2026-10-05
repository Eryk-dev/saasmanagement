// Códigos de resposta que ATRAVESSAM o proxy.
//
// O proxy do EasyPanel (Traefik) intercepta QUALQUER 5xx e troca o corpo pela
// página dele ("Service is not reachable"). Ou seja: toda vez que a gente
// respondia 502/503 com o motivo em JSON, quem estava na tela via um HTML de
// infraestrutura e ficava sem saber que a Meta tinha recusado, que o Google
// não estava conectado ou que faltava uma credencial. Foi assim que um simples
// "conta com chamadas demais na Meta" virou "o cockpit caiu".
//
// Então erro de dependência externa sai como 4xx, que o proxy deixa passar:
//   UPSTREAM_FAILED (424) — o serviço externo respondeu erro, caiu ou recusou.
//   NOT_CONFIGURED  (424) — falta credencial/integração pra sequer tentar.
// 5xx fica reservado pra bug NOSSO, que é o que 5xx quer dizer de verdade.
export const UPSTREAM_FAILED = 424;
export const NOT_CONFIGURED = 424;
