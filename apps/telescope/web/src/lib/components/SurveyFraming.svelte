<script lang="ts">
	import { untrack } from 'svelte';
	import { FIELD_ARCMIN, separation } from '$lib/catalog';
	import { formatDec, formatRa } from '$lib/format';
	import { fieldCorners, fromSurvey, MAX_PANELS, mosaicSpan, panelOffsets, squareView, SURVEY_CREDIT, surveyFov, surveyUrl, toSurvey } from '$lib/survey';
	import { tanDeproject } from '$lib/wcs';

	/**
	 * B3: the camera's field (or a mosaic of panels) at a camera angle over a DSS2 survey cutout, north up and
	 * east left, with the object's catalog outline, a scale bar and N/E arrows; optionally a session's
	 * plate-solved footprint. `adjustable`: a camera angle slider and the mosaic's panels.
	 */
	let {
		ra,
		dec,
		object = null,
		angle = 0,
		panels = [1, 1],
		footprint = null,
		adjustable = false
	}: {
		/** The planned field's centre, degrees. */
		ra: number;
		dec: number;
		object?: { ra: number; dec: number; maj: number | null; min: number | null; pa: number | null; label: string } | null;
		/** The ASIAIR's camera angle (FITS ROTATOR), degrees. */
		angle?: number;
		/** Mosaic panels: columns (side by side along the image's top edge) × rows. */
		panels?: [number, number];
		/** The actual field from a plate solve, (ra, dec) degrees: n points per edge clockwise from the image's top-left corner (4n in all). */
		footprint?: [number, number][] | null;
		adjustable?: boolean;
	} = $props();

	let cameraAngle = $state(untrack(() => angle));
	let cols = $state(untrack(() => panels[0]));
	let rows = $state(untrack(() => panels[1]));
	let width = $state(0);
	let loaded = $state<{ url: string; ok: boolean } | null>(null);

	/** Degrees across the cutout: twice the field at least, the object and the mosaic with room round them. */
	const need = $derived.by(() => {
		let deg = (2 * FIELD_ARCMIN) / 60;
		if (object) deg = Math.max(deg, 2 * separation(ra, dec, object.ra, object.dec) + ((object.maj ?? 0) * 1.4) / 60);
		deg = Math.max(deg, (Math.hypot(mosaicSpan(cols), mosaicSpan(rows)) * 1.2) / 60);
		for (const [r, d] of footprint ?? []) deg = Math.max(deg, 2.4 * separation(ra, dec, r, d));
		return deg;
	});
	const view = $derived(squareView(ra, dec, surveyFov(need)));
	const url = $derived(surveyUrl(view));
	/** CSS px per cutout px. */
	const k = $derived(width / view.w);

	function points(sky: [number, number][]): string {
		const out: string[] = [];
		for (const [r, d] of sky) {
			const p = toSurvey(view, r, d);
			if (p) out.push(`${(p[0] * k).toFixed(1)},${(p[1] * k).toFixed(1)}`);
		}
		return out.join(' ');
	}

	/** A small triangle out of the middle of the top edge (sky corners a, b; `centre` in cutout px): which way is the image's top. */
	function topMark(a: [number, number], b: [number, number], centre: [number, number] | null): string | null {
		const pa = toSurvey(view, ...a);
		const pb = toSurvey(view, ...b);
		if (!pa || !pb || !centre) return null;
		const mx = ((pa[0] + pb[0]) / 2) * k;
		const my = ((pa[1] + pb[1]) / 2) * k;
		const dx = mx - centre[0] * k;
		const dy = my - centre[1] * k;
		const n = Math.hypot(dx, dy) || 1;
		const [ux, uy] = [dx / n, dy / n];
		const s = 8;
		return [
			[mx - uy * s, my + ux * s],
			[mx + ux * s * 1.3, my + uy * s * 1.3],
			[mx + uy * s, my - ux * s]
		]
			.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
			.join(' ');
	}

	const offsets = $derived(panelOffsets(cols, rows));
	const tiles = $derived(offsets.map((offset) => points(fieldCorners(ra, dec, cameraAngle, offset))));
	/** The whole mosaic's top edge: the top-left panel's top-left corner to the top-right panel's top-right one. */
	const plannedTop = $derived(topMark(fieldCorners(ra, dec, cameraAngle, offsets[0])[0], fieldCorners(ra, dec, cameraAngle, offsets[cols - 1])[1], toSurvey(view, ra, dec)));
	const actual = $derived(footprint && footprint.length > 3 ? points([...footprint, footprint[0]]) : null);
	const actualTop = $derived.by(() => {
		if (!footprint || footprint.length < 4) return null;
		const px = footprint.map(([r, d]) => toSurvey(view, r, d)).filter((p) => p !== null);
		const centre: [number, number] = [px.reduce((s, p) => s + p[0], 0) / px.length, px.reduce((s, p) => s + p[1], 0) / px.length];
		return topMark(footprint[0], footprint[footprint.length / 4], centre);
	});
	const outline = $derived.by(() => {
		if (!object || object.maj === null) return null;
		const a = object.maj / 120;
		const b = (object.min ?? object.maj) / 120;
		const pa = ((object.pa ?? 0) * Math.PI) / 180;
		const sky: [number, number][] = [];
		for (let i = 0; i <= 64; i++) {
			const t = (2 * Math.PI * i) / 64;
			// Offsets east (ξ) and north (η): the major axis along the position angle.
			const xi = a * Math.cos(t) * Math.sin(pa) + b * Math.sin(t) * Math.cos(pa);
			const eta = a * Math.cos(t) * Math.cos(pa) - b * Math.sin(t) * Math.sin(pa);
			sky.push(tanDeproject(xi, eta, object.ra, object.dec));
		}
		return points(sky);
	});
	const marker = $derived.by(() => {
		if (!object) return null;
		const p = toSurvey(view, object.ra, object.dec);
		return p ? { x: p[0] * k, y: p[1] * k } : null;
	});

	/** N and E arrows near the bottom-right corner, from the sky there (meridians converge away from the centre). */
	const compass = $derived.by(() => {
		const x = view.w * 0.88;
		const y = view.h * 0.86;
		const [r, d] = fromSurvey(view, x, y);
		const north = toSurvey(view, r, d + 0.05);
		const east = toSurvey(view, r + 0.05 / Math.max(0.01, Math.cos((d * Math.PI) / 180)), d);
		if (!north || !east) return null;
		const arrow = (p: [number, number]) => {
			const dx = p[0] - x;
			const dy = p[1] - y;
			const n = Math.hypot(dx, dy) || 1;
			return { x: (dx / n) * 30, y: (dy / n) * 30 };
		};
		return { x: x * k, y: y * k, n: arrow(north), e: arrow(east) };
	});
	const SCALES = [5, 10, 15, 20, 30, 60, 120, 180, 300];
	const scale = $derived.by(() => {
		const arcmin = SCALES.filter((s) => s <= (view.fov * 60) / 5).at(-1) ?? SCALES[0];
		return { arcmin, px: (arcmin / 60 / (view.fov / view.w)) * k, label: arcmin >= 60 ? `${arcmin / 60}°` : `${arcmin}′` };
	});
	const mosaicText = $derived(cols * rows > 1 ? `${cols} wide × ${rows} tall panels, 15 % overlap, ${(mosaicSpan(cols) / 60).toFixed(2)}° × ${(mosaicSpan(rows) / 60).toFixed(2)}°` : `${(FIELD_ARCMIN / 60).toFixed(2)}° × ${(FIELD_ARCMIN / 60).toFixed(2)}°`);
	const shownAngle = $derived(((Math.round(cameraAngle) % 360) + 360) % 360);
