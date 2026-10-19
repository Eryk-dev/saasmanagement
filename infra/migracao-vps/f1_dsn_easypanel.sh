# Roda no Easypanel. Imprime o COCKPIT_DB_URL convertido para CONEXAO DIRETA (db.<ref>.supabase.co:5432,
# usuario postgres), sem pooler: pg_dump faz SET de sessao e nao pode passar pelo Supavisor.
cid=$(docker ps -q -f name=extrator_mp_saasmngmnt | head -1)
docker inspect "$cid" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^COCKPIT_DB_URL=//p' \
 | sed -E 's#^postgres(ql)?://postgres\.([a-z0-9]+):([^@]*)@[^/]*/([^?]*).*#postgresql://postgres:\3@db.\2.supabase.co:5432/\4?sslmode=require#'
