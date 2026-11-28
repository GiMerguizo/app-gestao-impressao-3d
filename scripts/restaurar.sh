#!/usr/bin/env bash
# Restaura um backup NO BANCO DE PRODUÇÃO (substitui todos os dados atuais).
# Antes de apagar qualquer coisa, gera um backup de segurança do estado atual em backups/manual/.
#
# Uso:
#   sudo scripts/restaurar.sh /srv/erp3d/backups/diario/erp3d_2026-11-20_023001.dump
#   sudo AGE_IDENTITY=/caminho/chave-age.txt scripts/restaurar.sh arquivo.dump.age   (cópia da nuvem)
#   sudo scripts/restaurar.sh --sem-backup-previo arquivo.dump   (banco atual inacessível/corrompido)
NOME_SCRIPT=restaurar
source "$(dirname "$0")/comum.sh"
exigir_root
travar restaurar

backup_previo=1
if [[ "${1:-}" == "--sem-backup-previo" ]]; then backup_previo=0; shift; fi
arquivo="${1:-}"
[[ -n "$arquivo" && -f "$arquivo" ]] || { echo "Uso: sudo $0 [--sem-backup-previo] <arquivo.dump|arquivo.dump.age>"; exit 1; }
arquivo="$(readlink -f "$arquivo")"
nome="$(basename "$arquivo")"
pasta_tmp=""
trap 'if [[ -n "$pasta_tmp" ]]; then rm -rf "$pasta_tmp"; fi' EXIT

if [[ "$arquivo" == *.age ]]; then
  [[ -n "${AGE_IDENTITY:-}" && -f "$AGE_IDENTITY" ]] || { erro "arquivo criptografado: defina AGE_IDENTITY=/caminho/da/chave-privada"; exit 1; }
  pasta_tmp="$(mktemp -d)"
  age -d -i "$AGE_IDENTITY" -o "$pasta_tmp/${nome%.age}" "$arquivo"
  arquivo="$pasta_tmp/${nome%.age}"
  log "arquivo descriptografado"
elif [[ -f "$arquivo.sha256" ]]; then
  (cd "$(dirname "$arquivo")" && sha256sum --quiet -c "$nome.sha256") || { erro "checksum não confere: arquivo corrompido"; exit 1; }
  log "checksum conferido"
fi

[[ -f "$arquivo.verificado" ]] || log "aviso: este arquivo ainda não passou pelo teste de restauração (scripts/testar-restauracao.sh)"

echo
echo "ATENÇÃO: todos os dados atuais do ERP serão SUBSTITUÍDOS pelo conteúdo de:"
echo "   $nome"
echo "Os sócios perderão o que foi lançado depois desse backup."
read -r -p 'Digite RESTAURAR para continuar: ' resposta
[[ "$resposta" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }

dc up -d db
for _ in $(seq 1 60); do dc exec -T db pg_isready -U erp3d -q 2>/dev/null && break; sleep 2; done

if (( backup_previo )); then
  log "gerando backup de segurança do estado atual"
  "$RAIZ/scripts/backup.sh" pre-restauracao || { erro "backup de segurança falhou; use --sem-backup-previo se o banco atual estiver inutilizável"; exit 1; }
fi

log "parando o backend (usuários ficam sem acesso durante a restauração)"
dc stop backend

log "recriando o banco"
dc exec -T db psql -U erp3d -d postgres -v ON_ERROR_STOP=1 -c 'DROP DATABASE IF EXISTS erp3d WITH (FORCE)'
dc exec -T db psql -U erp3d -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE erp3d OWNER erp3d'

log "restaurando $nome"
dc exec -T db pg_restore -U erp3d -d erp3d --no-owner --no-privileges --exit-on-error <"$arquivo"

log "iniciando o backend"
dc up -d backend
if esperar_saude 120; then
  # Sessões do backup podem estar vencidas ou ser de outra época: força novo login.
  dc exec -T db psql -U erp3d -d erp3d -c 'DELETE FROM sessoes' >/dev/null
  log "RESTAURAÇÃO CONCLUÍDA. Os sócios precisam entrar novamente."
  notificar "ERP: banco restaurado" "Restaurado a partir de $nome" high
else
  erro "o backend não respondeu após a restauração. Veja: docker compose logs backend"
  exit 1
fi
