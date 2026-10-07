// Presence service: who is home, from Wi-Fi (UniFi via Prometheus). Cluster-internal:
//   GET /api/presence  people with home/away, since, last seen; source health
//   GET /metrics       Prometheus metrics (presence_home{person} …)
//   GET /healthz       ready once the state has been restored from history
import { createServer } from 'node:http';
import { config, loadPeople } from './config.ts';
import { Presence, type PersonState } from './presence.ts';
import { connectedHistory, connectedNow, historyStart } from './wifi.ts';

const people = loadPeople(config.peopleFile);
const allMacs = people.flatMap((p) => p.wifi);
const nowS = () => Date.now() / 1000;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

const presence = new Presence(people, config.awayAfterS, (person, s: PersonState) =>
	console.log(`${person.id} ${s.home ? 'home' : 'away'}`)
);
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

async function poll(): Promise<void> {
	try {
		const macs = await connectedNow(allMacs);
		presence.observe('wifi', new Set(people.filter((p) => p.wifi.some((m) => macs.has(m))).map((p) => p.id)), nowS());
	} catch (e) {
		const error = errorText(e);
		if (presence.sources.wifi.ok || presence.sources.wifi.lastOk === null) console.error(`wifi poll failed: ${error}`);
		presence.failed('wifi', error);
	}
}

function body() {
	return {
		people: people.map((p) => ({ id: p.id, name: p.name, ...presence.state.get(p.id) })),
		sources: presence.sources,
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
		'# HELP presence_last_seen_timestamp_seconds Last sighting of any of the person\'s devices.',
		'# TYPE presence_last_seen_timestamp_seconds gauge',
		...people.flatMap((p) => {
			const t = presence.state.get(p.id)?.lastSeen;
			return t == null ? [] : [`presence_last_seen_timestamp_seconds{person="${p.id}"} ${Math.round(t)}`];
		}),
		'# HELP presence_source_up 1 when the source answered at its last poll.',
		'# TYPE presence_source_up gauge',
		...Object.entries(presence.sources).map(([name, s]) => `presence_source_up{source="${name}"} ${s.ok ? 1 : 0}`)
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

server.listen(config.port, () => console.log(`presence: ${people.length} people, listening on :${config.port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));

await restore();
await poll();
ready = true;
setInterval(poll, config.pollS * 1000);
