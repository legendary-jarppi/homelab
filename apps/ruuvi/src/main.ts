// RuuviTag readings for Prometheus: the cabin's Ruuvi Gateway relays every tag it hears to Mosquitto
// (platform/components/mosquitto), this service keeps the latest reading per tag. Cluster-internal:
//   GET /metrics   ruuvi_temperature_celsius{mac,name} …, scraped by Prometheus
//   GET /healthz   200 while running
// Topics (the gateway's default prefix ruuvi/<gateway MAC>/):
//   ruuvi/<gateway MAC>/<tag MAC>   one reading (JSON, decoded data)
//   ruuvi/<gateway MAC>/gw_status   {"state": "online"} / {"state": "offline"} (retained; offline is the last will)
import { createServer } from 'node:http';
import mqtt from 'mqtt';
import { config, normalizeMac } from './config.ts';
import { Tags } from './tags.ts';

const nowS = () => Math.round(Date.now() / 1000);
const tags = new Tags(config.tags, config.staleAfterS);
let warnedNotDecoded = false;

const client = mqtt.connect(config.mqttUrl, {
	username: config.mqttUsername,
	password: config.mqttPassword,
	clientId: `ruuvi-${process.pid}`,
	clean: true,
	reconnectPeriod: 5_000,
	connectTimeout: 10_000
});

function down(error: string): void {
	if (tags.mqttUp) console.error(`mqtt: ${error}`);
	tags.mqttUp = false;
}

client.on('connect', () => {
	client.subscribe('ruuvi/+/+', { qos: 0 }, (err) => {
		if (err) return down(`subscribe: ${err.message}`);
		tags.mqttUp = true;
		console.log(`mqtt: connected to ${config.mqttUrl}`);
	});
});
client.on('close', () => down('disconnected'));
client.on('error', (err) => down(err.message));
client.on('message', (topic, payload) => {
	const [, gatewayRaw = '', last = ''] = topic.split('/');
	const text = payload.toString();
	if (last === 'gw_status') {
		const gateway = normalizeMac(gatewayRaw) ?? gatewayRaw;
		const online = /"state"\s*:\s*"online"/.test(text);
		if (tags.gateways.get(gateway) !== online) console.log(`gateway ${gateway} ${online ? 'online' : 'offline'}`);
		tags.gateways.set(gateway, online);
		return;
	}
	const mac = normalizeMac(last);
	if (!mac) return;
	const result = tags.update(mac, text, nowS());
	if (result === 'new') console.log(`tag ${mac} (${tags.name(mac)}) seen`);
	else if (result === 'invalid') console.error(`tag ${mac}: not JSON: ${text.slice(0, 120)}`);
	else if (result === 'not-decoded' && !warnedNotDecoded) {
		warnedNotDecoded = true;
		console.error('messages carry raw data only: set the gateway\'s MQTT data format to "Decoded" (or "Raw and decoded")');
	}
});

const server = createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://localhost');
	const send = (status: number, type: string, text: string) => {
		res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(text);
	};
	if (req.method !== 'GET') return send(405, 'text/plain', 'method not allowed\n');
	if (url.pathname === '/metrics') return send(200, 'text/plain; version=0.0.4', tags.metrics(nowS()));
	if (url.pathname === '/healthz') return send(200, 'text/plain', 'ok\n');
	send(404, 'text/plain', 'not found\n');
});

server.listen(config.port, () => console.log(`ruuvi: ${config.tags.size} named tags, listening on :${config.port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	process.on(signal, () => {
		void client.endAsync();
		server.close(() => process.exit(0));
	});
}
