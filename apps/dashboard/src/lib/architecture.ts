// The homelab's structure for the Homelab tab's Components and Network views. Groups, components and
// connections are written here by hand (Kubernetes does not record who talks to whom); live pod status
// comes from Prometheus (src/routes/api/architecture). Update this file when an app or connection is
// added: workloads running in the cluster but missing here are listed under the Components diagram.

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
			'out monitoring monitoring headlamp lists'
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
			'backup lists'
		]
	},
	groups: [
		{
			id: 'out',
			label: 'Outside the cluster',
			kind: 'outside',
			nodes: [
				{ id: 'users', label: 'Family devices', sub: 'iPad, phones, laptops', info: 'Browsers on the home network (or the UDM\'s VPN). *.lab.internal names resolve on the UDM Pro to 192.168.1.10, where Traefik answers.' },
				{ id: 'udm', label: 'UDM Pro', sub: '192.168.1.1 · router, DNS, Protect', info: 'Router and firewall (NAT, port forward for the cabin camera), DNS for lab.internal, DHCP, and UniFi Protect: records the home cameras, serves their RTSPS streams and the event and clip API. UnPoller reads its network statistics.' },
				{ id: 'cams', label: 'Protect cameras', sub: 'Front door, Backyard, Carport', info: 'UniFi G4/G5 Dome cameras, recorded continuously by Protect on the UDM Pro; smart detections (person, vehicle, animal) on the carport camera.' },
				{ id: 'esp', label: 'ESPresense nodes', sub: 'Bluetooth, ESP32', info: 'ESP32 boards that recognise the family\'s phones over Bluetooth and publish sightings to Mosquitto (MQTT, port 1883 on 192.168.1.10).' },
				{ id: 'cabincam', label: 'Cabin camera', sub: 'Reolink Go Plus, 4G', info: 'Battery camera at the cabin on a 4G connection. On motion it uploads a picture and a clip over FTPS to the home\'s public address; the UDM forwards ports 2121 and 50000-50009 to the server.' },
				{ id: 'internet', label: 'Internet services', sub: 'weather, calendar, parcels, news, AI, Drive', info: 'Open-Meteo (weather), Google Calendar (iCal), Posti, Matkahuolto and UPS (parcels) for the dashboard; news outlets and the AI proxy for the news worker; Google Drive for the nightly backup.' }
			]
		},
		{
			id: 'kube-system',
			label: 'kube-system',
			sub: 'k3s built-ins',
			kind: 'namespace',
			nodes: [
				{ id: 'svclb', label: 'ServiceLB', sub: '192.168.1.10 ports → services', workloads: ['kube-system/svclb-*'], info: 'k3s\'s load balancer: one small pod per LoadBalancer service forwards the server\'s ports to it: 80/443 to Traefik, 1883 to Mosquitto, 2121 and 50000-50009 to the cabin camera\'s FTPS server.' },
				{ id: 'traefik', label: 'Traefik', sub: 'ingress · *.lab.internal', workloads: ['kube-system/traefik'], info: 'Reverse proxy for every web UI: routes by host name (Ingress objects) to the app\'s Service and passes the client\'s address in X-Forwarded-For (externalTrafficPolicy: Local).' },
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
				{ id: 'localpath', label: 'local-path', sub: 'volumes on the host disk', workloads: ['local-path-storage/local-path-provisioner'], info: 'Creates each PersistentVolumeClaim as a folder under /var/lib/rancher/k3s/storage on the server. The nightly backup copies these folders.' }
			]
		},
		{
			id: 'dashboard',
			label: 'dashboard',
			kind: 'namespace',
			nodes: [
				{ id: 'dashboard', label: 'Dashboard', sub: 'dashboard.lab.internal', workloads: ['dashboard/dashboard'], href: '/', info: 'This page (SvelteKit). Gathers everything server-side: Prometheus for network and server status, go2rtc for camera pictures and live video, presence, workouts, the cabin camera\'s uploads, Protect\'s events and clips, and weather, calendar and parcels from the internet.' }
			]
		},
		{
			id: 'news',
			label: 'news',
			kind: 'namespace',
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
			nodes: [
				{ id: 'workweb', label: 'Web', sub: 'workout.lab.internal', workloads: ['workout/web'], href: 'http://workout.lab.internal', info: 'Workout log; also gives the dashboard this week\'s summary (bearer token).' },
				{ id: 'workpg', label: 'Postgres', sub: 'workouts', workloads: ['workout/postgres'], info: 'Postgres for workouts; only the web pod may connect. Dumped nightly by the backup.' }
			]
		},
		{
			id: 'homeassistant',
			label: 'homeassistant',
			kind: 'namespace',
			nodes: [
				{ id: 'ha', label: 'Home Assistant', sub: 'host network', workloads: ['homeassistant/homeassistant'], href: 'http://homeassistant.lab.internal', info: 'Devices, automations and notifications. Runs on the host network so it can discover devices on the LAN (mDNS); its UI is reached through Traefik only. Uses Mosquitto for MQTT devices.' }
			]
		},
		{
			id: 'go2rtc',
			label: 'go2rtc',
			kind: 'namespace',
			nodes: [
				{ id: 'go2rtc', label: 'go2rtc', sub: 'camera streams', workloads: ['go2rtc/go2rtc'], info: 'Repackages Protect\'s RTSPS streams for browsers without transcoding: still frames for the camera tiles, live video over WebSocket. Only the dashboard may connect; it connects to Protect only while someone watches.' }
			]
		},
		{
			id: 'cabin-camera',
			label: 'cabin-camera',
			kind: 'namespace',
			nodes: [
				{ id: 'cabinftp', label: 'FTPS server', sub: 'SFTPGo · from the internet', workloads: ['cabin-camera/cabin-camera'], info: 'Receives the cabin camera\'s uploads: FTPS only, upload-only account, IP bans after failed logins. The homelab\'s only service reachable from the internet.' },
				{ id: 'cabinsnap', label: 'Snapshot service', sub: 'pictures and clips', workloads: ['cabin-camera/cabin-camera'], info: 'Lists and serves the uploaded pictures and clips to the dashboard (same pod as the FTPS server, shared volume) and deletes files older than 30 days.' }
			]
		},
		{
			id: 'presence',
			label: 'presence',
			kind: 'namespace',
			nodes: [
				{ id: 'presence', label: 'presence', sub: 'who is home', workloads: ['presence/presence'], info: 'Decides who is home from Wi-Fi (phones connected, via UnPoller\'s data in Prometheus) and Bluetooth (ESPresense sightings over MQTT).' }
			]
		},
		{
			id: 'mosquitto',
			label: 'mosquitto',
			kind: 'namespace',
			nodes: [
				{ id: 'mosquitto', label: 'Mosquitto', sub: 'MQTT broker :1883', workloads: ['mosquitto/mosquitto'], info: 'MQTT broker for the ESPresense nodes, presence and Home Assistant. Password logins and per-user topic rules; reachable from the LAN only.' }
			]
		},
		{
			id: 'monitoring',
			label: 'monitoring',
			kind: 'namespace',
			nodes: [
				{ id: 'prometheus', label: 'Prometheus', sub: 'prometheus.lab.internal', workloads: ['monitoring/prometheus-kube-prometheus-stack-prometheus'], href: 'http://prometheus.lab.internal', info: 'Collects metrics every 30 s (15 days kept): server, Kubernetes objects, network (UnPoller), Traefik, presence. The dashboard and presence query it.' },
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
			nodes: [
				{ id: 'unpoller', label: 'UnPoller', sub: 'UniFi → metrics', workloads: ['unpoller/unpoller'], info: 'Reads the UDM Pro\'s statistics every 10 s with a read-only account (WAN traffic, clients, access points, speed tests) and exposes them to Prometheus.' }
			]
		},
		{
			id: 'headlamp',
			label: 'headlamp',
			kind: 'namespace',
			nodes: [
				{ id: 'headlamp', label: 'Headlamp', sub: 'kube.lab.internal', workloads: ['headlamp/headlamp'], href: 'http://kube.lab.internal', info: 'Kubernetes web UI; log in with a token.' }
			]
		},
		{
			id: 'lists',
			label: 'lists',
			kind: 'namespace',
			nodes: [
				{ id: 'listsweb', label: 'Web', sub: 'lists.lab.internal', workloads: ['lists/web'], href: 'http://lists.lab.internal', info: 'Lists of things done, watched or wanted (watched movies, movies to watch, …): any number of lists, each with the item fields it needs (people, date, service, link, note). Gives the dashboard the lists marked "Show on dashboard" (bearer token).' },
				{ id: 'listspg', label: 'Postgres', sub: 'lists, items', workloads: ['lists/postgres'], info: 'Postgres for lists; only the web pod may connect. Dumped nightly by the backup.' }
			]
		},
		{
			id: 'backup',
			label: 'backup',
			kind: 'namespace',
			nodes: [
				{ id: 'backup', label: 'Backup', sub: 'nightly 03:30 · restic', workloads: ['backup/backup'], info: 'CronJob: dumps the Postgres databases (exec through the API), copies every volume and the secrets, encrypts with restic and uploads to Google Drive through rclone. Keeps 7 daily, 5 weekly, 12 monthly.' }
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
		{ from: 'dashboard', to: 'prometheus', label: 'network, server, backup status', kind: 'metrics' },
		{ from: 'dashboard', to: 'go2rtc', label: 'pictures, live video', kind: 'video' },
		{ from: 'dashboard', to: 'presence', label: 'who is home', kind: 'web' },
		{ from: 'dashboard', to: 'workweb', label: 'week\'s workouts', kind: 'web' },
		{ from: 'dashboard', to: 'cabinsnap', label: 'cabin pictures, clips', kind: 'video' },
		{ from: 'dashboard', to: 'udm', label: 'Protect events, clips', kind: 'video' },
		{ from: 'dashboard', to: 'internet', label: 'weather, calendar, parcels', kind: 'internet' },
		{ from: 'go2rtc', to: 'udm', label: 'RTSPS :7441', kind: 'video' },
		{ from: 'cabinftp', to: 'cabinsnap', label: 'shared volume', kind: 'data' },
		{ from: 'newsweb', to: 'newspg', label: 'SQL', kind: 'data' },
		{ from: 'newsworker', to: 'newspg', label: 'SQL', kind: 'data' },
		{ from: 'newsworker', to: 'internet', label: 'outlets, AI classification', kind: 'internet' },
		{ from: 'workweb', to: 'workpg', label: 'SQL', kind: 'data' },
		{ from: 'traefik', to: 'listsweb', label: 'lists.lab.internal', kind: 'web' },
		{ from: 'dashboard', to: 'listsweb', label: 'lists on the dashboard', kind: 'web' },
		{ from: 'listsweb', to: 'listspg', label: 'SQL', kind: 'data' },
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
				{ id: 'n-family', label: 'Family devices', sub: 'iPad, phones, laptops', info: 'Open the web UIs by name: the UDM\'s DNS answers 192.168.1.10, Traefik routes by host name. kubectl uses the API on port 6443.' },
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
				{ id: 'n-deny', label: 'Default deny', sub: 'news, workout, lists', info: 'All traffic blocked except the listed paths: Traefik to web, web (and worker) to Postgres, DNS, the dashboard to workout and lists, and the news worker to the internet on 80/443 (not the LAN).' },
				{ id: 'n-limited', label: 'Limited', sub: 'go2rtc, presence, cabin-camera, mosquitto, backup', info: 'go2rtc accepts only the dashboard; presence only the dashboard and Prometheus; Mosquitto only the LAN, presence and the server itself; cabin-camera\'s snapshot service only the dashboard; the backup may reach DNS, the API and the internet on 443 only.' },
				{ id: 'n-open', label: 'No policy', sub: 'dashboard, monitoring, kube-system, …', info: 'dashboard, monitoring, headlamp, unpoller and kube-system have no NetworkPolicy; Home Assistant and node-exporter are on the host network, where policies do not apply.' }
			]
		}
	],
	edges: [
		{ from: 'n-internet', to: 'n-wan', label: 'public address', kind: 'internet' },
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
		{ from: 'n-egress', to: 'n-wan', label: 'to the internet', kind: 'internet' },
		{ from: 'n-egress', to: 'n-protect', label: 'RTSPS, Protect and UniFi API', kind: 'video' },
		{ from: 'n-hostnet', to: 'n-smart', label: 'mDNS discovery', kind: 'control' },
		{ from: 'n-trusted', to: 'n-hostnet', label: 'pods ↔ host', kind: 'control' }
	]
};

