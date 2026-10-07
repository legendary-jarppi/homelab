// Settings from the environment (ConfigMap presence-config) and the people file (secret presence-people).
import { readFileSync } from 'node:fs';

export interface Person {
	/** Stable key for the API and metrics ("jari"). */
	id: string;
	/** Shown on the dashboard ("Jari"). */
	name: string;
	/** Wi-Fi MAC addresses as UniFi reports them (lower case, colons). */
	wifi: string[];
}

const env = process.env;

function positive(name: string, fallback: number): number {
	const value = Number(env[name] ?? fallback);
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
	return value;
}

export const config = {
	port: positive('PORT', 8080),
	prometheusUrl: env.PROMETHEUS_URL ?? 'http://kube-prometheus-stack-prometheus.monitoring.svc:9090',
	/** UnPoller's `source` label of the home UniFi controller. */
	unifiSource: env.UNIFI_SOURCE ?? 'https://192.168.1.1',
	peopleFile: env.PEOPLE_FILE ?? '/etc/presence/people.json',
	/** Unseen this long by every source: away. Phones drop off Wi-Fi briefly now and then. */
	awayAfterS: positive('AWAY_AFTER_MIN', 10) * 60,
	pollS: positive('POLL_S', 30),
	/** Wi-Fi history read at start to restore "home since" / "last seen". */
	historyDays: positive('HISTORY_DAYS', 7)
};

const ID = /^[a-z0-9-]{1,32}$/;
const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

/** `[{ "id": "alice", "name": "Alice", "wifi": ["aa:bb:cc:dd:ee:01"] }, …]`; throws on anything malformed. */
export function loadPeople(file: string): Person[] {
	const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
	if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${file}: expected a non-empty JSON array of people`);
	const ids = new Set<string>();
	const macs = new Set<string>();
	return raw.map((entry: unknown, i): Person => {
		const p = entry as Partial<Record<keyof Person, unknown>>;
		const where = `${file}[${i}]`;
		if (typeof p.id !== 'string' || !ID.test(p.id)) throw new Error(`${where}: id must match ${ID}`);
		if (ids.has(p.id)) throw new Error(`${where}: duplicate id ${p.id}`);
		ids.add(p.id);
		if (typeof p.name !== 'string' || p.name.trim() === '') throw new Error(`${where}: name missing`);
		if (!Array.isArray(p.wifi) || p.wifi.length === 0) throw new Error(`${where}: wifi must list at least one MAC address`);
		const wifi = p.wifi.map((m: unknown) => {
			const mac = typeof m === 'string' ? m.trim().toLowerCase().replaceAll('-', ':') : '';
			if (!MAC.test(mac)) throw new Error(`${where}: bad MAC address ${JSON.stringify(m)}`);
			if (macs.has(mac)) throw new Error(`${where}: MAC ${mac} listed twice`);
			macs.add(mac);
			return mac;
		});
		return { id: p.id, name: p.name.trim(), wifi };
	});
}
