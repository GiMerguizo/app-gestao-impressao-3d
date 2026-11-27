# Operação do dia a dia

Todos os comandos abaixo são executados no servidor (via SSH pela Tailscale: `ssh admin@erp`), dentro de `/opt/erp3d`.

## Rotina automática

| Quando | O quê | Serviço |
|---|---|---|
| No boot | Sobe Docker e o ERP | `erp3d.service` (e `restart: unless-stopped`) |
| Se um container cair | O Docker reinicia o container | `restart: unless-stopped` + healthchecks |
| Diário, 02:30 | Backup: dump, validação, retenção, disco externo, cópia independente | `erp3d-backup.timer` |
| Domingo, 03:30 | Teste de restauração num banco temporário isolado | `erp3d-restore-test.timer` |
| A cada 5 min | Verificação de saúde e alertas | `erp3d-monitor.timer` |
| Diário | Atualizações de segurança do sistema; reinício às 04:30, se necessário | `unattended-upgrades` |

Os timers têm `Persistent=true`: se o notebook estava desligado no horário, a tarefa roda logo depois que ele ligar.

## Comandos úteis

```bash
sudo docker compose ps
```

```bash
sudo docker compose logs --tail 100 -f backend
```

```bash
sudo scripts/monitorar.sh
```

```bash
systemctl list-timers 'erp3d*'
```

```bash
journalctl -u erp3d-backup --since "7 days ago"
```

```bash
cat /srv/erp3d/backups/status/testes_restauracao.log
```

Logs: os containers usam `json-file` com rotação (5 arquivos de 10 MB por serviço). O sistema usa o journald persistente, limitado a 500 MB e 3 meses. O backend registra uma linha JSON por requisição (método, rota, status, tempo, usuário, IP), sem gravar corpo nem senhas.

## Usuários e permissões

A administração é feita só pelo terminal: não existe painel web.

```bash
sudo docker compose exec backend node src/cli.js
```

Sem argumentos, o comando lista a ajuda. Os mais usados:

| Tarefa | Comando (`... node src/cli.js` + ) |
|---|---|
| Listar usuários | `usuario:listar` |
| Redefinir senha esquecida | `usuario:senha socio1` |
| Bloquear acesso (ex.: celular roubado) | `sessoes:encerrar socio1`, depois `usuario:senha socio1` |
| Desligar um usuário | `usuario:desativar login` |
| Criar usuário só de consulta (ex.: contador) | `usuario:criar contador "Contador" "Minha Empresa 3D" leitura` |
| Segunda empresa | `empresa:criar "Outra Empresa"`, depois `usuario:vincular socio1 "Outra Empresa" admin` |
| Ver últimos acessos e alterações | `auditoria 50` |
| Sessões abertas | `sessoes:listar` |

Papéis: `admin` e `editor` leem e gravam; `leitura` só consulta. Quem tem mais de uma empresa escolhe a empresa no topo da tela.

## Atualização do ERP

```bash
sudo scripts/atualizar.sh
```

O script faz um backup `pre-atualizacao`, roda `git pull` (só fast-forward), reconstrói as imagens, reinicia e confere a saúde. Se falhar, ele mostra o comando para voltar:

```bash
sudo scripts/atualizar.sh --voltar <commit-anterior>
```

O histórico fica em `/srv/erp3d/backups/status/atualizacoes.log`. Se a versão nova alterou o banco (migração) e é preciso voltar, restaure também o backup `pre-atualizacao`, conforme docs/RECUPERACAO.md.

As migrações de banco ficam em `backend/migrations/NNN_descricao.sql`. São aplicadas automaticamente, em ordem e uma única vez, quando o backend sobe.

### Atualizar o sistema operacional

As atualizações de segurança são automáticas. Para as demais, uma vez por mês:

```bash
sudo apt-get update && sudo apt-get full-upgrade -y && sudo reboot
```

### Trocar a versão principal do PostgreSQL (ex.: 17 → 18)

Uma versão principal nova não lê os arquivos da anterior. Faça em horário sem uso:

