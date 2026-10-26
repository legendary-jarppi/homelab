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
	/** The filter in the train that night (the header's FILTER, else the service's FILTERS history); null: none. */
	filter?: string | null;
	/** D6 (newer services): rejected exposure, medians of the accepted frames, guiding RMS during the exposures (quadratic mean), rejections by first reason. */
	rejectedS?: number;
	hfr?: number | null;
	fwhmPx?: number | null;
	stars?: number | null;
	backgroundAdu?: number | null;
	guidingRmsArcsec?: number | null;
	rejectReasons?: Partial<Record<RejectKind, number>>;
	/** R6 (newer services): medians of the accepted frames' sky brightness (mag/arcsec²), zero point (mag for 1 e-/s) and sky (e-/s per camera pixel), and the sensor's read noise (e-); null until measured. */
	skyMag?: number | null;
	zeroPoint?: number | null;
	skyEps?: number | null;
	readNoiseE?: number | null;
}

/** R6: the session report's exposure advice from the measured sky and read noise (service `skyq.advice`). */
export interface ExposureAdvice {
	readNoiseE: number;
	darkCurrentEps: number | null;
	/** Median sky of the accepted frames, e-/s per camera pixel (green). */
	skyEps: number;
	/** Rounded up to a usual length, at most the service's cap (600 s). */
	recommendedSubS: number;
	/** Where read noise adds exactly 5 % to the noise, s. */
	neededSubS: number;
	currentSubS: number | null;
	/** Read noise's fraction of a current sub's noise variance. */
	readNoiseShare: number | null;
	/** How much read noise adds to the noise of sky and dark current alone at the current sub, %. */
	noiseAddedPct: number | null;
	text: string;
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
	/** Focuser (EAF) position from FITS FOCUSPOS (A5; null when unknown). */
	focusPos?: number | null;
	/** A7: satellite, plane and meteor trails marked in the frame; null until scanned (newer services). */
	trails?: Trail[] | null;
	/** R6: sky brightness (mag/arcsec², the green pixels calibrated against Gaia BP) and zero point (mag for 1 e-/s); null until measured or when it cannot be. */
	skyMag?: number | null;
	zeroPoint?: number | null;
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
	/** A5: the auto focus runs in the session's window (newer services). */
	autofocus?: AutofocusRun[];
	/** A7: trails over the session's frames (newer services). */
	trails?: TrailCounts;
	/** R6: sub length advice; null before the sky or the read noise is measured (newer services). */
	exposure?: ExposureAdvice | null;
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
	/** The filter the frames were taken through (header, else the processor's FILTERS history); null: none. */
	filter?: string | null;
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
	filter?: string | null;
	night: string;
	median: number | null;
	noise: number | null;
	fitsUrl: string;
}

