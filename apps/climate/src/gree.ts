// Gree LAN protocol (UDP 7000), spoken by the Wi-Fi modules in Gree-made air-to-air heat pumps
// (Innova, Daitsu, Sinclair, …). Every message is JSON whose `pack` is AES-encrypted JSON. This
// module (firmware V2.0.0) answers discovery in the old AES-128-ECB format but binds only in the
// newer AES-128-GCM one (an envelope with t:"bind" goes unanswered); after binding, everything uses
// GCM with the device's own key:
//   bind:   {t:"pack", tcid:<mac>, pack: GCM(generic key, {mac, t:"bind", uid:0})} → {t:"bindok", key}
//   status: {t:"pack", pack: GCM(key, {t:"status", mac, cols:[…]})}            → {t:"dat", cols, dat}
//   change: {t:"pack", pack: GCM(key, {t:"cmd", opt:[…], p:[…]})}              → {t:"res", opt, p}
import { createCipheriv, createDecipheriv } from 'node:crypto';
import dgram from 'node:dgram';

const PORT = 7000;
const GENERIC_ECB_KEY = 'a3K8Bx%2r8Y7#xDh';
const GENERIC_GCM_KEY = '{yxAHAY_Lm6pbC/<';
const GCM_IV = Buffer.from('5440784449675a516c5e6313', 'hex');
const GCM_AAD = Buffer.from('qualcomm-test');

interface Envelope {
	t: string;
	pack: string;
	tag?: string;
}

function gcmSeal(key: string, payload: object): { pack: string; tag: string } {
	const c = createCipheriv('aes-128-gcm', key, GCM_IV);
	c.setAAD(GCM_AAD);
	const pack = Buffer.concat([c.update(JSON.stringify(payload)), c.final()]);
	return { pack: pack.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

function gcmOpen(key: string, e: Envelope): Record<string, unknown> {
	if (!e.tag) throw new Error('Gree: answer without a GCM tag');
	const d = createDecipheriv('aes-128-gcm', key, GCM_IV);
	d.setAAD(GCM_AAD);
	d.setAuthTag(Buffer.from(e.tag, 'base64'));
	return JSON.parse(Buffer.concat([d.update(Buffer.from(e.pack, 'base64')), d.final()]).toString());
}

function ecbOpen(key: string, pack: string): Record<string, unknown> {
	const d = createDecipheriv('aes-128-ecb', key, null);
	return JSON.parse(Buffer.concat([d.update(Buffer.from(pack, 'base64')), d.final()]).toString());
}

/** One request, one answer, over a fresh socket; UDP, so a few tries. */
async function exchange(host: string, message: object, timeoutMs: number, tries = 3): Promise<Envelope> {
	let last: Error = new Error('Gree: no answer');
	for (let i = 0; i < tries; i++) {
		try {
			return await new Promise<Envelope>((resolve, reject) => {
				const socket = dgram.createSocket('udp4');
				const timer = setTimeout(() => {
					socket.close();
					reject(new Error(`Gree: no answer from ${host}`));
				}, timeoutMs);
				socket.on('message', (m) => {
					clearTimeout(timer);
					socket.close();
					try {
						resolve(JSON.parse(m.toString()) as Envelope);
					} catch (e) {
						reject(e as Error);
					}
				});
				socket.on('error', (e) => {
					clearTimeout(timer);
					socket.close();
					reject(e);
				});
				socket.send(JSON.stringify(message), PORT, host);
			});
		} catch (e) {
			last = e as Error;
		}
	}
	throw last;
}

export class GreeDevice {
	private readonly host: string;
	private readonly timeoutMs: number;
	private mac: string | null = null;
	private key: string | null = null;

	constructor(host: string, timeoutMs = 3000) {
		this.host = host;
		this.timeoutMs = timeoutMs;
	}

	/** Discovery (ECB, answered with the device's MAC), then bind (GCM) for its key. */
	private async session(): Promise<{ mac: string; key: string }> {
		if (this.mac && this.key) return { mac: this.mac, key: this.key };
		const scan = await exchange(this.host, { t: 'scan' }, this.timeoutMs);
		const mac = ecbOpen(GENERIC_ECB_KEY, scan.pack).mac;
		if (typeof mac !== 'string') throw new Error('Gree: discovery answer without a MAC');
		const bind = await exchange(this.host, { cid: 'app', i: 1, t: 'pack', uid: 0, tcid: mac, ...gcmSeal(GENERIC_GCM_KEY, { mac, t: 'bind', uid: 0 }) }, this.timeoutMs);
		const answer = gcmOpen(GENERIC_GCM_KEY, bind);
		if (answer.t !== 'bindok' || typeof answer.key !== 'string') throw new Error(`Gree: bind refused (${JSON.stringify(answer).slice(0, 80)})`);
		this.mac = mac;
		this.key = answer.key;
		return { mac, key: answer.key };
	}

	private async call(payload: (mac: string) => object): Promise<Record<string, unknown>> {
		const { mac, key } = await this.session();
		try {
			const answer = await exchange(this.host, { cid: 'app', i: 0, t: 'pack', uid: 0, tcid: mac, ...gcmSeal(key, payload(mac)) }, this.timeoutMs);
			return gcmOpen(key, answer);
		} catch (e) {
			// A new key after the module restarted or was paired again: bind again next time.
			this.key = null;
			throw e;
		}
	}

	/** Current values of the given parameters (raw device values). */
	async status(cols: string[]): Promise<Record<string, number>> {
		const answer = await this.call((mac) => ({ cols, mac, t: 'status' }));
		const names = answer.cols as string[] | undefined;
		const values = answer.dat as number[] | undefined;
		if (!names || !values) throw new Error('Gree: status answer without values');
		return Object.fromEntries(names.map((c, i) => [c, values[i]]));
	}

	/** Sets parameters; resolves once the device confirms them. */
	async set(values: Record<string, number>): Promise<void> {
		const opt = Object.keys(values);
		const answer = await this.call(() => ({ opt, p: opt.map((k) => values[k]), t: 'cmd' }));
		if (answer.t !== 'res') throw new Error(`Gree: change not confirmed (${JSON.stringify(answer).slice(0, 80)})`);
	}
}
