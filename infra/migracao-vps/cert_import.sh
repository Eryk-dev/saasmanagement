set -e
umask 077
mkdir -p /data/coolify/proxy/certs
python3 -c '
import json, base64, sys
d = json.load(sys.stdin)
open("/data/coolify/proxy/certs/levermoney.com.br.crt", "wb").write(base64.b64decode(d["crt"]))
open("/data/coolify/proxy/certs/levermoney.com.br.key", "wb").write(base64.b64decode(d["key"]))
'
openssl x509 -in /data/coolify/proxy/certs/levermoney.com.br.crt -noout -subject -issuer -enddate
cat > /data/coolify/proxy/dynamic/cockpit-cert.yaml <<'Y'
# Corte do Cockpit (19/10/2026): certificado do levermoney.com.br copiado do Easypanel enquanto o
# Let's Encrypt do Coolify não consegue validar (DNS propagando). Remover quando o ACME emitir o próprio.
tls:
  certificates:
    - certFile: /traefik/certs/levermoney.com.br.crt
      keyFile: /traefik/certs/levermoney.com.br.key
Y
sleep 3
echo | openssl s_client -connect 127.0.0.1:443 -servername levermoney.com.br 2>/dev/null | openssl x509 -noout -subject -issuer
curl -s -m 10 --resolve levermoney.com.br:443:127.0.0.1 https://levermoney.com.br/api/health | head -c 60; echo
