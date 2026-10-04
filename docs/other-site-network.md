# Other site: renumbering and site-to-site VPN (pending)

To do on the next visit to the other site (UCG Max behind a Teltonika RUTX50 on mobile).

## Why

- The RUTX50's LAN (`192.168.1.0/24`, the UCG Max's WAN side) overlaps the home LAN, which breaks routing over a site-to-site VPN.
- The other site's LAN (`192.168.0.0/24`) is one digit away from home and both are common factory defaults; a distinct range avoids mix-ups and collisions.
- Goal: Site Magic mesh VPN, so UnPoller can poll the UCG Max and the other site can reach `*.lab.internal`.

## Address plan

| Range | Use |
|---|---|
| `192.168.1.0/24` | Home LAN (UDM Pro `.1`, k3s node `.10`); unchanged |
| `192.168.20.0/24` | Other site LAN (UCG Max `.1`); was `192.168.0.0/24` |
| `10.200.0.0/24` | RUTX50 ↔ UCG Max link (RUTX50 `.1`); was `192.168.1.0/24` |
| `10.42.0.0/16`, `10.43.0.0/16` | k3s pods/services; must not be used at either site |

## On site, in this order

Be on site (or have other access): if the UCG Max does not pick up a new WAN address, the site loses internet and remote management.

1. **RUTX50**: *Network > LAN*, change `192.168.1.1/24` to `10.200.0.1/24` (DHCP range follows). Admin UI is then at `http://10.200.0.1`.
2. **UCG Max WAN**: reconnect WAN or restart; check it gets `10.200.0.x` with gateway `10.200.0.1` and internet works.
3. **UCG Max Default network**: change to `192.168.20.1/24` and adjust the DHCP range. Update fixed IPs/DHCP reservations and any device with a hard-coded address. Reconnect clients or restart switches/APs to speed up renewal.
4. **Site Magic** (UniFi Site Manager > Site Magic SD-WAN > Mesh): select both consoles, connect only the *Default* networks (`192.168.1.0/24`, `192.168.20.0/24`). Home has the public IP, so the mobile side works behind CGNAT.
5. **DNS** on the UCG Max (*Settings > Policy Table > DNS*): *Forward Domain* `lab.internal` → `192.168.1.1`.
6. **Check** from a client at the other site: `ping 192.168.1.10`, and open `http://grafana.lab.internal`.

## Afterwards (with the agent)

- Confirm whether the `unpoller` UniFi account has the same password on both consoles.
- UnPoller: add the UCG Max (`https://192.168.20.1`) as a second controller, one Prometheus scrape per site; check its devices appear in the Grafana UniFi dashboards.
