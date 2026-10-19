# homelab

The homelab's own site at http://homelab.lab.internal: what is running and where, how the network and the devices are connected, what is planned and what to buy, and every README of this repository. Live status from Prometheus; everything else is written in this repo and bundled at build time, so the site shows what was deployed.

SvelteKit 2 + Svelte 5, adapter-node; [marked](https://marked.js.org) renders the markdown on the server, [mermaid](https://mermaid.js.org) draws ```` ```mermaid ```` blocks in the browser (loaded only on pages that have one). Same look as [apps/dashboard](../dashboard/README.md).

## Pages

| Path | Content |
|---|---|
| `/` *Overview* | The two sites (home: UDM Pro 192.168.1.1 and the k3s node 192.168.1.10; cabin: UCG Max 192.168.20.1 behind the Teltonika RUTX50, joined by Site Magic) with UnPoller's view of each console; the cluster's health (workloads ready, container restarts in 24 h, Prometheus targets down, backup status judged as on the dashboard: failed, none yet, or older than 26 h); every app and platform component with its addresses (*lab* `lab.internal` through Traefik, *public* Cloudflare Tunnel, *LAN*, *cluster* internal only), purpose and live status, linking to its README |
| `/components` | The Components diagram: every namespace, the components outside the cluster (home, cabin, internet) and the connections between them, with live pod status; workloads running but not in the diagram are listed in amber under it |
| `/network` | The Network diagram, then the network reference quoted from the docs it lives in: [docs/other-site-network.md](../../docs/other-site-network.md) (lead and *Address plan*), [apps/README.md](../README.md) (*Hostnames*, DNS) and [platform/README.md](../../platform/README.md) (*Network*: open ports, firewall, port forwards) |
| `/devices` | Every device outside the cluster, per site: what it is, its address and MAC, what connects to it and how (the Components diagram's connections: app, protocol, port), and its live status; planned devices marked as such with a link to their plan. Below, the UniFi gear (consoles, switches, access points) and the network clients the model does not name |
| `/plans` | [docs/future-plans.md](../../docs/future-plans.md) |
| `/shopping` | [docs/shopping-list.md](../../docs/shopping-list.md) |
| `/docs`, `/docs/<repo path>` | Index of every markdown file in the repository (the root README, `docs/`, `platform/`, `apps/`), and each one rendered: links between them go to their pages here, links to code, manifests or directories without a README become plain text, mermaid blocks are drawn, tables styled |

Overview, Components and Devices refresh every 30 s while the tab is visible (`GET /api/status`, one set of Prometheus queries for all three). `GET /healthz` is the probe.

## Architecture diagrams and devices

Groups, components, devices and connections are written by hand in `src/lib/architecture.ts` (Kubernetes does not record who talks to whom, and nothing records which device is which); the diagrams' layout is CSS grid areas per diagram, the lines are drawn from the components' measured positions (`src/lib/components/Diagram.svelte`). Tap a component to highlight its connections (labelled) and read what it does, what it talks to, its pods and its docs; on narrow screens the details stay pinned to the bottom. Planned devices and their connections are dashed. **Update it when adding an app, a namespace, a device or a connection**: a workload running in the cluster that no component claims is listed in amber under the Components diagram, a network client no device claims under *Other network clients* on the Devices page.

The model, one source for the diagrams, the Overview's table and the Devices page:

- A namespace group's `app` (kind, one-line purpose, `lab` / `public` / `lan` / `internal` addresses, `docs`) makes it a row in the Overview's table; its status combines the group's workloads.
- A component's `docs` (repo path, optional `#anchor`; default: its group's) is linked from the diagram's details and the Devices page.
- A component's `device` makes it a device: `site` (`home` / `cabin`, each with its UniFi console), `address`, `client` (`{ mac }`, or `{ ip }` while the MAC is unknown: network presence from UnPoller's `unpoller_client_uptime_seconds`), `checks` (PromQL giving 1 when fine, 0 when not; e.g. `climate_device_up{device="nibe"}`, `telescope_asiair_up`, `max(ruuvi_gateway_up)`, `up{job="unpoller", instance=…}`) and `planned` (docs path of the plan).

A device's status: *Planned*; or from its checks: *OK* when all known ones pass, *Down* when all fail, *Partly down* in between, *Unknown* without data. "On the network" is unknown, not down, while the site's console is not reporting to UnPoller.

## Markdown: build and development

`src/lib/server/docs.ts` imports the markdown with `import.meta.glob` from `$repo` (the repository root, `../..`, an alias in `svelte.config.js`): `README.md`, `docs/*.md`, `platform/**/*.md`, `apps/*.md`, `apps/*/*.md`, `apps/*/docs/*.md`. Nothing is read at runtime.

- **Image**: `deploy.sh` stages the build context in a temporary directory with the repository's layout: `apps/homelab` (without `node_modules`, `build`, `.svelte-kit`) and every markdown file git tracks (`git ls-files '*.md'`, as in the working tree). Building from the repository root would send every app's `node_modules`. The Containerfile builds in `/repo/apps/homelab`, so `$repo` resolves the same way.
- **Development**: `npm run dev` reads the live files (Vite's `server.fs.allow` includes `../..`), and an edited README shows on reload.

## Access

No login, like the other `lab.internal` apps: Traefik serves `homelab.lab.internal` on the home network and the UDM's VPN only; it is not published through Cloudflare. DNS is added by hand on the UDM Pro (*Settings > Policy Table > DNS*): `homelab` CNAME `ingress.lab.internal` ([apps/README.md](../README.md#dns)).

NetworkPolicy: accepts only Traefik; may reach only Prometheus (9090) and DNS. Read-only root filesystem, non-root, no service account token.

## Develop

```sh
cd apps/homelab
npm install
PROMETHEUS_URL=http://prometheus.lab.internal npm run dev
npm run check   # svelte-check / TypeScript
```

## Deploy

```sh
./apps/homelab/deploy.sh
```

Stages the build context (above), builds with podman, imports the image into k3s's containerd (`sudo k3s ctr`; no registry, `imagePullPolicy: Never`), writes the tag into `deploy/kustomization.yaml`, applies, and waits for the rollout. Commit the tag change. Redeploy after changing a README or the model to update the site.
