// Registro das tools. Existe por três motivos, todos aprendidos na marra:
//
//  1. Erro nunca pode virar exceção do transporte — vira envelope de erro
//     legível (envelope.failure), senão o cliente só vê "tool failed".
//  2. Toda tool declara se LÊ ou ESCREVE (annotations do MCP). O cliente usa
//     isso pra pedir confirmação antes de gastar dinheiro ou mandar mensagem
//     pra pessoa de verdade.
//  3. O catálogo fica em memória pra tool `cockpit_help` conseguir se
//     descrever sozinha — o modelo não precisa adivinhar o que existe.

import { failure } from "./envelope.js";

// Chaveado por nome: o servidor é construído uma vez por SESSÃO MCP, e uma
// lista simples duplicaria o catálogo a cada cliente que conecta.
export const catalog = new Map();

export function makeTool(server) {
  return function tool(name, cfg, handler) {
    const {
      title,
      description,
      input,
      group = "geral",
      write = false,
      destructive = false,
      external = false,
      danger = "",
    } = cfg;

    catalog.set(name, { name, group, title, description, write, destructive, danger });

    server.registerTool(name, {
      title,
      description: danger ? `${description} ⚠️ ${danger}` : description,
      ...(input ? { inputSchema: input } : {}),
      annotations: {
        // `title` já vai no campo próprio da tool — repetir aqui é o mesmo texto
        // duas vezes em cada uma das ~230 entradas do catálogo, que o cliente
        // carrega inteiro em toda sessão.
        readOnlyHint: !write,
        destructiveHint: !!destructive,
        idempotentHint: !write || !!cfg.idempotent,
        // Meta, Google, Mercado Pago, Anthropic e WhatsApp são mundo aberto.
        openWorldHint: !!external,
      },
    }, async (args, extra) => {
      try {
        return await handler(args || {}, extra);
      } catch (err) {
        return failure(err, { hint: cfg.hint });
      }
    });
  };
}
