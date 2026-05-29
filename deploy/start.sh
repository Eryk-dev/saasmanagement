#!/bin/sh
# Sobe API + MCP + nginx no mesmo container (POSIX sh — sem depender de bash).
# Se qualquer um dos três cair, encerra o container para o Easypanel reiniciar.

echo "[start] testando config do nginx:"
nginx -t 2>&1 || true

echo "[start] subindo API :8787 + MCP :8788 + nginx :80"
node packages/api/src/index.js & api=$!
node packages/mcp/src/index.js & mcp=$!
nginx -g 'daemon off;' & ng=$!

while kill -0 "$api" "$mcp" "$ng" 2>/dev/null; do
  sleep 5
done

echo "[start] um processo encerrou — derrubando o container para reinício"
exit 1
