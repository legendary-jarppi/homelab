import { formatAgo, formatBytes } from './format';

// The homelab's structure: the Components and Network diagrams, the Overview's apps table and the
// Devices page all come from here. Groups, components, devices and connections are written by hand
// (Kubernetes does not record who talks to whom, and nothing records which device is which); live
// status comes from Prometheus (src/lib/server/status.ts). Update this file when an app, a device or a
// connection is added: workloads running in the cluster but missing here are listed under the
// Components diagram, network clients that no device claims under the Devices page.

/** Connection type: line colour and legend. */
export type EdgeKind = 'web' | 'video' | 'mqtt' | 'data' | 'metrics' | 'control' | 'internet';

export const EDGE_KINDS: { kind: EdgeKind; label: string }[] = [
	{ kind: 'web', label: 'HTTP' },
	{ kind: 'video', label: 'Video' },
	{ kind: 'mqtt', label: 'MQTT' },
	{ kind: 'data', label: 'Database, volume' },
	{ kind: 'metrics', label: 'Metrics' },
	{ kind: 'control', label: 'Control (API)' },
	{ kind: 'internet', label: 'Internet' }
];

export type SiteId = 'home' | 'cabin';

/** The two sites; `console` is the UniFi console's URL, UnPoller's `source`/`instance` label for its data. */
export const SITES: Record<SiteId, { label: string; console: string; lan: string }> = {
	home: { label: 'Home', console: 'https://192.168.1.1', lan: '192.168.1.0/24' },
	cabin: { label: 'Cabin', console: 'https://192.168.20.1', lan: '192.168.20.0/24' }
};

/** A service-level check of a device: PromQL that gives 1 when it is fine and 0 when not; no result = unknown. */
export interface DeviceCheck {
	label: string;
	expr: string;
}

/** A device outside the cluster, for the Devices page; the node's connections say which app talks to it. */
export interface Device {
	site: SiteId;
	/** IP address (or how it is reached when it has none on a LAN). */
	address?: string;
	/** The UniFi client to look for (network presence from UnPoller): by MAC, or by IP while the MAC is unknown. */
	client?: { mac: string } | { ip: string };
	checks?: DeviceCheck[];
	/** Not there yet: the plan, a docs path with an optional #anchor. Shown dashed in the diagram. */
	planned?: string;
}

/** A namespace group that is an app or a platform component with an address: a row in the Overview's table. */
export interface AppInfo {
	kind: 'app' | 'platform';
	/** One line. */
	purpose: string;
	lab?: string[];
	public?: string[];
	lan?: string[];
	internal?: string[];
	/** Docs path (/docs/<path>), optional #anchor; also the default for the group's components. */
	docs?: string;
}

export interface DiagramNode {
	id: string;
	label: string;
	/** One line under the label. */
	sub?: string;
	/** What it does, shown when selected. */
	info: string;
	/**
	 * Kubernetes workload(s) whose pods this is, "namespace/name"; a trailing * matches a name prefix
	 * (ServiceLB's per-service DaemonSets). Absent for things outside the cluster.
	 */
	workloads?: string[];
	/** Opens from the details panel. */
	href?: string;
	/** Docs path (/docs/<path>), optional #anchor; defaults to the group's `app.docs`. */
	docs?: string;
	device?: Device;
}

export interface DiagramGroup {
	id: string;
	label: string;
	sub?: string;
	/** `namespace`: a Kubernetes namespace; `outside`: not in the cluster; `zone`: a network zone. */
	kind: 'namespace' | 'outside' | 'zone';
	/** Components side by side (wide groups) instead of stacked. */
	row?: boolean;
	nodes: DiagramNode[];
	app?: AppInfo;
}

export interface DiagramEdge {
	from: string;
	to: string;
	label: string;
	kind: EdgeKind;
}

export interface Diagram {
	groups: DiagramGroup[];
	edges: DiagramEdge[];
	/** CSS grid-template-areas rows (group ids; "." for empty) per layout. */
	areas: { wide: string[]; narrow: string[] };
}