1. `sudo scripts/backup.sh pre-upgrade-pg`
2. `sudo scripts/testar-restauracao.sh /srv/erp3d/backups/manual/<arquivo pre-upgrade-pg>.dump`
3. `sudo docker compose down`
4. Guarde uma cópia do volume antigo, como garantia extra: `sudo docker run --rm -v erp3d_db_data:/de -v erp3d_db_data_pg17:/para alpine cp -a /de/. /para/`
5. `sudo docker volume rm erp3d_db_data`
6. No `.env`, troque `PG_IMAGE=postgres:18-alpine` e rode `sudo docker compose up -d db`
7. `sudo scripts/restaurar.sh --sem-backup-previo /srv/erp3d/backups/manual/<arquivo pre-upgrade-pg>.dump`
8. Confira o ERP. Depois de algumas semanas, apague o volume antigo `erp3d_db_data_pg17`.

## Backups: onde estão e quanto tempo ficam

| Local | Conteúdo | Retenção padrão |
|---|---|---|
| `/srv/erp3d/backups/diario` | Um dump por dia | 14 dias |
| `/srv/erp3d/backups/semanal` | Um por semana | 8 semanas |
| `/srv/erp3d/backups/mensal` | Um por mês | 12 meses |
| `/srv/erp3d/backups/manual` | Antes de restauração e atualização | 90 dias |
| Disco externo `/mnt/backup-erp3d/erp3d` | Espelho dos diários, semanais e mensais | Diários por 180 dias; semanais e mensais sem limite |
| Nuvem ou computador do outro sócio | Diário criptografado (`.dump.age`) | 90 dias (rclone) |

Cada dump tem um `.sha256`. Os que passaram no teste de restauração recebem um `.verificado`. **Um backup sem teste de restauração não é considerado válido.** O monitor avisa quando o último teste bem-sucedido tem mais de 8 dias.

Backup manual a qualquer momento (ex.: antes de lançar muita coisa):

```bash
sudo scripts/backup.sh antes-de-fechar-mes
```

### Testes periódicos de recuperação

O teste semanal é automático, mas usa o backup local. Por isso, de tempos em tempos, teste as outras cópias:

- **Mensal:** testar um arquivo do **disco externo**:
  ```bash
  sudo scripts/testar-restauracao.sh /mnt/backup-erp3d/erp3d/diario/<arquivo>.dump
  ```
- **Trimestral:** baixar uma cópia da **nuvem ou do outro computador** num computador de um sócio e testar com a chave privada (requer Docker nesse computador, ou fazer no servidor):
  ```bash
  sudo rclone copy gdrive:backups-erp3d/diario/<arquivo>.dump.age /tmp/teste/
  ```
  ```bash
  sudo AGE_IDENTITY=/caminho/chave-erp3d-backup.txt scripts/testar-restauracao.sh /tmp/teste/<arquivo>.dump.age
  ```
  Apague a chave do servidor depois do teste.
- **Anual:** simulado completo de desastre: instalar o ERP em outro computador seguindo a seção "Servidor perdido" de docs/RECUPERACAO.md e medir quanto tempo leva.

Registre data e resultado de cada teste (os automáticos ficam em `status/testes_restauracao.log`).

## Funcionamento contínuo do notebook

- **Ventilação:** deixe o notebook em superfície dura e ventilada, nunca sobre tecido. Com a tampa fechada, alguns modelos esquentam mais; se a temperatura passar de 80 °C, deixe a tampa entreaberta. Para ver a temperatura: `sudo apt-get install lm-sensors && sensors`.
- **Limpeza:** a cada 6 a 12 meses, limpe a poeira da ventoinha.
- **Bateria:** verifique a cada 3 meses se ela não está estufada (tampa ou teclado levantando). Bateria estufada deve ser removida.
- **Local:** fora do alcance de clientes, de crianças e de luz solar direta. O notebook guarda todos os dados da empresa.
- **Tela:** o Ubuntu Server apaga o console sozinho após alguns minutos.
- **Cabo de rede:** prefira cabo ao Wi-Fi. É mais estável e dispensa senha de Wi-Fi no servidor.
- **Disco externo:** mantenha conectado. Se for levá-lo para outro local como cópia extra, traga de volta no mesmo dia, ou use dois discos em revezamento (cada um com o mesmo LABEL).
- **Não instale** outros programas nem use o notebook como computador pessoal.
- **Disco cheio:** o monitor avisa a partir de 85%. Ajuste as retenções no `.env` ou rode `sudo docker system prune` (remove só imagens e containers parados, nunca o volume do banco).
