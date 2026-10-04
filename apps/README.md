# apps

One directory per application, each with its own manifests or Helm values.

## Hostnames

Internal zone: `lab.internal` (`.internal` is reserved by ICANN for private use). Becomes `lab.<domain>` once a domain is bought; only the suffix changes.

| Rule | Example |
|---|---|
| Hostname = directory under `apps/` = namespace | `apps/news/` → namespace `news` → `news.lab.internal` |
| Extra endpoints of one app: single label, joined with `-` | `news-api.lab.internal`, not `api.news.lab.internal` (a `*.lab.<domain>` wildcard cert covers one level only) |
| Platform UIs share the zone | `traefik.lab.internal`, `argocd.lab.internal` |
| `lab.` names are never published; public apps (Cloudflare Tunnel) get a separate name directly under the domain | `news.<domain>` (Cloudflare's free cert covers one level only) |

### DNS

Records live on the UDM Pro (*Settings > Policy Table > DNS*). UniFi rejects wildcards, so each app needs its own record:

| Name | Type | Target |
|---|---|---|
| `ingress.lab.internal` | A | `192.168.1.10` (Traefik via ServiceLB) |
| `<app>.lab.internal` | CNAME | `ingress.lab.internal` |

Existing: `news`, `dashboard` (both not deployed yet), `grafana`, `prometheus`, `kube` (Headlamp).

For other sites over site-to-site VPN: a *Forward Domain* record for `lab.internal` → `192.168.1.1`.

No TLS for `lab.internal`: serve plain HTTP until the domain exists (then a Let's Encrypt `*.lab.<domain>` certificate via DNS-01).
