// Innova air-to-air heat pump with a Gree Wi-Fi module (U-WB05RT13), over the Gree LAN protocol.
import { GreeDevice } from './gree.ts';

export const MODES = ['auto', 'cool', 'dry', 'fan', 'heat'] as const;
export type Mode = (typeof MODES)[number];
/** WdSpd: 0 auto, 1 low … 5 high. */
export const FAN = ['auto', 'low', 'medium-low', 'medium', 'medium-high', 'high'] as const;
export type Fan = (typeof FAN)[number];

export const MIN_TARGET = 16;
export const MAX_TARGET = 30;

export interface InnovaState {
	power: boolean;
	mode: Mode | null;
	/** °C, whole degrees. */
	target: number | null;
	/** Room temperature at the indoor unit, °C. */
	room: number | null;
	fan: Fan | null;
	quiet: boolean;
	turbo: boolean;
}

const COLS = ['Pow', 'Mod', 'SetTem', 'TemSen', 'WdSpd', 'Quiet', 'Tur', 'TemUn'];

export class Innova {
	private readonly device: GreeDevice;

	constructor(host: string) {
		this.device = new GreeDevice(host);
	}

	async read(): Promise<InnovaState> {
		const s = await this.device.status(COLS);
		return {
			power: s.Pow === 1,
			mode: MODES[s.Mod] ?? null,
			target: typeof s.SetTem === 'number' ? s.SetTem : null,
			// The module reports the sensor with a +40 offset (63 = 23 °C).
			room: typeof s.TemSen === 'number' && s.TemSen > 0 ? s.TemSen - 40 : null,
			fan: FAN[s.WdSpd] ?? null,
			quiet: s.Quiet === 1,
			turbo: s.Tur === 1
		};
	}

	async set(change: { power?: boolean; mode?: Mode; target?: number; fan?: Fan }): Promise<void> {
		const values: Record<string, number> = {};
		if (change.power !== undefined) values.Pow = change.power ? 1 : 0;
		if (change.mode !== undefined) {
			const i = MODES.indexOf(change.mode);
			if (i < 0) throw new RangeError(`mode must be one of ${MODES.join(', ')}`);
			values.Mod = i;
		}
		if (change.target !== undefined) {
			if (!Number.isInteger(change.target) || change.target < MIN_TARGET || change.target > MAX_TARGET) {
				throw new RangeError(`target must be a whole number from ${MIN_TARGET} to ${MAX_TARGET}`);
			}
			Object.assign(values, { SetTem: change.target, TemUn: 0, TemRec: 0 });
		}
		if (change.fan !== undefined) {
			const i = FAN.indexOf(change.fan);
			if (i < 0) throw new RangeError(`fan must be one of ${FAN.join(', ')}`);
			values.WdSpd = i;
		}
		if (Object.keys(values).length === 0) throw new RangeError('nothing to change');
		await this.device.set(values);
	}
}