export const COMPONENTS: Diagram = {
	areas: {
		wide: [
			'out kube-system dashboard go2rtc cabin-camera',
			'out kube-system news presence mosquitto',
			'out local-path-storage workout homeassistant mosquitto',
			'out monitoring monitoring unpoller backup',
			'out monitoring monitoring headlamp lists',
			'out cloudflare notify homelab lists',
			'out cloudflare climate telescope ruuvi',
			'cabin cabin cabin cabin cabin'
		],
		narrow: [
			'out out',
			'kube-system local-path-storage',
			'dashboard go2rtc',
			'news cabin-camera',
			'workout presence',
			'homeassistant mosquitto',
			'monitoring monitoring',
			'unpoller headlamp',
			'backup lists',
			'cloudflare notify',
			'homelab ruuvi',
			'climate telescope',
			'cabin cabin'
		]
	},
	groups: [
		{
			id: 'out',
			label: 'Outside the cluster',
			kind: 'outside',
			nodes: [
				{ id: 'users', label: 'Family devices', sub: 'iPad, phones, laptops', info: 'Browsers on the home network (or the UDM\'s VPN). *.lab.internal names resolve on the UDM Pro to 192.168.1.10, where Traefik answers. The Notify app (Home Screen web app) opens through Cloudflare, also away from home.' },
				{ id: 'udm', label: 'UDM Pro', sub: '192.168.1.1 · router, DNS, Protect', docs: 'platform/README.md#network', device: { site: 'home', address: '192.168.1.1', checks: [{ label: 'UnPoller reads it', expr: 'up{job="unpoller", instance="https://192.168.1.1"}' }] }, info: 'Router and firewall (NAT, port forward for the cabin camera), DNS for lab.internal, DHCP, and UniFi Protect: records the home cameras (about 80 days fit its disk), serves their RTSPS streams and the event, clip and recording API. UnPoller reads its network statistics.' },
				{ id: 'cams', label: 'Protect cameras', sub: 'Front door, Backyard, Carport', docs: 'platform/README.md#components', device: { site: 'home', address: 'wired to the UDM Pro' }, info: 'UniFi G4/G5 Dome cameras, recorded continuously by Protect on the UDM Pro; smart detections (person, vehicle, animal) on the carport camera.' },
				{ id: 'esp', label: 'ESPresense nodes', sub: 'Bluetooth, ESP32 · planned', docs: 'platform/components/mosquitto/README.md', device: { site: 'home', address: 'MQTT client of 192.168.1.10:1883', planned: 'docs/shopping-list.md#1-espresense-nodes-bluetooth-presence-home-and-cabin' }, info: 'ESP32 boards that recognise the family\'s phones over Bluetooth and publish sightings to Mosquitto (MQTT, port 1883 on 192.168.1.10). Not bought yet (shopping list); presence and Mosquitto are ready for them.' },
				{ id: 'dschome', label: 'DSC Neo alarm, home', sub: 'HS2032 + TL2803G · planned', device: { site: 'home', address: 'fixed LAN address (to choose)', planned: 'docs/future-plans.md#dsc-neo-alarms-home-and-cabin' }, info: 'The home alarm panel. Planned: its TL2803G communicator dials out over ITv2 to Home Assistant on 192.168.1.10, port 3072, and pushes zone, partition, alarm and trouble changes; the dashboard shows status only.' },
				{ id: 'internet', label: 'Internet services', sub: 'weather, calendar, parcels, news, AI, Drive', info: 'Open-Meteo (weather), Google Calendar (iCal), Posti, Matkahuolto and UPS (parcels) for the dashboard; Open-Meteo, 7Timer (seeing) and NOAA SWPC (Kp, aurora) for the telescope web app, Open-Meteo for the telescope service\'s dew notification; Gaia DR3 from VizieR for the telescope processor\'s colour calibration (Siril); news outlets and the AI proxy for the news worker; Google Drive for the nightly backup.' },
				{ id: 'cfedge', label: 'Cloudflare', sub: 'notify, dashboard, news .shillyshally.org · Access', info: 'Public HTTPS for the shillyshally.org apps (Notify, the dashboard, News): Cloudflare\'s certificate, then Cloudflare Access (email one-time code, listed emails only), then the tunnel to cloudflared. Nothing is port-forwarded for it.' },
				{ id: 'pushsvc', label: 'Push services', sub: 'Apple, Google, Mozilla', info: 'Web Push: notify sends each message, encrypted for the device, to the push service of the browser that subscribed (web.push.apple.com for iPhones), which delivers it to the device.' }
			]
		},
		{
			id: 'cabin',
			label: 'Cabin',
			sub: '192.168.20.0/24 · Site Magic VPN to home',
			kind: 'outside',
			row: true,
			nodes: [
				{ id: 'ucg', label: 'Cabin UCG Max', sub: '192.168.20.1 · Site Magic VPN, Protect', docs: 'docs/other-site-network.md', device: { site: 'cabin', address: '192.168.20.1 (WAN 10.200.0.x behind the RUTX50)', checks: [{ label: 'UnPoller reads it over the VPN', expr: 'up{job="unpoller", instance="https://192.168.20.1"}' }] }, info: 'The cabin\'s UniFi console, behind a Teltonika RUTX50 on mobile, joined to home by a Site Magic mesh VPN (home 192.168.1.0/24 ↔ cabin 192.168.20.0/24). UnPoller reads its statistics and clients; the cabin resolves *.lab.internal through the UDM Pro. Runs UniFi Protect for the cabin cameras: the dashboard reads their events, clips and snapshots, go2rtc their RTSPS streams.' },
				{ id: 'cabincam', label: 'Cabin camera', sub: 'Reolink Go Plus, 4G', docs: 'apps/cabin-camera/README.md', device: { site: 'cabin', address: '4G, not on the cabin LAN' }, info: 'Battery camera at the cabin on a 4G connection. On motion it uploads a picture and a clip over FTPS to the home\'s public address; the UDM forwards ports 2121 and 50000-50009 to the server.' },
				{ id: 'cabincams', label: 'Cabin Protect cameras', sub: '6 × G5 Turret Ultra', docs: 'apps/dashboard/README.md', device: { site: 'cabin', address: 'PoE, recorded by the UCG Max' }, info: 'Driveway, cabin door, the yard from the cabin and from the sauna, the lake and the drain field; recorded continuously by Protect on the UCG Max (about 13 days fit its disk), smart detections (person, vehicle, animal). The dashboard tiles show Protect snapshots; live video (Medium channel) and recordings (full resolution, 20 s pieces) only while someone watches, to spare the mobile link.' },
				{ id: 'asiair', label: 'ASIAIR Plus', sub: 'cabin telescope · ZWO ASI533MC Pro', docs: 'apps/telescope/README.md', device: { site: 'cabin', address: '192.168.20.121', client: { ip: '192.168.20.121' }, checks: [{ label: 'SMB share answers (telescope)', expr: 'telescope_asiair_up' }, { label: 'live state, JSON-RPC (telescope)', expr: 'telescope_live_up' }] }, info: 'The cabin\'s astrophotography controller on the cabin LAN, reached over the Site Magic VPN: it runs the imaging plans (Autorun) and stores each frame as FITS on its SMB share, with the Autorun logs beside them.' },
				{ id: 'nibe', label: 'NIBE heat pump', sub: 'VVM S320 · 192.168.20.49', docs: 'apps/climate/README.md', device: { site: 'cabin', address: '192.168.20.49', client: { mac: '64:8c:bb:b1:1d:60' }, checks: [{ label: 'answers Modbus (climate)', expr: 'climate_device_up{device="nibe"}' }] }, info: 'The cabin\'s heating and hot water: NIBE VVM S320 with its outdoor air/water unit, wired to the UCG Max. apps/climate reads it and sets the heating offset and hot water amount over Modbus TCP.' },
				{ id: 'innova', label: 'Innova air heat pump', sub: 'Gree Wi-Fi module · 192.168.20.28', docs: 'apps/climate/README.md', device: { site: 'cabin', address: '192.168.20.28', client: { mac: 'c0:39:37:8c:84:0a' }, checks: [{ label: 'answers (climate)', expr: 'climate_device_up{device="innova"}' }] }, info: 'Air-to-air heat pump on the cabin Wi-Fi (Gree module U-WB05RT13). apps/climate reads and sets it over the Gree LAN protocol (UDP 7000, AES).' },
				{ id: 'ruuvigw', label: 'Ruuvi Gateway', sub: 'RuuviGateway942E · 192.168.20.223', docs: 'apps/ruuvi/README.md', device: { site: 'cabin', address: '192.168.20.223', client: { mac: '30:c6:f7:51:63:00' }, checks: [{ label: 'reports online to Mosquitto (ruuvi)', expr: 'max(ruuvi_gateway_up)' }] }, info: 'Hears the cabin\'s RuuviTags over Bluetooth and publishes their decoded readings once a minute to Mosquitto at home (MQTT over the VPN, user ruuvigateway).' },
				{ id: 'ruuvitags', label: 'RuuviTags', sub: 'Vesitalo, Olohuone, Terassi, Kylppari', docs: 'apps/ruuvi/README.md', device: { site: 'cabin', address: 'Bluetooth, through the gateway', checks: [{ label: 'every reporting tag heard in 10 min', expr: 'min(time() - ruuvi_last_seen_timestamp_seconds < bool 600)' }] }, info: 'Battery temperature, humidity and pressure sensors around the cabin; only the Ruuvi Gateway hears them.' },
				{ id: 'swegonmb', label: 'Swegon Modbus adapter', sub: 'Casa W3 ventilation · planned', device: { site: 'cabin', address: 'e.g. 192.168.20.70 (to reserve)', planned: 'docs/shopping-list.md#2-swegon-casa-w3-modbus-adapter-in-the-network-closet' }, info: 'Planned: a Waveshare RS485 TO POE ETH (B) in the network closet turns the Swegon Casa W3\'s RS-485 Modbus into Modbus TCP (port 502), so apps/climate can show and set the ventilation (Home / Away / Boost).' },
				{ id: 'loragw', label: 'LoRaWAN gateway', sub: 'Dragino LPS8v2 · planned', device: { site: 'cabin', address: 'cabin LAN, Ethernet', planned: 'docs/future-plans.md#cabin-lorawan-sensors' }, info: 'Planned: receives every LoRaWAN sensor on the plot and forwards their decoded readings (built-in ChirpStack) to Mosquitto at home over the VPN.' },
				{ id: 'lorasensors', label: 'LoRaWAN sensors', sub: 'lake, septic tank, doors, leaks · planned', device: { site: 'cabin', address: 'LoRa, through the gateway', planned: 'docs/future-plans.md#cabin-lorawan-sensors' }, info: 'Planned: battery sensors around the cabin plot (lake water temperature, septic tank level, doors, leaks, frost watch).' },
				{ id: 'dsccabin', label: 'DSC Neo alarm, cabin', sub: 'HS2032 + TL2803G · planned', device: { site: 'cabin', address: 'fixed LAN address (to choose)', planned: 'docs/future-plans.md#dsc-neo-alarms-home-and-cabin' }, info: 'The cabin alarm panel. Planned: its TL2803G communicator dials out over ITv2 to Home Assistant on 192.168.1.10, port 3073, over the VPN; alarm state could also drive the cabin heating.' }
			]
		},
		{
			id: 'kube-system',
			label: 'kube-system',
			sub: 'k3s built-ins',
			kind: 'namespace',
			nodes: [
				{ id: 'svclb', label: 'ServiceLB', sub: '192.168.1.10 ports → services', workloads: ['kube-system/svclb-*'], docs: 'platform/README.md#network', info: 'k3s\'s load balancer: one small pod per LoadBalancer service forwards the server\'s ports to it: 80/443 to Traefik, 1883 to Mosquitto, 2121 and 50000-50009 to the cabin camera\'s FTPS server.' },
				{ id: 'traefik', label: 'Traefik', sub: 'ingress · *.lab.internal', workloads: ['kube-system/traefik'], docs: 'platform/README.md#components', info: 'Reverse proxy for every web UI: routes by host name (Ingress objects) to the app\'s Service and passes the client\'s address in X-Forwarded-For (externalTrafficPolicy: Local).' },
				{ id: 'coredns', label: 'CoreDNS', sub: 'cluster DNS', workloads: ['kube-system/coredns'], info: 'Resolves <service>.<namespace>.svc names for every pod (10.43.0.10) and forwards other names to the UDM.' },
				{ id: 'metrics', label: 'metrics-server', sub: 'kubectl top', workloads: ['kube-system/metrics-server'], info: 'Live CPU and memory per pod for kubectl top and Headlamp.' },
				{ id: 'api', label: 'k3s API server', sub: ':6443 · in the k3s process', info: 'The Kubernetes API, embedded in the k3s service on the host (not a pod). kubectl from the LAN, Headlamp, kube-state-metrics and the backup job use it.' }
			]
		},
		{
			id: 'local-path-storage',
			label: 'local-path-storage',
			kind: 'namespace',
			nodes: [
				{ id: 'localpath', label: 'local-path', sub: 'volumes on the host disk', workloads: ['local-path-storage/local-path-provisioner'], docs: 'platform/README.md#components', info: 'Creates each PersistentVolumeClaim as a folder under /var/lib/rancher/k3s/storage on the server. The nightly backup copies these folders.' }
			]
		},
		{
			id: 'dashboard',
			label: 'dashboard',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'The family\'s wall display: home, cameras, cabin, telescope, homelab status', lab: ['dashboard.lab.internal'], public: ['dashboard.shillyshally.org'], internal: ['dashboard.dashboard.svc:3000'], docs: 'apps/dashboard/README.md' },
			nodes: [
				{ id: 'dashboard', label: 'Dashboard', sub: 'dashboard.lab.internal', workloads: ['dashboard/dashboard'], href: 'http://dashboard.lab.internal', info: 'The home dashboard (SvelteKit), on the iPad and at dashboard.shillyshally.org. Gathers everything server-side: Prometheus for network and server status, go2rtc for camera pictures and live video, presence, workouts, the cabin camera\'s uploads, both Protect consoles\' events and clips (and the cabin cameras\' snapshots), the cabin telescope\'s session and frames, and weather, calendar and parcels from the internet.' }
			]
		},
		{
			id: 'news',
			label: 'news',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'Shilly Shally News: classified articles in editions three times a day', lab: ['news.lab.internal'], public: ['news.shillyshally.org'], internal: ['web.news.svc:3000'], docs: 'apps/news/README.md' },
			nodes: [
				{ id: 'newsweb', label: 'Web', sub: 'news.lab.internal', workloads: ['news/web'], href: 'http://news.lab.internal', info: 'Shilly Shally News reader site: editions and articles filtered by each reader\'s settings. Shares the photo volume with the worker.' },
				{ id: 'newsworker', label: 'Worker', sub: 'fetch, classify, publish', workloads: ['news/worker'], info: 'Fetches articles and photos from the outlets, has the AI proxy classify them, de-duplicates and publishes editions at 06:30, 12:00 and 17:00. Its NetworkPolicy allows the internet (80/443) but not the LAN.' },
				{ id: 'newspg', label: 'Postgres', sub: 'articles, readers', workloads: ['news/postgres'], info: 'Postgres for news; only web and worker may connect (NetworkPolicy). Dumped nightly by the backup.' }
			]
		},
		{
			id: 'workout',
			label: 'workout',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'Workout log; the week\'s summary on the dashboard', lab: ['workout.lab.internal'], internal: ['web.workout.svc:3000'], docs: 'apps/workout/README.md' },
			nodes: [
				{ id: 'workweb', label: 'Web', sub: 'workout.lab.internal', workloads: ['workout/web'], href: 'http://workout.lab.internal', info: 'Workout log; also gives the dashboard this week\'s summary (bearer token).' },
				{ id: 'workpg', label: 'Postgres', sub: 'workouts', workloads: ['workout/postgres'], info: 'Postgres for workouts; only the web pod may connect. Dumped nightly by the backup.' }
			]
		},
		{
			id: 'homeassistant',
			label: 'homeassistant',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'Devices, automations and notifications', lab: ['homeassistant.lab.internal'], internal: ['homeassistant.homeassistant.svc:8123 (host network)'], docs: 'apps/homeassistant/README.md' },
			nodes: [
				{ id: 'ha', label: 'Home Assistant', sub: 'host network', workloads: ['homeassistant/homeassistant'], href: 'http://homeassistant.lab.internal', info: 'Devices, automations and notifications. Runs on the host network so it can discover devices on the LAN (mDNS); its UI is reached through Traefik only. Uses Mosquitto for MQTT devices.' }
			]
		},
		{
			id: 'go2rtc',
			label: 'go2rtc',
			kind: 'namespace',
			app: { kind: 'platform', purpose: 'Home and cabin camera streams for the dashboard (Protect RTSPS repackaged)', internal: ['go2rtc.go2rtc.svc:1984'], docs: 'platform/README.md#components' },
			nodes: [
				{ id: 'go2rtc', label: 'go2rtc', sub: 'camera streams', workloads: ['go2rtc/go2rtc'], info: 'Repackages Protect\'s RTSPS streams (the UDM Pro\'s, and the cabin UCG Max\'s over the VPN) for browsers without transcoding: still frames for the home camera tiles, live video over WebSocket. Only the dashboard may connect; it connects to Protect only while someone watches.' }
			]
		},
		{
			id: 'cabin-camera',
			label: 'cabin-camera',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'The cabin camera\'s FTPS uploads and its pictures and clips for the dashboard', public: ['FTPS :2121 on the home public address (port forward)'], internal: ['snapshots.cabin-camera.svc:8080'], docs: 'apps/cabin-camera/README.md' },
			nodes: [
				{ id: 'cabinftp', label: 'FTPS server', sub: 'SFTPGo · from the internet', workloads: ['cabin-camera/cabin-camera'], info: 'Receives the cabin camera\'s uploads: FTPS only, upload-only account, IP bans after failed logins. The homelab\'s only service reachable from the internet.' },
				{ id: 'cabinsnap', label: 'Snapshot service', sub: 'pictures and clips', workloads: ['cabin-camera/cabin-camera'], info: 'Lists and serves the uploaded pictures and clips to the dashboard (same pod as the FTPS server, shared volume) and deletes files older than 30 days.' }
			]
		},
		{
			id: 'presence',
			label: 'presence',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'Who is home, at the cabin or away (Wi-Fi and Bluetooth)', internal: ['presence.presence.svc:8080'], docs: 'apps/presence/README.md' },
			nodes: [
				{ id: 'presence', label: 'presence', sub: 'who is where', workloads: ['presence/presence'], info: 'Decides where everyone is (home, the cabin or away) from Wi-Fi (phones connected to each site\'s network, via UnPoller\'s data in Prometheus) and Bluetooth at home (ESPresense sightings over MQTT). Someone at a site that stops reporting (cabin link or VPN down) stays there, marked as no fresh data.' }
			]
		},
		{
			id: 'mosquitto',
			label: 'mosquitto',
			kind: 'namespace',
			app: { kind: 'platform', purpose: 'MQTT broker: Ruuvi Gateway, presence, Home Assistant', lan: ['mqtt://192.168.1.10:1883'], internal: ['mosquitto.mosquitto.svc:1883'], docs: 'platform/components/mosquitto/README.md' },
			nodes: [
				{ id: 'mosquitto', label: 'Mosquitto', sub: 'MQTT broker :1883', workloads: ['mosquitto/mosquitto'], info: 'MQTT broker for the Ruuvi Gateway, ruuvi, presence and Home Assistant (and the ESPresense nodes once they exist). Password logins and per-user topic rules; reachable from the home and cabin LANs only.' }
			]
		},
		{
			id: 'monitoring',
			label: 'monitoring',
			kind: 'namespace',
			app: { kind: 'platform', purpose: 'Metrics (Prometheus, 15 days) and dashboards (Grafana)', lab: ['prometheus.lab.internal', 'grafana.lab.internal'], internal: ['kube-prometheus-stack-prometheus.monitoring.svc:9090'], docs: 'platform/README.md#components' },
			nodes: [
				{ id: 'prometheus', label: 'Prometheus', sub: 'prometheus.lab.internal', workloads: ['monitoring/prometheus-kube-prometheus-stack-prometheus'], href: 'http://prometheus.lab.internal', info: 'Collects metrics every 30 s (15 days kept): server, Kubernetes objects, network (UnPoller), Traefik, presence, climate, ruuvi, telescope. The dashboard, this site and presence query it.' },
				{ id: 'grafana', label: 'Grafana', sub: 'grafana.lab.internal', workloads: ['monitoring/kube-prometheus-stack-grafana'], href: 'http://grafana.lab.internal', info: 'Dashboards over Prometheus: Kubernetes, node and UniFi.' },
				{ id: 'ksm', label: 'kube-state-metrics', sub: 'Kubernetes objects', workloads: ['monitoring/kube-prometheus-stack-kube-state-metrics'], info: 'Turns Kubernetes objects (pods, deployments, jobs) into metrics; where this page\'s pod status comes from.' },
				{ id: 'nodeexp', label: 'node-exporter', sub: 'server CPU, disk, memory', workloads: ['monitoring/kube-prometheus-stack-prometheus-node-exporter'], info: 'The server\'s own metrics: CPU, memory, disks, network interfaces, temperatures.' },
				{ id: 'operator', label: 'Prometheus operator', sub: 'scrape config', workloads: ['monitoring/kube-prometheus-stack-operator'], info: 'Runs Prometheus and turns ServiceMonitors and PodMonitors from any namespace into its scrape configuration.' }
			]
		},
		{
			id: 'unpoller',
			label: 'unpoller',
			kind: 'namespace',
			app: { kind: 'platform', purpose: 'UniFi statistics of both consoles for Prometheus', internal: ['unpoller.unpoller.svc:9130'], docs: 'platform/README.md#components' },
			nodes: [
				{ id: 'unpoller', label: 'UnPoller', sub: 'UniFi → metrics', workloads: ['unpoller/unpoller'], info: 'Reads the UDM Pro\'s statistics every 10 s and the cabin UCG Max\'s every 30 s (over the VPN) with a read-only account (WAN traffic, clients, access points, speed tests) and exposes them to Prometheus, one scrape per console.' }
			]
		},
		{
			id: 'headlamp',
			label: 'headlamp',
			kind: 'namespace',
			app: { kind: 'platform', purpose: 'Kubernetes web UI (token login)', lab: ['kube.lab.internal'], docs: 'platform/README.md#components' },
			nodes: [
				{ id: 'headlamp', label: 'Headlamp', sub: 'kube.lab.internal', workloads: ['headlamp/headlamp'], href: 'http://kube.lab.internal', info: 'Kubernetes web UI; log in with a token.' }
			]
		},
		{
			id: 'lists',
			label: 'lists',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'Lists of things watched, done or wanted', lab: ['lists.lab.internal'], internal: ['web.lists.svc:3000'], docs: 'apps/lists/README.md' },
			nodes: [
				{ id: 'listsweb', label: 'Web', sub: 'lists.lab.internal', workloads: ['lists/web'], href: 'http://lists.lab.internal', info: 'Lists of things done, watched or wanted (watched movies, movies to watch, …): any number of lists, each with the item fields it needs (people, date, service, link, note). Gives the dashboard the lists marked "Show on dashboard" (bearer token).' },
				{ id: 'listspg', label: 'Postgres', sub: 'lists, items', workloads: ['lists/postgres'], info: 'Postgres for lists; only the web pod may connect. Dumped nightly by the backup.' }
			]
		},
		{
			id: 'cloudflare',
			label: 'cloudflare',
			kind: 'namespace',
			app: { kind: 'platform', purpose: 'Cloudflare Tunnel for the public shillyshally.org names', docs: 'platform/README.md#components' },
			nodes: [
				{ id: 'cloudflared', label: 'cloudflared', sub: 'tunnel homelab', workloads: ['cloudflare/cloudflared'], info: 'Keeps outbound connections to Cloudflare (QUIC, port 7844) and forwards the requests for the published hostnames (config in git: platform/components/cloudflared/config.yaml). Accepts no connections; may reach only Cloudflare and the apps it publishes.' }
			]
		},
		{
			id: 'notify',
			label: 'notify',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'Notifications to the family\'s phones as web push', public: ['notify.shillyshally.org'], internal: ['web.notify.svc:3000 (sending API)'], docs: 'apps/notify/README.md' },
			nodes: [
				{ id: 'notifyweb', label: 'Web', sub: 'notify.shillyshally.org', workloads: ['notify/web'], href: 'https://notify.shillyshally.org', info: 'The one place for notifications: apps send to a topic (POST /api/send, bearer token per sender, cluster-internal only), notify delivers web push to the devices of everyone who has that topic on. People install it on the Home Screen, choose topics and see recent messages; identity from Cloudflare Access.' },
				{ id: 'notifypg', label: 'Postgres', sub: 'people, devices, messages', workloads: ['notify/postgres'], info: 'Postgres for notify; only the web pod may connect. Dumped nightly by the backup.' }
			]
		},
		{
			id: 'climate',
			label: 'climate',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'The cabin\'s heat pumps (NIBE, Innova) for the dashboard\'s Cabin tab', internal: ['climate.climate.svc:8080'], docs: 'apps/climate/README.md' },
			nodes: [
				{ id: 'climate', label: 'Climate', sub: 'cabin heat pumps', workloads: ['climate/climate'], info: 'Reads the cabin\'s NIBE heat pump (Modbus TCP) and Innova air heat pump (Gree LAN protocol) every minute over the VPN and changes them for the dashboard\'s Cabin tab: heating offset, hot water amount; power, mode, target and fan.' }
			]
		},
		{
			id: 'telescope',
			label: 'telescope',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'The cabin ASIAIR\'s imaging sessions: archive, live stack, reports, conditions, planning, calibration, final stacks and notifications', lab: ['telescope.lab.internal'], public: ['telescope.shillyshally.org', 'astro.shillyshally.org (share link: published gallery, no login)'], internal: ['telescope.telescope.svc:8080', 'telescope-processor.telescope.svc:8080', 'telescope-web.telescope.svc:3000'], docs: 'apps/telescope/README.md' },
			nodes: [
				{ id: 'telescope', label: 'Telescope', sub: 'cabin ASIAIR · Python', workloads: ['telescope/telescope'], info: 'Follows the cabin\'s ASIAIR over the VPN, read only: copies every FITS frame (lights, Bias/Dark/Flat) and the Autorun/PHD2 logs into an archive by night and target (PVC telescope-archive, 500 Gi, not backed up), renders previews with sky background, star count, focus (HFR, FWHM) and star elongation, rejects bad frames automatically (clouds, focus, trailing, guiding) with a manual override, marks satellite and plane trails, plate-solves frames and uploads the ASIAIR did not solve with ASTAP, registers and stacks each session live (sigma-clipped mean), records guiding and telemetry from the ASIAIR\'s live state, and keeps per-session reports, stacks and previews (PVC telescope-data, 20 Gi, backed up; aligned frames, timelapses and analyses in a 20 Gi emptyDir cache rebuilt from the archive). Also: auto focus runs from the Autorun logs, the mount\'s periodic error, Dec drift and backlash from the PHD2 logs, tilt and backfocus per frame, session timelapses. Notifies when imaging starts, ends or goes wrong. Serves the dashboard\'s Telescope tab and the telescope web app.' },
				{ id: 'telescopeprocessor', label: 'Telescope processor', sub: 'calibration · final stacks · Siril', workloads: ['telescope/telescope-processor'], info: 'Builds the calibration library from the archived Bias, Dark and Flat frames (sets by gain, offset, exposure, temperature and camera angle; masters with their age), matches them to each target\'s lights with warnings, and stacks finals with Siril (headless: calibration, registration, several nights together) into a linear FITS, a processed TIFF and previews, one job at a time; streams a tar of the raw lights, calibration sets, masters and the latest final for processing by hand. Reads the archive (PVC telescope-archive, read only) and the telescope service\'s sessions; writes masters and finals to PVC telescope-processed (100 Gi, not backed up: rebuilt from the archive).' },
				{ id: 'telescopeweb', label: 'Telescope web', sub: 'telescope.lab.internal', workloads: ['telescope/telescope-web'], href: 'http://telescope.lab.internal', info: 'The telescope web app (SvelteKit), for a phone at the telescope (red night mode) and a laptop: the live stack against the latest frame, the session\'s timeline with the target\'s altitude, guiding over the whole session beside the wind, every frame with its rejection reason, trails and accept/reject buttons, telemetry, focus against temperature, tilt and backfocus, the session\'s framing over a DSS2 survey image, a timelapse of the frames and the growing stack; tonight\'s conditions (darkness and moon, cloud by height from several models, seeing, aurora); a target planner over a bundled OpenNGC catalogue (hours above a limit in darkness, transit, moon, framing in the 0.96° field over the survey, mosaics, wishlist); integration goals per target across nights; the observing log, a report per night and target; the calibration library and final stacks with their downloads; a full-resolution viewer (zoom to single pixels, histogram, star FWHM and profile on a tap, objects and named stars from the plate solve); a gallery per target of the final stacks and the owner\'s own processed images (uploads up to 300 MB) with a publish toggle; Stats: hours and clear nights per month, which cloud forecast was right at the cabin, focus against temperature across nights, the mount from the PHD2 logs. The whole app is also at telescope.shillyshally.org (through cloudflared, behind Cloudflare Access, policy Family). Its share link astro.shillyshally.org is open to anyone (Access bypass) and shows only the published gallery, read-only: the tunnel routes only the gallery paths for that host and the app refuses everything else for it. Reads the telescope service, the processor and Prometheus; fetches Open-Meteo, 7Timer, NOAA SWPC and CDS hips2fits itself, cached.' }
			]
		},
		{
			id: 'backup',
			label: 'backup',
			kind: 'namespace',
			app: { kind: 'platform', purpose: 'Nightly restic backup to Google Drive', docs: 'platform/components/backup/README.md' },
			nodes: [
				{ id: 'backup', label: 'Backup', sub: 'nightly 03:30 · restic', workloads: ['backup/backup'], info: 'CronJob: dumps the Postgres databases (exec through the API), copies every volume (except disposable ones: Prometheus, the telescope archive and processed stacks) and the secrets, encrypts with restic and uploads to Google Drive through rclone. Keeps 7 daily, 5 weekly, 12 monthly.' }
			]
		},
		{
			id: 'homelab',
			label: 'homelab',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'This site: state, network, devices, plans and docs', lab: ['homelab.lab.internal'], internal: ['homelab.homelab.svc:3000'], docs: 'apps/homelab/README.md' },
			nodes: [
				{ id: 'homelab', label: 'Homelab', sub: 'homelab.lab.internal', workloads: ['homelab/homelab'], href: '/', info: 'This site (SvelteKit): the homelab\'s current state, these diagrams, the devices and how they connect, plans, the shopping list and every README, bundled at build time. Live status from Prometheus.' }
			]
		},
		{
			id: 'ruuvi',
			label: 'ruuvi',
			kind: 'namespace',
			app: { kind: 'app', purpose: 'The cabin\'s RuuviTag readings as metrics (Grafana: Ruuvi)', internal: ['ruuvi.ruuvi.svc:8080'], docs: 'apps/ruuvi/README.md' },
			nodes: [
				{ id: 'ruuvi', label: 'ruuvi', sub: 'RuuviTags → metrics', workloads: ['ruuvi/ruuvi'], info: 'Subscribes to the Ruuvi Gateway\'s readings on Mosquitto, keeps the latest per tag and serves them to Prometheus (temperature, humidity, pressure, battery, last seen); Grafana dashboard Ruuvi.' }
			]
		}
	],
	edges: [
		{ from: 'users', to: 'traefik', label: 'HTTP :80 · *.lab.internal', kind: 'web' },
		{ from: 'svclb', to: 'traefik', label: 'ports 80, 443', kind: 'web' },
		{ from: 'traefik', to: 'dashboard', label: 'dashboard.lab.internal', kind: 'web' },
		{ from: 'traefik', to: 'newsweb', label: 'news.lab.internal', kind: 'web' },
		{ from: 'traefik', to: 'workweb', label: 'workout.lab.internal', kind: 'web' },
		{ from: 'traefik', to: 'ha', label: 'homeassistant.lab.internal', kind: 'web' },
		{ from: 'traefik', to: 'grafana', label: 'grafana.lab.internal', kind: 'web' },
		{ from: 'traefik', to: 'prometheus', label: 'prometheus.lab.internal', kind: 'web' },
		{ from: 'traefik', to: 'headlamp', label: 'kube.lab.internal', kind: 'web' },
		{ from: 'esp', to: 'svclb', label: 'MQTT :1883', kind: 'mqtt' },
		{ from: 'svclb', to: 'mosquitto', label: 'port 1883', kind: 'mqtt' },
		{ from: 'cabincam', to: 'udm', label: 'FTPS over 4G to the public address', kind: 'internet' },
		{ from: 'udm', to: 'svclb', label: 'port forward 2121, 50000-50009', kind: 'internet' },
		{ from: 'svclb', to: 'cabinftp', label: 'ports 2121, 50000-50009', kind: 'internet' },
		{ from: 'cams', to: 'udm', label: 'recorded by Protect', kind: 'video' },
		{ from: 'cabincams', to: 'ucg', label: 'recorded by Protect', kind: 'video' },
		{ from: 'dashboard', to: 'prometheus', label: 'network, server, backup status', kind: 'metrics' },
		{ from: 'dashboard', to: 'go2rtc', label: 'pictures, live video', kind: 'video' },
		{ from: 'dashboard', to: 'presence', label: 'who is home', kind: 'web' },
		{ from: 'dashboard', to: 'workweb', label: 'week\'s workouts', kind: 'web' },
		{ from: 'dashboard', to: 'cabinsnap', label: 'cabin pictures, clips', kind: 'video' },
		{ from: 'dashboard', to: 'udm', label: 'Protect events, clips, recordings', kind: 'video' },
		{ from: 'dashboard', to: 'ucg', label: 'Protect events, clips, recordings, snapshots over the VPN', kind: 'video' },
		{ from: 'dashboard', to: 'internet', label: 'weather, calendar, parcels', kind: 'internet' },
		{ from: 'go2rtc', to: 'udm', label: 'RTSPS :7441', kind: 'video' },
		{ from: 'go2rtc', to: 'ucg', label: 'RTSPS :7441 over the VPN', kind: 'video' },
		{ from: 'cabinftp', to: 'cabinsnap', label: 'shared volume', kind: 'data' },
		{ from: 'newsweb', to: 'newspg', label: 'SQL', kind: 'data' },
		{ from: 'newsworker', to: 'newspg', label: 'SQL', kind: 'data' },
		{ from: 'newsworker', to: 'internet', label: 'outlets, AI classification', kind: 'internet' },
		{ from: 'workweb', to: 'workpg', label: 'SQL', kind: 'data' },
		{ from: 'traefik', to: 'listsweb', label: 'lists.lab.internal', kind: 'web' },
		{ from: 'dashboard', to: 'listsweb', label: 'lists on the dashboard', kind: 'web' },
		{ from: 'listsweb', to: 'listspg', label: 'SQL', kind: 'data' },
		{ from: 'users', to: 'cfedge', label: 'HTTPS *.shillyshally.org', kind: 'internet' },
		{ from: 'cloudflared', to: 'cfedge', label: 'tunnel, outbound', kind: 'internet' },
		{ from: 'cloudflared', to: 'notifyweb', label: 'the Notify app', kind: 'web' },
		{ from: 'cloudflared', to: 'dashboard', label: 'dashboard.shillyshally.org', kind: 'web' },
		{ from: 'cloudflared', to: 'newsweb', label: 'news.shillyshally.org', kind: 'web' },
		{ from: 'cloudflared', to: 'telescopeweb', label: 'telescope.shillyshally.org; astro.shillyshally.org (published gallery only)', kind: 'web' },
		{ from: 'dashboard', to: 'notifyweb', label: 'package ready for pickup', kind: 'web' },
		{ from: 'dashboard', to: 'climate', label: 'Cabin tab, changes', kind: 'web' },
		{ from: 'climate', to: 'nibe', label: 'Modbus TCP 502 over the VPN', kind: 'control' },
		{ from: 'climate', to: 'innova', label: 'Gree LAN protocol, UDP 7000, over the VPN', kind: 'control' },
		{ from: 'climate', to: 'swegonmb', label: 'Modbus TCP 502 over the VPN', kind: 'control' },
		{ from: 'ruuvitags', to: 'ruuvigw', label: 'Bluetooth advertisements', kind: 'data' },
		{ from: 'ruuvigw', to: 'svclb', label: 'MQTT :1883 over the VPN', kind: 'mqtt' },
		{ from: 'ruuvi', to: 'mosquitto', label: 'gateway readings', kind: 'mqtt' },
		{ from: 'prometheus', to: 'ruuvi', label: 'scrape', kind: 'metrics' },
		{ from: 'lorasensors', to: 'loragw', label: 'LoRa, EU868', kind: 'data' },
		{ from: 'loragw', to: 'svclb', label: 'MQTT :1883 over the VPN', kind: 'mqtt' },
		{ from: 'dschome', to: 'ha', label: 'ITv2 :3072, dials out', kind: 'control' },
		{ from: 'dsccabin', to: 'ha', label: 'ITv2 :3073 over the VPN, dials out', kind: 'control' },
		{ from: 'traefik', to: 'homelab', label: 'homelab.lab.internal', kind: 'web' },
		{ from: 'homelab', to: 'prometheus', label: 'pod, device and network status', kind: 'metrics' },
		{ from: 'dashboard', to: 'telescope', label: 'Telescope tab, frame previews', kind: 'web' },
		{ from: 'traefik', to: 'telescopeweb', label: 'telescope.lab.internal', kind: 'web' },
		{ from: 'telescopeweb', to: 'telescope', label: 'sessions, stacks, previews, frame overrides, goals and wishlist', kind: 'web' },
		{ from: 'telescopeweb', to: 'telescopeprocessor', label: 'calibration library, final stacks (start, status), downloads', kind: 'web' },
		{ from: 'telescopeprocessor', to: 'telescope', label: 'sessions and frame decisions', kind: 'web' },
		{ from: 'telescopeprocessor', to: 'internet', label: 'Gaia DR3 via VizieR TAP (Siril colour calibration; HTTP 80, 443)', kind: 'internet' },
		{ from: 'telescopeweb', to: 'internet', label: 'Open-Meteo (forecasts, forecast history, ERA5), 7Timer, NOAA SWPC, DSS2 survey images (CDS hips2fits)', kind: 'internet' },
		{ from: 'telescopeweb', to: 'prometheus', label: 'cabin RuuviTag temperature (Focus card)', kind: 'metrics' },
		{ from: 'telescope', to: 'asiair', label: 'frames and logs (SMB 445), live state (JSON-RPC 4700/4400, getters only) over the VPN', kind: 'data' },
		{ from: 'telescope', to: 'notifyweb', label: 'imaging notifications', kind: 'web' },
		{ from: 'telescopeweb', to: 'notifyweb', label: 'tonight\'s pick, morning report (topic telescope-digest)', kind: 'web' },
		{ from: 'telescope', to: 'internet', label: 'Open-Meteo (dew notification)', kind: 'internet' },
		{ from: 'prometheus', to: 'telescope', label: 'scrape', kind: 'metrics' },
		{ from: 'notifyweb', to: 'notifypg', label: 'SQL', kind: 'data' },
		{ from: 'notifyweb', to: 'pushsvc', label: 'Web Push', kind: 'internet' },
		{ from: 'pushsvc', to: 'users', label: 'notifications', kind: 'internet' },
		{ from: 'ha', to: 'mosquitto', label: 'MQTT', kind: 'mqtt' },
		{ from: 'presence', to: 'mosquitto', label: 'Bluetooth sightings', kind: 'mqtt' },
		{ from: 'presence', to: 'prometheus', label: 'Wi-Fi clients', kind: 'metrics' },
		{ from: 'prometheus', to: 'presence', label: 'scrape', kind: 'metrics' },
		{ from: 'prometheus', to: 'unpoller', label: 'scrape', kind: 'metrics' },
		{ from: 'prometheus', to: 'ksm', label: 'scrape', kind: 'metrics' },
		{ from: 'prometheus', to: 'nodeexp', label: 'scrape', kind: 'metrics' },
		{ from: 'prometheus', to: 'traefik', label: 'scrape', kind: 'metrics' },
		{ from: 'grafana', to: 'prometheus', label: 'dashboards', kind: 'metrics' },
		{ from: 'unpoller', to: 'udm', label: 'UniFi API, read-only', kind: 'control' },
		{ from: 'unpoller', to: 'ucg', label: 'UniFi API over the VPN', kind: 'control' },
		{ from: 'operator', to: 'prometheus', label: 'runs, configures', kind: 'control' },
		{ from: 'ksm', to: 'api', label: 'watches objects', kind: 'control' },
		{ from: 'headlamp', to: 'api', label: 'Kubernetes UI', kind: 'control' },
		{ from: 'backup', to: 'api', label: 'pg_dump via exec', kind: 'control' },
		{ from: 'backup', to: 'internet', label: 'Google Drive, encrypted', kind: 'internet' }
	]
};

