# app-gestao-impressao-3d

ERP para gestão de recursos de impressão 3D: filamentos, calculadora de custos, produtos, orçamentos, pedidos, compras e financeiro.

Ele é hospedado **na infraestrutura própria da empresa**, num notebook antigo usado como servidor, e acessado pelos sócios por uma rede privada **Tailscale**, sem hospedagem paga, IP fixo ou portas abertas no roteador.

## Componentes

| Pasta / arquivo | Conteúdo |
|---|---|
| `erp3d.html`, `css/`, `js/script.js` | Interface do ERP |
| `js/servidor.js` | Login e conexão com o servidor próprio (API + tempo real) |
| `backend/` | API Node.js: autenticação, sessões, permissões por usuário e empresa, auditoria, CLI de administração |
| `backend/migrations/` | Estrutura do banco PostgreSQL |
| `nginx/` | Servidor web do frontend e proxy da API, com cabeçalhos de segurança |
| `docker-compose.yml` | Os 3 serviços (web, backend, db) com volume persistente e redes internas |
| `.env.example` | Variáveis de ambiente de exemplo |
| `scripts/` | Instalação, backup, teste de restauração, restauração, atualização e monitoramento |
| `servidor/` | Preparação do Linux, unidades systemd e política de acesso da Tailscale |
| `docs/` | Documentação |

## Documentação

1. **[Arquitetura](docs/ARQUITETURA.md)**: decisões, segurança e limitações de disponibilidade
2. **[Instalação](docs/INSTALACAO.md)**: do notebook vazio ao ERP no celular dos sócios
3. **[Operação](docs/OPERACAO.md)**: usuários, atualização, backups, testes de recuperação e cuidados com o notebook
4. **[Recuperação](docs/RECUPERACAO.md)**: o que fazer em cada tipo de falha

## Resumo da instalação

```bash
sudo git clone https://github.com/GiMerguizo/app-gestao-impressao-3d.git /opt/erp3d
```

```bash
cd /opt/erp3d && sudo servidor/preparar-servidor.sh
```

```bash
sudo tailscale up --advertise-tags=tag:erp-servidor --hostname=erp
```

```bash
sudo scripts/instalar.sh
```

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
```

O passo a passo completo, com contas, disco externo, backups e validação, está em [docs/INSTALACAO.md](docs/INSTALACAO.md).

## Usar sem servidor

Abrindo `erp3d.html` direto no navegador, o ERP funciona em **modo local**: os dados ficam só naquele navegador. Esses dados podem ser importados depois para o servidor (docs/INSTALACAO.md, passo 13).

## Desenvolvimento

Testes da API (precisam de um PostgreSQL descartável; **nunca** use o de produção):

```bash
docker run -d --name pgtest -e POSTGRES_USER=erp3d -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=erp3d -p 127.0.0.1:55432:5432 postgres:17-alpine
```

```bash
cd backend && npm ci && DB_HOST=127.0.0.1 DB_PORT=55432 DB_PASSWORD=teste npm test
```
