# dashboard

Home dashboard at http://dashboard.lab.internal: cameras, family calendar (today, then this and next week), package tracking (Posti, DHL, UPS), live internet traffic, this week's workouts, homelab health, clock and weather (tap a location for its 10-day forecast), night mode. A second page (*Network* in the top bar) shows network status, speed tests and the top 10 devices; it returns to *Home* after 2 minutes untouched. Dates are Finnish, other text English. Built for an iPad (landscape fits one screen; portrait and phones scroll); add it to the Home Screen for full-screen use.

SvelteKit 2 + Svelte 5, adapter-node. `server.js` wraps the SvelteKit handler and relays live camera WebSockets; `session.js` is shared by both.

## Data sources

| Source | Used for |
|---|---|
| Prometheus (`PROMETHEUS_URL`) | UnPoller (`unpoller_*`, home site via `UNIFI_SOURCE`), node-exporter, kube-state-metrics |
| go2rtc (`GO2RTC_URL`, cluster-internal) | Snapshots (`/cameras/<id>/frame`) and live video (`/cameras/live?src=<id>`, MSE over WebSocket) |
| Open-Meteo | Weather for `WEATHER_LOCATIONS` (`name:lat:lon,…`; currently Espoo and Ristiina), one request for all, cached 10 min server-side |
| apps/workout (`WORKOUT_URL`, cluster-internal; bearer token `WORKOUT_TOKEN` from secret `dashboard-workout`) | Workouts card: this week per person (total, workout count, km per machine); tapping it opens the app (`WORKOUT_APP_URL`) in a new tab. Card hidden when the token is not set; rotation in [apps/workout/README.md](../workout/README.md#dashboard-card) |
| Google Calendar (`CALENDAR_ICS_URL` from secret `dashboard-calendar`) | Calendar card: the shared *Family* calendar's secret iCal address, fetched server-side at most every 5 min (last good copy served for up to an hour if Google fails). Recurring events are expanded with their exceptions and cancellations; day boundaries are Europe/Helsinki. The address is never sent to the browser or logged. Card colour: `CALENDAR_COLOR` (default `#38bdf8`) |
| Posti (public tracking used by posti.fi: anonymous token from `auth-service.posti.fi`, GraphQL at `graphql.posti.fi`; no account), DHL Shipment Tracking - Unified API (`DHL_API_KEY`), UPS Tracking API (`UPS_CLIENT_ID`/`UPS_CLIENT_SECRET`); keys from secret `dashboard-packages` | Packages card: add a tracking code (carrier detected from its format), see status, pickup point and deadline, ETA and the event history; delivered packages leave after 2 days. Each package is re-checked while the dashboard is open, at most every 20 min (Posti, UPS) or 60 min (DHL: 250 calls/day on the free tier). List stored in `/data/packages.json` (PVC `dashboard-data`). Carriers without credentials are shown as "not set up" |

Browser refresh: live data 10 s, homelab/speed test/workouts 60 s, calendar 5 min, weather 10 min, snapshots 5 s (paused at night and while live video is open).

Calendar address (Google Calendar → the calendar's *Settings and sharing* → *Secret address in iCal format*). Resetting it there invalidates the old one; then store the new one:

```sh
read -rsp 'Secret iCal address: ' U && echo
kubectl -n dashboard create secret generic dashboard-calendar --from-literal=CALENDAR_ICS_URL="$U" --dry-run=client -o yaml | kubectl apply -f -
unset U
kubectl -n dashboard rollout restart deploy/dashboard
```

Package tracking credentials (all optional; Posti works without): a DHL key from https://developer.dhl.com (app with *Shipment Tracking - Unified*), a UPS app from https://developer.ups.com (OAuth client credentials with the *Tracking* product):

```sh
read -rsp 'DHL API key: ' D && echo; read -rsp 'UPS client ID: ' I && echo; read -rsp 'UPS client secret: ' S && echo
kubectl -n dashboard create secret generic dashboard-packages --from-literal=DHL_API_KEY="$D" \
  --from-literal=UPS_CLIENT_ID="$I" --from-literal=UPS_CLIENT_SECRET="$S" --dry-run=client -o yaml | kubectl apply -f -
unset D I S
kubectl -n dashboard rollout restart deploy/dashboard
```

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
