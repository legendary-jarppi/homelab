# Future plans

Ideas agreed in principle but not started. Each lists what it depends on, the hardware and the homelab changes it needs, so it can be picked up later without redoing the research.

## Cabin: LoRaWAN sensors

**Status:** idea (2026-10). **Depends on:** the site-to-site VPN in [other-site-network.md](other-site-network.md) (done, 2026-10) and the hardware below (not bought yet).

Battery sensors around the cabin plot (lake water, doors, leaks, septic tank) reporting over LoRa to one gateway in the house, which forwards their readings home over the VPN into Mosquitto, where Home Assistant and the dashboard pick them up.

```mermaid
flowchart LR
  S["LoRaWAN sensors<br/>(lake probe, septic tank, door, leak…)"] -->|LoRa, EU868| G["Gateway in the cabin<br/>Dragino LPS8v2, built-in ChirpStack"]
  G -->|"MQTT over the site-to-site VPN<br/>(192.168.20.0/24 → 192.168.1.10:1883)"| M["Mosquitto at home"]
  M --> HA["Home Assistant"]
  M --> D["Dashboard"]
```

### Why LoRaWAN

| Option | Verdict |
|---|---|
| **LoRaWAN, own gateway at the cabin** | Chosen. The cabin has mains power, a UniFi network (UCG Max, 6 PoE cameras) and internet over 5G (Teltonika RUTX50), so one gateway can serve every sensor on the plot. Sensors run for years on lithium batteries (fine in frost), reach the shore without cables (LoRa: hundreds of metres to over a kilometre outdoors), and need no SIM cards or cloud services. |
| NB-IoT / LTE-M sensor (Dragino D20-CB) | Rejected for the cabin: an IoT SIM per sensor and a cloud MQTT broker in between. Only worth it where there is no gateway. |
| Wi-Fi sensor at the shore (M5Stack AtomS3 Lite + waterproof DS18B20, ESPHome) | Cheapest and real-time, but only if the sauna or a shed by the water has power and Wi-Fi coverage. Fine for the lake temperature alone; LoRaWAN wins once there are several sensors. |

### Hardware

