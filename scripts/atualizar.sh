#!/usr/bin/env bash
# Atualiza o ERP para a versão mais recente do repositório Git.
#   1. backup de segurança  2. git pull  3. rebuild das imagens  4. reinício  5. verificação
# Uso: sudo scripts/atualizar.sh
#      sudo scripts/atualizar.sh --voltar <commit>   (volta o código para uma versão anterior)
NOME_SCRIPT=atualizar
source "$(dirname "$0")/comum.sh"
exigir_root
travar atualizar

dono_repo="$(stat -c %U "$RAIZ")"
git_() { sudo -u "$dono_repo" git -C "$RAIZ" "$@"; }

anterior="$(git_ rev-parse --short HEAD)"

if [[ "${1:-}" == "--voltar" ]]; then
  alvo="${2:?informe o commit. Veja o histórico em $BACKUP_DIR/status/atualizacoes.log}"
  log "voltando o código para $alvo"
  git_ checkout --detach "$alvo"
else
  [[ -z "$(git_ status --porcelain --untracked-files=no)" ]] || { erro "há alterações locais no repositório; resolva antes (git status)"; exit 1; }
  log "backup antes da atualização"
  "$RAIZ/scripts/backup.sh" pre-atualizacao
  log "baixando atualizações"
  git_ fetch --quiet origin
  ramo="$(git_ rev-parse --abbrev-ref HEAD)"
  [[ "$ramo" != "HEAD" ]] || { erro "repositório em modo 'detached' (após --voltar). Rode: git checkout main"; exit 1; }
  git_ merge --ff-only "origin/$ramo"
fi
novo="$(git_ rev-parse --short HEAD)"

log "reconstruindo imagens ($anterior -> $novo)"
dc pull --quiet db
dc build --pull
dc up -d --remove-orphans

if esperar_saude 180; then
  printf '%s %s -> %s OK\n' "$(date '+%F %T')" "$anterior" "$novo" >>"$BACKUP_DIR/status/atualizacoes.log"
  docker image prune -f >/dev/null
  log "ATUALIZAÇÃO CONCLUÍDA ($novo)"
else
  printf '%s %s -> %s FALHOU\n' "$(date '+%F %T')" "$anterior" "$novo" >>"$BACKUP_DIR/status/atualizacoes.log"
  erro "o sistema não respondeu após a atualização."
  erro "Logs:   docker compose logs --tail 100 backend"
  erro "Voltar: sudo scripts/atualizar.sh --voltar $anterior"
  erro "Se a atualização alterou o banco, restaure também o backup 'pre-atualizacao' em $BACKUP_DIR/manual/"
  notificar "ERP: atualização FALHOU" "Versão $novo não subiu. Voltar com: scripts/atualizar.sh --voltar $anterior" high
  exit 1
fi
