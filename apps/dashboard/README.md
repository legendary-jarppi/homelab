# dashboard

Home dashboard at http://dashboard.lab.internal, three pages in the top bar. *Home*, for the whole family: who's home, family calendar (today, then this and next week), package tracking (Posti, DHL, UPS), this week's workouts. *Cameras*, everything camera: *Live* (the default each time the tab opens) shows the home cameras' live pictures with the cabin camera's latest motion picture beside them; *Detections* (with today's event count) shows motion events and their clips from the cabin and the home cameras (UniFi Protect). *Homelab*: *Status* (the default) has live internet traffic, speed tests, homelab health and backup status, network status and the top 10 devices; *Components* and *Network* are diagrams of how the homelab fits together (see [Architecture diagrams](#architecture-diagrams)). *Cameras* and *Homelab* return to *Home* after 2 minutes untouched. All show the clock, weather (tap a location for its 10-day forecast), internet and backup status pills (tap the backup pill for *Homelab*) and night mode. Dates are Finnish, other text English. Built for an iPad (landscape fits one screen; portrait and phones scroll); add it to the Home Screen for full-screen use.

SvelteKit 2 + Svelte 5, adapter-node. `server.js` wraps the SvelteKit handler and relays live camera WebSockets; `session.js` is shared by both.

## Data sources

