set -e
umask 077
IMG=supabase/postgres:17.6.1.136
W=/opt/cockpit-migracao; mkdir -p $W
CLOUD=$(cat /root/.cockpit-cloud-dsn)
NOVO="postgresql://cockpit_app:$(cat /root/.cockpit-app-pw)@127.0.0.1:5432/${ALVO:-cockpit_ensaio}"
t0=$(date +%s)
docker run --rm --network host -v $W:/w --entrypoint pg_dump $IMG "$CLOUD" -Fc -n cockpit --no-owner --no-acl -f /w/cockpit.dump
t1=$(date +%s); echo "dump: $((t1-t0)) s, $(du -h $W/cockpit.dump | cut -f1)"
docker run --rm --network host -v $W:/w --entrypoint pg_restore $IMG -d "$NOVO" --no-owner --no-acl -j 4 /w/cockpit.dump
t2=$(date +%s); echo "restore: $((t2-t1)) s"
