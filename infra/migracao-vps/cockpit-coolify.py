"""Cockpit no Coolify da VPS (migração do Easypanel, 19/10/2026). Mesmo padrão do /opt/leverads/corte-coolify.py.

  criar        cria o app (repo público, Dockerfile.allinone, porta 80, 2 vCPU / 2 GB, sem domínio, sem deploy)
  envs         sobe /opt/cockpit-migracao/env-cockpit.env (só nomes e contagem na saída)
  deploy       dispara o deploy e espera terminar
  dominio      põe https://levermoney.com.br no app (só no corte)
  status       uuid, fqdn, status e últimas variáveis (nomes)
"""
import json, os, sys, time, urllib.request

A = "http://localhost:8000/api/v1"
T = open("/root/.coolify-api-token").read().strip()
LEV = dict(l.strip().split("=", 1) for l in open("/opt/leverads/coolify-ids.env") if "=" in l)
W = "/opt/cockpit-migracao"
IDS_FILE = f"{W}/coolify-ids.env"
FORA = {"GIT_SHA", "DEPLOY_TIMESTAMP"}  # carimbos do Easypanel, sem uso no código


def req(metodo, caminho, corpo=None):
    r = urllib.request.Request(A + caminho, method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None)
    r.add_header("Authorization", "Bearer " + T); r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read() or b"{}")


def app_uuid():
    return dict(l.strip().split("=", 1) for l in open(IDS_FILE) if "=" in l)["COOLIFY_APP_COCKPIT"]


def criar():
    if os.path.exists(IDS_FILE):
        print("já existe:", app_uuid()); return
    corpo = {
        "project_uuid": LEV["COOLIFY_PROJECT"], "environment_uuid": LEV["COOLIFY_ENV"], "environment_name": "production",
        "server_uuid": LEV["COOLIFY_SERVER"],
        "git_repository": "https://github.com/Eryk-dev/saasmanagement", "git_branch": "main",
        "build_pack": "dockerfile", "dockerfile_location": "/Dockerfile.allinone", "ports_exposes": "80",
        "name": "cockpit", "description": "Cockpit (saasmanagement): api + mcp + nginx",
        "domains": "", "autogenerate_domain": False, "instant_deploy": False,
        "limits_cpus": "2", "limits_memory": "2g", "health_check_enabled": False,
    }
    r = req("POST", "/applications/public", corpo)
    with open(IDS_FILE, "w") as f: f.write(f"COOLIFY_APP_COCKPIT={r['uuid']}\n")
    print("criado:", r["uuid"])


def envs():
    u = app_uuid(); dados = []
    for linha in open(f"{W}/env-cockpit.env"):
        linha = linha.rstrip("\n")
        if not linha or linha.startswith("#") or "=" not in linha: continue
        k, v = linha.split("=", 1)
        if k in FORA: continue
        dados.append({"key": k, "value": v, "is_preview": False, "is_literal": True, "is_multiline": False, "is_shown_once": False})
    req("PATCH", f"/applications/{u}/envs/bulk", {"data": dados})
    # O bulk só cria/atualiza: o que saiu do arquivo (ex.: JOBS_ENABLED=0 no corte) sai do app aqui.
    enviadas = {d["key"] for d in dados}
    for e in req("GET", f"/applications/{u}/envs"):
        if e["key"] not in enviadas:
            req("DELETE", f"/applications/{u}/envs/{e['uuid']}"); print("removida:", e["key"])
    chaves = sorted({e["key"] for e in req("GET", f"/applications/{u}/envs") if not e.get("is_preview")})
    print(f"{len(dados)} enviadas, {len(chaves)} no app")


def deploy():
    u = app_uuid()
    d = req("POST", f"/deploy?uuid={u}&force=false")["deployments"][0]
    du = d["deployment_uuid"]; print("deployment", du, d.get("message")); t0 = time.time()
    while True:
        st = req("GET", f"/deployments/{du}").get("status")
        if st in ("finished", "failed", "cancelled-by-user"):
            print(f"{st} em {int(time.time() - t0)}s"); return 0 if st == "finished" else 1
        time.sleep(5)


def dominio():
    u = app_uuid()
    req("PATCH", f"/applications/{u}", {"domains": "https://levermoney.com.br"})
    print("fqdn =", req("GET", f"/applications/{u}").get("fqdn"))


def status():
    a = req("GET", f"/applications/{app_uuid()}")
    print({k: a.get(k) for k in ("uuid", "name", "fqdn", "status", "git_repository", "git_branch", "dockerfile_location", "limits_cpus", "limits_memory")})


cmd = sys.argv[1:] or [""]
acoes = {"criar": criar, "envs": envs, "deploy": deploy, "dominio": dominio, "status": status}
if cmd[0] in acoes:
    sys.exit(acoes[cmd[0]]() or 0)
print(__doc__)
