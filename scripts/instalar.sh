#!/usr/bin/env bash
# Primeira instalação do ERP no servidor (depois de servidor/preparar-servidor.sh).
#   - cria .env a partir do exemplo
#   - gera a senha do PostgreSQL em secrets/db_password.txt
#   - constrói as imagens e sobe os containers
# Pode ser executado de novo sem perder dados (não recria senha nem volume existentes).
NOME_SCRIPT=instalar
source "$(dirname "$0")/comum.sh"
exigir_root

command -v docker >/dev/null || { erro "Docker não instalado. Rode antes: sudo servidor/preparar-servidor.sh"; exit 1; }

if [[ ! -f "$RAIZ/.env" ]]; then
  cp "$RAIZ/.env.example" "$RAIZ/.env"
  chmod 600 "$RAIZ/.env"
  log ".env criado a partir de .env.example (revise BACKUP_DIR, DISCO_EXTERNO e OFFSITE_*)"
  set -a; source "$RAIZ/.env"; set +a
fi

mkdir -p "$RAIZ/secrets"
chmod 700 "$RAIZ/secrets"   # só o root entra na pasta
if [[ ! -s "$RAIZ/secrets/db_password.txt" ]]; then
  if docker volume inspect erp3d_db_data >/dev/null 2>&1; then
    erro "o volume do banco já existe mas secrets/db_password.txt sumiu."
    erro "Recupere o arquivo (cópia de segurança) ou veja docs/RECUPERACAO.md, seção 'Senha do banco perdida'."
    exit 1
  fi
  od -An -tx1 -N32 /dev/urandom | tr -d ' \n' >"$RAIZ/secrets/db_password.txt"   # 64 caracteres hex
  log "senha do PostgreSQL gerada em secrets/db_password.txt"
fi
# O arquivo é montado dentro dos containers (usuários não-root): precisa ser legível lá dentro.
# A pasta secrets/ (700) impede a leitura por outros usuários do notebook.
chmod 644 "$RAIZ/secrets/db_password.txt"

mkdir -p "$BACKUP_DIR"/{diario,semanal,mensal,manual,status}
chmod 700 "$BACKUP_DIR"

log "construindo imagens (pode levar alguns minutos na primeira vez)"
dc build --pull
dc up -d --remove-orphans

if esperar_saude 180; then
  log "ERP no ar em http://127.0.0.1:${WEB_PORT:-8080} (acesso dos sócios: via Tailscale, ver docs/INSTALACAO.md)"
else
  erro "o ERP não respondeu. Veja: docker compose logs --tail 100"
  exit 1
fi

cat <<EOF

Próximos passos:
  1. Criar a empresa:
       docker compose exec backend node src/cli.js empresa:criar "Nome da Empresa"
  2. Criar o login de cada sócio (a senha é pedida no terminal):
       docker compose exec backend node src/cli.js usuario:criar socio1 "Nome do Sócio 1" "Nome da Empresa" admin
       docker compose exec backend node src/cli.js usuario:criar socio2 "Nome do Sócio 2" "Nome da Empresa" admin
  3. Publicar na Tailscale:   sudo tailscale serve --bg --https=443 http://127.0.0.1:${WEB_PORT:-8080}
  4. Fazer o primeiro backup e testar a restauração:
       sudo scripts/backup.sh && sudo scripts/testar-restauracao.sh
EOF
