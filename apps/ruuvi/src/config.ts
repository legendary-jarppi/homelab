// Settings from the environment (ConfigMap ruuvi-config, secret ruuvi-mqtt).
const env = process.env;

function positive(name: string, fallback: number): number {
	const value = Number(env[name] ?? fallback);
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
	return value;
}

/** Upper case with colons, as the gateway writes MACs in its topics. */
export function normalizeMac(raw: string): string | null {
	const mac = raw.trim().toUpperCase().replaceAll('-', ':');
	return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) ? mac : null;
}

/** TAGS="C9:3A:12:4B:5C:6D=Sauna,E2:01:7F:AA:10:42=Lake"; tags not listed are named by their MAC. */
export function parseTags(raw: string): Map<string, string> {
	const tags = new Map<string, string>();
	for (const entry of raw.split(',').map((e) => e.trim()).filter(Boolean)) {
		const eq = entry.indexOf('=');
		const mac = normalizeMac(eq < 0 ? '' : entry.slice(0, eq));
		const name = entry.slice(eq + 1).trim();
		if (!mac || !name) throw new Error(`TAGS: "${entry}" is not MAC=Name`);
		if (tags.has(mac)) throw new Error(`TAGS: ${mac} listed twice`);
		tags.set(mac, name);
	}
	return tags;
}

export const config = {
	port: positive('PORT', 8080),
	/** Mosquitto, where the Ruuvi Gateway publishes. */
	mqttUrl: env.MQTT_URL || 'mqtt://mosquitto.mosquitto.svc:1883',
	mqttUsername: env.MQTT_USERNAME ?? '',
	mqttPassword: env.MQTT_PASSWORD ?? '',
	tags: parseTags(env.TAGS ?? ''),
	/** A tag unheard this long has its readings dropped from /metrics (its last-seen time stays). */
	staleAfterS: positive('STALE_AFTER_MIN', 10) * 60
};
