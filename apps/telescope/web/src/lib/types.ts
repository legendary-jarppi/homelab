// The telescope service's HTTP API (apps/telescope, unix seconds; any field may be null) and this
// app's own server routes (conditions: unix ms).

/** A recent light frame in /api/status (the dashboard's shape). */
export interface StatusFrame {
	id: string;
	target: string;
	mode: string;
	number: number | null;
	at: number;
	exposureS: number | null;
	gain: number | null;
	sensorTempC: number | null;
	setTempC: number | null;
	camera: string | null;
	focalLengthMm: number | null;
	backgroundAdu: number | null;
	stars: number | null;
	hfr: number | null;
	width: number | null;
	height: number | null;
}

export interface Live {
	connected: boolean;
	updatedAt: number | null;
	/** "Exposing", "Meridian flip", "Auto focus", "GoTo", "Plate solving", "Finding star", "Polar alignment", "Live stacking", "Idle". */
	activity: string | null;
	exposure: { startedAt: number | null; totalS: number | null; elapsedS: number | null } | null;
	plan: {
		target: string | null;
		targetIndex: number | null;
		targets: number | null;
		targetDone: number | null;
		targetTotal: number | null;
		planDone: number | null;
		planTotal: number | null;
		ended: boolean | null;
	} | null;
	guiding: {
		state: string | null;
		rmsArcsec: number | null;
		rmsRaArcsec: number | null;
		rmsDecArcsec: number | null;
		samples: number | null;
		snr: number | null;
		pixelScaleArcsec: number | null;
		history: [number, number, number][] | null;
	} | null;
	sensorTempC: number | null;
	controllerTempC: number | null;
	wifiDbm: number | null;
	coolerPowerPct?: number | null;
	underVoltage?: boolean | null;
	overTemp?: boolean | null;
}

export interface Stack {
	sessionId: string;
	target: string;
	accepted: number;
	rejected: number;
	integrationS: number;
	updatedAt: number | null;
	width: number | null;
	height: number | null;
	/** Changes with every restack: the preview URL's ?v=. */
	imageId: string;
}

export interface Storage {
	name: string;
	freeBytes: number | null;
	totalBytes: number | null;
}

/** GET /api/status. */
export interface Status {
	online: boolean;
	lastContact: number | null;
	error: string | null;
	session: {
		target: string;
		mode: string;
		frames: number;
		integrationS: number;
		firstFrameAt: number;
		lastFrameAt: number;
		exposureS: number | null;
		active: boolean;
	} | null;
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
		events: { at: number; text: string }[];
	} | null;
	live: Live | null;
	frames: StatusFrame[];
	stack?: Stack | null;
	storage?: Storage[] | null;
	updatedAt: number;
}

/** GET /api/sessions (newest first). */
export interface SessionSummary {
	id: string;
	/** Local date of the evening, YYYY-MM-DD. */
	night: string;
	target: string;
	mode: string;
	firstFrameAt: number;
	lastFrameAt: number;
	frames: number;
	accepted: number;
	rejected: number;
	integrationS: number;
	active: boolean;
	hasStack: boolean;
	/** Target from the FITS header, degrees (newer services). */
	ra?: number | null;
	dec?: number | null;
	exposureS?: number | null;
	gain?: number | null;
}

export interface Frame {
	id: string;
	number: number | null;
	at: number;
	exposureS: number | null;
	backgroundAdu: number | null;
	stars: number | null;
	hfr: number | null;
	fwhmPx: number | null;
	/** 0 = round. */
	elongation: number | null;
	guidingRmsArcsec: number | null;
	accepted: boolean;
	rejectReason: string | null;
	/** Decided by hand (override). */
	manual: boolean;
	/** Registered onto the stack's reference (newer services). */
	aligned?: boolean;
	/** Relative to the archive volume's root; null until archived (newer services). */
	archivePath?: string | null;
	/** Camera angle (FITS ROTATOR), degrees. */
	rotatorDeg?: number | null;
}

export type GuideEventKind = 'dither' | 'settle' | 'lost' | 'start' | 'stop';
export type TimelineKind = 'plan_start' | 'plan_end' | 'target_start' | 'autofocus' | 'meridian_flip' | 'goto' | 'centering' | 'guiding_lost' | 'frame';

export interface Guiding {
	rmsArcsec: number | null;
	rmsRaArcsec: number | null;
	rmsDecArcsec: number | null;
	samples: number | null;
	/** [t, RA ″, Dec ″, settling 0/1], oldest first. */
	history: [number, number, number, number][];
	events: { at: number; kind: GuideEventKind }[];
}

