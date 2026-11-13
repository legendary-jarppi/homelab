# climate

The cabin's heat pumps, read and changed from the dashboard's *Cabin* tab. Cluster-internal (`http://climate.climate.svc:8080`, no Ingress); a NetworkPolicy admits only the dashboard and Prometheus, and lets the pod reach only the two devices, over the Site Magic VPN ([docs/other-site-network.md](../../docs/other-site-network.md)).

Node 22 running the TypeScript sources directly (type stripping); no runtime dependencies: Modbus TCP and the Gree protocol are small enough to speak with `node:net`, `node:dgram` and `node:crypto`.

## Devices

| Device | Address | How | Read | Changed |
|---|---|---|---|---|
| NIBE VVM S320 with its outdoor air/water unit | `192.168.20.49` | Modbus TCP, port 502 (turned on in the heat pump's menu 7.5.9; accepts private source addresses only) | outdoor, heating water (supply, return, calculated), hot water (top, charging), compressor Hz, defrost, compressor starts and hours, degree minutes, what it is doing (heating / hot water / off), electric additional heat steps, alarm, operating mode | heating curve offset (holding register 30, −10…+10), hot water amount (56: small, medium, large, smart control) |
| Innova air-to-air heat pump, Gree Wi-Fi module U-WB05RT13 | `192.168.20.28` | Gree LAN protocol, UDP 7000: discovery in AES-ECB, then binding and everything else in AES-GCM with the key the module hands out (see `src/gree.ts`; an envelope with `t: "bind"` goes unanswered on this firmware, `t: "pack"` works) | power, mode, target, room temperature (reported +40), fan speed, quiet, turbo | power, mode (heat, cool, auto, dry, fan), target (16…30 °C), fan (auto, 1…5) |

Registers come from NIBE's *Modbus S-series* (M12676EN), checked against this installation: the VVM S320's own registers plus the outdoor unit as slave 2 (frequency 1803, defrost 1805, starts 1489, hours 1491). A register the installation lacks answers Modbus exception 1 and is shown as missing. NIBE takes at most 20 registers per query and 100 a second; registers are read one by one (about 1.5 s per poll over the VPN). A full register list for the installation: *menu 7.5.9 → Export all registers* to a USB stick.

Both are polled every `POLL_S` (60 s); a change is applied and the device read again before the answer, so the dashboard shows what the device now reports. Changes and reads of one device run one at a time, each with a 30 s deadline: one that has not finished by then counts as failed, so a request that never settles cannot hold up the device (on 2026-10-29 a NIBE connection attempt that timed out before connecting never settled; the NIBE kept its reading of 01:16 and ignored every change for two weeks). A device that stops answering keeps its last reading (`ok: false`, `updatedAt` of the last good one).

## API

| Path | |
|---|---|
| `GET /api/climate` | `{ nibe, innova, hotWaterDemands }`; each device `{ ok, error, updatedAt, state }` (`updatedAt` unix ms) |
| `POST /api/nibe` | JSON `{ offset?, hotWaterDemand? }` → the device's entry after the change; 400 for a value out of range |
| `POST /api/innova` | JSON `{ power?, mode?, target?, fan? }` → likewise |
| `GET /metrics` | `climate_device_up{device}`, `climate_nibe_temperature_celsius{sensor}`, `climate_nibe_compressor_hertz`, `climate_nibe_degree_minutes`, `climate_nibe_offset`, `climate_nibe_additional_heat_steps`, `climate_innova_power`, `climate_innova_temperature_celsius{kind}` (ServiceMonitor, every 60 s) |
| `GET /healthz` | 200 |

The dashboard reaches it through `/api/climate` (GET, and POST with `?device=nibe|innova`), behind the dashboard's own access (Cloudflare Access on the public address).

## Planned: Swegon Casa W3

The ventilation unit's control panel talks only to Swegon's cloud. The unit itself speaks Modbus RTU (RS-485, 38400 baud, 8N1; device address 16 in the community setups) on its Modbus/SEC connector; an RS-485-to-network gateway in *Modbus TCP to RTU* mode there makes it a third Modbus TCP device for this service (fan mode at holding register 5001: away, home, boost; temperatures from input register 6200 on).

## Develop and deploy

```sh
cd apps/climate && npm install && npm run check        # tsc, types only
PORT=8282 npm start                                     # from the server: the VPN reaches the cabin
./apps/climate/deploy.sh                                # build, import into k3s, roll out; commit the tag
```

A changed device address goes in `deploy/kustomization.yaml` and `deploy/networkpolicy.yaml`.
