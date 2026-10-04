# platform

## Bootstrap

1. In UniFi, reserve `192.168.1.10` for this machine's MAC.
2. `sudo ./platform/host/prepare.sh`: hostname, packages, k3s data dir, firewalld.
3. `sudo ./platform/k3s/install.sh [user...]`: SELinux policy, `/etc/rancher/k3s/config.yaml`, k3s. Gives each user (default: the sudo caller) `~/.kube/config` plus `~/.bashrc.d/kubeconfig.sh` exporting `KUBECONFIG`; k3s's `kubectl` otherwise reads the root-only `/etc/rancher/k3s/k3s.yaml`. Via the agent account: `sudo -u omp sudo ./platform/k3s/install.sh jari`.
4. `kubectl apply -k platform/components/local-path`: default StorageClass `local-path`.

Both scripts are idempotent. Re-run `install.sh` after editing `k3s/config.yaml`; bump `K3S_VERSION` in it to upgrade.

## Components

Cluster add-ons under `components/`, one kustomization each; apply with `kubectl apply -k`.

| Component | Notes |
|---|---|
| `local-path` | local-path-provisioner v0.0.37, replacing the k3s-bundled one (`disable: [local-storage]`). Volumes in `/var/lib/rancher/k3s/storage`. Helper pod runs with MCS range `s0-s0:c0.c1023`; without it, SELinux blocks deleting volumes written by other pods ([k3s#10130](https://github.com/k3s-io/k3s/issues/10130)). |

k3s still provides Traefik, ServiceLB, CoreDNS and metrics-server.

## Agent access

`platform/host/agent-access.sh` toggles root access for the coding agent (`omp` account):

| Command | Effect |
|---|---|
| `sudo ./platform/host/agent-access.sh on` | Create `omp` if missing (password locked), install `/etc/sudoers.d/omp`: invoking user → `omp` → root, no password |
| `sudo ./platform/host/agent-access.sh off` | Remove the sudoers file; account and home stay |
| `sudo ./platform/host/agent-access.sh remove` | Remove the sudoers file and delete the account with its home |
| `./platform/host/agent-access.sh status` | Report account presence and whether access works |

While on, anything running as the invoking user can reach root without a password. Audit with `journalctl _COMM=sudo`.

## Host layout

| Path | Notes |
|---|---|
| `/var/lib/rancher` | Bind mount of `/home/rancher` (root LV is only 70G). Holds containerd images and local-path volumes (`k3s/storage`). SELinux equivalence rule labels `/home/rancher` like `/var/lib/rancher`. |
| `/etc/rancher/k3s/config.yaml` | Copied from `k3s/config.yaml` |
| `/etc/yum.repos.d/k3s-selinux.repo` | Rancher testing channel; EL10 policy is not in stable yet |

## Network

| | |
|---|---|
| Pod / service CIDR | `10.42.0.0/16` / `10.43.0.0/16` (firewalld `trusted` zone) |
| Open on LAN | 6443/tcp (API), 80/443 (Traefik via ServiceLB on the node IP) |
| Not open yet | 10250/tcp, 8472/udp: needed when a second node joins |
