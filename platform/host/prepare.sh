#!/usr/bin/env bash
# One-time host preparation for the k3s node. Idempotent; run as root:
#   sudo ./platform/host/prepare.sh
set -euo pipefail

NODE_HOSTNAME=shilly-shally-lab-01
# Root LV is small (70G); bulk k3s state (images, local-path volumes) lives on /home.
DATA_DIR=/home/rancher
DATA_MOUNT=/var/lib/rancher
POD_CIDR=10.42.0.0/16
SERVICE_CIDR=10.43.0.0/16

[[ $EUID -eq 0 ]] || { echo "run as root: sudo $0" >&2; exit 1; }

echo "== hostname"
hostnamectl set-hostname "$NODE_HOSTNAME"

echo "== packages"
dnf install -y container-selinux policycoreutils-python-utils git

echo "== k3s data on /home, mounted at $DATA_MOUNT"
install -d -m 0755 "$DATA_DIR" "$DATA_MOUNT"
# Label $DATA_DIR as if it were $DATA_MOUNT, so a relabel of /home keeps container contexts.
if ! semanage fcontext -l -C | grep -qxF "$DATA_DIR = $DATA_MOUNT"; then
  semanage fcontext -a -e "$DATA_MOUNT" "$DATA_DIR"
fi
FSTAB_LINE="$DATA_DIR $DATA_MOUNT none bind,x-systemd.requires-mounts-for=/home 0 0"
if ! grep -qE "^[^#]*[[:space:]]$DATA_MOUNT[[:space:]]" /etc/fstab; then
  echo "$FSTAB_LINE" >> /etc/fstab
  systemctl daemon-reload
fi
mountpoint -q "$DATA_MOUNT" || mount "$DATA_MOUNT"
restorecon -R "$DATA_DIR" "$DATA_MOUNT"

echo "== firewalld"
iface=$(ip -4 route show default | awk '{print $5; exit}')
if ! zone=$(firewall-cmd --get-zone-of-interface="$iface" 2>/dev/null); then
  zone=$(firewall-cmd --get-default-zone)
fi
firewall-cmd --permanent --zone=trusted --add-source="$POD_CIDR" --add-source="$SERVICE_CIDR"
# 6443: Kubernetes API (kubectl from LAN/VPN); 80/443: Traefik ingress.
firewall-cmd --permanent --zone="$zone" --add-port=6443/tcp
firewall-cmd --permanent --zone="$zone" --add-service=http --add-service=https
firewall-cmd --reload

echo
echo "hostname: $(hostnamectl hostname)"
findmnt "$DATA_MOUNT"
ls -Zd "$DATA_DIR"
echo "firewalld zone for $iface: $zone"
firewall-cmd --zone="$zone" --list-all
firewall-cmd --zone=trusted --list-all
