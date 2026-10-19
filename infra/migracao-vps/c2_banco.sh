set -e
umask 077
cd /opt/cockpit-migracao
echo "== conexoes do Cockpit no Cloud (esperado: nenhuma de app)"
docker run --rm --network host --entrypoint psql supabase/postgres:17.6.1.136 "$(cat /root/.cockpit-cloud-dsn)" -Atc "select coalesce(application_name,'-'), count(*) from pg_stat_activity where usename='postgres' and pid<>pg_backend_pid() and backend_type='client backend' group by 1"
echo "== database cockpit"
docker exec -i leverads-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select exists(select 1 from pg_database where datname='cockpit') as tem \gset
\if :tem
  \echo database cockpit JA EXISTE - abortando para nao sobrescrever
  \quit 3
\endif
create database cockpit owner cockpit_app;
revoke connect on database cockpit from public;
SQL
docker exec -i leverads-db psql -U supabase_admin -d cockpit -v ON_ERROR_STOP=1 -c 'create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";'
echo "== dump/restore"
ALVO=cockpit bash /opt/cockpit-migracao/f1_dump_restore.sh
echo "== contagem"
ALVO=cockpit bash /opt/cockpit-migracao/f1_contagem.sh
