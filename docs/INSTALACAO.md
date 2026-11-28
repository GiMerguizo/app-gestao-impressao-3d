# Instalação do servidor

Tempo estimado: 1h30. Ao final, os dois sócios acessam o ERP pelo celular ou notebook em `https://erp.<sua-tailnet>.ts.net`, de casa, da empresa ou da rua.

## 0. O que é preciso

| Item | Recomendação |
|---|---|
| Notebook-servidor | 64 bits, **4 GB de RAM** (2 GB funciona no limite), **SSD** de preferência, bateria em condições razoáveis |
| Pendrive | 4 GB ou mais, para instalar o sistema |
| Disco externo USB | Qualquer tamanho a partir de 32 GB. Fica ligado ao notebook |
| Contas | Uma conta Google, Microsoft ou GitHub para cada sócio, **com verificação em duas etapas ativada** (é com ela que se entra na Tailscale) |
| Nobreak pequeno (opcional) | Para o roteador. A bateria do notebook já protege o servidor |

## 1. BIOS do notebook

Entre no BIOS (geralmente F2, F10, F12 ou Del ao ligar) e configure:

- **Restore on AC power loss / Power on after AC loss / Auto power on:** `On`. O notebook liga sozinho quando a energia volta. Nem todo notebook tem essa opção. Se não tiver, alguém precisa apertar o botão depois de uma falta de energia longa.
- **Wake on LAN:** opcional.
- Se houver opção de **limitar a carga da bateria** (ex.: 80%), ative. Isso prolonga a vida da bateria que fica sempre na tomada.

## 2. Instalar o Ubuntu Server 24.04 LTS

1. Baixe o Ubuntu Server 24.04 LTS (ubuntu.com/download/server) e grave no pendrive com o balenaEtcher ou o Rufus.
2. Instale com: idioma à escolha; teclado `Portuguese (Brazil)`; **usar o disco inteiro**; **marcar "Install OpenSSH server"**; não marcar nenhum snap adicional.
3. Crie um usuário administrador (ex.: `admin`) com senha forte.
4. Ao terminar, anote o IP local exibido (`ip -4 addr`).

Debian 12 ou 13 (instalação mínima + servidor SSH) também é suportado.

A partir daqui dá para continuar de outro computador da rede: `ssh admin@IP-DO-NOTEBOOK`.

Recomendado: cadastre sua chave SSH (`ssh-copy-id admin@IP`). O passo 4 desativa login SSH por senha quando encontra uma chave.

## 3. Preparar a Tailscale (no navegador, uma vez)

1. O sócio 1 cria a conta em https://login.tailscale.com (plano Personal, gratuito) com a conta dele.
2. **Users → Invite users:** convide o e-mail do sócio 2.
3. **DNS:** confirme que **MagicDNS** está ativado. Em **HTTPS Certificates**, clique em **Enable**.
4. **Access controls:** substitua o conteúdo pela política de `servidor/tailscale/politica-acl.hujson` deste repositório, trocando os e-mails de exemplo pelos e-mails reais dos sócios. Salve.
5. (Recomendado) **Settings → Device management → Device approval:** ative. Assim, todo dispositivo novo precisa ser aprovado por um sócio.

## 4. Baixar o ERP e preparar o servidor

```bash
sudo apt-get update && sudo apt-get install -y git
```

```bash
sudo git clone https://github.com/GiMerguizo/app-gestao-impressao-3d.git /opt/erp3d
```

Se o repositório for privado, crie um token de acesso somente leitura no GitHub e use `https://<token>@github.com/...`, ou cadastre uma deploy key.

```bash
cd /opt/erp3d && sudo servidor/preparar-servidor.sh
```

O script instala Docker e Tailscale, desativa a suspensão e a ação da tampa, configura firewall, logs, atualizações automáticas e SSH, e registra os serviços de boot, backup e monitoramento. Pode ser executado de novo sem problemas.

## 5. Conectar o servidor à Tailscale

```bash
sudo tailscale up --advertise-tags=tag:erp-servidor --hostname=erp
```

