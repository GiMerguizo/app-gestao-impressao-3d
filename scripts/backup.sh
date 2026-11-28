#!/usr/bin/env bash
# Backup do PostgreSQL do ERP.
#   1. pg_dump (formato custom, comprimido) + validação + SHA-256
#   2. retenção local: diários, semanais e mensais
#   3. cópia 1: disco externo USB
#   4. cópia 2: local independente (nuvem via rclone, criptografado | outro computador via rsync)
# Executado diariamente pelo timer erp3d-backup.timer. Uso manual: sudo scripts/backup.sh [rotulo]
NOME_SCRIPT=backup
source "$(dirname "$0")/comum.sh"
exigir_root
travar backup

ROTULO="${1:-}"
FALHAS=()
trap 'erro "falha inesperada na linha $LINENO"; notificar "ERP: backup FALHOU" "Falha na linha $LINENO de backup.sh. Veja: journalctl -u erp3d-backup" high; ping_hc "${HC_BACKUP_URL:-}" /fail' ERR

ping_hc "${HC_BACKUP_URL:-}" /start
mkdir -p "$BACKUP_DIR"/{diario,semanal,mensal,status,manual}
chmod 700 "$BACKUP_DIR"

# ---------------------------------------------------------------- 1. dump
dc ps --status running --services | grep -qx db || { erro "o container do banco não está rodando"; false; }

livre_kb=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')
anterior="$(ultimo_backup)"
if [[ -n "$anterior" ]]; then
  precisa_kb=$(( $(stat -c %s "$anterior") * 3 / 1024 + 102400 ))
  (( livre_kb > precisa_kb )) || { erro "espaço insuficiente em $BACKUP_DIR (${livre_kb} KB livres)"; false; }
fi

carimbo="$(date +%Y-%m-%d_%H%M%S)"
if [[ -n "$ROTULO" ]]; then
  destino_dir="$BACKUP_DIR/manual"; nome="erp3d_${carimbo}_${ROTULO//[^A-Za-z0-9_-]/}.dump"
else
  destino_dir="$BACKUP_DIR/diario"; nome="erp3d_${carimbo}.dump"
fi
arquivo="$destino_dir/$nome"
tmp="$arquivo.parcial"

log "gerando dump: $arquivo"
dc exec -T db pg_dump -U erp3d -d erp3d --format=custom --compress=6 --no-owner --no-privileges >"$tmp"

# Validação: o arquivo precisa ter índice legível e conter as tabelas principais.
indice="$(dc exec -T db pg_restore --list <"$tmp")"
for tabela in usuarios empresas documentos schema_migrations; do
  grep -q "TABLE DATA public $tabela " <<<"$indice" || { erro "dump sem a tabela $tabela"; rm -f "$tmp"; false; }
done
mv "$tmp" "$arquivo"
(cd "$destino_dir" && sha256sum "$nome" >"$nome.sha256")
tamanho="$(du -h "$arquivo" | cut -f1)"
log "dump validado ($tamanho)"

if [[ -n "$ROTULO" ]]; then
  log "backup manual concluído: $arquivo"
  exit 0
fi

# ---------------------------------------------------------------- 2. retenção local
semana="$BACKUP_DIR/semanal/erp3d_semana_$(date +%G-W%V).dump"
mes="$BACKUP_DIR/mensal/erp3d_mes_$(date +%Y-%m).dump"
for alvo in "$semana" "$mes"; do
  if [[ ! -f "$alvo" ]]; then
    ln "$arquivo" "$alvo" 2>/dev/null || cp -p "$arquivo" "$alvo"
    (cd "$(dirname "$alvo")" && sha256sum "$(basename "$alvo")" >"$(basename "$alvo").sha256")
    log "cópia de retenção criada: $alvo"
  fi
done

find "$BACKUP_DIR/diario" -maxdepth 1 -type f -name 'erp3d_*' -mtime +"${RETENCAO_DIARIOS:-14}" -print -delete
manter_ultimos() {  # $1=pasta $2=quantidade
  ls -1t "$1"/erp3d_*.dump 2>/dev/null | tail -n +"$(( $2 + 1 ))" | while read -r velho; do
    log "removendo (retenção): $velho"; rm -f "$velho" "$velho.sha256" "$velho.verificado"
  done
}
manter_ultimos "$BACKUP_DIR/semanal" "${RETENCAO_SEMANAIS:-8}"
manter_ultimos "$BACKUP_DIR/mensal" "${RETENCAO_MENSAIS:-12}"
find "$BACKUP_DIR/manual" -maxdepth 1 -type f -mtime +90 -print -delete

