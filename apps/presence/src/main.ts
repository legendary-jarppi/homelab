// Presence service: where everyone is (a site such as home or the cabin, or away), from Wi-Fi (each
// site's UniFi console via Prometheus) and, when MQTT_URL is set, Bluetooth (ESPresense nodes at
// home via Mosquitto). Cluster-internal:
//   GET /api/presence  people with place, since, last seen; sites and sources with their health; Bluetooth nodes
//   GET /metrics       Prometheus metrics (presence_place{person,place} …)
//   GET /healthz       ready once the state has been restored from history
import { createServer } from 'node:http';
import { startBle } from './ble.ts';
import { config, loadPeople } from './config.ts';
import { Presence, type PersonState, type Source } from './presence.ts';
import { connectedNow, history } from './wifi.ts';

const people = loadPeople(config.peopleFile);
const allMacs = people.flatMap((p) => p.wifi);
/** ESPresense device id → person id. */
const bleOwner = new Map(people.flatMap((p) => p.ble.map((id) => [id, p.id] as const)));
/** The ESPresense nodes are at home, the first site. */
const bleSite = config.sites[0].id;
const sources: Source[] = config.mqttUrl ? ['wifi', 'ble'] : ['wifi'];
const nowS = () => Date.now() / 1000;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

const presence = new Presence(people, sources, config.awayAfterS, (person, s: PersonState) =>
	console.log(`${person.id} ${s.place}${s.stale ? ' (not reporting)' : ''} (${s.via ?? 'no sighting'})`)
);
/** Per site: reporting at the last Wi-Fi poll, and when it last was. */
const sites = new Map(config.sites.map((s) => [s.id, { ok: false, lastOk: null as number | null }]));
/** ESPresense nodes by room, from their retained status. */
const nodes = new Map<string, boolean>();
let ready = false;

async function restore(): Promise<void> {
	try {
		const now = nowS();
		const h = await history(allMacs, config.historyDays, now);
		for (const p of people) presence.restore(p.id, p.wifi.flatMap((mac) => h.connected.get(mac) ?? []), 'wifi', now, h.dataFrom, h.dataUntil);
		const from = [...h.dataFrom].map(([site, t]) => `${site} since ${new Date(t * 1000).toISOString()}`);
		console.log(`restored from Wi-Fi history: ${from.join(', ') || 'no data'}`);
	} catch (e) {
		// Not fatal: the first successful poll places everyone, without "since" for those away.
		console.error(`restore failed: ${errorText(e)}`);
	}
}

/** Wi-Fi sightings per site, then the away decisions (Bluetooth sightings arrive on their own). */
async function poll(): Promise<void> {
	try {
		const bySite = await connectedNow(allMacs);
		const now = nowS();
		const reporting = new Set<string>();
		for (const site of config.sites) {
			const answer = bySite.get(site.id);
			const state = sites.get(site.id);
			if (!answer || !state) continue;
			if (state.ok !== answer.reporting && state.lastOk !== null) console.log(`site ${site.id} ${answer.reporting ? 'reporting again' : 'not reporting'}`);
			state.ok = answer.reporting;
			if (answer.reporting) {
				state.lastOk = now;
				reporting.add(site.id);
			}
			for (const p of people) if (p.wifi.some((m) => answer.macs.has(m))) presence.sighting(p.id, site.id, 'wifi', now);
		}
		presence.answered('wifi', now);
		presence.evaluate(now, reporting);
	} catch (e) {
		const error = errorText(e);
		const wifi = presence.sources.wifi;
		// Log the first failure and the switch from working to failing, not every retry.
		if (!wifi || wifi.ok || wifi.lastOk === null) console.error(`wifi poll failed: ${error}`);
		presence.failed('wifi', error);
	}
}

const stopBle = config.mqttUrl
	? startBle(config.mqttUrl, config.mqttUsername, config.mqttPassword, {
			sighting(deviceId, room) {
				const now = nowS();
				presence.answered('ble', now);
				const owner = bleOwner.get(deviceId.toLowerCase());
				// Everything else in range (neighbours' phones, speakers, …) is ignored.
				if (owner) presence.sighting(owner, bleSite, 'ble', now);
			},
			node(room, online) {
				if (nodes.get(room) !== online) console.log(`ble node ${room} ${online ? 'online' : 'offline'}`);
				nodes.set(room, online);
			},
			up() {
				console.log(`ble: connected to ${config.mqttUrl}`);
				presence.answered('ble', nowS());
			},
			down(error) {
				if (presence.sources.ble?.ok) console.error(`ble: ${error}`);
				presence.failed('ble', error);
			}
		})
	: null;

function body() {
	return {
		people: people.map((p) => ({ id: p.id, name: p.name, ...presence.state.get(p.id) })),
		sites: config.sites.map((s) => ({ id: s.id, label: s.label, ...sites.get(s.id) })),
		sources: presence.sources,
		...(stopBle ? { nodes: [...nodes].map(([room, online]) => ({ room, online })) } : {}),
		awayAfterS: config.awayAfterS,
		updatedAt: Date.now()
	};
}

function metrics(): string {
	const lines = [
		'# HELP presence_place 1 for where the person is (a site id or "away"); absent while unknown.',
		'# TYPE presence_place gauge',
		...people.flatMap((p) => {
			const place = presence.state.get(p.id)?.place;
			return place == null ? [] : [`presence_place{person="${p.id}",place="${place}"} 1`];
		}),
		'# HELP presence_site_up 1 when the site\'s UniFi console reported clients at the last Wi-Fi poll.',
		'# TYPE presence_site_up gauge',
		...[...sites].map(([id, s]) => `presence_site_up{site="${id}"} ${s.ok ? 1 : 0}`),
		"# HELP presence_last_seen_timestamp_seconds Last sighting of any of the person's devices.",
		'# TYPE presence_last_seen_timestamp_seconds gauge',
		...people.flatMap((p) => {
			const t = presence.state.get(p.id)?.lastSeen;
			return t == null ? [] : [`presence_last_seen_timestamp_seconds{person="${p.id}"} ${Math.round(t)}`];
		}),
		'# HELP presence_source_up 1 when the source answered at its last poll (Wi-Fi) or is connected (Bluetooth).',
		'# TYPE presence_source_up gauge',
		...Object.entries(presence.sources).map(([name, s]) => `presence_source_up{source="${name}"} ${s.ok ? 1 : 0}`),
		'# HELP presence_ble_node_up 1 when the ESPresense node in the room reports online.',
		'# TYPE presence_ble_node_up gauge',
		...[...nodes].map(([room, online]) => `presence_ble_node_up{room="${room}"} ${online ? 1 : 0}`)
	];
	return lines.join('\n') + '\n';
}

const server = createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://localhost');
	const send = (status: number, type: string, text: string) => {
		res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(text);
	};
	if (req.method !== 'GET') return send(405, 'text/plain', 'method not allowed\n');
	if (url.pathname === '/api/presence') return send(200, 'application/json', JSON.stringify(body()));
	if (url.pathname === '/metrics') return send(200, 'text/plain; version=0.0.4', metrics());
	if (url.pathname === '/healthz') return send(ready ? 200 : 503, 'text/plain', ready ? 'ok\n' : 'starting\n');
	send(404, 'text/plain', 'not found\n');
});

server.listen(config.port, () => console.log(`presence: ${people.length} people, sources ${sources.join(', ')}, listening on :${config.port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	process.on(signal, () => {
		void stopBle?.();
		server.close(() => process.exit(0));
	});
}

await restore();
await poll();
ready = true;
setInterval(poll, config.pollS * 1000);
