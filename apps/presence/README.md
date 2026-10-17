# presence

Where everyone is (home, the cabin, or away), for the dashboard's *Who's home* card and anything else in the cluster. Cluster-internal only (`http://presence.presence.svc:8080`, no Ingress); a NetworkPolicy admits the dashboard and Prometheus.

Node 22 running the TypeScript sources directly (type stripping); runtime dependencies `mqtt` (MQTT.js) and `zod` (the people file and Prometheus answers are validated).

## How it decides

Sites are `SITES` in `deploy/kustomization.yaml`: `id:Label:<UnPoller source>`, comma-separated, home first (`home:Home:https://192.168.1.1,cabin:Cabin:https://192.168.20.1`).

| Rule | |
|---|---|
| Wi-Fi | A person's phone is connected to a site's network, as that site's UniFi console reports it through UnPoller (`unpoller_client_uptime_seconds{source=<console>, mac=…}` in Prometheus), polled every 30 s |
| Bluetooth | An ESPresense node (ESP32) at home recognises the person's enrolled iPhone by its identity key and publishes `espresense/devices/<name>/<room>` to Mosquitto ([platform/components/mosquitto](../../platform/components/mosquitto/)); every message is a sighting at home. Off when `MQTT_URL` is empty |
| At a site | As soon as any source sees any of the person's devices there; "since" is the first sighting there |
| Away | No device seen by any source for `AWAY_AFTER_MIN` (10 min) **and** the site they were last at is reporting; bridges phones dropping off Wi-Fi briefly, or going quiet on Bluetooth when locked. "Away since" is the last sighting |
| Site not reporting | A site with no UniFi client series at all (console, VPN or the cabin's mobile link down; every site has always-connected clients) cannot tell whether someone left: people there stay there with `stale: true` ("no fresh data" on the dashboard) until it reports again (then away if not seen, since the last sighting) or they are seen elsewhere |
| Source down | The away decisions run at each successful Wi-Fi poll: Prometheus not answering freezes everyone's state. Bluetooth down just means fewer sightings (the dashboard says "No fresh data") |
| Restart | State is rebuilt from the last 7 days of Wi-Fi history in Prometheus, per site (at a site since the start of the current run of sightings there, away since the last one; at the last site, stale, if that site has had no data since). Bluetooth sightings are not kept. A run reaching back to the start of a site's data has an unknown start: `since` is null |

Phones must keep one Wi-Fi address per network: in iOS, *Settings → Wi-Fi → (network) → Private Wi-Fi Address* set to *Fixed* (or *Off*), not *Rotating*. With *Fixed*, an iPhone uses a different address on each site's network, so a person lists one address per site.

Bluetooth names that are nobody's (neighbours' phones, speakers, …) are ignored. Node status (`espresense/rooms/<room>/status`) is reported in the API and metrics.

## API

| Path | |
|---|---|
| `GET /api/presence` | `{ people: [{ id, name, place, since, lastSeen, lastSite, via, stale }], sites: [{ id, label, ok, lastOk }], sources: { wifi: { ok, lastOk, error }, ble: {…} }, nodes: [{ room, online }], awayAfterS, updatedAt }`; times in unix seconds, `place` a site id or `away` (null until a source has answered), `via` `wifi` or `ble`, a site `ok` when it reported at the last poll; `ble` and `nodes` only with `MQTT_URL` |
| `GET /metrics` | `presence_place{person,place}` (1 for the current place, absent while unknown), `presence_site_up{site}`, `presence_last_seen_timestamp_seconds{person}`, `presence_source_up{source}`, `presence_ble_node_up{room}`; scraped by Prometheus (ServiceMonitor) |
| `GET /healthz` | 200 once the state has been restored |

Transitions are logged (`kubectl -n presence logs deploy/presence`: `jari cabin (wifi)`, `jari away (wifi)`, `jari home (ble)`), as are sites that stop or start reporting and Bluetooth nodes going online/offline.

## People

Secret `presence-people` (not in git), key `people.json`; ids are used in the API and metrics. `wifi`: MAC addresses as UniFi shows them, from any site (one per phone per site); `ble`: the names given when enrolling the phones on an ESPresense node (case-insensitive). Each person needs at least one device of either kind:

```json
[
  { "id": "alice", "name": "Alice", "wifi": ["aa:bb:cc:dd:ee:01"], "ble": ["alice-iphone"] },
  { "id": "bob", "name": "Bob", "wifi": ["aa:bb:cc:dd:ee:02", "aa:bb:cc:dd:ee:03"] }
]
```

Add Bluetooth names to the current list with `jq` (here Jussi's):

```sh
kubectl -n presence get secret presence-people -o jsonpath='{.data.people\.json}' | base64 -d \
  | jq '(.[] | select(.id == "jussi")).ble = ["jussi-iphone"]' > people.json
```

Current list: `kubectl -n presence get secret presence-people -o jsonpath='{.data.people\.json}' | base64 -d`.

A phone that is offline now can still be added: UnPoller only exports connected clients, but Prometheus keeps their history (15 days), and UniFi lists it under offline wireless devices.

Find a phone's address at a site (UniFi client name, MAC, access point; `source` as in `SITES`):

```sh
curl -s http://prometheus.lab.internal/api/v1/query --data-urlencode 'query=max by (name, mac, ap_name) (unpoller_client_uptime_seconds{source="https://192.168.20.1", wired="false"})' \
  | jq -r '.data.result[].metric | [.name, .mac, .ap_name] | @tsv'
```

iPhones all show as "iPhone": the address of one's own phone on a network is in *Settings → Wi-Fi → (network) → Wi-Fi Address*.

Apply a changed list (the pod reads the file at start), then delete the local copy:

```sh
kubectl -n presence create secret generic presence-people --from-file=people.json=people.json --dry-run=client -o yaml | kubectl apply -f -
kubectl -n presence rollout restart deploy/presence
rm people.json
```

## Develop and deploy

```sh
cd apps/presence && npm install && npm run check        # tsc, types only
PEOPLE_FILE=people.json PROMETHEUS_URL=http://prometheus.lab.internal SITES='home:Home:https://192.168.1.1,cabin:Cabin:https://192.168.20.1' PORT=8181 npm start   # MQTT_URL/MQTT_USERNAME/MQTT_PASSWORD for Bluetooth
./apps/presence/deploy.sh                                  # build, import into k3s, roll out; commit the tag
```
