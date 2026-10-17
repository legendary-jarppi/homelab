// Settings from the environment (ConfigMap presence-config, secret presence-mqtt) and the people file
// (secret presence-people).
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const env = process.env;

function positive(name: string, fallback: number): number {
	const value = Number(env[name] ?? fallback);
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
	return value;
}

export interface Site {
	/** In the API and metrics ("home", "cabin"); never "away". */
	id: string;
	/** Shown on the dashboard ("Home", "Cabin"). */
	label: string;
	/** UnPoller's `source` label for the site's UniFi console. */
	unifiSource: string;
}

/** SITES="home:Home:https://192.168.1.1,cabin:Cabin:https://192.168.20.1"; the first is home (the ESPresense nodes are there). */
function parseSites(raw: string): Site[] {
	const sites = raw
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry): Site => {
			const [id, label, ...url] = entry.split(':');
			const site = { id: id?.trim() ?? '', label: label?.trim() ?? '', unifiSource: url.join(':').trim() };
			if (!/^[a-z0-9-]{1,32}$/.test(site.id) || site.id === 'away' || !site.label || !/^https?:\/\//.test(site.unifiSource)) {
				throw new Error(`SITES: "${entry}" is not id:Label:https://console`);
			}
			return site;
		});
	if (sites.length === 0) throw new Error('SITES lists no site');
	if (new Set(sites.map((s) => s.id)).size !== sites.length) throw new Error('SITES lists a site twice');
	return sites;
}

export const config = {
	port: positive('PORT', 8080),
	prometheusUrl: env.PROMETHEUS_URL ?? 'http://kube-prometheus-stack-prometheus.monitoring.svc:9090',
	sites: parseSites(env.SITES ?? 'home:Home:https://192.168.1.1'),
	peopleFile: env.PEOPLE_FILE ?? '/etc/presence/people.json',
	/** Unseen this long by every source: away. Phones drop off Wi-Fi briefly now and then. */
	awayAfterS: positive('AWAY_AFTER_MIN', 10) * 60,
	pollS: positive('POLL_S', 30),
	/** Wi-Fi history read at start to restore "home since" / "last seen". */
	historyDays: positive('HISTORY_DAYS', 7),
	/** Mosquitto, where ESPresense nodes publish Bluetooth sightings; empty: no Bluetooth source. */
	mqttUrl: env.MQTT_URL ?? '',
	mqttUsername: env.MQTT_USERNAME ?? '',
	mqttPassword: env.MQTT_PASSWORD ?? ''
};

/** Lower case with colons, as UniFi reports it. */
const Mac = z
	.string()
	.transform((s) => s.trim().toLowerCase().replaceAll('-', ':'))
	.pipe(z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/, 'not a MAC address'));
/** The name given when enrolling the phone on an ESPresense node ("jari-iphone"); compared in lower case. */
const BleId = z
	.string()
	.transform((s) => s.trim().toLowerCase())
	.pipe(z.string().regex(/^[a-z0-9][a-z0-9:_.-]{0,63}$/, 'not an ESPresense device id'));

const PersonSchema = z
	.object({
		/** Stable key for the API and metrics ("jari"). */
		id: z.string().regex(/^[a-z0-9-]{1,32}$/),
		/** Shown on the dashboard ("Jari"). */
		name: z.string().trim().min(1),
		wifi: z.array(Mac).default([]),
		ble: z.array(BleId).default([])
	})
	.refine((p) => p.wifi.length + p.ble.length > 0, 'list at least one wifi or ble device');

export type Person = z.infer<typeof PersonSchema>;

const People = z
	.array(PersonSchema)
	.min(1)
	.superRefine((people, ctx) => {
		const seen = new Set<string>();
		for (const key of people.flatMap((p) => [`id ${p.id}`, ...p.wifi.map((m) => `MAC ${m}`), ...p.ble.map((b) => `ble ${b}`)])) {
			if (seen.has(key)) ctx.addIssue({ code: 'custom', message: `${key} listed twice` });
			seen.add(key);
		}
	});

/** `[{ "id": "alice", "name": "Alice", "wifi": ["aa:bb:cc:dd:ee:01"], "ble": ["alice-iphone"] }, …]`; throws on anything malformed. */
export function loadPeople(file: string): Person[] {
	const parsed = People.safeParse(JSON.parse(readFileSync(file, 'utf8')));
	if (!parsed.success) throw new Error(`${file}:\n${z.prettifyError(parsed.error)}`);
	return parsed.data;
}
