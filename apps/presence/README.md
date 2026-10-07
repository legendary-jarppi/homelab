# presence

Who is home, for the dashboard's *Who's home* card and anything else in the cluster. Cluster-internal only (`http://presence.presence.svc:8080`, no Ingress); a NetworkPolicy admits the dashboard and Prometheus.

Node 22 running the TypeScript sources directly (type stripping), no runtime dependencies.

## How it decides

| Rule | |
|---|---|
| Source | Wi-Fi: a person's phone is connected to the home network, as UniFi reports it through UnPoller (`unpoller_client_uptime_seconds{mac=…}` in Prometheus), polled every 30 s |
| Home | As soon as any of the person's devices is seen |
| Away | No device seen for `AWAY_AFTER_MIN` (10 min); bridges phones dropping off Wi-Fi briefly. "Away since" is the last sighting |
| Source down | Prometheus not answering freezes everyone's state (judged at the last successful poll) instead of sending them away |
| Restart | State is rebuilt from the last 7 days of Wi-Fi history in Prometheus (home since the start of the current run of sightings, away since the last one). A run reaching back to the start of the UniFi data has an unknown start: `since` is null |

Phones must keep one Wi-Fi address on the home network: in iOS, *Settings → Wi-Fi → (network) → Private Wi-Fi Address* set to *Fixed* (or *Off*), not *Rotating*.

Bluetooth (ESP32 scanners with ESPresense, matching iPhones by their identity key) is meant to become a second source: `Source` in `src/presence.ts`, sightings fed through `Presence.observe`.

## API

| Path | |
|---|---|
| `GET /api/presence` | `{ people: [{ id, name, home, since, lastSeen, via }], sources: { wifi: { ok, lastOk, error } }, awayAfterS, updatedAt }`; times in unix seconds, `home` null until a source has answered |
| `GET /metrics` | `presence_home{person}` (1/0, absent while unknown), `presence_last_seen_timestamp_seconds{person}`, `presence_source_up{source}`; scraped by Prometheus (ServiceMonitor) |
| `GET /healthz` | 200 once the state has been restored |

Transitions are logged (`kubectl -n presence logs deploy/presence`: `jari away`, `jari home`).

## People

Secret `presence-people` (not in git), key `people.json`; ids are used in the API and metrics, a person may have several devices:

```json
[
  { "id": "alice", "name": "Alice", "wifi": ["aa:bb:cc:dd:ee:01"] },
  { "id": "bob", "name": "Bob", "wifi": ["aa:bb:cc:dd:ee:02", "aa:bb:cc:dd:ee:03"] }
]
```

Current list: `kubectl -n presence get secret presence-people -o jsonpath='{.data.people\.json}' | base64 -d`.

A phone that is offline now can still be added: UnPoller only exports connected clients, but Prometheus keeps their history (15 days), and UniFi lists it under offline wireless devices.

Find a phone's address (UniFi client name, MAC, access point):

```sh
curl -s http://prometheus.lab.internal/api/v1/query --data-urlencode 'query=max by (name, mac, ap_name) (unpoller_client_uptime_seconds{wired="false"})' \
  | jq -r '.data.result[].metric | [.name, .mac, .ap_name] | @tsv'
```

Change people (the pod reads the file at start):

```sh
kubectl -n presence create secret generic presence-people --from-file=people.json=people.json --dry-run=client -o yaml | kubectl apply -f -
kubectl -n presence rollout restart deploy/presence
```

## Develop and deploy

```sh
cd apps/presence && npm install && npm run check        # tsc, types only
PEOPLE_FILE=people.json PROMETHEUS_URL=http://prometheus.lab.internal PORT=8181 npm start
./apps/presence/deploy.sh                                  # build, import into k3s, roll out; commit the tag
```
