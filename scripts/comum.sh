#!/usr/bin/env bash
# Funções compartilhadas pelos scripts de operação. Não execute diretamente.
set -Eeuo pipefail
umask 077

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

if [[ -f "$RAIZ/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$RAIZ/.env"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/srv/erp3d/backups}"
STATUS_DIR="$BACKUP_DIR/status"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"

log()  { printf '%s [%s] %s\n' "$(date '+%F %T')" "${NOME_SCRIPT:-erp3d}" "$*"; }
erro() { log "ERRO: $*" >&2; }

dc() { docker compose --project-directory "$RAIZ" "$@"; }

# Notificação opcional no celular (ntfy). Nunca falha o script.
notificar() {
  local titulo="$1" msg="$2" prioridade="${3:-default}"
  [[ -n "${NTFY_URL:-}" ]] || return 0
  curl -fsS -m 15 -H "Title: $titulo" -H "Priority: $prioridade" -H "Tags: erp3d" \
    -d "$msg" "$NTFY_URL" >/dev/null 2>&1 || log "aviso: falha ao enviar notificação"
}

# Ping opcional do healthchecks.io. Sufixo: "" (sucesso), "/start" ou "/fail".
ping_hc() {
  local url="$1" sufixo="${2:-}"
  [[ -n "$url" ]] || return 0
  curl -fsS -m 10 --retry 3 "$url$sufixo" >/dev/null 2>&1 || true
}

exigir_root() {
  [[ $EUID -eq 0 ]] || { erro "execute como root (sudo $0)"; exit 1; }
}

# Garante execução única (ex.: backup manual e agendado ao mesmo tempo).
travar() {
  local nome="$1"
  exec 9>"/run/lock/erp3d-$nome.lock" 2>/dev/null || exec 9>"/tmp/erp3d-$nome.lock"
  flock -n 9 || { erro "já existe outra execução de $nome em andamento"; exit 1; }
}

# Espera o backend responder pelo Nginx local.
esperar_saude() {
  local limite="${1:-120}" i=0
  while (( i < limite )); do
    if curl -fsS -m 5 "http://127.0.0.1:${WEB_PORT:-8080}/api/health" 2>/dev/null | grep -q '"ok":true'; then
      return 0
    fi
    sleep 3; i=$((i + 3))
  done
  return 1
}

ultimo_backup() {
  ls -1t "$BACKUP_DIR"/diario/erp3d_*.dump 2>/dev/null | head -n1 || true
}
