set -e
cd /opt/cockpit-migracao
python3 env_build.py cockpit prod | head -2
python3 cockpit-coolify.py envs
python3 cockpit-coolify.py dominio
python3 cockpit-coolify.py deploy
c=$(docker ps --format '{{.Names}}' | grep '^sbul93ds9dvqfnkkccysymsg' | head -1)
docker exec -i $c node -e "fetch('http://127.0.0.1/api/health').then(r=>r.json()).then(h=>console.log('health', h.ok, h.build))"
docker exec -i $c node -e "console.log('JOBS_ENABLED=', process.env.JOBS_ENABLED ?? '(nao definido)', 'db=', new URL(process.env.COCKPIT_DB_URL).pathname)"
