#!/usr/bin/env bash
# Prepara um notebook com Ubuntu Server LTS (22.04/24.04) ou Debian 12/13 para ser o servidor do ERP.
# Idempotente: pode ser executado de novo com segurança.
#
# Uso (dentro da pasta do repositório clonado, ex.: /opt/erp3d):
#   sudo servidor/preparar-servidor.sh
#   sudo LAN_CIDR=192.168.1.0/24 servidor/preparar-servidor.sh   # informa a rede local manualmente
#
# O que faz:
#   1. Atualiza o sistema e instala utilitários (git, ufw, rsync, age, rclone, smartmontools)
#   2. Instala Docker Engine + Compose (repositório oficial) com rotação de logs
#   3. Instala Tailscale
#   4. Desativa suspensão/hibernação e a ação de fechar a tampa
#   5. Logs persistentes com limite de tamanho; fuso horário; atualizações de segurança automáticas
#   6. Firewall (UFW): nega tudo que entra, exceto HTTPS/SSH pela Tailscale e SSH pela rede local
#   7. Endurece o SSH (sem root; sem senha, se já houver chave cadastrada)
#   8. Instala os serviços e timers systemd do ERP (boot, backup, teste de restauração, monitor)
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Execute como root: sudo $0"; exit 1; }

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log() { printf '\n==> %s\n' "$*"; }
. /etc/os-release
[[ "$ID" == ubuntu || "$ID" == debian ]] || { echo "Sistema não suportado: $ID (use Ubuntu Server LTS ou Debian)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# ------------------------------------------------------------------ 1. pacotes
log "Atualizando o sistema"
apt-get update -q
apt-get -y -q full-upgrade
apt-get -y -q install ca-certificates curl gnupg git ufw unattended-upgrades apt-listchanges \
  rsync age rclone smartmontools jq util-linux openssl

# ------------------------------------------------------------------ 2. Docker
if ! command -v docker >/dev/null; then
  log "Instalando Docker Engine (repositório oficial)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if [[ ! -f /etc/docker/daemon.json ]]; then
  log "Configurando Docker (rotação de logs, live-restore)"
  mkdir -p /etc/docker
  cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true
}
JSON
  systemctl restart docker
fi
systemctl enable --now docker containerd

# ------------------------------------------------------------------ 3. Tailscale
if ! command -v tailscale >/dev/null; then
  log "Instalando Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled

# ------------------------------------------------------------------ 4. sem suspensão
log "Desativando suspensão, hibernação e ação da tampa"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target >/dev/null
mkdir -p /etc/systemd/logind.conf.d
cat >/etc/systemd/logind.conf.d/erp3d-servidor.conf <<'CONF'
# Notebook usado como servidor: fechar a tampa ou ficar ocioso não pode suspender.
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
IdleAction=ignore
CONF
systemctl kill -s HUP systemd-logind 2>/dev/null || true

# ------------------------------------------------------------------ 5. logs, hora, atualizações
log "Logs persistentes (máx. 500 MB), fuso horário e atualizações automáticas"
mkdir -p /etc/systemd/journald.conf.d
cat >/etc/systemd/journald.conf.d/erp3d.conf <<'CONF'
[Journal]
Storage=persistent
SystemMaxUse=500M
MaxRetentionSec=3month
CONF
systemctl restart systemd-journald
timedatectl set-timezone America/Sao_Paulo || true
timedatectl set-ntp true || true

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat >/etc/apt/apt.conf.d/52erp3d-unattended <<'CONF'
// Reinicia sozinho de madrugada quando uma atualização de segurança exigir (o ERP volta sozinho).
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
CONF
systemctl enable --now unattended-upgrades smartmontools 2>/dev/null || systemctl enable --now smartd 2>/dev/null || true
echo 'vm.swappiness=10' >/etc/sysctl.d/90-erp3d.conf
sysctl -q --system || true

# ------------------------------------------------------------------ 6. firewall
if [[ -z "${LAN_CIDR:-}" ]]; then
  iface="$(ip -4 route show default | awk '{print $5; exit}')"
  LAN_CIDR="$(ip -4 -o addr show dev "$iface" 2>/dev/null | awk '{print $4; exit}')"
  [[ -n "$LAN_CIDR" ]] && LAN_CIDR="$(python3 -c "import ipaddress,sys;print(ipaddress.ip_interface(sys.argv[1]).network)" "$LAN_CIDR" 2>/dev/null || echo "")"
fi
log "Firewall UFW (rede local detectada: ${LAN_CIDR:-nenhuma})"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow in on tailscale0 to any port 443 proto tcp comment 'ERP via tailscale serve' >/dev/null
ufw allow in on tailscale0 to any port 22 proto tcp comment 'SSH via Tailscale' >/dev/null
[[ -n "${LAN_CIDR:-}" ]] && ufw allow from "$LAN_CIDR" to any port 22 proto tcp comment 'SSH rede local (emergencia)' >/dev/null
ufw allow 41641/udp comment 'Tailscale conexao direta (WireGuard)' >/dev/null
ufw --force enable >/dev/null
ufw status verbose

# ------------------------------------------------------------------ 7. SSH
if [[ -d /etc/ssh/sshd_config.d ]]; then
  log "Endurecendo SSH"
  {
    echo "PermitRootLogin no"
    echo "MaxAuthTries 4"
    echo "X11Forwarding no"
    if compgen -G "/home/*/.ssh/authorized_keys" >/dev/null && [[ -n "$(cat /home/*/.ssh/authorized_keys 2>/dev/null)" ]]; then
      echo "PasswordAuthentication no"
      echo "KbdInteractiveAuthentication no"
    fi
  } >/etc/ssh/sshd_config.d/90-erp3d.conf
  grep -q PasswordAuthentication /etc/ssh/sshd_config.d/90-erp3d.conf \
    || echo "AVISO: nenhuma chave SSH cadastrada; login por senha continua ativo. Cadastre uma chave (ssh-copy-id) e rode este script de novo."
  if sshd -t; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  else
    echo "ERRO na configuração do SSH; removendo 90-erp3d.conf para não perder o acesso."
    rm -f /etc/ssh/sshd_config.d/90-erp3d.conf
  fi
fi

# ------------------------------------------------------------------ 8. serviços do ERP
log "Instalando serviços systemd do ERP (pasta: $RAIZ)"
chmod +x "$RAIZ"/scripts/*.sh "$RAIZ"/servidor/*.sh
for unidade in "$RAIZ"/servidor/systemd/*; do
  sed "s#__RAIZ__#$RAIZ#g" "$unidade" >"/etc/systemd/system/$(basename "$unidade")"
done
systemctl daemon-reload
systemctl enable erp3d.service erp3d-backup.timer erp3d-restore-test.timer erp3d-monitor.timer
systemctl start erp3d-backup.timer erp3d-restore-test.timer erp3d-monitor.timer

cat <<EOF

Servidor preparado. Próximos passos (detalhes em docs/INSTALACAO.md):
  1. Conectar à Tailscale:        sudo tailscale up --advertise-tags=tag:erp-servidor
  2. Instalar o ERP:              sudo scripts/instalar.sh
  3. Configurar o disco externo e a cópia independente (.env)
  4. Reiniciar para validar o boot automático: sudo reboot
EOF
