# platform

## Bootstrap

1. In UniFi, reserve `192.168.1.10` for this machine's MAC.
2. `sudo ./platform/host/prepare.sh`: hostname, packages, k3s data dir, firewalld.
3. `sudo ./platform/k3s/install.sh [user...]`: SELinux policy, `/etc/rancher/k3s/config.yaml`, k3s. Gives each user (default: the sudo caller) `~/.kube/config` plus `~/.bashrc.d/kubeconfig.sh` exporting `KUBECONFIG`; k3s's `kubectl` otherwise reads the root-only `/etc/rancher/k3s/k3s.yaml`. Via the agent account: `sudo -u omp sudo ./platform/k3s/install.sh jari`.
4. `kubectl apply -k platform/components/local-path`: default StorageClass `local-path`.
5. Grafana admin secret (kept out of git), then monitoring:
   ```sh
   kubectl apply -f platform/components/monitoring/namespace.yaml
   kubectl -n monitoring create secret generic grafana-admin --from-literal=admin-user=admin \
     --from-literal=admin-password="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
   kubectl apply -k platform/components/monitoring
   ```
   Grafana reads the password only when it first initializes its database; later changes to the secret need `grafana cli admin reset-admin-password`.
6. `kubectl apply -k platform/components/headlamp`.
7. UniFi read-only login (a local *View Only* Network admin on the UDM Pro, kept out of git), then UnPoller:
   ```sh
   kubectl apply -f platform/components/unpoller/namespace.yaml
   read -rp 'UniFi user: ' U && read -rsp 'UniFi password: ' P && echo
   kubectl -n unpoller create secret generic unifi-readonly --from-literal=user="$U" --from-literal=pass="$P"
   unset U P
   kubectl apply -k platform/components/unpoller
   ```
8. Camera stream tokens (kept out of git), then go2rtc. In UniFi Protect, enable RTSPS per camera (*Settings > Advanced*); the token is the URL part after the last `/` and before `?`. One secret key per stream name in `components/go2rtc/go2rtc.yaml`:
   ```sh
   kubectl apply -f platform/components/go2rtc/namespace.yaml
   args=(); for cam in front-door backyard carport; do
     read -rsp "$cam RTSPS URL: " url && echo; t=${url##*/}; t=${t%%\?*}; args+=(--from-literal="$cam=$t")
   done
   kubectl -n go2rtc create secret generic camera-tokens "${args[@]}"; unset url t args
   kubectl apply -k platform/components/go2rtc
   ```
   go2rtc reads tokens at start: after changing the secret, `kubectl -n go2rtc rollout restart deploy/go2rtc`.
9. `kubectl apply -k platform/components/traefik`: Traefik keeps client source addresses.
10. Backup to Google Drive: authorize rclone and create secret `backup` as in [components/backup/README.md](components/backup/README.md#setup), then `./platform/components/backup/deploy.sh`.

Both scripts are idempotent. Re-run `install.sh` after editing `k3s/config.yaml`; bump `K3S_VERSION` in it to upgrade.

## Components

Cluster add-ons under `components/`, one kustomization each; apply with `kubectl apply -k`. Helm charts are declared as k3s `HelmChart` resources (installed by k3s's helm-controller; install logs: `kubectl -n kube-system logs job/helm-install-<name>`), so no `helm` CLI is needed.

| Component | Notes |
|---|---|
| `local-path` | local-path-provisioner v0.0.37, replacing the k3s-bundled one (`disable: [local-storage]`). Volumes in `/var/lib/rancher/k3s/storage`. Helper pod runs with MCS range `s0-s0:c0.c1023`; without it, SELinux blocks deleting volumes written by other pods ([k3s#10130](https://github.com/k3s-io/k3s/issues/10130)). |
| `monitoring` | kube-prometheus-stack 91.9.0 in namespace `monitoring`. Prometheus at http://prometheus.lab.internal (no auth, 15 days / 18 GB retention, 20 Gi volume), Grafana at http://grafana.lab.internal (`admin`; password: `kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' \| base64 -d`). Picks up ServiceMonitors/PodMonitors/rules from all namespaces. Alertmanager and the controller-manager/scheduler/proxy/etcd monitors are off (no receivers; components are embedded in k3s). node-exporter runs as SELinux `spc_t` (confined, it cannot read `/proc/1`). Traefik is scraped through a PodMonitor. |
| `headlamp` | Headlamp 0.45.0 at http://kube.lab.internal (the Kubernetes Dashboard project is archived). Its own service account has no cluster permissions; log in with a token for `headlamp-admin` (cluster-admin): `kubectl -n headlamp create token headlamp-admin --duration=720h`. Revoke all tokens by deleting and re-applying the `headlamp-admin` ServiceAccount. Tokens travel over plain HTTP on the LAN until TLS exists. |
| `unpoller` | UnPoller v5.5.0 polling the UDM Pro (`https://192.168.1.1`) every 10 s (the UDM's counters change at that rate; feeds the dashboard's live chart); metrics prefixed `unpoller_` (gateway/WAN, switch ports, APs, clients, speed tests; DPI off). Grafana dashboards in `dashboards/` are grafana.com 11311-11315 with the datasource placeholders replaced by `Prometheus`; loaded as ConfigMaps labelled `grafana_dashboard: "1"`. Panels that stay empty: DPI categories, client-type breakdowns the UDM doesn't report, name-matched Echo/FireTV/camera panels. |
| `go2rtc` | go2rtc 1.9.14, cluster-internal (`go2rtc.go2rtc.svc:1984`): UniFi Protect RTSPS (`rtspx://192.168.1.1:7441/<token>`) repackaged without transcoding. Viewed through the dashboard (passcode login, WebSocket relay); a NetworkPolicy admits only the `dashboard` namespace. Streams `front-door`, `backyard`, `carport`; connects to Protect only while someone watches. Locked down: modules `api, ws, rtsp, mp4, mjpeg` only, API limited to `/`, `/api/ws`, `/api/frame.jpeg` (no stream/config editing, no exec). Tokens come from secret `camera-tokens`, mounted as credential files. Debug locally: `kubectl -n go2rtc port-forward svc/go2rtc 1984`. |
| `traefik` | `HelmChartConfig` merged into k3s's bundled Traefik: `externalTrafficPolicy: Local`, so apps see real client addresses in `X-Forwarded-For` (with `Cluster`, ServiceLB rewrites every client to `10.42.0.1`). |
| `backup` | Nightly (03:30) restic backup to Google Drive through rclone, encrypted: `pg_dump` of pods labelled `backup.homelab/dump: postgres`, every local-path volume except those Postgres data dirs and Prometheus, and the Opaque secrets. Keeps 7 daily, 5 weekly, 12 monthly. Own image (`deploy.sh`). Setup, adding apps, restore: [components/backup/README.md](components/backup/README.md). |

k3s still provides Traefik (configured by `components/traefik`), ServiceLB, CoreDNS and metrics-server.

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
