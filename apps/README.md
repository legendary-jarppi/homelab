# apps

One directory per application, each with its own manifests or Helm values.

## Hostnames

Internal zone: `lab.internal` (`.internal` is reserved by ICANN for private use). The domain is `shillyshally.org` (Cloudflare Registrar and DNS); moving the internal zone to `lab.shillyshally.org` changes only the suffix.

| Rule | Example |
|---|---|
| Hostname = directory under `apps/` = namespace | `apps/news/` → namespace `news` → `news.lab.internal` |
| Extra endpoints of one app: single label, joined with `-` | `news-api.lab.internal`, not `api.news.lab.internal` (a `*.lab.<domain>` wildcard cert covers one level only) |
| Platform UIs share the zone | `traefik.lab.internal`, `argocd.lab.internal` |
| `lab.` names are never published; public apps (Cloudflare Tunnel) get a separate name directly under the domain | `notify.shillyshally.org` (Cloudflare's free cert covers one level only) |

### DNS

Records live on the UDM Pro (*Settings > Policy Table > DNS*). UniFi rejects wildcards, so each app needs its own record:

| Name | Type | Target |
|---|---|---|
| `ingress.lab.internal` | A | `192.168.1.10` (Traefik via ServiceLB) |
| `<app>.lab.internal` | CNAME | `ingress.lab.internal` |

Existing: `dashboard` ([apps/dashboard](dashboard/)), `homeassistant` ([apps/homeassistant](homeassistant/)), `homelab` ([apps/homelab](homelab/): the homelab's state, network, devices, plans and docs), `lists` ([apps/lists](lists/)), `news` ([apps/news](news/)), `telescope` ([apps/telescope/web](telescope/web/): the cabin telescope's live stack, conditions and observing log), `workout` ([apps/workout](workout/)), `grafana`, `prometheus`, `kube` (Headlamp). `cameras` is no longer used (go2rtc is cluster-internal); delete its record.

Cluster-internal apps (no hostname, no record): `presence` ([apps/presence](presence/)), who is where, read by the dashboard; `cabin-camera` ([apps/cabin-camera](cabin-camera/)), the cabin camera's motion snapshots for the dashboard, whose FTPS upload is the one service port-forwarded from the internet; `climate` ([apps/climate](climate/)), the cabin's heat pumps for the dashboard's Cabin tab; `ruuvi` ([apps/ruuvi](ruuvi/)), RuuviTag readings from the cabin's Ruuvi Gateway as Prometheus metrics, shown in the Grafana dashboard *Ruuvi*; `telescope` ([apps/telescope](telescope/)), the cabin ASIAIR's imaging sessions (archive, stacking, frame previews, plan progress, notifications) for the dashboard's Telescope tab and the telescope web app (which has the `telescope.lab.internal` name).

Public apps (Cloudflare Tunnel, behind Cloudflare Access; DNS at Cloudflare, no UDM record): `notify` ([apps/notify](notify/)), notifications as web push, `notify.shillyshally.org`; the dashboard also at `dashboard.shillyshally.org` and news at `news.shillyshally.org` (besides their `lab.internal` names). All share the Access policy *Family*. Tunnel and routes: `cloudflared` in [platform/README.md](../platform/README.md#components).

For other sites over site-to-site VPN: a *Forward Domain* record for `lab.internal` → `192.168.1.1`.

No TLS for `lab.internal`: plain HTTP (later a Let's Encrypt `*.lab.shillyshally.org` certificate via DNS-01).
