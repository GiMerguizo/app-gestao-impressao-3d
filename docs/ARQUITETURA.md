# Arquitetura: hospedagem local e acesso remoto

O ERP roda inteiro num notebook antigo da empresa. Não há hospedagem paga, e o banco de dados fica com os dois sócios. Para acessar de fora, usa-se uma rede privada Tailscale. Não é preciso IP fixo nem abrir portas no roteador.

## Visão geral

```
 Celular / notebook do Sócio 1 ─┐
 Celular / notebook do Sócio 2 ─┤  Tailscale (WireGuard, criptografado ponta a ponta)
                                │  https://erp.<sua-tailnet>.ts.net
                                ▼
┌──────────────────────── Notebook-servidor (Ubuntu Server / Debian) ────────────────────────┐
│ UFW: bloqueia toda entrada; só libera 443 e 22 vindos da interface tailscale0               │
│                                                                                              │
│  tailscaled ── "tailscale serve" :443 (certificado HTTPS automático *.ts.net)               │
│        │                                                                                     │
│        ▼  127.0.0.1:8080  (única porta publicada pelo Docker, só no localhost)              │
│  ┌──────────── Docker Compose (projeto erp3d) ─────────────────────────────────────┐        │
│  │  web      Nginx sem root: frontend estático + proxy /api, cabeçalhos de         │        │
│  │           segurança, limite de requisições           [rede publica + app]        │        │
│  │  backend  Node.js: login, sessões, permissões, API,   [rede app + dados]         │        │
│  │           tempo real (SSE), auditoria          sem acesso à internet             │        │
│  │  db       PostgreSQL 17, SEM porta publicada          [rede dados, interna]      │        │
│  │           volume persistente erp3d_db_data                                        │        │
│  └──────────────────────────────────────────────────────────────────────────────────┘        │
│  systemd: erp3d.service (boot) · backup diário · teste de restauração semanal · monitor 5 min│
│  /srv/erp3d/backups ──► disco externo USB ──► cópia independente (nuvem criptografada ou     │
│                                               computador do outro sócio via Tailscale)       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Decisões

### Node.js + PostgreSQL em vez de Supabase self-hosted

| | Supabase self-hosted | Node.js + PostgreSQL (escolhido) |
|---|---|---|
| Containers | cerca de 10 (Kong, GoTrue, PostgREST, Realtime, Storage, Studio, Meta, Vector...) | 3 |
| RAM em repouso | 2 a 4 GB | cerca de 250 MB |
| Superfície de ataque | painel Studio, chaves JWT, várias APIs | uma API pequena e auditável |
| Atualização | várias imagens com versões acopladas | 3 imagens |

Um notebook antigo costuma ter 4 a 8 GB de RAM e disco lento. Com dois usuários, o Supabase não traz ganho que compense o consumo de recursos e a complexidade. A alternativa prevista no requisito (Node.js + PostgreSQL) atende tudo: autenticação, permissões e tempo real.

### Acesso pela Tailscale com `tailscale serve`

- **Sem IP público e sem portas no roteador.** O tailscaled abre conexões de saída e atravessa NAT sozinho. Quando não há conexão direta, o tráfego passa pelos relays DERP, ainda criptografado.
- **HTTPS de verdade** com certificado válido emitido automaticamente para `nome.tailnet.ts.net`. Isso permite cookies `Secure`, e os celulares não mostram aviso de certificado.
- **Rede local:** um celular ou notebook na mesma rede que o servidor também usa a Tailscale, que detecta a rede local e conecta direto pela LAN, sem passar pela internet. Em casa ou no escritório, o caminho é sempre o mesmo endereço.
- **Autorização dos dois sócios:** só entram na tailnet os dispositivos das contas dos sócios. A política de ACL (`servidor/tailscale/politica-acl.hujson`) libera apenas a porta 443 (e a 22 para administração) do servidor. Depois disso, ainda é preciso o login individual no ERP.

### Camadas de segurança

| Requisito | Como foi atendido |
|---|---|
| Autenticação individual | Um usuário por sócio (`usuarios`), criado pelo terminal do servidor |
| Senhas com hash seguro | scrypt (N=2^15, r=8, p=1, sal aleatório de 16 bytes), comparação em tempo constante |
| Controle de sessão | Token aleatório de 256 bits em cookie `HttpOnly`, `Secure`, `SameSite=Strict`, prefixo `__Host-`. No banco fica só o SHA-256 do token. Expira por inatividade (72 h) e por idade máxima (30 dias). Há logout, "sair de todos os dispositivos" e encerramento automático das outras sessões ao trocar a senha |
| Permissões por usuário e empresa | `usuario_empresa` com papel `admin`, `editor` ou `leitura`. Toda consulta é filtrada pela empresa da sessão, com isolamento testado automaticamente |
| Proteção das APIs | Sessão obrigatória, lista fechada de coleções, validação de id e tamanho, cabeçalho anti-CSRF `X-ERP3D`, limite de tentativas de login (backend e Nginx), limite de requisições, CSP e cabeçalhos de segurança |
| Firewall | UFW: nega toda entrada, exceto 443/22 pela `tailscale0`, SSH pela LAN (emergência) e 41641/udp (WireGuard) |
| Segredos fora do frontend | A senha do banco fica em `secrets/db_password.txt` (Docker secret, pasta 700). O navegador só recebe o cookie de sessão |
| Banco só para serviços autorizados | O PostgreSQL não publica porta e está numa rede Docker `internal` acessível só pelo backend. O backend também não tem saída para a internet |
| Sem painel exposto | Não existe painel administrativo web. A administração é feita pelo CLI (`src/cli.js`) dentro do servidor |
| HTTPS | `tailscale serve --https=443` com certificado `*.ts.net`, mais HSTS |
| Rastreabilidade | Tabela `auditoria`: login, falhas, e cada gravação ou exclusão com o conteúdo, o que permite recuperar um registro apagado |

**Atenção:** o Docker ignora o UFW para portas publicadas. Por isso a única porta publicada (`127.0.0.1:8080`) fica presa ao localhost. Nunca mude `WEB_BIND` para `0.0.0.0`.

### Modelo de dados

O frontend usa uma interface de "coleções e documentos" (`db.collection("pedidos").add(...)`). O backend guarda cada documento como JSONB na tabela `documentos (empresa_id, colecao, id, dados)`. Assim o frontend continua igual nos três modos:

1. **Servidor próprio** (produção): `js/servidor.js`, com login e dados no PostgreSQL.
2. **Claude**: quando a página roda como artefato.
3. **Local**: `localStorage`, quando o arquivo é aberto direto no navegador.

As mudanças feitas por um sócio aparecem na tela do outro em tempo real, por Server-Sent Events (`/api/stream`).

## Limitações de disponibilidade

Um único notebook não é um datacenter. Os sócios precisam saber o que acontece em cada caso:

| Evento | Efeito | Mitigação |
|---|---|---|
| **Falta de energia** | A bateria do notebook funciona como nobreak, mas **o roteador desliga**: sem internet, o acesso remoto para. Se a falta durar mais que a bateria, o servidor desliga | Ligar o roteador num nobreak pequeno. Ativar no BIOS "Power on after AC loss" ou "Restore on AC power". O ERP volta sozinho no boot. O PostgreSQL tem journaling (WAL) e não corrompe com desligamento abrupto na maioria dos casos |
| **Internet do local cai** | Acesso remoto indisponível. Quem está na mesma rede local continua acessando, se o dispositivo já estava conectado à tailnet: a Tailscale mantém conexões diretas na LAN por um tempo, mas novas conexões dependem do servidor de coordenação | Para uso prolongado sem internet, acessar pelo próprio notebook (`http://127.0.0.1:8080`, com `COOKIE_SECURE=false` temporário). Ver docs/RECUPERACAO.md |
| **Servidores da Tailscale fora do ar** | Raro. Conexões já estabelecidas costumam continuar; novas podem falhar | Mesma alternativa acima |
| **Falha de disco do notebook** | ERP fora do ar até trocar o disco ou o notebook. Perda máxima: o que foi lançado desde o último backup diário | Backups diários verificados em 3 lugares. SMART monitorado. Procedimento em docs/RECUPERACAO.md. Tempo estimado de recuperação: 1 a 2 horas com um notebook substituto |
| **Notebook travado ou desligado** | ERP fora do ar | Monitoramento externo (healthchecks.io) avisa no celular quando o servidor para de responder |
| **Atualização automática do sistema** | Reinício de madrugada (04:30) quando uma atualização de segurança exige; 1 a 2 minutos fora do ar | Horário escolhido fora do expediente |
| **Bateria degradada** | Notebooks antigos sempre na tomada podem inchar a bateria | Verificar a bateria periodicamente. Se o BIOS permitir, limitar a carga a 80%. Uma bateria estufada deve ser removida, e o notebook passa a funcionar só na tomada |

**Expectativa realista:** disponibilidade alta no horário comercial, sem garantia de 24x7. O backup diário limita a perda de dados a no máximo um dia; com backups manuais antes de mudanças grandes, a perda costuma ser bem menor.