export type Series = [number, number][];

export interface Telemetry {
	sensorTempC: Series;
	setTempC: number | null;
	coolerPowerPct: Series;
	boardTempC: Series;
	wifiDbm: Series;
}

/** GET /api/sessions/<id>. */
export interface SessionDetail extends Omit<SessionSummary, 'frames'> {
	exposureS: number | null;
	gain: number | null;
	camera: string | null;
	focalLengthMm: number | null;
	/** Target, degrees. */
	ra: number | null;
	dec: number | null;
	site: { lat: number; lon: number } | null;
	plan: { planned: number | null; current: number | null; targetIndex: number | null; targets: number | null } | null;
	frames: Frame[];
	guiding: Guiding | null;
	timeline: { at: number; kind: TimelineKind; text: string }[];
	telemetry: Telemetry | null;
	archive: { frames: number; bytes: number } | null;
	/** Frames found but not processed yet (newer services); `frames` lists only processed ones. */
	pending?: number;
	/** This session's stack (newer services), the shape of status.stack. */
	stack?: Stack | null;
}

/** A target's goal and wishlist mark (GET /api/targets; key: a catalog id like "NGC 7000", or a session's target name). */
export interface TargetGoal {
	goalHours: number | null;
	wishlist: boolean;
	note: string | null;
	updatedAt: number;
}

export interface Targets {
	targets: Record<string, TargetGoal>;
}

export type CalibrationType = 'bias' | 'dark' | 'flat';

/** A night's set of calibration frames of one kind and setting (the processor's GET /api/library). */
export interface CalibrationSet {
	id: string;
	type: CalibrationType;
	night: string;
	count: number;
	exposureS: number | null;
	gain: number | null;
	offset: number | null;
	/** Median sensor temperature. */
	sensorTempC: number | null;
	setTempC: number | null;
	binning: number | null;
	rotatorDeg: number | null;
	camera: string | null;
	firstAt: number;
	lastAt: number;
}

export interface Master {
	id: string;
	type: CalibrationType;
	builtAt: number;
	sets: string[];
	frames: number;
	exposureS: number | null;
	gain: number | null;
	offset: number | null;
	tempC: number | null;
	rotatorDeg: number | null;
	night: string;
	median: number | null;
	noise: number | null;
	fitsUrl: string;
}

export interface Library {
	sets: CalibrationSet[];
	masters: Master[];
	updatedAt: number | null;
}

/** Masters (ids) chosen for a target's lights, with what does not quite fit. */
export interface CalibrationChoice {
	bias: string | null;
	dark: string | null;
	flat: string | null;
	darkFlat: string | null;
	warnings: string[];
}

/** GET /api/library/match?target=. */
export interface LibraryMatch extends CalibrationChoice {
	nights?: ({ night: string } & CalibrationChoice)[];
}

export type FinalStatus = 'queued' | 'running' | 'done' | 'failed';

/** A final stack (Siril) of a target over one or more nights (GET /api/finals, newest first). */
export interface Final {
	id: string;
	target: string;
	nights: string[];
	sessions: string[];
	frames: number;
	integrationS: number;
	status: FinalStatus;
	/** "registering 34/80" while running. */
	progress: string | null;
	createdAt: number;
	startedAt: number | null;
	finishedAt: number | null;
	error: string | null;
	/** Started by the processor after a session, not by hand. */
	automatic: boolean;
	calibration: CalibrationChoice;
	outputs: { linearFits: string | null; processedTiff: string | null; previewJpg: string | null; previewSmallJpg: string | null; fullJpg?: string | null };
	/** GET /api/finals/<id> only: the log's tail. */
	log?: string[];
	/** D4 gallery (newer processors): shown in the public gallery, the owner's title and note. */
	published?: boolean;
	title?: string | null;
	note?: string | null;
}

/** The images the viewer opens (B1): the live stack, a final stack, an own upload. */
export type ImageKind = 'stack' | 'final' | 'upload';

/** FITS WCS keywords of the displayed image's data array (TAN, optionally SIP), as numbers and the CTYPE strings. */
export type WcsHeader = Record<string, number | string>;

