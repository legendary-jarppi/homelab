/** Everyday page (`home`), motion events from all cameras (`cameras`) and the technical page (network, server, backups). */
export type DashboardTab = 'home' | 'cameras' | 'homelab';

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

/** apps/lists GET /api/dashboard: lists marked "Show on dashboard", each with its first items in the list's order. */
export interface ListsData {
	/** Everyone who can be on an item, in order; colours go by this order (as in apps/lists). `short`: "Ja", "AL". */
	people: { id: number; name: string; short: string }[];
	lists: {
		slug: string;
		name: string;
		/** null when the list has no dates. */
		dateLabel: string | null;
		usesPeople: boolean;
		usesService: boolean;
		/** `day` "YYYY-MM-DD"; `people` are person ids. */
		items: { id: number; title: string; day: string | null; people: number[]; service: string | null; link: string | null }[];
	}[];
}

/** Family calendar (GET /api/calendar): events from today through the next days, sorted by start. */
export interface CalendarData {
	/** IANA zone the dates and day boundaries are in. */
	timeZone: string;
	events: CalendarEvent[];
	updatedAt: number;
	/** Events can be added from the dashboard (POST /api/calendar). */
	writable: boolean;
}

export interface CalendarEvent {
	id: string;
	title: string;
	/** All-day: "YYYY-MM-DD", `end` exclusive (as in Google Calendar). Timed: ISO 8601 instants. */
	start: string;
	end: string;
	allDay: boolean;
	location: string | null;
	/** Plain text (Google's HTML reduced to lines). */
	description: string | null;
	/** Whose calendar or which shared calendar; `color` is a CSS colour for it. */
	calendar: string;
	color: string;
}

/** POST /api/calendar: wall-clock date and time in CalendarData.timeZone. */
export interface NewCalendarEvent {
	title: string;
	/** "YYYY-MM-DD" */
	date: string;
	allDay: boolean;
	/** "HH:MM"; timed events only. */
	time: string | null;
	/** Timed events: length in minutes. */
	minutes: number | null;
	/** All-day events: how many days. */
	days: number | null;
	location: string | null;
	description: string | null;
}

export type Carrier = 'posti' | 'matkahuolto' | 'dhl' | 'ups' | 'dsv';

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
	/** When the package was first seen delivered; it moves to the archive a few days later. */
	deliveredAt: number | null;
	tracking: PackageTracking | null;
	/** Set while in the archive: off the card, no longer checked. */
	archivedAt: number | null;
	/** Last taken back out of the archive; the automatic archiving counts from here too. */
	restoredAt: number | null;
}

/** GET /api/packages: the packages on the card (not archived). */
export interface PackagesData {
	packages: TrackedPackage[];
	/** How many are in the archive (GET /api/packages/archive lists them). */
	archived: number;
	/** Carriers a package can be added for: Posti, Matkahuolto, DSV and DHL (link-only) always, UPS with credentials. */
	carriers: Record<Carrier, boolean>;
}

/** GET /api/presence, as apps/presence serves it (times in unix seconds). */
export interface PresenceData {
	people: {
		id: string;
		name: string;
		/** null until the presence service has heard from a source. */
		home: boolean | null;
		/** Home since (arrival) or away since (last seen); null when unknown. */
		since: number | null;
		lastSeen: number | null;
		via: string | null;
	}[];
	sources: Record<string, { ok: boolean; lastOk: number | null; error: string | null }>;
	awayAfterS: number;
	updatedAt: number;
}

/** GET /api/cabin: the cabin camera's latest pictures and clips, newest first (apps/cabin-camera). */
export interface CabinData {
	/** `path` is served at /cabin/<path>; `time` is the upload time, unix ms. */
	snapshots: { path: string; kind: 'image' | 'video'; time: number; size: number }[];
	total: number;
	retentionDays: number;
}

/** GET /api/protect: UniFi Protect's ended motion events of the last `windowHours`, newest first. */
export interface ProtectData {
	/** Display order and labels (PROTECT_CAMERAS). */
	cameras: { id: string; label: string }[];
	/** `start`/`end` unix ms; `types`: smart detections (person, vehicle, animal, …), empty for plain motion.
	 *  Thumbnail at /cameras/events/<id>/thumbnail, clip at /cameras/events/<id>/clip. */
	events: { id: string; camera: string; start: number; end: number; types: string[] }[];
	windowHours: number;
}