export const NETWORK: Diagram = {
	areas: {
		wide: [
			'inet udm lan',
			'host host host',
			'pods pods svc',
			'np np np'
		],
		narrow: ['inet', 'udm', 'lan', 'host', 'pods', 'svc', 'np']
	},
	groups: [
		{
			id: 'inet',
			label: 'Internet',
			kind: 'zone',
			nodes: [
				{ id: 'n-internet', label: 'Internet services', sub: 'weather, calendar, parcels, news, AI, Drive', info: 'Everything the cluster fetches from outside. Pods reach it through the server (NAT to 192.168.1.10) and the UDM (NAT to the public address).' },
				{ id: 'n-cloudflare', label: 'Cloudflare', sub: 'tunnel · Access · push services', info: 'shillyshally.org: Notify, the dashboard, News and the telescope app are reached at Cloudflare (HTTPS, Access login; the telescope\'s share link astro.shillyshally.org, its published gallery only, without a login) and come in over the tunnel that cloudflared keeps open from inside (outbound QUIC 7844), so no port is forwarded for them. Notifications go out to the push services (Apple, Google) on 443.' },
				{ id: 'n-cabincam', label: 'Cabin camera', sub: '4G', info: 'Uploads over FTPS to the home\'s public address: control port 2121 and passive data ports 50000-50009. The only connection that comes in from the internet.' }
			]
		},
		{
			id: 'udm',
			label: 'UDM Pro',
			sub: '192.168.1.1',
			kind: 'zone',
			nodes: [
				{ id: 'n-wan', label: 'WAN, NAT', sub: 'port forward 2121, 50000-50009 → .10', info: 'The home\'s public address. Outgoing traffic is translated (NAT); incoming is dropped except the two port forward entries for the cabin camera, which go to 192.168.1.10.' },
				{ id: 'n-dns', label: 'DNS, DHCP', sub: '*.lab.internal → 192.168.1.10', info: 'DNS records under Settings → Policy Table → DNS: ingress.lab.internal A 192.168.1.10, and each app as a CNAME to it (no wildcards in UniFi). DHCP reserves 192.168.1.10 for the server.' },
				{ id: 'n-protect', label: 'Protect', sub: 'NVR · RTSPS :7441 · API', info: 'Records the home cameras. go2rtc reads their RTSPS streams (port 7441); the dashboard reads events, thumbnails and clips through its API with the read-only account.' }
			]
		},
		{
			id: 'lan',
			label: 'Home LAN',
			sub: '192.168.1.0/24',
			kind: 'zone',
			nodes: [
				{ id: 'n-family', label: 'Family devices', sub: 'iPad, phones, laptops', info: 'Open the web UIs by name: the UDM\'s DNS answers 192.168.1.10, Traefik routes by host name. kubectl uses the API on port 6443. The Notify app goes through Cloudflare instead, at home and away.' },
				{ id: 'n-cams', label: 'Protect cameras', sub: 'wired to the UDM', info: 'Stream to Protect only; nothing in the cluster talks to them directly.' },
				{ id: 'n-esp', label: 'ESPresense nodes', sub: 'MQTT to .10:1883', info: 'Publish Bluetooth sightings to Mosquitto on port 1883 (password login, LAN only).' },
				{ id: 'n-smart', label: 'Smart devices', sub: 'found over mDNS', info: 'Devices announcing themselves on the LAN (Chromecast, Hue, Shelly, ESPHome, HomeKit); Home Assistant sees them because it runs on the host network and firewalld allows mDNS.' }
			]
		},
		{
			id: 'host',
			label: 'Server shilly-shally-lab-01',
			sub: '192.168.1.10 · k3s, single node',
			kind: 'zone',
			row: true,
			nodes: [
				{ id: 'n-api', label: 'k3s API', sub: ':6443', info: 'Kubernetes API inside the k3s service; kubectl from the LAN, Headlamp, kube-state-metrics and the backup job.' },
				{ id: 'n-fw', label: 'firewalld · public', sub: '22, 80, 443, 1883, 2121, 6443, 9090, 50000-50009, 5353/udp', info: 'The LAN-facing zone. Open: SSH 22, Cockpit 9090, HTTP 80 and 443 (Traefik), 6443 (Kubernetes API), 1883 (MQTT), 2121 and 50000-50009 (cabin FTPS), 5353/udp (mDNS). Everything else, including Home Assistant\'s 8123, is closed (platform/host/prepare.sh).' },
				{ id: 'n-svclb', label: 'ServiceLB', sub: '80/443 · 1883 · 2121, 50000-50009', info: 'k3s binds each LoadBalancer service\'s ports on 192.168.1.10 and forwards them into the pod network: 80/443 to Traefik, 1883 to Mosquitto, 2121 and 50000-50009 to the cabin FTPS server. Client addresses are kept (externalTrafficPolicy: Local).' },
				{ id: 'n-hostnet', label: 'Host network pods', sub: 'Home Assistant, node-exporter', info: 'Pods using the server\'s own network instead of the pod network: Home Assistant (8123, reached only through Traefik; mDNS discovery) and node-exporter (9100, scraped by Prometheus). NetworkPolicies do not apply to them.' },
				{ id: 'n-trusted', label: 'firewalld · trusted', sub: '10.42.0.0/16, 10.43.0.0/16', info: 'Pod and service networks are trusted, so pods can reach the host (Traefik to Home Assistant on the host network, the backup to the API).' },
			]
		},
		{
			id: 'pods',
			label: 'Pod network',
			sub: '10.42.0.0/16 · flannel · gateway cni0 10.42.0.1',
			kind: 'zone',
			row: true,
			nodes: [
				{ id: 'n-egress', label: 'Outbound NAT', sub: 'as 192.168.1.10', info: 'Traffic from pods to the LAN or the internet is translated to the server\'s address, then by the UDM to the public address.' },
				{ id: 'n-pods', label: 'App pods', sub: 'one IP each', info: 'Every other pod gets an address in 10.42.0.0/16 on the cni0 bridge. Pod-to-pod traffic stays on the server.' },
				{ id: 'n-traefik', label: 'Traefik', sub: 'ingress by host name', info: 'Receives 80/443 from ServiceLB and proxies to Services by host name; HTTP only on the LAN (no TLS until a domain exists).' },
			]
		},
		{
			id: 'svc',
			label: 'Service network',
			sub: '10.43.0.0/16',
			kind: 'zone',
			nodes: [
				{ id: 'n-svc', label: 'ClusterIP services', sub: '<name>.<namespace>.svc', info: 'Stable virtual addresses in front of pods; kube-proxy rules on the server send each connection to a ready pod.' },
				{ id: 'n-coredns', label: 'CoreDNS', sub: '10.43.0.10', info: 'Every pod\'s DNS server: answers service names, forwards everything else to the UDM.' }
			]
		},
		{
			id: 'np',
			label: 'NetworkPolicies',
			sub: 'enforced by k3s',
			kind: 'zone',
			row: true,
			nodes: [
				{ id: 'n-deny', label: 'Default deny', sub: 'news, workout, lists, notify', info: 'All traffic blocked except the listed paths: Traefik to web, web (and worker) to Postgres, DNS, the dashboard to workout, lists and notify, the telescope service and the telescope web app to notify, cloudflared to notify and news, the news worker to the internet on 80/443 and notify to the internet on 443 (not the LAN).' },
				{ id: 'n-limited', label: 'Limited', sub: 'go2rtc, presence, cabin-camera, mosquitto, backup, cloudflared, climate, telescope, telescope-processor, telescope-web, ruuvi, homelab', info: 'go2rtc accepts only the dashboard; presence only the dashboard and Prometheus; Mosquitto only the home and cabin LANs, presence, ruuvi and the server itself; cabin-camera\'s snapshot service only the dashboard; the backup may reach DNS, the API and the internet on 443 only; cloudflared accepts nothing and may reach only Cloudflare (7844, 443, not the LAN), notify, the dashboard, news and telescope-web; climate accepts the dashboard and Prometheus and may reach only the cabin\'s two heat pumps; telescope accepts the dashboard, telescope-web, telescope-processor and Prometheus; telescope-processor accepts only telescope-web and may reach only telescope, DNS and the internet on 80 and 443 (not the LAN; Siril\'s VizieR TAP queries for Gaia DR3 are plain HTTP); telescope-web accepts Traefik and cloudflared and may reach only telescope, telescope-processor, Prometheus, notify, DNS and the internet on 443 (not the LAN); ruuvi accepts only Prometheus and may reach only Mosquitto; homelab accepts only Traefik and may reach only Prometheus.' },
				{ id: 'n-open', label: 'No policy', sub: 'dashboard, monitoring, kube-system, …', info: 'dashboard, monitoring, headlamp, unpoller and kube-system have no NetworkPolicy; Home Assistant and node-exporter are on the host network, where policies do not apply.' }
			]
		}
	],
	edges: [
		{ from: 'n-internet', to: 'n-wan', label: 'public address', kind: 'internet' },
		{ from: 'n-family', to: 'n-cloudflare', label: 'HTTPS *.shillyshally.org, at home and away', kind: 'web' },
		{ from: 'n-wan', to: 'n-cloudflare', label: 'cloudflared tunnel, outbound', kind: 'internet' },
		{ from: 'n-cabincam', to: 'n-wan', label: 'FTPS 2121, 50000-50009', kind: 'internet' },
		{ from: 'n-wan', to: 'n-fw', label: 'port forward → 192.168.1.10', kind: 'internet' },
		{ from: 'n-family', to: 'n-dns', label: 'look up *.lab.internal', kind: 'control' },
		{ from: 'n-family', to: 'n-fw', label: 'HTTP :80, kubectl :6443', kind: 'web' },
		{ from: 'n-esp', to: 'n-fw', label: 'MQTT :1883', kind: 'mqtt' },
		{ from: 'n-cams', to: 'n-protect', label: 'video', kind: 'video' },
		{ from: 'n-fw', to: 'n-svclb', label: 'open ports', kind: 'web' },
		{ from: 'n-fw', to: 'n-api', label: ':6443', kind: 'control' },
		{ from: 'n-svclb', to: 'n-traefik', label: '80, 443', kind: 'web' },
		{ from: 'n-svclb', to: 'n-pods', label: '1883, 2121, 50000-50009', kind: 'mqtt' },
		{ from: 'n-traefik', to: 'n-svc', label: 'to the app\'s Service', kind: 'web' },
		{ from: 'n-traefik', to: 'n-hostnet', label: 'Home Assistant :8123', kind: 'web' },
		{ from: 'n-svc', to: 'n-pods', label: 'to a ready pod', kind: 'web' },
		{ from: 'n-pods', to: 'n-coredns', label: 'DNS', kind: 'control' },
		{ from: 'n-pods', to: 'n-egress', label: 'outbound', kind: 'internet' },
		{ from: 'n-egress', to: 'n-wan', label: 'to the internet; Site Magic VPN to the cabin (192.168.20.0/24)', kind: 'internet' },
		{ from: 'n-egress', to: 'n-protect', label: 'RTSPS, Protect and UniFi API', kind: 'video' },
		{ from: 'n-hostnet', to: 'n-smart', label: 'mDNS discovery', kind: 'control' },
		{ from: 'n-trusted', to: 'n-hostnet', label: 'pods ↔ host', kind: 'control' }
	]
};