/** GET /api/images/<kind>/<id>. */
export interface ImageMeta {
	kind: ImageKind;
	id: string;
	target: string | null;
	width: number;
	height: number;
	/** Full resolution, 8-bit. */
	url: string;
	smallUrl: string | null;
	wcs: WcsHeader | null;
	/** FITS data row 1 is the image's top row (always true). */
	rowsTopDown: boolean;
	pixelScaleArcsec: number | null;
	histogram: { bins: number; scale: string; r: number[]; g: number[]; b: number[] } | null;
	/** Median and noise per channel, in the histogram's 0–1 scale. */
	stats: Record<'r' | 'g' | 'b', { median: number | null; noise: number | null }> | null;
	takenAt: number | null;
	integrationS: number | null;
	frames: number | null;
	/** Star measurement possible (linear data, or an upload's own pixels). */
	measurable: boolean;
}

/** GET /api/images/<kind>/<id>/star?x=&y= (display pixels, pixel centres at integers). */
export interface StarMeasure {
	found: boolean;
	x?: number;
	y?: number;
	fwhmPx?: number;
	fwhmArcsec?: number | null;
	hfrPx?: number;
	/** 0 = round. */
	elongation?: number;
	angleDeg?: number;
	peak?: number;
	background?: number;
	snr?: number;
	saturated?: boolean;
	/** Measured on linear data (false: a stretched 8-bit upload). */
	linear?: boolean;
	/** [radius px, value above the background]. */
	profile?: [number, number][];
}

/** An own processed image (D4, the service's GET /api/uploads). */
export interface Upload {
	id: string;
	target: string;
	title: string | null;
	note: string | null;
	createdAt: number;
	takenAt: number | null;
	published: boolean;
	width: number;
	height: number;
	url: string;
	smallUrl: string;
	original: { filename: string; bytes: number; contentType: string };
	imageKind: 'upload';
}

/** Wind at the site, hourly (unix s, m/s at 10 m). */
export interface WindPoint {
	time: number;
	wind: number | null;
	gusts: number | null;
}

/** A source of the conditions page: its data, or why it is missing. */
export type Sourced<T> = { data: T; error: null; fetchedAt: number } | { data: null; error: string; fetchedAt: null };

export interface TimeWindow {
	start: number;
	end: number;
}

/** Darkness and moon for one night (unix ms), computed with SunCalc. */
export interface Sky {
	noon: number;
	nextNoon: number;
	sunset: number | null;
	sunrise: number | null;
	/** Sun below −18°; null in the light summer nights. */
	astronomical: TimeWindow | null;
	/** Sun below −12°. */
	nautical: TimeWindow | null;
	/** Lowest sun altitude of the night, degrees. */
	sunLowest: number;
	moon: {
		illumination: number;
		phase: number;
		events: { at: number; kind: 'rise' | 'set' }[];
		upAtDark: boolean;
	};
}

/** Open-Meteo hour (best-match model). */
export interface WeatherHour {
	time: number;
	cloud: number | null;
	temperature: number | null;
	dewPoint: number | null;
	humidity: number | null;
	/** m/s, 10 m. */
	wind: number | null;
	gusts: number | null;
}

export interface ModelClouds {
	id: string;
	label: string;
	/** Per hour, aligned with `times`: total, low, mid, high (%), null past the model's range. */
	total: (number | null)[];
	low: (number | null)[];
	mid: (number | null)[];
	high: (number | null)[];
}

export interface SeeingPoint {
	time: number;
	/** 7Timer scales: seeing 1 (< 0.5″) … 8 (> 2.5″), transparency 1 (< 0.3 mag/airmass) … 8 (> 1), cloud 1 (0–6 %) … 9 (94–100 %). */
	seeing: number | null;
	transparency: number | null;
	cloud: number | null;
}

export interface KpPoint {
	time: number;
	kp: number;
	/** "observed", "estimated" or "predicted". */
	kind: string;
}

export interface Aurora {
	/** OVATION probability (%) at the site's grid point, and the most within ~1000 km to the north. */
	probability: number;
	northProbability: number;
	observedAt: number | null;
	forecastAt: number | null;
}

/** GET /api/conditions. */
export interface Conditions {
	site: { name: string; lat: number; lon: number };
	sky: Sky;
	/** The night's hours (unix ms), sunset to sunrise. */
	times: number[];
	/** Moon altitude (degrees) at the middle of each hour. */
	moonAltitude: number[];
	weather: Sourced<WeatherHour[]>;
	models: Sourced<ModelClouds[]>;
	seeing: Sourced<SeeingPoint[]>;
	kp: Sourced<{ now: number | null; nowAt: number | null; points: KpPoint[] }>;
	aurora: Sourced<Aurora>;
	verdict: string;
	auroraLine: string;
	updatedAt: number;
}
