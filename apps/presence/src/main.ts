// Presence service: who is home, from Wi-Fi (UniFi via Prometheus) and, when MQTT_URL is set,
// Bluetooth (ESPresense nodes via Mosquitto). Cluster-internal:
//   GET /api/presence  people with home/away, since, last seen; source health; Bluetooth nodes
//   GET /metrics       Prometheus metrics (presence_home{person} …)
//   GET /healthz       ready once the state has been restored from history
import { createServer } from 'node:http';
import { startBle } from './ble.ts';
import { config, loadPeople } from './config.ts';
import { Presence, type PersonState, type Source } from './presence.ts';
import { connectedHistory, connectedNow, historyStart } from './wifi.ts';

const people = loadPeople(config.peopleFile);
const allMacs = people.flatMap((p) => p.wifi);
/** ESPresense device id → person id. */
const bleOwner = new Map(people.flatMap((p) => p.ble.map((id) => [id, p.id] as const)));
const sources: Source[] = config.mqttUrl ? ['wifi', 'ble'] : ['wifi'];
const nowS = () => Date.now() / 1000;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

const presence = new Presence(people, sources, config.awayAfterS, (person, s: PersonState) =>
	console.log(`${person.id} ${s.home ? 'home' : 'away'} (${s.via ?? 'no sighting'})`)
);
/** ESPresense nodes by room, from their retained status. */
const nodes = new Map<string, boolean>();
let ready = false;

async function restore(): Promise<void> {
	try {
		const now = nowS();
		const [history, start] = await Promise.all([connectedHistory(allMacs, config.historyDays, now), historyStart(config.historyDays, now)]);
		for (const p of people) presence.restore(p.id, p.wifi.flatMap((mac) => history.get(mac) ?? []), 'wifi', now, start);
		console.log(`restored from Wi-Fi history since ${start === null ? 'nothing' : new Date(start * 1000).toISOString()}`);
	} catch (e) {
		// Not fatal: the first successful poll sets everyone home/away, without "since" for those away.
		console.error(`restore failed: ${errorText(e)}`);
	}
}

/** Wi-Fi sightings, then the away decisions (Bluetooth sightings arrive on their own). */
async function poll(): Promise<void> {
	try {
		const macs = await connectedNow(allMacs);
		const now = nowS();
		for (const p of people) if (p.wifi.some((m) => macs.has(m))) presence.sighting(p.id, 'wifi', now);
		presence.answered('wifi', now);
		presence.evaluate(now);
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
				if (owner) presence.sighting(owner, 'ble', now);
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
		sources: presence.sources,
		...(stopBle ? { nodes: [...nodes].map(([room, online]) => ({ room, online })) } : {}),
		awayAfterS: config.awayAfterS,
		updatedAt: Date.now()
	};
}

function metrics(): string {
	const lines = [
		'# HELP presence_home 1 when the person is home, 0 when away; absent while unknown.',
		'# TYPE presence_home gauge',
		...people.flatMap((p) => {
			const s = presence.state.get(p.id);
			return s?.home === null || s === undefined ? [] : [`presence_home{person="${p.id}"} ${s.home ? 1 : 0}`];
		}),
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