/** Live state of one workload from Prometheus (GET /api/status). */
export interface WorkloadStatus {
	kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'CronJob';
	pods: { name: string; ready: boolean; phase: string; restarts24h: number; cpu: number | null; memory: number | null }[];
	/** CronJob: last successful run, unix ms. */
	lastSuccess?: number | null;
}

/** A client connected to a site's UniFi network, from UnPoller. */
export interface NetworkClient {
	site: SiteId;
	name: string;
	mac: string;
	ip: string;
	wired: boolean;
	/** Access point, or switch and port. */
	via: string;
	uptimeS: number;
}

/** A UniFi console, switch or access point, from UnPoller. */
export interface UnifiGear {
	site: SiteId;
	name: string;
	model: string;
	ip: string;
	mac: string;
	uptimeS: number | null;
}

/** Everything live, from Prometheus (GET /api/status, every 30 s). */
export interface ArchitectureData {
	/** Keyed "namespace/name". */
	workloads: Record<string, WorkloadStatus>;
	/** UnPoller reaches the site's console (its scrape is up); null without data. */
	consoles: Record<SiteId, boolean | null>;
	clients: NetworkClient[];
	gear: UnifiGear[];
	/** Each device check's `expr` → its value; absent when the query returned nothing. */
	checks: Record<string, number>;
	cluster: {
		node: string | null;
		nodeReady: boolean | null;
		kubelet: string | null;
		uptimeS: number | null;
		cpu: number | null;
		memory: number | null;
		targetsDown: number | null;
		/** Backup CronJob: unix seconds of the newest successful run's end and failed run's start. */
		backup: { lastSuccess: number | null; lastFailure: number | null; running: boolean };
	};
	updatedAt: number;
}

