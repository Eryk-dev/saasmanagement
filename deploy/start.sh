#!/usr/bin/env bash
# Sobe API + MCP (em background) e nginx (foreground) no mesmo container.
# Se qualquer um morrer, derruba o container para o Easypanel reiniciar.
set -euo pipefail

echo "[start] API :8787 + MCP :8788 + nginx :80"
node packages/api/src/index.js &
node packages/mcp/src/index.js &
nginx -g 'daemon off;' &

wait -n
echo "[start] um processo encerrou — derrubando o container para reinício"
exit 1
