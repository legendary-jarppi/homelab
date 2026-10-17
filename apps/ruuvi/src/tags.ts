// Latest reading per RuuviTag, from the Ruuvi Gateway's MQTT messages with "decoded" data (gateway
// firmware 1.15+): one JSON object per Bluetooth advertisement, for example
//   { "gw_mac": "C8:25:2D:8E:9C:2C", "rssi": -62, "gwts": 1760700000, "ts": 1760699999, "coords": "",
//     "dataFormat": 5, "temperature": 21.345, "humidity": 41.25, "pressure": 100412, "accelX": 0.004,
//     "accelY": -0.004, "accelZ": 1.036, "movementCounter": 66, "voltage": 2.977, "txPower": 4,
//     "measurementSequenceNumber": 205, "id": "CB:B8:33:4C:88:4F" }
// A value the tag reports as not available is null.

/** Decoded field → metric. The axis label splits the acceleration fields into one metric. */
const FIELDS: { field: string; metric: string; axis?: string }[] = [
	{ field: 'temperature', metric: 'ruuvi_temperature_celsius' },
	{ field: 'humidity', metric: 'ruuvi_humidity_percent' },
	{ field: 'pressure', metric: 'ruuvi_pressure_pascals' },
	{ field: 'voltage', metric: 'ruuvi_battery_volts' },
	{ field: 'accelX', metric: 'ruuvi_acceleration_g', axis: 'x' },
	{ field: 'accelY', metric: 'ruuvi_acceleration_g', axis: 'y' },
	{ field: 'accelZ', metric: 'ruuvi_acceleration_g', axis: 'z' },
	{ field: 'movementCounter', metric: 'ruuvi_movement_counter' },
	{ field: 'txPower', metric: 'ruuvi_tx_power_dbm' },
	{ field: 'rssi', metric: 'ruuvi_rssi_dbm' }
];

const HELP: Record<string, string> = {
	ruuvi_temperature_celsius: 'Temperature.',
	ruuvi_humidity_percent: 'Relative humidity.',
	ruuvi_pressure_pascals: 'Air pressure.',
	ruuvi_battery_volts: 'Battery voltage.',
	ruuvi_acceleration_g: 'Acceleration per axis; about 1 g down when the tag is at rest.',
	ruuvi_movement_counter: 'Movements detected by the accelerometer; wraps around after 254.',
	ruuvi_tx_power_dbm: "The tag's transmit power.",
	ruuvi_rssi_dbm: 'Signal strength of the tag at the gateway.'
};

export interface Tag {
	mac: string;
	/** Decoded field → value, from the latest message. */
	values: Map<string, number>;
	/** Unix seconds. */
	lastSeen: number;
}

export type Update = 'new' | 'updated' | 'not-decoded' | 'invalid';

export class Tags {
	readonly tags = new Map<string, Tag>();
	/** Gateway MAC → online, from its retained gw_status. */
	readonly gateways = new Map<string, boolean>();
	mqttUp = false;

	private readonly names: Map<string, string>;
	private readonly staleAfterS: number;

	constructor(names: Map<string, string>, staleAfterS: number) {
		this.names = names;
		this.staleAfterS = staleAfterS;
	}

	name(mac: string): string {
		return this.names.get(mac) ?? mac;
	}

	/** One message on ruuvi/<gateway>/<tag MAC>. */
	update(mac: string, payload: string, now: number): Update {
		let body: unknown;
		try {
			body = JSON.parse(payload);
		} catch {
			return 'invalid';
		}
		if (body === null || typeof body !== 'object') return 'invalid';
		const message = body as Record<string, unknown>;
		// Gateway set to raw data only: just the advertisement as hex.
		if (!('dataFormat' in message)) return 'not-decoded';
		const values = new Map<string, number>();
		for (const { field } of FIELDS) {
			const value = message[field];
			if (typeof value === 'number' && Number.isFinite(value)) values.set(field, value);
		}
		const known = this.tags.has(mac);
		this.tags.set(mac, { mac, values, lastSeen: now });
		return known ? 'updated' : 'new';
	}

	metrics(now: number): string {
		const lines: string[] = [];
		const fresh = [...this.tags.values()].filter((t) => now - t.lastSeen <= this.staleAfterS);
		for (const metric of new Set(FIELDS.map((f) => f.metric))) {
			lines.push(`# HELP ${metric} ${HELP[metric]}`, `# TYPE ${metric} gauge`);
			for (const tag of fresh) {
				for (const f of FIELDS) {
					const value = f.metric === metric ? tag.values.get(f.field) : undefined;
					if (value === undefined) continue;
					lines.push(`${metric}{${this.labels(tag.mac)}${f.axis ? `,axis="${f.axis}"` : ''}} ${value}`);
				}
			}
		}
		lines.push(
			'# HELP ruuvi_last_seen_timestamp_seconds Last message from the tag (kept after its readings go stale).',
			'# TYPE ruuvi_last_seen_timestamp_seconds gauge',
			...[...this.tags.values()].map((t) => `ruuvi_last_seen_timestamp_seconds{${this.labels(t.mac)}} ${t.lastSeen}`),
			'# HELP ruuvi_gateway_up 1 while the Ruuvi Gateway reports online to the broker (its last will says offline).',
			'# TYPE ruuvi_gateway_up gauge',
			...[...this.gateways].map(([mac, up]) => `ruuvi_gateway_up{gateway="${mac}"} ${up ? 1 : 0}`),
			'# HELP ruuvi_mqtt_up 1 while connected and subscribed to the broker.',
			'# TYPE ruuvi_mqtt_up gauge',
			`ruuvi_mqtt_up ${this.mqttUp ? 1 : 0}`
		);
		return lines.join('\n') + '\n';
	}

	private labels(mac: string): string {
		return `mac="${mac}",name="${escapeLabel(this.name(mac))}"`;
	}
}

function escapeLabel(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}
