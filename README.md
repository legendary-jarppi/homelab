# homelab

Single-node k3s cluster on `shilly-shally-lab-01` (Rocky Linux 10, 192.168.1.10), reachable on the home LAN; access from the other site needs the pending site-to-site VPN ([docs/other-site-network.md](docs/other-site-network.md)).

| Directory | Contents |
|---|---|
| [`platform/`](platform/) | Host preparation, k3s, and cluster-wide add-ons |
| [`apps/`](apps/) | Applications, one directory per app |
| [`docs/`](docs/) | Network notes and pending on-site tasks |

Everything deployed to the cluster is declared in this repo (manifests, Helm values). No `kubectl edit` or ad-hoc `--set`; the repo is meant to be handed to Argo CD later without rework.
