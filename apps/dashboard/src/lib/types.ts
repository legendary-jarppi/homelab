/** Everyday page (`home`), motion events from all cameras (`cameras`), the cabin's heating and cooling (`cabin`), the cabin telescope's imaging (`telescope`) and the technical page (network, server, backups). */
export type DashboardTab = 'home' | 'cameras' | 'cabin' | 'telescope' | 'homelab';

/** One light frame from apps/telescope; unix seconds, null where unknown. */
export interface TelescopeFrame {
	/** Content-addressed: previews at /telescope/frames/<id>.jpg and <id>-small.jpg. */
	id: string;
	target: string;
	mode: string;
	number: number | null;
	/** Exposure start. */
	at: number;
	exposureS: number | null;
	gain: number | null;
	sensorTempC: number | null;
	setTempC: number | null;
	camera: string | null;
	focalLengthMm: number | null;
	/** Sky background median, raw ADU (16-bit scale): rises with the moon, lit clouds, dawn. */
	backgroundAdu: number | null;
	/** Detected stars: drop with clouds, fog, dew. */
	stars: number | null;
	/** Median half-flux radius, pixels: rises when focus drifts or seeing is bad. */
	hfr: number | null;
	width: number | null;
	height: number | null;
}

/** GET /api/telescope: apps/telescope's /api/status (unix seconds). */
export interface TelescopeData {
	/** The ASIAIR answered the last poll. */
	online: boolean;
	lastContact: number | null;
	error: string | null;
	/** Current or most recent imaging run (frames within the last 12 h). */
	session: {
		target: string;
		mode: string;
		frames: number;
		integrationS: number;
		firstFrameAt: number;
		lastFrameAt: number;
		exposureS: number | null;
		/** A frame is due. */
		active: boolean;
	} | null;
	/** From the newest Autorun log on the ASIAIR. */
	plan: {
		name: string | null;
		target: string | null;
		planned: number | null;
		current: number | null;
		exposureS: number | null;
		state: string;
		activity: string | null;
		startedAt: number | null;
		updatedAt: number | null;
		/** Newest first. */
		events: { at: number; text: string }[];
	} | null;
	/** Newest first, recent light frames of all targets. */
	frames: TelescopeFrame[];
	/** The ASIAIR's own control ports (read only); null when they are not answering, missing from older services. */
	live?: TelescopeLive | null;
	updatedAt: number;
}

/** Live state from the ASIAIR's JSON-RPC ports (unix seconds; any field may be null). */
export interface TelescopeLive {
	connected: boolean;
	updatedAt: number | null;
	/** "Exposing", "Meridian flip", "Auto focus", "GoTo", "Plate solving", "Finding star", "Polar alignment", "Live stacking", "Idle". */
	activity: string | null;
	/** Only while a frame is exposing. */
	exposure: { startedAt: number | null; totalS: number | null; elapsedS: number | null } | null;
	/** Only during a plan or autorun. */
	plan: {
		target: string | null;
		/** 1-based. */
		targetIndex: number | null;
		targets: number | null;
		targetDone: number | null;
		targetTotal: number | null;
		planDone: number | null;
		planTotal: number | null;
		ended: boolean | null;
	} | null;
	/** Null when the guider is not running. */
	guiding: {
		/** Guider state: "Guiding", "Looping", "Calibrating", "Stopped", "Paused", "LostLock", "Selected", … */
		state: string | null;
		/** RMS of the guiding error over the last steps (settling and dithering excluded), arcsec. */
		rmsArcsec: number | null;
		rmsRaArcsec: number | null;
		rmsDecArcsec: number | null;
		samples: number | null;
		snr: number | null;
		pixelScaleArcsec: number | null;
		/** Last ≤120 steps, oldest first: [time, RA error ″, Dec error ″]. */
		history: [number, number, number][] | null;
	} | null;
	/** Main camera sensor. */
	sensorTempC: number | null;
	/** The ASIAIR's own board. */
	controllerTempC: number | null;
	/** The ASIAIR's Wi-Fi signal. */
	wifiDbm: number | null;
}

/** A time window, unix ms. */
export interface TimeWindow {
	start: number;
	end: number;
}

