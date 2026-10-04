# homelab

Single-node k3s cluster on `shilly-shally-lab-01` (Rocky Linux 10, 192.168.1.10), reachable on the LAN and over the UniFi site-to-site VPN.

| Directory | Contents |
|---|---|
| [`platform/`](platform/) | Host preparation, k3s, and cluster-wide add-ons |
| [`apps/`](apps/) | Applications, one directory per app |

Everything deployed to the cluster is declared in this repo (manifests, Helm values). No `kubectl edit` or ad-hoc `--set`; the repo is meant to be handed to Argo CD later without rework.