| Item | Use | Notes |
|---|---|---|
| **Dragino LPS8v2** (indoor LoRaWAN gateway, EU868) | Receives every sensor | Built-in ChirpStack network server and MQTT forwarding, so no separate network server or TTN account. Ethernet to the cabin's UniFi switch. Alternative: RAK WisGate Edge Lite 2 (RAK7268V2). |
| **Dragino D20-LB** (or LSN50v2-D20) | Lake water temperature | Waterproof stainless DS18B20 probe, −55…+125 °C, 2 m cable; 8500 mAh Li-SOCl2 battery. **D22-LB / D23-LB**: 2-3 probes, e.g. 0.5 m and 1.5 m deep to see the layering under the ice. |
| **Dragino LHT65N** | Temperature and humidity | Indoors, the crawl space or a storeroom (frost watch); optional external probe. |
| **Dragino LDS02** | Doors and windows | Shed and sauna doors. |
| **Leak sensor** (e.g. Dragino LWL03A) | Water leaks | Under the sink, by the water heater. |
| **Septic tank level sensor** | Fill level of the tank | See [below](#septic-tank-fill-level). |

### Lake probe in winter

- Ice there is typically 50-70 cm thick: probe 1-1.5 m deep, inside a weighted plastic pipe from the shore down into the water, which protects the cable and keeps the probe below the ice.
- Sensor box on a post or stake on the shore above flood level, not on a dock that is lifted out or pushed by ice; leave slack in the cable, as moving ice pulls or crushes a cable fixed tight.
- If 2 m of cable does not reach that depth from the post, DS18B20 cables extend to tens of metres, but the joint must be properly sealed (adhesive-lined heat-shrink) or water gets in over the winter.

### Homelab changes when the hardware arrives

1. **Mosquitto**: a `lora` user in `platform/components/mosquitto/users.sh` with its topics in `acl` (ChirpStack publishes `application/<id>/device/<eui>/event/up`), and the cabin LAN `192.168.20.0/24` in the NetworkPolicy, which admits only `192.168.1.0/24` today.
2. **Gateway**: register the sensors in its ChirpStack with Dragino's payload decoders (so the MQTT messages carry readable JSON: temperature, battery), and point its MQTT forwarding at `192.168.1.10:1883` with the `lora` login.
3. **Home Assistant**: MQTT sensors for each reading and battery level (YAML in `apps/homeassistant/deploy/configuration.yaml`, or a small translator to MQTT discovery); alerts for leaks, frost and the septic tank threshold to phones through the Companion app.
4. **Dashboard** (optional): a cabin card with lake temperature and tank level.
5. **Architecture diagram**: the gateway and sensors in `apps/dashboard/src/lib/architecture.ts`.

### Known limit

When the 5G link or the VPN is down, readings do not reach home. ChirpStack does not keep them for later, though some Dragino sensors can store readings and resend them, so a long outage leaves a gap in the history. Automations that must act at the cabin itself during an outage would need to run there.

## Septic tank fill level

**Status:** idea (2026-10). Part of the cabin LoRaWAN plan above (same gateway and path home).

Measure how full the cabin's septic tank is, so emptying can be booked before it fills up instead of on a fixed schedule or by lifting the lid. Most useful for a holding tank (*umpisäiliö*), which has no outflow and must be emptied when full.

**Sensor options** (LoRaWAN, battery):

| Type | How | Notes |
|---|---|---|
| **Ultrasonic distance sensor** under the lid (e.g. Dragino DDS75-LB) | Measures the distance down to the surface; level = tank depth − distance | The usual choice: nothing touches the sewage. Foam or a floating crust and heavy condensation can disturb the echo, so mount it straight above open liquid, away from the inlet pipe and the tank walls. |
| **Radar distance sensor** | Same idea with radar | Less affected by condensation and foam than ultrasonic; usually more expensive. |
| **Submersible pressure probe** (e.g. Dragino PS-LB with a water-level probe) | Hydrostatic pressure at the tank bottom gives the liquid depth | Unaffected by foam and crust, but the probe sits in the sewage and needs cleaning now and then. |

**Things to settle on site:**
- Tank type (holding tank vs septic tank with outflow), depth, lid size and where the sensor can be fixed; the tank's air holds corrosive hydrogen sulphide, so the sensor housing should be sealed (IP67 or better) and the bracket stainless or plastic.
- Whether the gateway reaches the tank through the lid and soil (a metal lid weakens the signal; the antenna may need to sit just under a plastic lid).
- Measurement interval: a few times a day is plenty, which keeps the battery going for years.

**In Home Assistant:** fill percentage from the measured distance and the tank's depth, an alert at a threshold (for example 75 % = book emptying), and the fill rate to estimate when it will be full; optionally on the dashboard's cabin card.

## DSC Neo alarms (home and cabin)

**Status:** planned (2026-10-18); the panels are not on the network yet. Research and decisions below.

**Hardware** (reported 2026-10-18): both sites have the same setup, a DSC PowerSeries Neo **HS2032** panel with a **TL2803G** communicator (Ethernet + 3G). No security company monitors them, and the installer code is at hand, so all four integration slots are free on both.

**How:** the Neo's integration protocol ITv2 through the TL280-family communicator: the panel *dials out* to a receiver on the LAN and pushes zone, partition, alarm and trouble changes (AES-encrypted). The tools for older DSC PowerSeries panels (Envisalink, dscKeybusInterface ESP32 boards) do not work with Neo. Receiver: the Home Assistant integration [HA_DSC_Neo_ITv2](https://github.com/LawPaul/HA_DSC_Neo_ITv2) (`dsc_neo_itv2`, GPL-3, v1.0.0 from 2026-07, developed against an HS2032 + TL280; supports the TL2803G). Alternative: [NeoHub](https://github.com/BrianHumlicek/NeoHub) (own web UI; its HA integration is unfinished). Fallback without the communicator: PGM outputs (armed, alarm, fire) into an ESP32 over optocouplers, status only.

**Panel programming** (per panel, `[*][8]` + installer code; sections for communicator firmware v5.0+, older boards differ):

| Section | Value |
|---|---|
| `[851][422]` | Integration ID: read only, write the 12 digits down |
| `[851][425]` | Integration options: bits 3, 4, 5 (`--345---`) |
| `[851][426]` | Polling / notifications: bit 3 only (`--3-----`) |
| `[851][428]` | Receiver IP: `192.168.1.10` (Home Assistant runs on the node's network) |
| `[851][429]` | Receiver port, **hex**: home `0C00` (3072), cabin `0C01` (3073) |
| `[851][700]` | Type 2 access key, 32 hex characters: a new random one, not the factory default |

**Homelab changes when the panels are connected:**
- TL2803G on the LAN by Ethernet (a fixed address at each site); the cabin panel reaches `192.168.1.10` over the Site Magic VPN.
- firewalld (`platform/host/prepare.sh`): 3072–3073/tcp from `192.168.1.0/24` and `192.168.20.0/24` only, never port-forwarded.
- Home Assistant: the integration from a pinned release in git (not HACS), one config entry per panel (ports 3072 and 3073); no user PIN stored, so HA asks for the code on every arm/disarm.
- **Dashboard: status only** (decided 2026-10-18; no arming or disarming there, it is too easy to tap by accident and the dashboard has no login): per site armed state, alarm / fire / trouble, open zones, recent events.
- Notifications through apps/notify: alarm and fire (with the cabin camera's latest picture), AC power loss (a power cut at the cabin), low battery, communicator trouble, armed/disarmed by which user.
- Optional: a reminder when everyone has left home (apps/presence) and the alarm is not armed; Grafana timeline of arming and zone activity.

**Cabin heating by alarm state** (idea to keep): *armed away* → economy (NIBE heating offset down, Innova lower or off; keep frost protection and hot water); *disarmed* → comfort. Disarming happens on arrival, which is too late to warm a cold cabin, so pre-warming needs its own trigger (a "heading to the cabin" action, or presence). Who acts (an HA automation calling apps/climate, or apps/climate reading the alarm state) is to be decided; apps/climate already controls both heat pumps.

**Risks:** a life-safety system and a young, reverse-engineered integration. The panel keeps protecting regardless; a Home Assistant restart or a broken link only makes HA's view stale. Never disarm from automations or untrusted input.