| Source | Used for |
|---|---|
| Prometheus (`PROMETHEUS_URL`) | UnPoller (`unpoller_*`, home site via `UNIFI_SOURCE`), node-exporter, kube-state-metrics, kubelet (cAdvisor). Backup status (top bar pill, Homelab card, night screen dot): jobs in namespace `backup` ([platform/components/backup](../../platform/components/backup/)); amber on "Backup failed" (newest finished run failed), "No backup yet", or a last success older than 26 h ("Backup late" in the pill). The pill shows yellow "Backup ?" when the status is unknown (no data from Prometheus, or none for over 3 min). Failed pods of Jobs do not count as pods not ready. *Homelab → Components*: every workload's pods with readiness, restarts in 24 h, CPU and memory (`/api/architecture`, every 30 s while shown) |
| go2rtc (`GO2RTC_URL`, cluster-internal) | *Cameras* tab, *Live*: snapshots (`/cameras/<id>/frame`) and, on tap, live video (`/cameras/live?src=<id>`, MSE over WebSocket) |
| Open-Meteo | Weather for `WEATHER_LOCATIONS` (`name:lat:lon,…`; currently Espoo and Ristiina), one request for all, cached 10 min server-side |
| apps/workout (`WORKOUT_URL`, cluster-internal; bearer token `WORKOUT_TOKEN` from secret `dashboard-workout`) | Workouts card: this week per person (total, workout count, km per machine); tapping it opens the app (`WORKOUT_APP_URL`) in a new tab. Card hidden when the token is not set; rotation in [apps/workout/README.md](../workout/README.md#dashboard-card) |
| apps/presence (`PRESENCE_URL`, cluster-internal) | Who's home card: each person home/away with since (today's time or the day); "No fresh data" in amber when the presence service or its Wi-Fi source is not answering (state frozen). "Presence not set up" without the URL |
| apps/cabin-camera (`CABIN_CAMERA_URL`, cluster-internal) | *Cameras → Live*: a tile with the cabin's latest motion picture and its time (the camera has no live stream). *Cameras → Detections*, Cabin card: the latest motion event from the cabin's Reolink camera (picture, or the clip's first frame; a play mark when there is a clip) above the earlier ones, with today's count. Tap the tile or an event for the viewer with clip playback (arrow keys step). A clip joins the picture uploaded up to 10 min before it (`src/lib/cabin.ts`). Files stream through `/cabin/<path>` (behind the login, Range requests passed through for video). Tile and card hidden without the URL |
| UniFi Protect on the UDM Pro (`PROTECT_URL`; login `PROTECT_USER`/`PROTECT_PASS` from secret `dashboard-protect`) | *Cameras → Detections*, Home cameras card: Protect's motion and smart-detection events of the last 48 h, by day, with thumbnail, camera, time, length and detections (person, vehicle, animal); filter by camera and detection; tap one for the viewer, which plays the recording. Labels and order from `PROTECT_CAMERAS` (Protect name:label). Uses Protect's **private** API (`/proxy/protect/api`, as its web app and Home Assistant do; the official integration API has no event history or recordings), so a Protect update may break it; certificate not verified (self-signed UDM). Clips are exported from the UDM at full resolution (about 0.7 MB per second of video; events over 3 min are cut) into the pod's `/tmp` (kept under 800 MB) and served from there, because Protect's export ignores the Range requests Safari needs. Card hidden without the login (`src/lib/server/protect.ts`) |
| Google Calendar (`CALENDAR_ICS_URL` from secret `dashboard-calendar`) | Calendar card: the shared *Family* calendar's secret iCal address, fetched server-side at most every 5 min (last good copy served for up to an hour if Google fails). Recurring events are expanded with their exceptions and cancellations; day boundaries are Europe/Helsinki. The address is never sent to the browser or logged. Card colour: `CALENDAR_COLOR` (default `#38bdf8`) |
| Posti (public tracking used by posti.fi: anonymous token from `auth-service.posti.fi`, GraphQL at `graphql.posti.fi`; no account), UPS Tracking API (`UPS_CLIENT_ID`/`UPS_CLIENT_SECRET` from secret `dashboard-packages`) | Packages card: add a tracking code (carrier detected from its format), see status, pickup point and deadline, ETA and the event history; delivered packages leave after 2 days. Each package is re-checked while the dashboard is open, at most every 20 min. List stored in `/data/packages.json` (PVC `dashboard-data`). UPS without credentials is shown as "not set up". **DHL is link-only**: its tracking API is for business customers only and dhl.com blocks automated lookups, so DHL packages show "Check at DHL" with a link to DHL's tracking page and leave the card 14 days after being added (nothing reports them delivered). Aggregators with DHL data (17TRACK, Ship24, Parcel app) were considered: no free plan with lasting API access |

Browser refresh: live data 10 s, presence 30 s, Protect events 30 s, homelab/speed test/workouts/cabin pictures 60 s, calendar 5 min, weather 10 min, camera snapshots 5 s (only on *Cameras → Live*; paused at night and while live video is open).

Calendar address (Google Calendar → the calendar's *Settings and sharing* → *Secret address in iCal format*). Resetting it there invalidates the old one; then store the new one:

```sh
read -rsp 'Secret iCal address: ' U && echo
kubectl -n dashboard create secret generic dashboard-calendar --from-literal=CALENDAR_ICS_URL="$U" --dry-run=client -o yaml | kubectl apply -f -
unset U
kubectl -n dashboard rollout restart deploy/dashboard
```

UPS tracking credentials (optional): an app from https://developer.ups.com (OAuth client credentials with the *Tracking* product):

```sh
read -rsp 'UPS client ID: ' I && echo; read -rsp 'UPS client secret: ' S && echo
kubectl -n dashboard create secret generic dashboard-packages \
  --from-literal=UPS_CLIENT_ID="$I" --from-literal=UPS_CLIENT_SECRET="$S" --dry-run=client -o yaml | kubectl apply -f -
unset I S
kubectl -n dashboard rollout restart deploy/dashboard
```

UniFi Protect login (optional; any local UniFi account that can view Protect, here the read-only account UnPoller uses, see [platform/README.md](../../platform/README.md)):

```sh
kubectl -n unpoller get secret unifi-readonly -o json | jq '{apiVersion: "v1", kind: "Secret", type: "Opaque",
  metadata: {name: "dashboard-protect", namespace: "dashboard"}, data: {PROTECT_USER: .data.user, PROTECT_PASS: .data.pass}}' | kubectl apply -f -
kubectl -n dashboard rollout restart deploy/dashboard
```

After changing that account's password, update `unifi-readonly` and run the above again.

## Architecture diagrams

*Homelab → Components* shows every namespace with its components and the connections between them (HTTP, video, MQTT, database and volumes, metrics, Kubernetes API, internet), each component with live pod status from Prometheus; components outside the cluster (family devices, the UDM Pro, cameras, ESPresense nodes, internet services) are on the left. *Network* shows the path through the network: internet and UDM Pro (NAT, port forward, DNS, Protect), the home LAN, the server's firewalld zones and ServiceLB, the host network, the pod and service networks, and which namespaces NetworkPolicies restrict. Tap a component to highlight its connections (labelled) and read what it does, what it talks to and its pods; on narrow screens the details stay pinned to the bottom.

Groups, components and connections are written by hand in `src/lib/architecture.ts` (Kubernetes does not record who talks to whom); the layout is CSS grid areas per diagram, the lines are drawn from the components' measured positions (`src/lib/components/Diagram.svelte`). **Update it when adding an app, a namespace or a connection**: a workload running in the cluster that no component claims is listed in amber under the Components diagram.

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
