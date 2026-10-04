#!/usr/bin/env bash
# Install, reconfigure or upgrade k3s on this node. Idempotent; run as root:
#   sudo ./platform/k3s/install.sh [kubeconfig-user...]
# Copies the admin kubeconfig to each user's ~/.kube/config (default: the sudo caller).
# Upgrade: bump K3S_VERSION and re-run.
set -euo pipefail

K3S_VERSION=v1.36.5+k3s1

[[ $EUID -eq 0 ]] || { echo "run as root: sudo $0" >&2; exit 1; }
mountpoint -q /var/lib/rancher || { echo "/var/lib/rancher not mounted; run platform/host/prepare.sh first" >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)

echo "== SELinux policy"
# get.k3s.io maps EL10 to the el9 package, so the policy is installed here instead.
install -m 0644 "$here/k3s-selinux.repo" /etc/yum.repos.d/k3s-selinux.repo
dnf install -y container-selinux k3s-selinux

echo "== config"
install -d -m 0755 /etc/rancher/k3s
# World-readable: holds no secrets, and k3s's kubectl reads it on every invocation.
install -m 0644 "$here/config.yaml" /etc/rancher/k3s/config.yaml

k3s=/usr/local/bin/k3s # not on sudo's secure_path
echo "== k3s $K3S_VERSION"
curl -sfL https://get.k3s.io |
  INSTALL_K3S_VERSION="$K3S_VERSION" INSTALL_K3S_SKIP_SELINUX_RPM=true INSTALL_K3S_SKIP_START=true sh -
# Skipping the installer's SELinux step also skips its relabel; the downloaded binary keeps user_tmp_t.
restorecon -v "$k3s"
systemctl restart k3s

echo "== kubeconfig"
for _ in $(seq 60); do [[ -s /etc/rancher/k3s/k3s.yaml ]] && break; sleep 1; done
users=("$@")
[[ ${#users[@]} -gt 0 || -z ${SUDO_USER:-} || $SUDO_USER == root ]] || users=("$SUDO_USER")
for u in "${users[@]}"; do
  user_home=$(getent passwd "$u" | cut -d: -f6)
  install -d -m 0700 -o "$u" -g "$u" "$user_home/.kube"
  install -m 0600 -o "$u" -g "$u" /etc/rancher/k3s/k3s.yaml "$user_home/.kube/config"
  # k3s's kubectl defaults to the root-only /etc/rancher/k3s/k3s.yaml unless KUBECONFIG is set.
  install -d -m 0700 -o "$u" -g "$u" "$user_home/.bashrc.d"
  echo 'export KUBECONFIG="$HOME/.kube/config"' |
    install -m 0644 -o "$u" -g "$u" /dev/stdin "$user_home/.bashrc.d/kubeconfig.sh"
  echo "wrote $user_home/.kube/config and $user_home/.bashrc.d/kubeconfig.sh"
done

echo
node=$(awk '/^node-name:/ {print $2}' "$here/config.yaml")
for _ in $(seq 120); do "$k3s" kubectl get node "$node" &>/dev/null && break; sleep 1; done
"$k3s" kubectl wait --for=condition=Ready "node/$node" --timeout=180s
"$k3s" kubectl get nodes -o wide