export interface Library {
	sets: CalibrationSet[];
	masters: Master[];
	/** Masters that could not be built (not retried until their set changes). */
	failed?: { set: string; id: string; error: string; at: number }[];
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

/** One calibration group of a target's lights (night, exposure, gain, offset, temperature, camera angle modulo 180°) and what the processor chose for it. */
export interface CalibrationGroup extends CalibrationChoice {
	night: string;
	frames: number;
	exposureS: number | null;
	gain: number | null;
	offset: number | null;
	tempC: number | null;
	rotatorDeg: number | null;
	/** The dark is of another exposure, scaled by the exposure ratio. */
	darkScaled: boolean;
	lightsBias: string | null;
}

/** GET /api/library/match?target=. */
export interface LibraryMatch extends CalibrationChoice {
	nights?: CalibrationGroup[];
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

/** D6: a rejected frame's first reason, as the service counts them (`rejectReasons`). */
export type RejectKind = 'stars' | 'hfr' | 'background' | 'elongation' | 'guiding' | 'alignment' | 'manual' | 'unreadable' | 'other';

/** D6: one night's ERA5 cloud during its darkness (astronomical, else nautical). */
export interface ClearNight {
	night: string;
	/** Hours of darkness; 0 in the light summer nights. */
	darkHours: number;
	/** Dark hours with ERA5 cloud ≤ CLEAR_PCT; null when ERA5 does not reach the night yet. */
	clearHours: number | null;
	/** At least CLEAR_NIGHT_HOURS clear dark hours (half the dark hours when the darkness is shorter); null unknown (no darkness or no ERA5 yet). */
	clear: boolean | null;
	imaged: boolean;
}

/** D6: clear nights per month (YYYY-MM). */
export interface ClearMonth {
	month: string;
	/** Nights with darkness. */
	darkNights: number;
	/** Dark nights ERA5 already covers. */
	known: number;
	clear: number;
	clearImaged: number;
	clearMissed: number;
	/** Imaged although ERA5 had fewer clear dark hours (gaps, thin cloud, ERA5's 28 km grid). */
	imagedNotClear: number;
	imaged: number;
}

/** C4: which forecast is compared: the run current 24 h before the hour, or the latest run before it. */
export type ForecastLead = 'dayAhead' | 'latest';

export interface ModelScore {
	id: string;
	label: string;
	/** Hours with both a forecast and frames to judge it by. */
	hours: number;
	/** Hours where the clear/cloudy call (cloud ≤ CLEAR_PCT) matched the frames. */
	hits: number;
	hitRate: number | null;
	/** Mean absolute error and mean (forecast − observed), percentage points. */
	mae: number | null;
	bias: number | null;
}

/** C4: one model's forecast for an hour (%). */
export interface ModelHour {
	dayAhead: number | null;
	latest: number | null;
	low: number | null;
	mid: number | null;
	high: number | null;
}

/** C4: an hour of a session (Open-Meteo's hour mark, unix s; frames whose middle lies within ±30 min). */
export interface ForecastHour {
	time: number;
	/** Cloud seen in the frames, % (null: too little exposure to judge in darkness above the trees). */
	observed: number | null;
	/** Judged exposure and frames in the hour, and how many of them counted as cloudy. */
	exposureS: number;
	frames: number;
	cloudyFrames: number;
	models: Record<string, ModelHour>;
}

export interface ForecastSession {
	id: string;
	night: string;
	target: string;
	mode: string;
	firstFrameAt: number;
	lastFrameAt: number;
	/** The clear reference: the 90th percentile of the stars in the judged frames. */
	referenceStars: number | null;
	judgedFrames: number;
	hours: ForecastHour[];
	scores: Record<ForecastLead, ModelScore[]>;
	/** Why the session has no truth (Live stacking, too few frames in darkness …), else null. */
	excluded: string | null;
	/** The forecasts could not be fetched. */
	forecastError: string | null;
}

/** C4: the data of /stats/forecasts. */
export interface ForecastReport {
	clearPct: number;
	models: { id: string; label: string }[];
	sessions: ForecastSession[];
	leaderboard: Record<ForecastLead, ModelScore[]>;
}

/** A5: an auto focus run from an archived Autorun log (GET /api/focus; session detail `autofocus`). */
export interface AutofocusRun {
	at: number;
	endedAt: number | null;
	night: string | null;
	target: string | null;
	/** What follows "Run AF" in the log: "before Autorun start", "1 hours later", "after Auto Meridian filpped" … */
	reason: string | null;
	exposureS: number | null;
	/** The focuser's temperature, whole °C. */
	temperatureC: number | null;
	success: boolean | null;
	position: number | null;
	/** [EAF position, star size, step: 0 find focus star, 1 V-curve, 2 focus point], in order. */
	points: [number, number, number][];
	bestSize: number | null;
	failure: string | null;
	/** Session detail: 'live' while the run's log is not archived yet (then only when it ran). */
	source?: 'log' | 'live';
}

/** A5: GET /api/focus. */
export interface FocusReport {
	runs: AutofocusRun[];
	updatedAt: number | null;
}

/** R6: focus advice from the V-curves and the temperature coefficient (src/lib/focus.ts focusAdvice). */
export interface FocusAdvice {
	stepsPerDegC: number;
	stepsPerDegCErr: number;
	/** Steps from best focus where stars grow TOLERANCE_PCT, and that in °C at stepsPerDegC. */
	toleranceSteps: number;
	toleranceDegC: number;
	/** The ASIAIR's temperature trigger as its runs show it; null when none is seen (or it no longer fires). */
	asiairTriggerDegC: number | null;
	summary: string;
}

/** R6: a calibration reminder (src/lib/calibration.ts). */
export interface CalibrationItem {
	level: 'info' | 'warn';
	kind: 'flat' | 'dark' | 'bias' | 'other';
	text: string;
	/** The ASIAIR target name the item is about; absent when it is about the camera or every target. */
	target?: string;
}

/** R6: src/lib/server/advice.ts adviceReport(). */
export interface AdviceReport {
	focus: FocusAdvice | null;
	calibration: CalibrationItem[];
	generatedAt: number;
}

/** A5: temperatures over a session window (GET /api/temperature), [unix s, °C]. */
export interface SessionTemperatures {
	/** The cabin's outdoor RuuviTag from Prometheus. */
	ruuvi: Sourced<Series>;
	/** Open-Meteo's hourly 2 m temperature at the site. */
	openMeteo: Sourced<Series>;
}

/** D7: RMS in arcseconds. */
export interface GuideRms {
	ra: number | null;
	dec: number | null;
	total: number | null;
}

/** D7: GET /api/guidelogs, newest first. */
export interface GuideLogSummary {
	/** The file's stem, PHD2_GuideLog_<date>_<time>. */
	id: string;
	night: string | null;
	startedAt: number | null;
	endedAt: number | null;
	sections: number;
	guidingS: number;
	rmsArcsec: GuideRms;
	/** Per section: [startedAt, durationS, total RMS ″ or null]. */
	sectionRms: [number, number, number | null][];
}

export interface PePeriod {
	periodS: number;
	amplitudeArcsec: number;
}

export interface GuideCorrections {
	steps: number;
	pulses: number;
	share: number | null;
	meanMs: number | null;
	maxMs: number | null;
	/** Pulses for a positive guide distance (W in RA) and a negative one. */
	positive: number;
	negative: number;
}

export interface GuideSection {
	index: number;
	startedAt: number;
	endedAt: number;
	durationS: number;
	pierSide: string | null;
	decDeg: number | null;
	hourAngleH: number | null;
	pixelScaleArcsec: number | null;
	exposureS: number | null;
	steps: number;
	lost: number;
	outliers: number;
	settling: number;
	dithered: number;
	dithers: number;
	rmsArcsec: GuideRms;
	peakArcsec: { ra: number | null; dec: number | null };
	corrections: { ra: GuideCorrections; dec: GuideCorrections };
	decDrift: { arcsecPerMin: number | null; polarErrorArcmin: number | null } | null;
	pe: { periods: PePeriod[]; peakToPeakArcsec: number | null; peakToPeakAxisArcsec: number | null; unguidedRmsArcsec: number | null; raDriftArcsecPerMin: number | null } | null;
}

/** D7: GET /api/guidelogs/<id>. */
export interface GuideLogDetail extends GuideLogSummary {
	mount: string | null;
	pixelScaleArcsec: number | null;
	guidingSections: GuideSection[];
	pe: {
		sections: number;
		minSectionS: number;
		periodRangeS: [number, number];
		periods: PePeriod[];
		peakToPeakArcsec: number | null;
		peakToPeakAxisArcsec: number | null;
		/** [period s, amplitude ″], the duration-weighted mean over the analysed sections. */
		periodogram: [number, number][];
		/** [t, drift-free RA position ″, its 30 s running mean or null]. */
		curve: [number, number, number | null][];
	} | null;
	decDrift: { sections: number; maxArcsecPerMin: number | null; polarErrorArcmin: number | null } | null;
	backlash: {
		reversals: number;
		measured: number;
		unanswered: number;
		sameWay: number;
		reversalMs: number | null;
		reversalPulses: number | null;
		sameWayMs: number | null;
		sameWayPulses: number | null;
		estimateMs: number | null;
		estimateArcsec: number | null;
	} | null;
	corrections: { ra: GuideCorrections; dec: GuideCorrections };
	/** [t, RA ″, Dec ″, settling], every measured step (downsampled to 3000). */
	series: [number, number, number, boolean][];
}

/** B4: one picture of a session timelapse. Frames: every analysed frame; stack: the stack after `frames` accepted frames. */
export interface TimelapseStep {
	step: number;
	frameId: string;
	number: number;
	at: number;
	accepted: boolean;
	rejectReason: string | null;
	/** Frames only: aligned by its stars, or (not aligned) placed by its plate solve or like its nearest aligned neighbour. */
	placement?: 'aligned' | 'plateSolve' | 'neighbour';
	/** Stack only: frames and seconds in the stack so far. */
	frames?: number;
	integrationS?: number;
	url: string;
}

export interface TimelapseSequence {
	steps: TimelapseStep[];
	webpUrl: string | null;
	webpBytes: number | null;
}

/** B4: GET /api/sessions/<id>/timelapse. */
export interface Timelapse {
	sessionId: string;
	target: string;
	state: 'ready' | 'building' | 'queued' | 'waiting' | 'failed' | 'unavailable';
	/** The sequences shown are older than the session's frames and decisions (a build is due or running). */
	stale: boolean;
	progress: { kind: 'frames' | 'stack' | 'webp'; done: number; total: number } | null;
	error: string | null;
	nextBuildAt: number | null;
	builtAt: number | null;
	width: number | null;
	height: number | null;
	bytes: number | null;
	/** The WebP's step length. */
	frameMs: number;
	frames: TimelapseSequence | null;
	stack: TimelapseSequence | null;
}

/** A7: a straight trail on the frame's preview grid (superpixels: x right, y down, pixel centres at integers, 1504² for the ASI533MC). */
export interface Trail {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/** FWHM across it, preview pixels. */
	widthPx: number;
}

export interface TrailCounts {
	/** Frames scanned so far (older ones by a backfill). */
	scanned: number;
	/** Frames with at least one trail. */
	frames: number;
	count: number;
}

/** A6: a cell of the sensor's 3×3 grid (bounds in camera pixels; numbers null with fewer than 5 measured stars). */
export interface TiltCell {
	row: number;
	col: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	stars: number;
	/** Median star FWHM, camera pixels (Gaussian-equivalent, adaptive moments). */
	fwhmPx: number | null;
	fwhmArcsec: number | null;
	hfrPx: number | null;
	/** 1 − minor/major, 0 = round. */
	elongation: number | null;
	/** The stars' dominant long axis, degrees clockwise from +x on the screen (0–180). */
	angleDeg: number | null;
}

export type TiltLevel = 'ok' | 'minor' | 'check';

export interface TiltSummary {
	centerFwhmPx: number | null;
	cornersFwhmPx: number | null;
	/** Largest minus smallest corner FWHM, % of the corners' mean. */
	tiltPct: number | null;
	worstCorner: string | null;
	bestCorner: string | null;
	/** Left column against right column, % (positive: left larger). */
	leftRightPct: number | null;
	/** Top row against bottom row, % (positive: top larger). */
	topBottomPct: number | null;
	/** Corners against the centre, % (positive: corners larger). */
	curvaturePct: number | null;
	cornerElongation: 'radial' | 'tangential' | 'mixed' | null;
	/** Elongated the same way across the field: tracking, not optics. */
	sameDirection: boolean;
	level: TiltLevel | null;
	verdict: string;
}

/** A6: GET /api/sessions/<id>/frames/<frameId>/inspect. */
export interface FrameInspection {
	sessionId: string;
	frameId: string;
	number: number | null;
	at: number;
	/** Camera pixels. */
	width: number;
	height: number;
	/** Per camera pixel. */
	pixelScaleArcsec: number | null;
	cells: TiltCell[];
	summary: TiltSummary;
	/** The nine crops (cropPx camera pixels each, gapPx between) in one JPEG. */
	mosaicUrl: string;
	cropPx: number;
	gapPx: number;
	crops: { row: number; col: number; x: number; y: number }[];
}

/** A6: GET /api/sessions/<id>/inspect: the cells of the session's best accepted frames, median per cell. */
export interface SessionInspection {
	sessionId: string;
	frames: { id: string; number: number | null }[];
	cells: TiltCell[] | null;
	summary: TiltSummary | null;
	pixelScaleArcsec: number | null;
	width: number | null;
	height: number | null;
	computedAt: number | null;
}

/** R6: tonight's pick or a night's morning report as the scheduler would send it (GET /api/digest/preview). */
export interface Digest {
	kind: 'pick' | 'report';
	/** The night, YYYY-MM-DD (the evening it starts). */
	night: string;
	/** Worth sending (a usable night, frames to report); else `reason` says why not. */
	send: boolean;
	reason: string | null;
	title: string;
	/** Lines separated by "\n". */
	body: string;
	url: string;
	/** When it is due, unix s; null while the night's imaging is still running. */
	dueAt: number | null;
	/** From the service's sent markers: when it went out, unix s; null when not (or unknown). */
	sentAt: number | null;
	/** A notify token is configured (else nothing is ever sent). */
	notifyConfigured: boolean;
	generatedAt: number;
}
