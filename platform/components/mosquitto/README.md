# mosquitto

Mosquitto 2.0.22 MQTT broker for the ESPresense Bluetooth nodes (ESP32 boards) that feed [apps/presence](../../../apps/presence/), the cabin's Ruuvi Gateway that feeds [apps/ruuvi](../../../apps/ruuvi/), and for [Home Assistant](../../../apps/homeassistant/). On the LAN at `mqtt://192.168.1.10:1883` (ServiceLB; firewalld opens 1883 in `platform/host/prepare.sh`), in the cluster at `mosquitto.mosquitto.svc:1883`.

| | |
|---|---|
| Access | Password login only (no anonymous); plain MQTT, no TLS, so LAN only: a NetworkPolicy admits the home LAN `192.168.1.0/24`, the cabin LAN `192.168.20.0/24` over the Site Magic VPN (client addresses are kept, `externalTrafficPolicy: Local`), and the presence and ruuvi pods; the node itself (Home Assistant runs on the host network) is always admitted by k3s's policy controller |
| Users | `espresense` (nodes: read/write `espresense/#`, `homeassistant/#`), `presence` (read `espresense/#`), `homeassistant` (read/write `homeassistant/#`, read `espresense/#`), `ruuvigateway` (the cabin's Ruuvi Gateway: write `ruuvi/#`), `ruuvi` (read `ruuvi/#`); topic rules in `acl`, anything else denied |
| Data | Retained messages persist on PVC `mosquitto-data` (backed up nightly). ESPresense keeps each enrolled phone's identity key there (`espresense/settings/irk:…/config`); losing it means enrolling the phones again |

Users and passwords (secrets, not in git), created or kept by `users.sh`:

```sh
./platform/components/mosquitto/users.sh                    # missing users get a password; existing ones are kept
./platform/components/mosquitto/users.sh --rotate presence  # new password for one user (rolls the broker and presence)
kubectl -n mosquitto get secret mqtt-espresense -o jsonpath='{.data.password}' | base64 -d   # node password
kubectl -n mosquitto get secret mqtt-ruuvigateway -o jsonpath='{.data.password}' | base64 -d # Ruuvi Gateway password
```

Rotating `espresense` means entering the new password on every node (its web UI → *Settings*); rotating `ruuvigateway`, entering it in the Ruuvi Gateway ([apps/ruuvi](../../../apps/ruuvi/README.md#ruuvi-gateway-settings)).

Watch traffic (needs podman; any MQTT client works):

```sh
P=$(kubectl -n mosquitto get secret mqtt-espresense -o jsonpath='{.data.password}' | base64 -d); export P
podman run --rm -it --network host -e P docker.io/library/eclipse-mosquitto:2.0.22 \
  sh -c 'mosquitto_sub -h 192.168.1.10 -u espresense -P "$P" -t "espresense/#" -v'
```

## Adding an ESPresense node

Boards: ESP32, ESP32-S3, ESP32-C3 or ESP32-C6 (ESPresense recommends the M5 Atom S3 Lite; a generic "D1 mini ESP32" works). ESP8266 boards (the ordinary Wemos D1 mini) and ESP32-S2 have no Bluetooth.

1. **Flash**: board on USB with a data cable, https://espresense.com/firmware in Chrome or Edge (Web Serial; not Firefox/Safari), *Connect* → *Install ESPresense*. On Linux the user needs the `dialout` group (`sudo usermod -a -G dialout $USER`, log in again).
2. **Configure**: join the board's `ESPresense-…` Wi-Fi; the setup page opens (or `http://192.168.4.1`):
   - *Room name*: where it will stay (`olohuone`); becomes the room in `espresense/rooms/<room>/…`
   - *Wi-Fi*: the home network, 2.4 GHz (the ESP32 cannot see 5 GHz)
   - *MQTT*: server `192.168.1.10`, port `1883`, user `espresense`, password from the command above
3. **Check**: `kubectl -n presence logs deploy/presence` shows `ble node <room> online`; `presence_ble_node_up{room}` in Prometheus.
4. **Enroll each iPhone** (once per phone; the key reaches every node through the retained message): open `http://<node-ip>/ui/#/devices`, type the phone's name (`jari-iphone`) and *Enroll*; within 2 minutes, on that iPhone: *Settings → Bluetooth* → tap *ESPresense* → pair. If an iPhone (iOS 17+) pairs but enrollment never completes, read its key from a Mac's Keychain: https://espresense.com/apple (*Lookup method*).
5. **Tell presence**: add the names to the people's `ble` lists ([apps/presence/README.md](../../../apps/presence/README.md#people)).

Optional, once phones are enrolled: publish only the household's phones, so the broker does not receive every Bluetooth device near the house (`include` is a prefix allow-list for all nodes):

```sh
mosquitto_pub -h 192.168.1.10 -u espresense -P "$P" -r -t 'espresense/rooms/*/include/set' -m 'jari-iphone elina-iphone ansku-iphone jussi-iphone'
```
