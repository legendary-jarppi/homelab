/** Everyday page (`home`) and the technical page (network, server, backups). */
export type DashboardTab = 'home' | 'homelab';

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
		/** Backup CronJob: unix seconds of the newest successful run's end and failed run's start. */
		backup: { lastSuccess: number | null; lastFailure: number | null; running: boolean };
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

/** apps/workout GET /api/summary: the current ISO week (Europe/Helsinki) per person. */
export interface WorkoutSummary {
	/** `start` is Monday, `end` Sunday, "YYYY-MM-DD". */
	week: { year: number; week: number; start: string; end: string };
	people: {
		id: string;
		name: string;
		meters: number;
		workouts: number;
		/** Every machine, in fixed order (treadmill, crosstrainer, rowing), zeros included; `short` is TR, CT, R. */
		byMachine: { id: string; name: string; short: string; meters: number }[];
	}[];
}

/** Family calendar (GET /api/calendar): events from today through the next days, sorted by start. */
export interface CalendarData {
	/** IANA zone the dates and day boundaries are in. */
	timeZone: string;
	events: CalendarEvent[];
	updatedAt: number;
}

export interface CalendarEvent {
	id: string;
	title: string;
	/** All-day: "YYYY-MM-DD", `end` exclusive (as in Google Calendar). Timed: ISO 8601 instants. */
	start: string;
	end: string;
	allDay: boolean;
	location: string | null;
	/** Whose calendar or which shared calendar; `color` is a CSS colour for it. */
	calendar: string;
	color: string;
}

export type Carrier = 'posti' | 'dhl' | 'ups';

/** Normalised across carriers; `pickup` = waiting at a pickup point or parcel locker. */
export type PackageState = 'unknown' | 'info' | 'transit' | 'out' | 'pickup' | 'delivered' | 'exception';

export interface PackageEvent {
	/** ISO 8601 with offset, or the carrier's local wall time ("YYYY-MM-DDTHH:MM:SS") when it gives no zone. */
	time: string | null;
	description: string;
	location: string | null;
}

/** What a carrier reports for one tracking code. */
export interface PackageTracking {
	state: PackageState;
	/** Latest event in the carrier's words. */
	summary: string | null;
	events: PackageEvent[];
	/** Expected delivery: ISO instant or "YYYY-MM-DD". */
	eta: string | null;
	pickup: { name: string; address: string | null; until: string | null } | null;
}

export interface TrackedPackage {
	id: string;
	code: string;
	carrier: Carrier;
	/** Given when adding ("Shoes"); the code is shown otherwise. */
	label: string | null;
	addedAt: number;
	checkedAt: number | null;
	/** Last check failed (carrier unreachable, unknown code, carrier not configured). */
	error: string | null;
	/** When the package was first seen delivered; it leaves the card a few days later. */
	deliveredAt: number | null;
	tracking: PackageTracking | null;
}

/** GET /api/packages */
export interface PackagesData {
	packages: TrackedPackage[];
	/** Carriers a package can be added for: Posti and DHL (link-only) always, UPS with credentials. */
	carriers: Record<Carrier, boolean>;
}
