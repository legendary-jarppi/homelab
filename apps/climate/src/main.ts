// Climate service: the cabin's heat pumps, read every POLL_S seconds and changed on request, over
// the Site Magic VPN. Cluster-internal (the dashboard and Prometheus only):
//   GET  /api/climate  { nibe, innova }: per device { ok, error, updatedAt, state }
//   POST /api/nibe     { offset?, hotWaterDemand? }            → that device's entry after the change
//   POST /api/innova   { power?, mode?, target?, fan? }        → that device's entry after the change
//   GET  /metrics      Prometheus metrics
//   GET  /healthz
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { FAN, Innova, MODES, type Fan, type InnovaState, type Mode } from './innova.ts';
import { HOT_WATER_DEMAND, Nibe, type NibeState } from './nibe.ts';

const env = process.env;
const port = Number(env.PORT ?? 8080);
const pollS = Number(env.POLL_S ?? 60);

interface Entry<T> {
	ok: boolean;
	error: string | null;
	/** Unix ms of the last successful read. */
	updatedAt: number | null;
	state: T | null;
}

/** One device: reads and changes run one at a time; the last good state is kept when a read fails. */
class Device<T> {
	readonly entry: Entry<T> = { ok: false, error: null, updatedAt: null, state: null };
	private queue: Promise<unknown> = Promise.resolve();
	private readonly name: string;
	private readonly reader: () => Promise<T>;

	constructor(name: string, reader: () => Promise<T>) {
		this.name = name;
		this.reader = reader;
	}

	private serial<R>(task: () => Promise<R>): Promise<R> {
		const run = this.queue.then(task, task);
		this.queue = run.catch(() => {});
		return run;
	}

	refresh(): Promise<void> {
		return this.serial(() => this.read());
	}

	/** Applies a change, then reads the device again so the answer shows what it now reports. */
	change(apply: () => Promise<void>): Promise<void> {
		return this.serial(async () => {
			await apply();
			console.log(`${this.name}: changed`);
			await this.read();
		});
	}

	private async read(): Promise<void> {
		try {
			this.entry.state = await this.reader();
			if (!this.entry.ok && this.entry.updatedAt !== null) console.log(`${this.name}: answering again`);
			Object.assign(this.entry, { ok: true, error: null, updatedAt: Date.now() });
		} catch (e) {
			const error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
			if (this.entry.ok || this.entry.updatedAt === null) console.error(`${this.name}: ${error}`);
			Object.assign(this.entry, { ok: false, error });
		}
	}
}

const nibe = new Nibe(env.NIBE_HOST ?? '192.168.20.49');
const innova = new Innova(env.INNOVA_HOST ?? '192.168.20.28');
const devices = { nibe: new Device<NibeState>('nibe', () => nibe.read()), innova: new Device<InnovaState>('innova', () => innova.read()) };

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
	if (!req.headers['content-type']?.startsWith('application/json')) throw new RangeError('expected JSON');
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const parsed = JSON.parse(Buffer.concat(chunks).toString() || 'null') as unknown;
	if (!parsed || typeof parsed !== 'object') throw new RangeError('expected a JSON object');
	return parsed as Record<string, unknown>;
}

const optionalNumber = (v: unknown, name: string) => {
	if (v === undefined) return undefined;
	if (typeof v !== 'number') throw new RangeError(`${name} must be a number`);
	return v;
};

async function changeNibe(b: Record<string, unknown>): Promise<void> {
	const offset = optionalNumber(b.offset, 'offset');
	const demand = optionalNumber(b.hotWaterDemand, 'hotWaterDemand');
	if (offset === undefined && demand === undefined) throw new RangeError('nothing to change');
	await devices.nibe.change(async () => {
		if (offset !== undefined) await nibe.setOffset(offset);
		if (demand !== undefined) await nibe.setHotWaterDemand(demand);
	});
}

