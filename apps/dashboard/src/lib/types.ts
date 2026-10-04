/** [unix seconds, value] */
export type Point = [number, number];

export interface LiveData {
	wan: {
		/** bits per second, newest last; null gaps dropped */
		down: Point[];
		up: Point[];
		downNow: number | null;
		upNow: number | null;
		/** bytes over the last 24 h */
		down24h: number | null;
		up24h: number | null;
		latencyMs: number | null;
	};
	gateway: {
		name: string;
		cpu: number | null;
		memory: number | null;
		temperatureC: number | null;
		uptimeS: number | null;
	} | null;
	clients: { total: number; wired: number; wireless: number };
	devices: { name: string; type: string; model: string; online: boolean; clients: number | null }[];
	top: { mac: string; name: string; vendor: string; wired: boolean; downBps: number; upBps: number }[];
	updatedAt: number;
}

export interface SlowData {
	speedtest: {
		downMbps: number;
		upMbps: number;
		latencyMs: number;
		ranAt: number;
		history: { ranAt: number; downMbps: number; upMbps: number }[];
	} | null;
	homelab: {
		cpu: number | null;
		memory: number | null;
		disks: { mount: string; used: number; sizeBytes: number }[];
		uptimeS: number | null;
		cpuHistory: Point[];
		pods: { running: number; problem: number; restarts1h: number };
		targetsDown: number;
	};
	updatedAt: number;
}

export interface WeatherData {
	name: string;
	current: { temperature: number; feelsLike: number; code: number; isDay: boolean; windMs: number; humidity: number };
	today: { max: number; min: number; sunrise: string; sunset: string; precipitationChance: number | null };
	hours: { time: string; temperature: number; code: number; precipitationChance: number | null }[];
	/** 10 days starting today; `date` is local "YYYY-MM-DD". */
	days: {
		date: string;
		code: number;
		max: number;
		min: number;
		precipitationChance: number | null;
		precipitationMm: number | null;
		windMaxMs: number | null;
	}[];
	updatedAt: number;
}
