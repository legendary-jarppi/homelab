// Minimal Modbus TCP client: one connection per batch of requests, one request at a time (the NIBE
// S-series takes at most 100 registers a second and 20 per query, and answers exception 1 for a
// read that includes any register it does not have, so registers are read one by one).
import net from 'node:net';

export class ModbusException extends Error {
	readonly code: number;
	constructor(code: number) {
		super(`Modbus exception ${code}`);
		this.code = code;
	}
}

const READ_HOLDING = 3;
const READ_INPUT = 4;
const WRITE_SINGLE = 6;

export class ModbusSession {
	private readonly socket: net.Socket;
	private buffer = Buffer.alloc(0);
	private transaction = 0;
	private pending: { id: number; resolve: (pdu: Buffer) => void; reject: (e: Error) => void } | null = null;
	private failure: Error | null = null;
	/** Settles on connect, or with the first failure (error, timeout or close before connecting). */
	private readonly ready: Promise<void>;
	private rejectReady: (e: Error) => void = () => {};

	private readonly unit: number;

	private constructor(host: string, port: number, unit: number, timeoutMs: number) {
		this.unit = unit;
		this.socket = net.connect(port, host);
		this.ready = new Promise((resolve, reject) => {
			this.socket.once('connect', () => resolve());
			// A connect that times out is destroyed without an 'error' event: fail() rejects it.
			this.rejectReady = reject;
		});
		this.socket.setTimeout(timeoutMs, () => this.fail(new Error(`no answer from ${host}:${port}`)));
		this.socket.on('error', (e) => this.fail(e));
		this.socket.on('close', () => this.fail(new Error('connection closed')));
		this.socket.on('data', (chunk) => this.receive(chunk));
	}

	/** Runs `work` on a fresh connection and closes it afterwards. */
	static async with<T>(host: string, port: number, unit: number, timeoutMs: number, work: (m: ModbusSession) => Promise<T>): Promise<T> {
		const session = new ModbusSession(host, port, unit, timeoutMs);
		try {
			await session.ready;
			return await work(session);
		} finally {
			session.socket.destroy();
		}
	}

	async readInput(address: number, count = 1): Promise<number[]> {
		return this.read(READ_INPUT, address, count);
	}

	async readHolding(address: number, count = 1): Promise<number[]> {
		return this.read(READ_HOLDING, address, count);
	}

	async writeSingle(address: number, value: number): Promise<void> {
		const pdu = Buffer.alloc(5);
		pdu.writeUInt8(WRITE_SINGLE, 0);
		pdu.writeUInt16BE(address, 1);
		pdu.writeInt16BE(value, 3);
		await this.request(pdu);
	}

	/** Raw 16-bit words, unsigned. */
	private async read(fn: number, address: number, count: number): Promise<number[]> {
		const pdu = Buffer.alloc(5);
		pdu.writeUInt8(fn, 0);
		pdu.writeUInt16BE(address, 1);
		pdu.writeUInt16BE(count, 3);
		const answer = await this.request(pdu);
		const bytes = answer.readUInt8(1);
		return Array.from({ length: bytes / 2 }, (_, i) => answer.readUInt16BE(2 + i * 2));
	}

	private request(pdu: Buffer): Promise<Buffer> {
		if (this.failure) return Promise.reject(this.failure);
		if (this.pending) return Promise.reject(new Error('one request at a time'));
		this.transaction = (this.transaction + 1) & 0xffff;
		const header = Buffer.alloc(7);
		header.writeUInt16BE(this.transaction, 0);
		header.writeUInt16BE(0, 2);
		header.writeUInt16BE(pdu.length + 1, 4);
		header.writeUInt8(this.unit, 6);
		const id = this.transaction;
		return new Promise((resolve, reject) => {
			this.pending = { id, resolve, reject };
			this.socket.write(Buffer.concat([header, pdu]));
		});
	}

	private receive(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (this.buffer.length >= 7) {
			const length = this.buffer.readUInt16BE(4);
			if (this.buffer.length < 6 + length) return;
			const id = this.buffer.readUInt16BE(0);
			const pdu = this.buffer.subarray(7, 6 + length);
			this.buffer = this.buffer.subarray(6 + length);
			const pending = this.pending;
			if (!pending || pending.id !== id) continue;
			this.pending = null;
			if (pdu.readUInt8(0) & 0x80) pending.reject(new ModbusException(pdu.readUInt8(1)));
			else pending.resolve(Buffer.from(pdu));
		}
	}

	private fail(e: Error): void {
		this.failure ??= e;
		const pending = this.pending;
		this.pending = null;
		pending?.reject(e);
		// No-op once connected (the promise has settled).
		this.rejectReady(this.failure);
		this.socket.destroy();
	}
}

/** 16-bit word as signed. */
export const s16 = (word: number) => (word >= 0x8000 ? word - 0x10000 : word);
/** NIBE 32-bit values: the register at the address holds the low word, the next one the high word. */
export const s32 = ([low, high]: number[]) => (s16(high) * 0x10000 + low);
export const u32 = ([low, high]: number[]) => high * 0x10000 + low;