const matches = (pattern: string, key: string) => (pattern.endsWith('*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern);

/** The workloads in `data` that a node's patterns match. */
export function nodeWorkloads(node: DiagramNode, data: ArchitectureData | null): [string, WorkloadStatus][] {
	if (!data || !node.workloads) return [];
	return Object.entries(data.workloads).filter(([key]) => node.workloads!.some((p) => matches(p, key)));
}

/** Workloads running in the cluster that no node of `diagram` claims: the diagram needs updating. */
export function unmodelled(diagram: Diagram, data: ArchitectureData | null): string[] {
	if (!data) return [];
	const patterns = diagram.groups.flatMap((g) => g.nodes.flatMap((n) => n.workloads ?? []));
	return Object.keys(data.workloads)
		.filter((key) => !patterns.some((p) => matches(p, key)))
		.sort();
}

export type Tone = 'ok' | 'warn' | 'bad';
export interface Status {
	tone: Tone;
	text: string;
}

/**
 * Status of a component's or an app's workloads: a CronJob by its last success (a nightly job older
 * than 26 h is late), otherwise pods ready, restarts in 24 h and memory ("not running" without pods).
 */
export function workloadsStatus(workloads: [string, WorkloadStatus][], nowMs: number): Status {
	const cron = workloads.find(([, w]) => w.kind === 'CronJob')?.[1];
	if (cron) {
		const ok = cron.lastSuccess != null && nowMs - cron.lastSuccess < 26 * 3_600_000;
		return { tone: ok ? 'ok' : 'warn', text: cron.lastSuccess ? `last run ${formatAgo(cron.lastSuccess / 1000, nowMs)}` : 'never succeeded' };
	}
	const pods = workloads.flatMap(([, w]) => w.pods);
	if (pods.length === 0) return { tone: 'bad', text: 'not running' };
	const ready = pods.filter((p) => p.ready).length;
	const restarts = pods.reduce((sum, p) => sum + p.restarts24h, 0);
	const memory = pods.reduce((sum, p) => sum + (p.memory ?? 0), 0);
	const tone = ready === 0 ? 'bad' : ready < pods.length || restarts > 0 ? 'warn' : 'ok';
	const parts = [`${ready}/${pods.length} ready`];
	if (restarts > 0) parts.push(`${restarts} restart${restarts > 1 ? 's' : ''}`);
	if (memory > 0) parts.push(formatBytes(memory));
	return { tone, text: parts.join(' · ') };
}

/** Every component of the Components diagram with its group, by id. */
export const NODES = new Map(COMPONENTS.groups.flatMap((g) => g.nodes.map((n) => [n.id, { node: n, group: g }] as const)));