/** GET /api/tonight: darkness, moon and clouds at the telescope site tonight. Times unix ms. */
export interface TonightData {
	site: { name: string; latitude: number; longitude: number };
	sunset: number | null;
	sunrise: number | null;
	/** Sun below −18°; null in the bright summer nights. */
	astronomical: TimeWindow | null;
	/** Sun below −12°. */
	nautical: TimeWindow | null;
	/** Lowest sun altitude of the night, degrees. */
	sunLowest: number;
	moon: {
		/** Illuminated fraction 0…1 at midnight. */
		illumination: number;
		/** 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
		phase: number;
		/** Moonrises and moonsets from noon to noon. */
		events: { at: number; kind: 'rise' | 'set' }[];
		/** Above the horizon when darkness (without darkness: sunset) begins. */
		upAtDark: boolean;
	};
	/** Hourly forecast through the night (Open-Meteo), % and °C; null when it failed. */
	hours: { time: number; cloud: number | null; low: number | null; mid: number | null; high: number | null; temperature: number | null; dewPoint: number | null }[] | null;
	weatherError: string | null;
	updatedAt: number;
}

/** One device of apps/climate: the last good reading is kept while it does not answer. */
export interface ClimateEntry<T> {
	ok: boolean;
	error: string | null;
	/** Unix ms of the last successful reading. */
	updatedAt: number | null;
	state: T | null;
}

/** GET /api/climate, as apps/climate serves it. Temperatures °C; null where the device has no such value. */
export interface ClimateData {
	nibe: ClimateEntry<{
		outdoor: number | null;
		supply: number | null;
		return: number | null;
		calculatedSupply: number | null;
		hotWaterTop: number | null;
		hotWaterCharging: number | null;
		compressorHz: number | null;
		defrosting: boolean | null;
		compressorStarts: number | null;
		compressorHours: number | null;
		degreeMinutes: number | null;
		priority: string | null;
		additionalHeatSteps: number | null;
		alarm: number | null;
		operatingMode: string | null;
		/** Heating curve offset, -10…10. */
		offset: number | null;
		/** Key of `hotWaterDemands`. */
		hotWaterDemand: number | null;
	}>;
	innova: ClimateEntry<{
		power: boolean;
		mode: 'auto' | 'cool' | 'dry' | 'fan' | 'heat' | null;
		/** 16…30 */
		target: number | null;
		room: number | null;
		fan: 'auto' | 'low' | 'medium-low' | 'medium' | 'medium-high' | 'high' | null;
		quiet: boolean;
		turbo: boolean;
	}>;
	hotWaterDemands: Record<string, string>;
}

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
		/** A site id (`sites`) or "away"; null until the presence service has heard from a source. */
		place: string | null;
		/** At the place since (arrival) or away since (last seen); null when unknown. */
		since: number | null;
		lastSeen: number | null;
		lastSite: string | null;
		via: string | null;
		/** At a site that is not reporting now (mobile link or VPN down): as far as anyone knows. */
		stale: boolean;
	}[];
	/** In order; the first is home. `ok`: its UniFi console reported at the last poll. */
	sites: { id: string; label: string; ok: boolean; lastOk: number | null }[];
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

/** The Protect consoles: the home UDM Pro and the cabin's UCG Max. */
export type ProtectSite = 'home' | 'cabin';

/** GET /api/protect/<site>: a Protect console's ended motion events of the last `windowHours`, newest first. */
export interface ProtectData {
	site: ProtectSite;
	/** Display order and labels (PROTECT_CAMERAS, CABIN_PROTECT_CAMERAS). */
	cameras: { id: string; label: string }[];
	/** `start`/`end` unix ms; `types`: smart detections (person, vehicle, animal, …), empty for plain motion.
	 *  Thumbnail at /cameras/events/<site>/<id>/thumbnail, clip at /cameras/events/<site>/<id>/clip. */
	events: { id: string; camera: string; start: number; end: number; types: string[] }[];
	windowHours: number;
}

/** GET /api/cameras/<id>/timeline: a recorded camera's events in a window, unix ms; ongoing ones end now. */
export interface CameraTimeline {
	/** Oldest recording Protect still has (it deletes the oldest when the disk is full); null if unknown. */
	recordingStart: number | null;
	events: { start: number; end: number; types: string[] }[];
}

/** A live camera (CAMERAS) as the page gets it; `recorded`: linked to a Protect camera, so its viewer has a timeline. */
export interface LiveCamera {
	id: string;
	label: string;
	recorded: boolean;
}