async function changeInnova(b: Record<string, unknown>): Promise<void> {
	if (b.power !== undefined && typeof b.power !== 'boolean') throw new RangeError('power must be true or false');
	if (b.mode !== undefined && !MODES.includes(b.mode as Mode)) throw new RangeError(`mode must be one of ${MODES.join(', ')}`);
	if (b.fan !== undefined && !FAN.includes(b.fan as Fan)) throw new RangeError(`fan must be one of ${FAN.join(', ')}`);
	const change = { power: b.power as boolean | undefined, mode: b.mode as Mode | undefined, target: optionalNumber(b.target, 'target'), fan: b.fan as Fan | undefined };
	await devices.innova.change(() => innova.set(change));
}

function metrics(): string {
	const lines: string[] = [];
	const gauge = (name: string, help: string, samples: [string, number | null | undefined][]) => {
		const present = samples.filter((s): s is [string, number] => typeof s[1] === 'number');
		if (present.length === 0) return;
		lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, ...present.map(([labels, v]) => `${name}${labels} ${v}`));
	};
	gauge('climate_device_up', '1 when the device answered at the last poll.', Object.entries(devices).map(([name, d]) => [`{device="${name}"}`, d.entry.ok ? 1 : 0]));
	const n = devices.nibe.entry.state;
	if (n) {
		gauge('climate_nibe_temperature_celsius', 'NIBE sensors.', [
			['{sensor="outdoor"}', n.outdoor],
			['{sensor="supply"}', n.supply],
			['{sensor="return"}', n.return],
			['{sensor="calculated_supply"}', n.calculatedSupply],
			['{sensor="hot_water_top"}', n.hotWaterTop],
			['{sensor="hot_water_charging"}', n.hotWaterCharging]
		]);
		gauge('climate_nibe_compressor_hertz', 'Outdoor unit compressor frequency.', [['', n.compressorHz]]);
		gauge('climate_nibe_degree_minutes', 'NIBE degree minutes.', [['', n.degreeMinutes]]);
		gauge('climate_nibe_offset', 'Heating curve offset.', [['', n.offset]]);
		gauge('climate_nibe_additional_heat_steps', 'Electric additional heat steps in use.', [['', n.additionalHeatSteps]]);
	}
	const i = devices.innova.entry.state;
	if (i) {
		gauge('climate_innova_power', '1 when the Innova heat pump is on.', [['', i.power ? 1 : 0]]);
		gauge('climate_innova_temperature_celsius', 'Innova room temperature and target.', [
			['{kind="room"}', i.room],
			['{kind="target"}', i.target]
		]);
	}
	return lines.join('\n') + '\n';
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
	const send = (status: number, type: string, text: string) => {
		res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(text);
	};
	const json = (status: number, value: unknown) => send(status, 'application/json', JSON.stringify(value));
	const url = new URL(req.url ?? '/', 'http://localhost');
	try {
		if (req.method === 'GET' && url.pathname === '/api/climate') return json(200, { nibe: devices.nibe.entry, innova: devices.innova.entry, hotWaterDemands: HOT_WATER_DEMAND });
		if (req.method === 'POST' && url.pathname === '/api/nibe') {
			await changeNibe(await body(req));
			return json(devices.nibe.entry.ok ? 200 : 502, devices.nibe.entry);
		}
		if (req.method === 'POST' && url.pathname === '/api/innova') {
			await changeInnova(await body(req));
			return json(devices.innova.entry.ok ? 200 : 502, devices.innova.entry);
		}
		if (req.method === 'GET' && url.pathname === '/metrics') return send(200, 'text/plain; version=0.0.4', metrics());
		if (req.method === 'GET' && url.pathname === '/healthz') return send(200, 'text/plain', 'ok\n');
		send(404, 'text/plain', 'not found\n');
	} catch (e) {
		if (e instanceof RangeError || e instanceof SyntaxError) return json(400, { message: e.message });
		console.error(`${req.method} ${url.pathname}: ${(e as Error).message}`);
		json(502, { message: (e as Error).message.slice(0, 200) });
	}
});

server.listen(port, () => console.log(`climate: nibe ${env.NIBE_HOST ?? '192.168.20.49'}, innova ${env.INNOVA_HOST ?? '192.168.20.28'}, listening on :${port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));

const poll = () => Promise.all(Object.values(devices).map((d) => d.refresh()));
await poll();
setInterval(poll, pollS * 1000);
