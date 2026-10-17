// NIBE VVM S320 indoor module with its outdoor air/water unit (slave 2), over Modbus TCP (menu
// 7.5.9 on the heat pump). Registers from NIBE's "Modbus S-series" (M12676EN) and checked against
// this installation: temperatures are signed tenths, -32768 means no sensor.
import { ModbusException, ModbusSession, s16, s32, u32 } from './modbus.ts';

export const PRIORITY = { 10: 'off', 20: 'hot water', 30: 'heating', 40: 'pool', 60: 'cooling' } as Record<number, string>;
/** Holding register 56. 3 is "not in use" on this model. */
export const HOT_WATER_DEMAND = { 0: 'small', 1: 'medium', 2: 'large', 4: 'smart control' } as Record<number, string>;
export const OPERATING_MODE = { 0: 'auto', 1: 'manual', 2: 'additional heat only' } as Record<number, string>;

export interface NibeState {
	/** °C */
	outdoor: number | null;
	supply: number | null;
	return: number | null;
	calculatedSupply: number | null;
	hotWaterTop: number | null;
	hotWaterCharging: number | null;
	/** Outdoor unit: compressor frequency (Hz), defrosting, starts, run hours. */
	compressorHz: number | null;
	defrosting: boolean | null;
	compressorStarts: number | null;
	compressorHours: number | null;
	degreeMinutes: number | null;
	/** What it is doing: off, hot water, heating, … */
	priority: string | null;
	additionalHeatSteps: number | null;
	alarm: number | null;
	operatingMode: string | null;
	/** Settings that can be changed: heating curve offset (-10…10) and hot water demand. */
	offset: number | null;
	hotWaterDemand: number | null;
}

const tenths = (word: number) => (s16(word) === -32768 ? null : s16(word) / 10);

export class Nibe {
	private readonly host: string;

	constructor(host: string) {
		this.host = host;
	}

	private session<T>(work: (m: ModbusSession) => Promise<T>): Promise<T> {
		return ModbusSession.with(this.host, 502, 1, 5000, work);
	}

	async read(): Promise<NibeState> {
		return this.session(async (m) => {
			// A register this installation lacks answers exception 2 or 1: null, not a failed poll.
			const get = async (read: () => Promise<number[]>) => {
				try {
					return await read();
				} catch (e) {
					if (e instanceof ModbusException) return null;
					throw e;
				}
			};
			const input = (address: number, count = 1) => get(() => m.readInput(address, count));
			const holding = (address: number, count = 1) => get(() => m.readHolding(address, count));
			const one = async (words: Promise<number[] | null>) => (await words)?.[0] ?? null;

			const outdoor = await one(input(1));
			const supply = await one(input(5));
			const ret = await one(input(7));
			const calculated = await one(input(1017));
			const top = await one(input(8));
			const charging = await one(input(9));
			const hz = await one(input(1803));
			const defrost = await one(input(1805));
			const starts = await input(1489, 2);
			const hours = await input(1491, 2);
			const dm = await holding(11, 2);
			const priority = await one(input(1028));
			const steps = await one(input(1029));
			const alarm = await one(input(1975));
			const mode = await one(holding(237));
			const offset = await one(holding(30));
			const demand = await one(holding(56));
			return {
				outdoor: outdoor === null ? null : tenths(outdoor),
				supply: supply === null ? null : tenths(supply),
				return: ret === null ? null : tenths(ret),
				calculatedSupply: calculated === null ? null : tenths(calculated),
				hotWaterTop: top === null ? null : tenths(top),
				hotWaterCharging: charging === null ? null : tenths(charging),
				compressorHz: hz === null ? null : hz / 10,
				defrosting: defrost === null ? null : defrost === 1,
				compressorStarts: starts ? u32(starts) : null,
				compressorHours: hours ? u32(hours) / 10 : null,
				degreeMinutes: dm ? s32(dm) / 10 : null,
				priority: priority === null ? null : (PRIORITY[priority] ?? String(priority)),
				additionalHeatSteps: steps,
				alarm,
				operatingMode: mode === null ? null : (OPERATING_MODE[mode] ?? String(mode)),
				offset: offset === null ? null : s16(offset),
				hotWaterDemand: demand
			};
		});
	}

	async setOffset(value: number): Promise<void> {
		if (!Number.isInteger(value) || value < -10 || value > 10) throw new RangeError('offset must be a whole number from -10 to 10');
		await this.session((m) => m.writeSingle(30, value));
	}

	async setHotWaterDemand(value: number): Promise<void> {
		if (!(value in HOT_WATER_DEMAND)) throw new RangeError(`hot water demand must be one of ${Object.keys(HOT_WATER_DEMAND).join(', ')}`);
		await this.session((m) => m.writeSingle(56, value));
	}
}
