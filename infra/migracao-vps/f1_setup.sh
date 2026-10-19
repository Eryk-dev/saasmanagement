set -e
umask 077
[ -s /root/.cockpit-app-pw ] || openssl rand -hex 24 > /root/.cockpit-app-pw
PW=$(cat /root/.cockpit-app-pw)
docker exec -i leverads-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -v pw="$PW" <<'SQL'
select exists(select 1 from pg_roles where rolname='cockpit_app') as tem_role \gset
\if :tem_role
  \echo role cockpit_app ja existe
\else
  create role cockpit_app login password :'pw' nosuperuser nocreatedb nocreaterole noinherit;
\endif
select exists(select 1 from pg_database where datname='cockpit_ensaio') as tem_db \gset
\if :tem_db
  \echo database cockpit_ensaio ja existe
\else
  create database cockpit_ensaio owner cockpit_app;
\endif
revoke connect on database cockpit_ensaio from public;
revoke connect on database postgres from cockpit_app;
SQL
docker exec -i leverads-db psql -U supabase_admin -d cockpit_ensaio -v ON_ERROR_STOP=1 <<'SQL'
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
select current_database(), (select rolname from pg_roles r join pg_database d on d.datdba=r.oid where d.datname=current_database()) dono;
SQL
