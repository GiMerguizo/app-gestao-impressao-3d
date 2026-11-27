#!/usr/bin/env bash
# Teste de recuperação: restaura um backup num PostgreSQL TEMPORÁRIO e isolado (sem rede)
# e confere se os dados estão lá. Não toca no banco de produção.
# Um backup só é considerado válido depois de passar por aqui (gera o arquivo .verificado).
#
# Uso: sudo scripts/testar-restauracao.sh [arquivo.dump]     (padrão: o backup diário mais recente)
# Executado semanalmente pelo timer erp3d-restore-test.timer.
NOME_SCRIPT=teste-restauracao
source "$(dirname "$0")/comum.sh"
exigir_root
travar teste-restauracao

arquivo="${1:-$(ultimo_backup)}"
[[ -n "$arquivo" && -f "$arquivo" ]] || { erro "nenhum backup encontrado em $BACKUP_DIR/diario"; notificar "ERP: teste de restauração FALHOU" "Nenhum backup encontrado." high; exit 1; }
arquivo="$(readlink -f "$arquivo")"
nome="$(basename "$arquivo")"
container="erp3d-teste-restauracao-$$"
pasta_tmp=""

limpar() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [[ -n "$pasta_tmp" ]]; then rm -rf "$pasta_tmp"; fi
  return 0
}
falhar() {
  erro "$1"
  printf '%s FALHOU %s: %s\n' "$(date '+%F %T')" "$nome" "$1" >>"$STATUS_DIR/testes_restauracao.log"
  notificar "ERP: teste de restauração FALHOU" "$nome: $1" high
  exit 1
}
trap limpar EXIT
trap 'falhar "erro inesperado na linha $LINENO"' ERR
mkdir -p "$STATUS_DIR"

# Arquivo criptografado (.age) vindo da nuvem: precisa da chave privada (fica com os sócios, não no servidor).
if [[ "$arquivo" == *.age ]]; then
  [[ -n "${AGE_IDENTITY:-}" && -f "$AGE_IDENTITY" ]] || falhar "arquivo .age: informe a chave com AGE_IDENTITY=/caminho/chave.txt"
  pasta_tmp="$(mktemp -d)"
  age -d -i "$AGE_IDENTITY" -o "$pasta_tmp/${nome%.age}" "$arquivo"
  arquivo="$pasta_tmp/${nome%.age}"
elif [[ -f "$arquivo.sha256" ]]; then
  (cd "$(dirname "$arquivo")" && sha256sum --quiet -c "$nome.sha256") || falhar "checksum SHA-256 não confere (arquivo corrompido)"
  log "checksum conferido"
else
  log "aviso: sem arquivo .sha256 para conferir"
fi

log "subindo PostgreSQL temporário ($PG_IMAGE, sem rede)"
docker run -d --rm --name "$container" --network none \
  -e POSTGRES_PASSWORD=teste-descartavel -e POSTGRES_USER=erp3d -e POSTGRES_DB=erp3d \
  --tmpfs /var/lib/postgresql/data:rw,size=2g "$PG_IMAGE" >/dev/null

for _ in $(seq 1 60); do
  docker exec "$container" pg_isready -U erp3d -d erp3d -q 2>/dev/null && break
  sleep 1
done
sleep 2
docker exec "$container" pg_isready -U erp3d -d erp3d -q || falhar "PostgreSQL temporário não iniciou"

log "restaurando $nome"
inicio=$(date +%s)
docker exec -i "$container" pg_restore -U erp3d -d erp3d --no-owner --no-privileges --exit-on-error <"$arquivo" \
  || falhar "pg_restore retornou erro"
duracao=$(( $(date +%s) - inicio ))

sql() { docker exec "$container" psql -U erp3d -d erp3d -At -c "$1"; }
migracoes="$(sql 'SELECT count(*) FROM schema_migrations')"
usuarios="$(sql 'SELECT count(*) FROM usuarios')"
empresas="$(sql 'SELECT count(*) FROM empresas')"
documentos="$(sql 'SELECT count(*) FROM documentos')"
por_colecao="$(sql "SELECT string_agg(colecao || '=' || n, ' ' ORDER BY colecao) FROM (SELECT colecao, count(*) n FROM documentos GROUP BY colecao) x")"
# Lê todo o conteúdo JSON (detecta corrupção que uma contagem não pegaria).
sql 'SELECT sum(length(dados::text)) FROM documentos' >/dev/null || falhar "falha ao ler os documentos restaurados"

(( migracoes >= 1 )) || falhar "tabela schema_migrations vazia"
(( usuarios >= 1 )) || falhar "nenhum usuário no backup"
(( empresas >= 1 )) || falhar "nenhuma empresa no backup"

# Compara com a produção: o backup não pode ter muito menos registros do que o banco atual.
if dc ps --status running --services 2>/dev/null | grep -qx db; then
  atual="$(dc exec -T db psql -U erp3d -d erp3d -At -c 'SELECT count(*) FROM documentos' 2>/dev/null || echo '')"
  if [[ "$atual" =~ ^[0-9]+$ ]] && (( atual > 50 )) && (( documentos * 10 < atual * 8 )); then
    falhar "backup tem $documentos documentos e a produção tem $atual (diferença maior que 20%)"
  fi
fi

resumo="usuarios=$usuarios empresas=$empresas documentos=$documentos [$por_colecao] restauracao=${duracao}s"
[[ "$arquivo" == "$BACKUP_DIR"/* ]] && date '+%F %T' >"$arquivo.verificado"
printf '%s OK %s %s\n' "$(date '+%F %T')" "$nome" "$resumo" >>"$STATUS_DIR/testes_restauracao.log"
date +%s >"$STATUS_DIR/ultimo_teste_restauracao_ok"
log "RESTAURAÇÃO OK: $nome — $resumo"
notificar "ERP: teste de restauração OK" "$nome — $resumo" low