Abra o link exibido e autorize com a conta de um dos sócios. Como o dispositivo tem tag, **a chave não expira**, e o servidor não sai da rede sozinho depois de 180 dias.

Confira com `tailscale status`. O servidor aparece como `erp`.

## 6. Instalar o ERP

```bash
cd /opt/erp3d && sudo scripts/instalar.sh
```

Revise o `.env` criado (`sudo nano /opt/erp3d/.env`). Em especial, confira `BACKUP_DIR`, `DISCO_EXTERNO` e `OFFSITE_*`. Os passos 9 e 10 tratam do disco e da cópia independente.

Crie a empresa e o login de cada sócio. A senha é digitada no terminal e precisa ter pelo menos 10 caracteres:

```bash
cd /opt/erp3d && sudo docker compose exec backend node src/cli.js empresa:criar "Minha Empresa 3D"
```

```bash
cd /opt/erp3d && sudo docker compose exec backend node src/cli.js usuario:criar socio1 "Nome do Sócio 1" "Minha Empresa 3D" admin
```

```bash
cd /opt/erp3d && sudo docker compose exec backend node src/cli.js usuario:criar socio2 "Nome do Sócio 2" "Minha Empresa 3D" admin
```

Cada sócio pode trocar a própria senha depois, pelo botão **Senha** no topo do ERP.

## 7. Publicar o ERP na Tailscale (HTTPS)

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
```

```bash
tailscale serve status
```

O endereço do ERP aparece no status, algo como `https://erp.tail1234.ts.net`. Essa configuração é permanente e sobrevive a reinícios.

> Não use `tailscale funnel`: ele publicaria o ERP na internet aberta.

## 8. Dispositivos dos sócios

Em cada celular e notebook:

1. Instale o app **Tailscale** (Play Store, App Store, tailscale.com/download).
2. Entre com a conta do sócio e aprove o dispositivo no painel, se a aprovação estiver ativada.
3. Abra `https://erp.<sua-tailnet>.ts.net`, faça login no ERP e, no celular, use "Adicionar à tela inicial".

Isso funciona igual na rede local e fora dela. Na mesma rede, a Tailscale conecta direto pela LAN.

## 9. Disco externo (cópia 1)

Conecte o disco e descubra o nome do dispositivo (ex.: `sdb`):

```bash
lsblk -o NAME,SIZE,MODEL,MOUNTPOINT
```

**Atenção:** a formatação apaga o disco. Confira o nome duas vezes.

```bash
sudo mkfs.ext4 -L backup-erp3d /dev/sdX1
```

(Se o disco não tiver partição, crie uma antes com `sudo fdisk /dev/sdX`: `n`, Enter até o fim, `w`.)

```bash
sudo mkdir -p /mnt/backup-erp3d
```

```bash
echo "LABEL=backup-erp3d /mnt/backup-erp3d ext4 defaults,nofail,x-systemd.device-timeout=10s 0 2" | sudo tee -a /etc/fstab
```

```bash
sudo mount -a && findmnt /mnt/backup-erp3d
```

O `nofail` garante que o notebook liga mesmo com o disco desconectado. O monitor avisa quando o disco não está montado.

## 10. Cópia em local independente (cópia 2)

Escolha **uma** das opções e preencha no `.env`.

### Chave de criptografia (para as duas opções)

Gere a chave **no computador de um dos sócios**, não no servidor:

```bash
age-keygen -o chave-erp3d-backup.txt
```