# ---------------------------------------------------------------- 3. disco externo
if [[ -n "${DISCO_EXTERNO:-}" ]]; then
  if mountpoint -q "$DISCO_EXTERNO"; then
    ext="$DISCO_EXTERNO/erp3d"
    mkdir -p "$ext"/{diario,semanal,mensal,config}
    if rsync -rt --no-perms "$BACKUP_DIR"/diario/ "$ext/diario/" \
       && rsync -rt --no-perms "$BACKUP_DIR"/semanal/ "$ext/semanal/" \
       && rsync -rt --no-perms "$BACKUP_DIR"/mensal/ "$ext/mensal/" \
       && (cd "$ext/diario" && sha256sum --quiet -c "$nome.sha256"); then
      cp -f "$RAIZ/.env" "$ext/config/env.txt" 2>/dev/null || true
      find "$ext/diario" -maxdepth 1 -type f -name 'erp3d_*' -mtime +"${RETENCAO_EXTERNO_DIAS:-180}" -delete
      sync
      log "cópia no disco externo conferida: $ext/diario/$nome"
    else
      FALHAS+=("cópia no disco externo falhou")
    fi
  else
    FALHAS+=("disco externo não está montado em $DISCO_EXTERNO")
  fi
fi

# ---------------------------------------------------------------- 4. cópia independente
case "${OFFSITE_METODO:-nenhum}" in
  rclone|rsync)
    envio="$arquivo"
    if [[ -n "${AGE_RECIPIENT:-}" ]]; then
      envio="$arquivo.age"
      age -r "$AGE_RECIPIENT" -o "$envio" "$arquivo"
    elif [[ "$OFFSITE_METODO" == rclone ]]; then
      FALHAS+=("AGE_RECIPIENT vazio: backup NÃO enviado à nuvem sem criptografia")
      envio=""
    fi
    if [[ -n "$envio" ]]; then
      if [[ "$OFFSITE_METODO" == rclone ]]; then
        if rclone copy --retries 5 "$envio" "${RCLONE_DESTINO:?defina RCLONE_DESTINO}/diario/" \
           && rclone check --one-way --size-only "$envio" "$RCLONE_DESTINO/diario/" >/dev/null 2>&1; then
          rclone delete --min-age "${RETENCAO_OFFSITE_DIAS:-90}d" "$RCLONE_DESTINO/diario/" || true
          log "cópia independente enviada (rclone): $RCLONE_DESTINO/diario/$(basename "$envio")"
        else
          FALHAS+=("envio rclone falhou")
        fi
      else
        if rsync -t --timeout=300 -e "ssh -o BatchMode=yes -o ConnectTimeout=20" \
             "$envio" "${RSYNC_DESTINO:?defina RSYNC_DESTINO}/"; then
          log "cópia independente enviada (rsync): $RSYNC_DESTINO/$(basename "$envio")"
        else
          FALHAS+=("envio rsync para $RSYNC_DESTINO falhou (o outro computador está ligado e na Tailscale?)")
        fi
      fi
      [[ "$envio" == *.age ]] && rm -f "$envio"
    fi
    ;;
  nenhum|"") log "aviso: cópia em local independente desativada (OFFSITE_METODO=nenhum)" ;;
  *) FALHAS+=("OFFSITE_METODO desconhecido: $OFFSITE_METODO") ;;
esac

# ---------------------------------------------------------------- status
printf '%s %s\n' "$(date +%s)" "$arquivo" >"$STATUS_DIR/ultimo_backup"
if ((${#FALHAS[@]})); then
  msg="Dump local OK ($nome, $tamanho), mas: $(IFS='; '; echo "${FALHAS[*]}")"
  erro "$msg"
  notificar "ERP: backup incompleto" "$msg" high
  ping_hc "${HC_BACKUP_URL:-}" /fail
  exit 1
fi
log "backup concluído: $nome ($tamanho)"
ping_hc "${HC_BACKUP_URL:-}"
