# Splash Loading CRM

Referência fornecida por Leonardo em 16/09/2026:
https://claude.ai/design/p/41865284-96e1-4bff-a622-e2a967dd7089?file=Splash+Loading+CRM.dc.html

Importação pelo ZIP original «Project HTML» da interface autenticada do Claude
Design; o MCP claude_design não estava disponível na sessão. Os arquivos da
seleção e suas dependências foram preservados aqui, sem alterações.

A implementação React está em `packages/web/src/components/screen-loading.jsx`.
Preserva o SVG, a órbita e os tempos de entrada/saída da referência; usa os tokens
do cockpit e respeita redução de movimento. A prévia original tem um ciclo
cronometrado de demonstração; o cockpit espera as consultas reais. O runtime
`support.js` e o bundle de componentes do editor não integram o build do app.