(age: https://github.com/FiloSottile/age. No Windows, `winget install FiloSottile.age`.)

- A linha `# public key: age1...` vai para `AGE_RECIPIENT=` no `.env` do servidor.
- O arquivo `chave-erp3d-backup.txt` é a **chave privada**. Guarde nos gerenciadores de senha **dos dois sócios** e, de preferência, também impresso num envelope. **Sem ela, as cópias criptografadas não podem ser abertas.** Ela não fica no servidor: se o notebook for roubado, os backups da nuvem continuam ilegíveis.

### Opção A: nuvem gratuita com rclone (recomendada)

Exemplo com Google Drive, que tem 15 GB grátis:

```bash
sudo rclone config
```

Crie um remoto chamado `gdrive` do tipo `drive`, escopo `drive.file`. Como o servidor não tem navegador, responda **n** em "Use auto config?" e siga a instrução de rodar `rclone authorize "drive"` num computador com navegador.

No `.env`:

```
OFFSITE_METODO=rclone
RCLONE_DESTINO=gdrive:backups-erp3d
AGE_RECIPIENT=age1...
```

### Opção B: computador do outro sócio (rsync pela Tailscale)

Requer Linux ou macOS com SSH ativado no computador de destino, e esse computador ligado no horário do backup (02:30; se estiver desligado, o envio falha e o alerta avisa).

1. No painel da Tailscale, aplique a tag `tag:backup-remoto` ao computador do sócio 2.
2. No servidor, gere uma chave SSH para o root e copie para o destino:

```bash
sudo ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519
```

```bash
sudo ssh-copy-id socio2@notebook-socio2
```

3. No `.env`:

```
OFFSITE_METODO=rsync
RSYNC_DESTINO=socio2@notebook-socio2:/home/socio2/backups-erp3d
AGE_RECIPIENT=age1...
```

## 11. Monitoramento e alertas no celular (opcional, recomendado)

- **ntfy** (alertas do próprio servidor): instale o app ntfy, assine um tópico com nome longo e aleatório (ex.: `erp3d-k29fj3m1q8`) e coloque `NTFY_URL=https://ntfy.sh/erp3d-k29fj3m1q8` no `.env`. O servidor avisa quando um backup falha, o disco enche, um container cai etc.
- **healthchecks.io** (avisa quando o servidor **some**, por falta de luz, internet ou travamento): crie dois checks gratuitos:
  - "ERP monitor": período 5 min, tolerância 15 min. Coloque a URL em `HC_MONITOR_URL`.
  - "ERP backup": período 1 dia, tolerância 3 h. Coloque a URL em `HC_BACKUP_URL`.
  - Configure o aviso por e-mail ou pelo app para os dois sócios.

Esses serviços recebem só "pings" e mensagens de status. Nenhum dado do ERP sai do servidor.

## 12. Validação final (obrigatória)

```bash
sudo /opt/erp3d/scripts/backup.sh
```

```bash
sudo /opt/erp3d/scripts/testar-restauracao.sh
```

```bash
sudo /opt/erp3d/scripts/monitorar.sh
```

O resultado esperado é "tudo OK". Depois:

```bash
sudo reboot
```

Após uns 2 minutos, abra o ERP pelo celular **usando os dados móveis** (Wi-Fi desligado). Isso prova o acesso remoto e o início automático.

Feche a tampa do notebook e confirme que o ERP continua respondendo.

### Checklist

- [ ] ERP abre pelo celular nos dados móveis e no Wi-Fi da empresa
- [ ] Login individual dos dois sócios funcionando
- [ ] `ufw status` mostra apenas 443/22 na `tailscale0`, SSH da LAN e 41641/udp
- [ ] O backup gerou arquivos em `/srv/erp3d/backups`, no disco externo e no destino independente
- [ ] O teste de restauração terminou com "RESTAURAÇÃO OK"
- [ ] Depois de reiniciar, tudo voltou sozinho
- [ ] Com a tampa fechada, o servidor continua ativo
- [ ] A chave privada age está guardada com os dois sócios
- [ ] Os alertas (ntfy / healthchecks) chegam no celular. Teste: `sudo docker compose stop web` e, depois, `sudo docker compose start web`

## 13. Migrar dados do modo local (se já usavam o ERP no navegador)

No navegador onde os dados estão, abra o ERP antigo, aperte F12, vá à aba **Console** e rode:

```js
copy(localStorage.getItem("erp3d"))
```

Cole o conteúdo num arquivo `erp3d-export.json` e envie ao servidor (ex.: `scp erp3d-export.json admin@erp:/tmp/`). Depois:

```bash
cd /opt/erp3d && sudo docker compose exec -T backend node src/cli.js dados:importar "Minha Empresa 3D" < /tmp/erp3d-export.json
```

```bash
rm /tmp/erp3d-export.json
```
