# Roda na VPS. Uso: env_build.py <database> [prod]. Sem prod, desliga os jobs. Le o env do servico do Easypanel (JSON) e escreve o env do Cockpit no Coolify.
# Nunca imprime valores: so nomes e contagens.
import json, re, sys
from urllib.parse import urlsplit, urlunsplit
W = "/opt/cockpit-migracao"
src = json.load(open(f"{W}/env-easypanel.json"))
env = dict(l.split("=", 1) for l in src if "=" in l)
pw = open("/root/.cockpit-app-pw").read().strip()
db = sys.argv[1] if len(sys.argv) > 1 else "cockpit_ensaio"
env["COCKPIT_DB_URL"] = f"postgresql://cockpit_app:{pw}@leverads-db:5432/{db}?sslmode=require"
if env.get("LEVERCOPY_DB_URL"):
    u = urlsplit(env["LEVERCOPY_DB_URL"])
    netloc = re.sub(r"@[^@]+$", "@leverads-db:5432", u.netloc)
    env["LEVERCOPY_DB_URL"] = urlunsplit((u.scheme, netloc, u.path, "sslmode=require", ""))
prod = len(sys.argv) > 2 and sys.argv[2] == "prod"
if prod: env.pop("JOBS_ENABLED", None)
else: env["JOBS_ENABLED"] = "0"
with open(f"{W}/env-cockpit.env", "w") as f:
    for k in sorted(env): f.write(f"{k}={env[k]}\n")
print(f"{len(src)} variaveis no Easypanel -> {len(env)} no env do Coolify (db={db})")
print("trocadas: COCKPIT_DB_URL, LEVERCOPY_DB_URL" if "LEVERCOPY_DB_URL" in env else "trocada: COCKPIT_DB_URL (sem LEVERCOPY_DB_URL)", "+ jobs " + ("como no Easypanel" if prod else "desligados (JOBS_ENABLED=0)"))
print("nomes:", " ".join(sorted(env)))
