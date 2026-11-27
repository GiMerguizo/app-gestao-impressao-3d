#!/usr/bin/env bash
# Verificação de saúde, a cada 5 minutos (timer erp3d-monitor.timer).
# Confere: ERP respondendo, containers saudáveis, Tailscale, disco, backup recente,
# teste de restauração recente, disco externo e saúde SMART do disco interno.
# Notifica (ntfy) somente quando o estado MUDA, para não gerar spam.
# Uso manual: sudo scripts/monitorar.sh   (mostra o relatório)
NOME_SCRIPT=monitor
source "$(dirname "$0")/comum.sh"
exigir_root

problemas=()
avisos=()
agora=$(date +%s)

# ERP de ponta a ponta (Nginx -> backend -> PostgreSQL)
curl -fsS -m 10 "http://127.0.0.1:${WEB_PORT:-8080}/api/health" 2>/dev/null | grep -q '"ok":true' \
  || problemas+=("ERP não responde em 127.0.0.1:${WEB_PORT:-8080}")

for svc in db backend web; do
  estado="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' "erp3d-$svc-1" 2>/dev/null || echo ausente)"
  [[ "$estado" == running/healthy || "$estado" == running/ ]] || problemas+=("container $svc: $estado")
done

# Tailscale (sem ele, ninguém acessa de fora)
if command -v tailscale >/dev/null; then
  tailscale status --peers=false >/dev/null 2>&1 || problemas+=("Tailscale desconectado")
  tailscale serve status 2>/dev/null | grep -q "127.0.0.1:${WEB_PORT:-8080}" || problemas+=("tailscale serve não está publicando o ERP")
fi

# Espaço em disco
for ponto in / "$BACKUP_DIR" /var/lib/docker; do
  [[ -d "$ponto" ]] || continue
  uso=$(df -P "$ponto" | awk 'NR==2 {gsub("%","",$5); print $5}')
  (( uso < ${ALERTA_DISCO_PCT:-85} )) || problemas+=("disco $ponto com ${uso}% de uso")
done

# Backup recente
if [[ -f "$STATUS_DIR/ultimo_backup" ]]; then
  t=$(cut -d' ' -f1 "$STATUS_DIR/ultimo_backup")
  (( agora - t < ${ALERTA_BACKUP_HORAS:-26} * 3600 )) || problemas+=("último backup há $(( (agora - t) / 3600 )) h")
else
  problemas+=("nenhum backup registrado")
fi

# Teste de restauração recente
if [[ -f "$STATUS_DIR/ultimo_teste_restauracao_ok" ]]; then
  t=$(cat "$STATUS_DIR/ultimo_teste_restauracao_ok")
  (( agora - t < ${ALERTA_TESTE_RESTAURACAO_DIAS:-8} * 86400 )) || problemas+=("último teste de restauração OK há $(( (agora - t) / 86400 )) dias")
else
  problemas+=("nenhum teste de restauração bem-sucedido ainda")
fi

# Disco externo
if [[ -n "${DISCO_EXTERNO:-}" ]] && ! mountpoint -q "$DISCO_EXTERNO"; then
  avisos+=("disco externo não montado em $DISCO_EXTERNO")
fi

# Saúde do disco interno (SMART), se disponível
if command -v smartctl >/dev/null; then
  disco="/dev/$(lsblk -no pkname "$(findmnt -no SOURCE /)" 2>/dev/null | head -n1)"
  if [[ -b "$disco" ]]; then
    rc=0; smartctl -H "$disco" >/dev/null 2>&1 || rc=$?
    # Bit 3 do código de saída do smartctl = "DISK FAILING".
    (( (rc & 8) == 0 )) || problemas+=("SMART indica falha iminente no disco $disco: troque o disco e confira os backups")
  fi
fi

# Bateria (notebook como "nobreak")
for bat in /sys/class/power_supply/BAT*; do
  [[ -d "$bat" ]] || continue
  st="$(cat "$bat/status" 2>/dev/null || true)"; cap="$(cat "$bat/capacity" 2>/dev/null || echo 100)"
  [[ "$st" != "Discharging" ]] || avisos+=("SEM ENERGIA: notebook na bateria (${cap}%)")
done

# Relatório e notificação por mudança de estado
mkdir -p "$STATUS_DIR"
estado_atual="$(printf '%s\n' "${problemas[@]}" "${avisos[@]}" | sort | sed '/^$/d')"
estado_antigo="$(cat "$STATUS_DIR/monitor_estado" 2>/dev/null || true)"

if [[ -z "$estado_atual" ]]; then
  log "tudo OK"
  [[ -z "$estado_antigo" ]] || notificar "ERP: normalizado" "Todos os itens monitorados voltaram ao normal." default
  ping_hc "${HC_MONITOR_URL:-}"
else
  while read -r linha; do log "PROBLEMA: $linha"; done <<<"$estado_atual"
  [[ "$estado_atual" == "$estado_antigo" ]] || notificar "ERP: atenção" "$estado_atual" high
  if ((${#problemas[@]})); then ping_hc "${HC_MONITOR_URL:-}" /fail; else ping_hc "${HC_MONITOR_URL:-}"; fi
fi
printf '%s' "$estado_atual" >"$STATUS_DIR/monitor_estado"
((${#problemas[@]} == 0))
