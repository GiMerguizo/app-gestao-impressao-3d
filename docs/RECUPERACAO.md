# Recuperação em caso de falha

Mantenha uma cópia impressa ou offline deste documento. Se o servidor morrer, o repositório no GitHub continua acessível.

Comece pelo diagnóstico rápido. Depois vá ao cenário correspondente.

## Diagnóstico rápido: "o ERP não abre"

| Sintoma | Causa provável | Próximo passo |
|---|---|---|
| O navegador não acha o endereço ou dá timeout | Tailscale desligada **no celular**, servidor desligado ou sem internet | Abra o app Tailscale no celular e confira se está "Connected" e se o `erp` aparece online. Se `erp` está offline, veja o cenário 1 |
| A página abre, mas mostra "Servidor indisponível" | Backend ou banco parado | Cenário 2 |
| "Usuário ou senha inválidos" | Senha errada | Cenário 5 |
| "Muitas tentativas" | Bloqueio temporário após erros de senha | Espere 15 minutos |
| Dados sumiram ou estão errados | Exclusão ou alteração indevida | Cenários 3 e 4 |

## 1. Servidor fora do ar (desligado, sem energia, sem internet)

1. Vá até o notebook. Está ligado? A luz de energia está acesa? Se não, ligue. O ERP sobe sozinho em cerca de 2 minutos.
2. O roteador tem internet? Teste com outro aparelho no Wi-Fi.
3. Ligado e com internet, mas `erp` offline na Tailscale: entre no notebook (teclado e tela, ou SSH pela rede local `ssh admin@IP-LOCAL`) e rode:
   ```bash
   sudo systemctl restart tailscaled && tailscale status
   ```
   ```bash
   tailscale serve status
   ```
   Se o `serve` sumiu, recrie com `sudo tailscale serve --bg --https=443 http://127.0.0.1:8080`.

### Sem internet por muito tempo, usando na própria empresa

O ERP continua rodando no notebook. Para usar direto nele ou num computador ligado por cabo:

1. No notebook, em `/opt/erp3d/.env`, mude `COOKIE_SECURE=false` e rode `sudo docker compose up -d backend`.
2. Para usar no próprio notebook (com interface gráfica): `http://127.0.0.1:8080`. Para usar de outro computador na rede local, crie um túnel SSH a partir dele: `ssh -L 8080:127.0.0.1:8080 admin@IP-LOCAL` e abra `http://localhost:8080`.
3. **Quando a internet voltar, desfaça:** `COOKIE_SECURE=true` e `sudo docker compose up -d backend`.

## 2. Container parado ou ERP com erro

```bash
cd /opt/erp3d && sudo docker compose ps
```

```bash
sudo docker compose logs --tail 200 backend db
```

```bash
sudo docker compose up -d
```

Causas comuns:

- **Disco cheio** (`df -h`): o PostgreSQL para de gravar. Libere espaço com `sudo docker system prune` (não apaga o banco) ou removendo backups manuais antigos em `/srv/erp3d/backups/manual`. Depois, `sudo docker compose up -d`.
- **`secrets/db_password.txt` sumiu ou mudou:** veja o cenário 7.
- **Banco não inicia, com erro de arquivo corrompido nos logs do `db`:** não apague nada. Faça uma cópia do volume (`sudo docker run --rm -v erp3d_db_data:/de -v erp3d_db_copia:/para alpine cp -a /de/. /para/`), depois siga o cenário 4 com `--sem-backup-previo`. Antes, rode `sudo smartctl -H /dev/sda`: o disco pode estar falhando (cenário 6).
- **Falhou logo após uma atualização:** `sudo scripts/atualizar.sh --voltar <commit>`. O commit anterior aparece na mensagem de erro e em `/srv/erp3d/backups/status/atualizacoes.log`.

## 3. Um registro foi apagado ou alterado por engano

Toda gravação e exclusão fica na tabela `auditoria` com o conteúdo completo. Para listar as últimas exclusões:

```bash
cd /opt/erp3d && sudo docker compose exec db psql -U erp3d -d erp3d -c "SELECT id, em, colecao, doc_id, left(dados::text, 120) FROM auditoria WHERE acao = 'excluir' ORDER BY id DESC LIMIT 20"
```

Para recolocar um documento apagado, trocando `123` pelo `id` da auditoria:

```bash
sudo docker compose exec db psql -U erp3d -d erp3d -c "INSERT INTO documentos (empresa_id, colecao, id, dados) SELECT empresa_id, colecao, doc_id, dados FROM auditoria WHERE id = 123"
```

Os sócios precisam recarregar a página. Para voltar a uma versão anterior de um registro alterado, use a entrada `gravar` ou `atualizar` desejada da auditoria, com `ON CONFLICT (empresa_id, colecao, id) DO UPDATE SET dados = EXCLUDED.dados` no final do INSERT.

Assim, não é preciso restaurar o banco inteiro (e perder o resto do dia) por causa de um registro.

