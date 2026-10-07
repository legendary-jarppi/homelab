# presence

Who is home, for the dashboard's *Who's home* card and anything else in the cluster. Cluster-internal only (`http://presence.presence.svc:8080`, no Ingress); a NetworkPolicy admits the dashboard and Prometheus.

Node 22 running the TypeScript sources directly (type stripping); runtime dependencies `mqtt` (MQTT.js) and `zod` (the people file and Prometheus answers are validated).

## How it decides

| Rule | |
|---|---|
| Wi-Fi | A person's phone is connected to the home network, as UniFi reports it through UnPoller (`unpoller_client_uptime_seconds{mac=…}` in Prometheus), polled every 30 s |
| Bluetooth | An ESPresense node (ESP32) recognises the person's enrolled iPhone by its identity key and publishes `espresense/devices/<name>/<room>` to Mosquitto ([platform/components/mosquitto](../../platform/components/mosquitto/)); every message is a sighting. Off when `MQTT_URL` is empty |
| Home | As soon as any source sees any of the person's devices |
| Away | No device seen by any source for `AWAY_AFTER_MIN` (10 min); bridges phones dropping off Wi-Fi briefly, or going quiet on Bluetooth when locked. "Away since" is the last sighting |
| Source down | The away decision runs at each successful Wi-Fi poll: Prometheus not answering freezes everyone's state instead of sending them away. Bluetooth down just means fewer sightings (the dashboard says "No fresh data") |
| Restart | State is rebuilt from the last 7 days of Wi-Fi history in Prometheus (home since the start of the current run of sightings, away since the last one); Bluetooth sightings are not kept. A run reaching back to the start of the UniFi data has an unknown start: `since` is null |

Phones must keep one Wi-Fi address on the home network: in iOS, *Settings → Wi-Fi → (network) → Private Wi-Fi Address* set to *Fixed* (or *Off*), not *Rotating*.

Bluetooth names that are nobody's (neighbours' phones, speakers, …) are ignored. Node status (`espresense/rooms/<room>/status`) is reported in the API and metrics.

## API

| Path | |
|---|---|
| `GET /api/presence` | `{ people: [{ id, name, home, since, lastSeen, via }], sources: { wifi: { ok, lastOk, error }, ble: {…} }, nodes: [{ room, online }], awayAfterS, updatedAt }`; times in unix seconds, `home` null until a source has answered, `via` `wifi` or `ble`; `ble` and `nodes` only with `MQTT_URL` |
| `GET /metrics` | `presence_home{person}` (1/0, absent while unknown), `presence_last_seen_timestamp_seconds{person}`, `presence_source_up{source}`, `presence_ble_node_up{room}`; scraped by Prometheus (ServiceMonitor) |
| `GET /healthz` | 200 once the state has been restored |

Transitions are logged (`kubectl -n presence logs deploy/presence`: `jari away (wifi)`, `jari home (ble)`), as are Bluetooth nodes going online/offline.

## People

Secret `presence-people` (not in git), key `people.json`; ids are used in the API and metrics. `wifi`: MAC addresses as UniFi shows them; `ble`: the names given when enrolling the phones on an ESPresense node (case-insensitive). Each person needs at least one device of either kind:

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

Find a phone's address (UniFi client name, MAC, access point):

```sh
curl -s http://prometheus.lab.internal/api/v1/query --data-urlencode 'query=max by (name, mac, ap_name) (unpoller_client_uptime_seconds{wired="false"})' \
  | jq -r '.data.result[].metric | [.name, .mac, .ap_name] | @tsv'
```

Apply a changed list (the pod reads the file at start), then delete the local copy:

```sh
kubectl -n presence create secret generic presence-people --from-file=people.json=people.json --dry-run=client -o yaml | kubectl apply -f -
kubectl -n presence rollout restart deploy/presence
rm people.json
```

## Develop and deploy

```sh
cd apps/presence && npm install && npm run check        # tsc, types only
PEOPLE_FILE=people.json PROMETHEUS_URL=http://prometheus.lab.internal PORT=8181 npm start   # MQTT_URL/MQTT_USERNAME/MQTT_PASSWORD for Bluetooth
./apps/presence/deploy.sh                                  # build, import into k3s, roll out; commit the tag
```