/** Live state of one workload from Prometheus (GET /api/architecture). */
export interface WorkloadStatus {
	kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'CronJob';
	pods: { name: string; ready: boolean; phase: string; restarts24h: number; cpu: number | null; memory: number | null }[];
	/** CronJob: last successful run, unix ms. */
	lastSuccess?: number | null;
}

export interface ArchitectureData {
	/** Keyed "namespace/name". */
	workloads: Record<string, WorkloadStatus>;
	updatedAt: number;
}

/** The workloads in `data` that a node's patterns match. */
export function nodeWorkloads(node: DiagramNode, data: ArchitectureData | null): [string, WorkloadStatus][] {
	if (!data || !node.workloads) return [];
	return Object.entries(data.workloads).filter(([key]) =>
		node.workloads!.some((p) => (p.endsWith('*') ? key.startsWith(p.slice(0, -1)) : key === p))
	);
}

/** Workloads running in the cluster that no node of `diagram` claims: the diagram needs updating. */
export function unmodelled(diagram: Diagram, data: ArchitectureData | null): string[] {
	if (!data) return [];
	const patterns = diagram.groups.flatMap((g) => g.nodes.flatMap((n) => n.workloads ?? []));
	return Object.keys(data.workloads)
		.filter((key) => !patterns.some((p) => (p.endsWith('*') ? key.startsWith(p.slice(0, -1)) : key === p)))
		.sort();
}
