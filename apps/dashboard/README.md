# dashboard

Home dashboard at http://dashboard.lab.internal: cameras, live internet traffic, network status, top devices, speed tests, homelab health, clock and weather, night mode. Built for an iPad (landscape fits one screen; portrait and phones scroll); add it to the Home Screen for full-screen use.

SvelteKit 2 + Svelte 5, adapter-node. `server.js` wraps the SvelteKit handler and relays live camera WebSockets; `session.js` is shared by both.

## Data sources

| Source | Used for |
|---|---|
| Prometheus (`PROMETHEUS_URL`) | UnPoller (`unpoller_*`, home site via `UNIFI_SOURCE`), node-exporter, kube-state-metrics |
| go2rtc (`GO2RTC_URL`, cluster-internal) | Snapshots (`/cameras/<id>/frame`) and live video (`/cameras/live?src=<id>`, MSE over WebSocket) |
| Open-Meteo | Weather, cached 10 min server-side; needs `WEATHER_LATITUDE`/`WEATHER_LONGITUDE` |

Browser refresh: live data 10 s, homelab/speed test 60 s, weather 10 min, snapshots 5 s (paused at night and while live video is open).

## Access

Passcode login, session cookie valid for a year (HttpOnly, HMAC-signed with `SESSION_SECRET`). Five wrong passcodes from one address lock that address out for 15 minutes; failed attempts are logged (`kubectl -n dashboard logs deploy/dashboard`).

| Task | Command |
|---|---|
| Set or change the passcode (existing sessions stay valid) | see below |
| Log out every device | `kubectl -n dashboard patch secret dashboard-auth -p "{\"stringData\":{\"SESSION_SECRET\":\"$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')\"}}" && kubectl -n dashboard rollout restart deploy/dashboard` |

Set or change the passcode:

```sh
read -rsp 'New passcode: ' P && echo
kubectl -n dashboard create secret generic dashboard-auth --from-literal=PASSCODE="$P" \
  --from-literal=SESSION_SECRET="$(kubectl -n dashboard get secret dashboard-auth -o jsonpath='{.data.SESSION_SECRET}' | base64 -d)" \
  --dry-run=client -o yaml | kubectl apply -f -
unset P
kubectl -n dashboard rollout restart deploy/dashboard
```

First-time secret: `kubectl -n dashboard create secret generic dashboard-auth --from-literal=SESSION_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')" --from-literal=PASSCODE=<passcode>`.

## Configuration

Non-secret settings are literals in `deploy/kustomization.yaml` (`dashboard-config`): cameras (`id:label`, ids = go2rtc stream names), weather location, service URLs. Apply with `kubectl apply -k apps/dashboard/deploy`.

## Develop

```sh
cd apps/dashboard
npm install
kubectl -n go2rtc port-forward svc/go2rtc 1984 &   # go2rtc is cluster-internal
PASSCODE=dev SESSION_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))') \
  PROMETHEUS_URL=http://prometheus.lab.internal GO2RTC_URL=http://localhost:1984 \
  CAMERAS='front-door:Front door,backyard:Backyard,carport:Carport' npm run dev
npm run check   # svelte-check / TypeScript
```

`npm run dev` serves everything except live video (the WebSocket relay lives in `server.js`); for that, `npm run build && node server.js` with the same environment plus `ORIGIN=http://localhost:3000`.

## Deploy

```sh
./apps/dashboard/deploy.sh
```

Builds with podman, imports the image into k3s's containerd (`sudo k3s ctr`; no registry, `imagePullPolicy: Never`), writes the tag into `deploy/kustomization.yaml`, applies, and waits for the rollout. Commit the tag change.

`src/lib/vendor/go2rtc/video-rtc.js` is go2rtc 1.9.14's player (MIT, see `LICENSE` there).
