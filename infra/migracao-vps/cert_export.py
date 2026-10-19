# Roda no Easypanel: imprime em JSON o cert+key de levermoney.com.br do acme.json (vai direto por pipe para a VPS)
import json, sys
d = json.load(open('/etc/easypanel/traefik/acme.json'))
for resolver in d.values():
    for c in (resolver.get('Certificates') or []):
        if c['domain']['main'] == 'levermoney.com.br':
            print(json.dumps({'crt': c['certificate'], 'key': c['key']})); sys.exit(0)
sys.exit('nao achei')