## 4. Restaurar o banco a partir de um backup

Use quando os dados estiverem corrompidos ou for preciso voltar o banco inteiro a um ponto anterior. **Tudo o que foi lançado depois do backup escolhido é perdido.** Avise o outro sócio antes.

1. Escolha o arquivo, de preferência um com `.verificado`:
   ```bash
   ls -lt /srv/erp3d/backups/diario/ /srv/erp3d/backups/manual/ | head -20
   ```
2. Se quiser, teste antes:
   ```bash
   sudo scripts/testar-restauracao.sh /srv/erp3d/backups/diario/<arquivo>.dump
   ```
3. Restaure. O script faz antes um backup de segurança do estado atual em `backups/manual/`:
   ```bash
   sudo scripts/restaurar.sh /srv/erp3d/backups/diario/<arquivo>.dump
   ```
   Digite `RESTAURAR` para confirmar. Se o banco atual estiver inacessível, use `--sem-backup-previo`.
4. Os sócios entram de novo no ERP (as sessões são encerradas) e conferem os dados.

Origem do arquivo:

- **Disco externo:** `/mnt/backup-erp3d/erp3d/diario/...`
- **Nuvem (rclone):**
  ```bash
  sudo rclone copy gdrive:backups-erp3d/diario/<arquivo>.dump.age /tmp/restaurar/
  ```
  Depois, com a chave privada que está com os sócios:
  ```bash
  sudo AGE_IDENTITY=/tmp/chave-erp3d-backup.txt scripts/restaurar.sh /tmp/restaurar/<arquivo>.dump.age
  ```
  **Apague a chave do servidor no final:** `sudo shred -u /tmp/chave-erp3d-backup.txt`.

## 5. Sócio esqueceu a senha

```bash
cd /opt/erp3d && sudo docker compose exec backend node src/cli.js usuario:senha socio1
```

## 6. Servidor perdido (disco ou notebook morreu, roubo)

Tempo estimado: 1 a 2 horas. Perda de dados: desde o último backup.

1. **Em caso de roubo, primeiro:** no painel da Tailscale, remova o dispositivo `erp` e qualquer outro afetado. Troque as senhas do ERP depois da restauração. A cópia da nuvem é criptografada e continua segura.
2. Separe um notebook ou computador substituto (ou o mesmo com disco novo).
3. Siga docs/INSTALACAO.md, passos 1, 2, 4, 5 e 6, **sem** criar empresa nem usuários. A restauração traz tudo.
   - No passo 5, se o nome `erp` ainda existir no painel, apague o antigo antes, para o endereço continuar o mesmo.
4. Pegue o backup mais recente disponível:
   - Disco externo (se sobreviveu): conecte, faça o passo 9 da instalação **sem formatar** (só `mkdir`, `fstab` e `mount`) e use `/mnt/backup-erp3d/erp3d/diario/` (o mais recente) ou `semanal/`.
   - Senão, nuvem ou computador do outro sócio (`.dump.age`, precisa da chave privada).
5. Restaure:
   ```bash
   sudo scripts/restaurar.sh --sem-backup-previo <arquivo>
   ```
6. Recoloque o `.env` (há uma cópia em `/mnt/backup-erp3d/erp3d/config/env.txt`), refaça o `tailscale serve` (passo 7) e a configuração do rclone, se usada.
7. Rode a validação final (passo 12 da instalação).

## 7. Senha do banco perdida (`secrets/db_password.txt`)

Os dados não se perdem: a senha pode ser redefinida por dentro do container, que aceita conexão local sem senha.

```bash
cd /opt/erp3d && sudo sh -c 'od -An -tx1 -N32 /dev/urandom | tr -d " \n" > secrets/db_password.txt && chmod 644 secrets/db_password.txt'
```

```bash
sudo docker compose exec db sh -c 'psql -U erp3d -d postgres -c "ALTER USER erp3d PASSWORD '"'"'$(cat /run/secrets/db_password)'"'"'"'
```

```bash
sudo docker compose up -d --force-recreate db backend
```

## 8. Celular ou notebook de um sócio perdido ou roubado

1. Painel da Tailscale → **Machines** → remova o dispositivo. Ele perde o acesso imediatamente.
2. Encerre as sessões e troque a senha do ERP:
   ```bash
   cd /opt/erp3d && sudo docker compose exec backend node src/cli.js sessoes:encerrar socio1
   ```
   ```bash
   sudo docker compose exec backend node src/cli.js usuario:senha socio1
   ```
3. Troque a senha da conta Google, Microsoft ou GitHub usada na Tailscale, se ela estava logada no aparelho.

## 9. Verificar o que aconteceu (auditoria e logs)

```bash
cd /opt/erp3d && sudo docker compose exec backend node src/cli.js auditoria 100
```

```bash
sudo docker compose logs --since 24h backend | grep -E '"status":(401|403|429|5..)'
```

```bash
journalctl -u erp3d-monitor --since today
```
