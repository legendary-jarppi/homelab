// Bluetooth source: ESPresense nodes (ESP32 boards) recognise enrolled iPhones by their identity
// key (IRK), whatever Bluetooth address the phone is using, and report them to MQTT:
//   espresense/devices/<id>/<room>   JSON per sighting ({ "distance": 1.2, "rssi": -60, … })
//   espresense/rooms/<room>/status   online / offline (retained; offline is the node's last will)
// <id> is the name given when enrolling the phone on a node ("jari-iphone").
import mqtt from 'mqtt';

export interface BleHandlers {
	sighting(deviceId: string, room: string, distance: number | null): void;
	node(room: string, online: boolean): void;
	up(): void;
	down(error: string): void;
}

export function startBle(url: string, username: string, password: string, on: BleHandlers): () => Promise<void> {
	const client = mqtt.connect(url, {
		username,
		password,
		clientId: `presence-${process.pid}`,
		clean: true,
		reconnectPeriod: 5_000,
		connectTimeout: 10_000
	});
	client.on('connect', () => {
		client.subscribe(['espresense/devices/+/+', 'espresense/rooms/+/status'], { qos: 0 }, (err) =>
			err ? on.down(`subscribe: ${err.message}`) : on.up()
		);
	});
	client.on('close', () => on.down('disconnected'));
	client.on('error', (err) => on.down(err.message));
	client.on('message', (topic, payload) => {
		const [, kind, a, b] = topic.split('/');
		if (kind === 'devices' && a && b) on.sighting(a, b, distanceOf(payload));
		else if (kind === 'rooms' && a && b === 'status') on.node(a, payload.toString() === 'online');
	});
	return () => client.endAsync();
}

/** The node's distance estimate in metres; a sighting without a readable one still counts. */
function distanceOf(payload: Buffer): number | null {
	let body: unknown;
	try {
		body = JSON.parse(payload.toString());
	} catch {
		return null;
	}
	if (body !== null && typeof body === 'object' && 'distance' in body && typeof body.distance === 'number' && Number.isFinite(body.distance)) {
		return body.distance;
	}
	return null;
}
