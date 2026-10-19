set -e
IMG=supabase/postgres:17.6.1.136
CLOUD=$(cat /root/.cockpit-cloud-dsn)
NOVO="postgresql://cockpit_app:$(cat /root/.cockpit-app-pw)@127.0.0.1:5432/${ALVO:-cockpit_ensaio}"
SQL="select string_agg(format('select %L t, count(*) n from cockpit.%I', tablename, tablename), ' union all ' order by tablename) from pg_tables where schemaname='cockpit'"
conta() { Q=$(docker run --rm --network host --entrypoint psql $IMG "$1" -Atc "$SQL"); docker run --rm --network host --entrypoint psql $IMG "$1" -At -F' ' -c "begin read only; $Q order by 1; rollback;" | grep -v -E '^(BEGIN|ROLLBACK)$'; }
conta "$CLOUD" > /tmp/c_cloud.txt; conta "$NOVO" > /tmp/c_novo.txt
echo "tabelas cloud=$(wc -l < /tmp/c_cloud.txt) novo=$(wc -l < /tmp/c_novo.txt)"
diff /tmp/c_cloud.txt /tmp/c_novo.txt && echo "CONTAGEM IGUAL" || echo "DIFERENCAS ACIMA (< cloud, > novo)"
