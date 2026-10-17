# Shopping list

Hardware still to buy (2026-10). Prices only where checked on OpenELAB (2026-10-17); check the rest where buying. Quantities are suggestions. When something arrives, the homelab side is noted under each part.

## 1. ESPresense nodes (Bluetooth presence, home and cabin)

| Item | Qty | Where | Price |
|---|---|---|---|
| **M5Stack AtomS3 Lite** (ESP32-S3; ESPresense's recommended board) | home 3, cabin 2 | OpenELAB (`m5stack-atoms3-lite`) | €10.34 each |
| USB-C power supply (5 V, 1 A is plenty) + USB-C cable | one per node | anywhere | – |

- One node per main living area or floor: phones are detected within one or two rooms of a node.
- One USB-C *data* cable for flashing them from the browser (Chrome or Edge); setup in [platform/components/mosquitto/README.md](../platform/components/mosquitto/README.md#adding-an-espresense-node).
- **Cabin nodes need one homelab change first:** [apps/presence](../apps/presence/) counts every Bluetooth sighting as home, so it needs to know which nodes (rooms) are at the cabin. (The MQTT broker already admits the cabin's `192.168.20.0/24`, for the Ruuvi Gateway.)

## 2. Swegon Casa W3 (Modbus adapter, in the network closet)

| Item | Qty | Where | Price |
|---|---|---|---|
| **Waveshare RS485 TO POE ETH (B)** | 1 | Waveshare store, Amazon, other electronics shops (not OpenELAB) | – |
| **RJ45-to-screw-terminal breakout** (RJ45 socket, 8 screw terminals) | 1 | any electronics shop | – |
| Short Ethernet patch cable, adapter to switch | 1 | probably already on hand | – |

- The grey cable from the W3's SEC/SEM socket ends in the network closet. It carries the unit's Modbus (RS-485), **not Ethernet: never plug it into the switch** (PoE could damage the unit's board).
- Wiring (T568B colours): grey cable into the breakout; pin 1 (orange-white) to the adapter's **A+**, pin 2 (orange) to **B−**, nothing else. Swapping A and B if nothing answers damages nothing. Pins 7 and 8 reportedly carry 5 V and ground: do not connect them.
- Power over PoE from the cabin switch (the one powering the cameras), or a 6–36 V DC supply.
- Adapter settings: *Modbus TCP to RTU*, TCP server on port 502; serial 38400 baud, 8N1; a fixed address (e.g. `192.168.20.70`) reserved in the UCG Max. On the Swegon control panel: Modbus on, address 1.
- Homelab side: a third device in [apps/climate](../apps/climate/README.md#planned-swegon-casa-w3) and on the dashboard's Cabin tab (Home / Away / Boost, temperatures, humidity, fan speeds).

## 3. LoRaWAN sensors at the cabin

The plan in [future-plans.md](future-plans.md#cabin-lorawan-sensors). Order the **EU868** versions: OpenELAB lists both EU and US models of some sensors.

| Item | Use | Qty | Where | Price |
|---|---|---|---|---|
| **Dragino LPS8v2** gateway (EU868) | receives every sensor; built-in ChirpStack | 1 | Dragino resellers (not OpenELAB) | – |
| **Dragino D20-LB** (or **D22-LB / D23-LB** for 2–3 probes at different depths) | lake water temperature | 1 | Dragino resellers | – |
| **Dragino LHT65N** 868 MHz | temperature and humidity (crawl space, storeroom, frost watch) | 1–2 | OpenELAB (`seeed-studio-lht65n-lorawan-sensor`, *868MHz*) | €52.45 |
| **Dragino LDS02** EU868 | doors (shed, sauna) | one per door | OpenELAB (`seeed-studio-lds02-lorawan-sensor`, *EU868*) | €25.15 |
| **Dragino LWL03A** | water leak (sink, water heater) | 1–2 | Dragino resellers | – |
| **Dragino DDS75-LB** | septic tank level (ultrasonic, under the lid) | 1 | Dragino resellers | – |

- Lake probe: a weighted plastic pipe from the shore to about 1–1.5 m deep, a post above flood level for the sensor box, and, if the 2 m probe cable is too short, an extension sealed with adhesive-lined heat-shrink.
- Septic tank: confirm the tank type (holding tank or septic tank with outflow) and the lid on site before buying; the DDS75-LB suits a holding tank with a plastic lid, a metal lid may need the antenna placed differently ([future-plans.md](future-plans.md#septic-tank-fill-level)).
- Homelab side: the steps under *Homelab changes when the hardware arrives* in future-plans.md (MQTT user and NetworkPolicy, ChirpStack decoders and forwarding, Home Assistant sensors and alerts).

## Suggested order

1. **Swegon adapter**: one evening's setup, and it adds the third device to the Cabin tab.
2. **Home ESPresense nodes**.
3. **Cabin nodes and LoRaWAN**: cabin nodes need the presence change above.