</script>

<div class="framing">
	<div class="sky" bind:clientWidth={width}>
		<img src={url} alt="Survey image (DSS2) around {object?.label ?? 'the target'}" loading="lazy" decoding="async" onload={() => (loaded = { url, ok: true })} onerror={() => (loaded = { url, ok: false })} />
		{#if loaded?.url !== url}<span class="status muted small">Loading survey…</span>{:else if !loaded.ok}<span class="status muted small">Survey image unavailable</span>{/if}
		{#if width > 0}
			<svg viewBox="0 0 {width} {width}" aria-hidden="true">
				{#if outline}<polyline points={outline} class="object" />{:else if marker}<circle cx={marker.x} cy={marker.y} r="5" class="object" />{/if}
				{#each tiles as t, i (i)}<polygon points={t} class="fov" class:planned={actual !== null} />{/each}
				{#if plannedTop}<polygon points={plannedTop} class="top" />{/if}
				{#if actual}<polyline points={actual} class="actual" />{/if}
				{#if actualTop}<polygon points={actualTop} class="top actual-top" />{/if}
				{#if compass}
					<g class="compass" transform="translate({compass.x} {compass.y})">
						<line x1="0" y1="0" x2={compass.n.x} y2={compass.n.y} />
						<line x1="0" y1="0" x2={compass.e.x} y2={compass.e.y} />
						<text x={compass.n.x * 1.45} y={compass.n.y * 1.45} class="label">N</text>
						<text x={compass.e.x * 1.45} y={compass.e.y * 1.45} class="label">E</text>
					</g>
				{/if}
				<g class="scale" transform="translate({width * 0.05} {width * 0.93})">
					<line x1="0" y1="0" x2={scale.px} y2="0" />
					<line x1="0" y1="-4" x2="0" y2="4" />
					<line x1={scale.px} y1="-4" x2={scale.px} y2="4" />
					<text x={scale.px / 2} y="-8" class="label">{scale.label}</text>
				</g>
			</svg>
		{/if}
	</div>

	<div class="legend small muted">
		{#if actual}<span><i class="swatch actual"></i>Plate solve</span>{/if}
		<span><i class="swatch fov" class:planned={actual !== null}></i>{actual ? 'Planned' : 'Field'} {mosaicText}, camera angle {shownAngle}°</span>
		{#if object}<span><i class="swatch object"></i>{object.label}</span>{/if}
		<span>Survey {view.fov}° wide</span>
	</div>

	{#if adjustable}
		<div class="controls">
			<label class="angle small">
				<span>Camera angle</span>
				<input type="range" min="0" max="179" step="1" bind:value={cameraAngle} aria-label="Camera angle" />
				<span class="num">{shownAngle}° <span class="faint">/ {(shownAngle + 180) % 360}°</span></span>
			</label>
			<div class="panels small">
				<span>Mosaic</span>
				<button class="btn" disabled={cols <= 1} onclick={() => cols--} aria-label="Fewer panels across">−</button>
				<span class="num">{cols}</span>
				<button class="btn" disabled={cols >= MAX_PANELS} onclick={() => cols++} aria-label="More panels across">+</button>
				<span>×</span>
				<button class="btn" disabled={rows <= 1} onclick={() => rows--} aria-label="Fewer panels up">−</button>
				<span class="num">{rows}</span>
				<button class="btn" disabled={rows >= MAX_PANELS} onclick={() => rows++} aria-label="More panels up">+</button>
			</div>
		</div>
		<p class="small muted">Centre {formatRa(ra)} {formatDec(dec)} · the ASIAIR's camera angle, the second one after a meridian flip; the tick marks the image's top edge.</p>
	{/if}

	<p class="credit faint small">
		Survey: <a href={SURVEY_CREDIT.surveyUrl}>{SURVEY_CREDIT.survey}</a> ({SURVEY_CREDIT.text}) via <a href={SURVEY_CREDIT.serviceUrl}>{SURVEY_CREDIT.service}</a>, {SURVEY_CREDIT.serviceText}.
	</p>
</div>

<style>
	.framing {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	p {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.sky {
		position: relative;
		width: 100%;
		aspect-ratio: 1;
		border-radius: 14px;
		overflow: hidden;
		border: 1px solid var(--border);
		background: var(--bg);
	}
	.sky img,
	.sky svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.status {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
	}
	svg {
		overflow: visible;
	}
	.object {
		fill: none;
		stroke: var(--line2);
		stroke-width: 1.5;
	}
	.fov {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.6;
	}
	.fov.planned {
		stroke-dasharray: 6 4;
	}
	.top {
		fill: var(--accent);
	}
	.actual {
		fill: none;
		stroke: var(--line3);
		stroke-width: 2;
	}
	.actual-top {
		fill: var(--line3);
	}
	.compass line,
	.scale line {
		stroke: var(--text);
		stroke-width: 1.5;
	}
	.label {
		fill: var(--text);
		stroke: var(--bg);
		stroke-width: 3px;
		paint-order: stroke;
		font-size: 12px;
		font-weight: 600;
		text-anchor: middle;
		dominant-baseline: middle;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.swatch {
		display: inline-block;
		width: 16px;
		height: 0;
		border-top: 2px solid var(--accent);
	}
	.swatch.planned {
		border-top-style: dashed;
	}
	.swatch.actual {
		border-top-color: var(--line3);
	}
	.swatch.object {
		border-top-color: var(--line2);
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 18px;
	}
	.angle {
		flex: 1 1 260px;
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.angle input {
		flex: 1;
		min-width: 0;
		accent-color: var(--accent);
	}
	.panels {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.panels .btn {
		padding: 3px 11px;
	}
	.panels .num {
		min-width: 1ch;
		text-align: center;
	}
	.credit a {
		color: inherit;
	}
</style>
