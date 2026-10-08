# homeassistant

Home Assistant 2026.9.4 (official container image) at http://homeassistant.lab.internal, for devices, automations and notifications. The family dashboard (apps/dashboard) stays the wall display.

| | |
|---|---|
| Network | Host network, so discovery (mDNS/zeroconf, SSDP, DHCP), HomeKit and Matter see the LAN; firewalld allows mDNS (`platform/host/prepare.sh`). Port 8123 is not opened: the UI is reached through Traefik only, which HA trusts for `X-Forwarded-For`, so logins and IP bans see real client addresses. NetworkPolicies do not apply to host-network pods |
| Configuration | `deploy/configuration.yaml` in git, mounted read-only (a change rolls the pod). Everything set up in the UI (users, location, integrations, dashboards, automations, scripts, scenes) is on PVC `config` (10 Gi) |
| HTTP settings | Since 2026.9 these live in HA's storage (`.storage/http`), not YAML: an `http:` block is migrated once as a trial that reverts after 5 minutes unless an admin confirms it, then ignored. The init container seeds the file from `deploy/http-storage.json` (trust Traefik's `10.42.0.0/16` for `X-Forwarded-For`, ban after 10 failed logins) when it is missing; changes made in the UI afterwards are kept. Without it HA answers `400 Bad Request` through Traefik |
| Security | No privileged mode; root inside the container (the image's init needs it) with capabilities limited to what it uses. Bluetooth is unavailable (no `NET_ADMIN`, no D-Bus), hence the `habluetooth` error at start; Bluetooth presence comes from the ESPresense nodes over MQTT |
| MQTT | User `homeassistant` on platform/components/mosquitto: read/write `homeassistant/#` (discovery, status), read `espresense/#`. Other topics need a line in that component's `acl` |
| Backup | PVC `config` is in the nightly restic backup. Settings and integrations (`.storage/`, JSON, rarely written) copy cleanly; the history database (`home-assistant_v2.db`, written constantly) may be torn in a copy, and HA replaces a corrupt one with an empty database on start (history lost, setup kept) |

## Setup

1. DNS on the UDM Pro: `homeassistant.lab.internal` CNAME `ingress.lab.internal` ([apps/README.md](../README.md#dns)).
2. Deploy: `kubectl apply -k apps/homeassistant/deploy`.
3. Open http://homeassistant.lab.internal and create the owner account straight away: until onboarding is done, anyone on the LAN who opens the page can create it. Home location: the house; units metric.
4. MQTT: `./platform/components/mosquitto/users.sh` (creates the `homeassistant` user, keeps the others), then in HA *Settings → Devices & services → Add integration → MQTT*: broker `mosquitto.mosquitto.svc`, port `1883`, username `homeassistant`, password from `kubectl -n homeassistant get secret homeassistant-mqtt -o jsonpath='{.data.password}' | base64 -d`.
5. Phones: the Home Assistant Companion app, server `http://homeassistant.lab.internal` (at home or over the UDM's VPN); it also provides push notifications and the phone's location.

## Operating

| Task | |
|---|---|
| Upgrade | Bump the image tag (both containers) in `deploy/app.yaml`, read the release notes' breaking changes, `kubectl apply -k apps/homeassistant/deploy` |
| Logs | `kubectl -n homeassistant logs deploy/homeassistant -c homeassistant` (also *Settings → System → Logs*) |
| Restart | `kubectl -n homeassistant rollout restart deploy/homeassistant` |
| Clear IP bans | Delete `ip_bans.yaml` on the volume and restart: `kubectl -n homeassistant exec deploy/homeassistant -c homeassistant -- rm -f /config/ip_bans.yaml` |
| YAML-only settings | Edit `deploy/configuration.yaml` and apply |
