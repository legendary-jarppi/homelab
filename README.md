# homelab

Single-node k3s cluster on `shilly-shally-lab-01` (Rocky Linux 10, 192.168.1.10), reachable on the home LAN and from the cabin over the Site Magic VPN ([docs/other-site-network.md](docs/other-site-network.md)).

| Directory | Contents |
|---|---|
| [`platform/`](platform/) | Host preparation, k3s, and cluster-wide add-ons |
| [`apps/`](apps/) | Applications, one directory per app |
| [`docs/`](docs/) | Network notes, [future plans](docs/future-plans.md) (cabin LoRaWAN sensors, septic tank level, DSC Neo alarms and alarm-driven cabin heating) and the [shopping list](docs/shopping-list.md) |

Everything deployed to the cluster is declared in this repo (manifests, Helm values). No `kubectl edit` or ad-hoc `--set`; the repo is meant to be handed to Argo CD later without rework.
