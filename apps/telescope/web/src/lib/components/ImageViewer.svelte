<script lang="ts">
	import type OpenSeadragon from 'openseadragon';
	import { tick } from 'svelte';
	import { objectsOn, starsOn, type ObjectMark, type StarMark } from '$lib/annotate';
	import { portal } from '$lib/portal';
	import type { ImageKind, ImageMeta, StarMeasure } from '$lib/types';
	import { gridLines, Wcs } from '$lib/wcs';
	import Histogram from './Histogram.svelte';
	import StarPanel from './StarPanel.svelte';

	/**
	 * B1/B2: one picture full screen, at full resolution: zoom (wheel, pinch, double tap, Fit and 1:1) and pan
	 * down to single pixels; with `image` (a stack, final or upload) also its histogram, a star measurement on
	 * tap or click, and the objects, named stars and RA/Dec grid from its plate solve. Esc or ✕ closes.
	 * Without `image`, or while its details are unavailable, `src` is shown alone.
	 */
	let { image, src, alt, caption, onclose }: { image?: { kind: ImageKind; id: string } | null; src: string; alt: string; caption?: string; onclose: () => void } = $props();

	let meta = $state.raw<ImageMeta | null>(null);
	let metaError = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let zoom = $state<number | null>(null);
	let showObjects = $state(true);
	let showStars = $state(true);
	let showGrid = $state(false);
	let panel = $state<'histogram' | 'star' | null>(null);
	let star = $state.raw<StarMeasure | null>(null);
	let starBusy = $state(false);
	let starError = $state<string | null>(null);
	let objects = $state.raw<ObjectMark[]>([]);
	let stars = $state.raw<StarMark[]>([]);

	let host = $state<HTMLDivElement>();
	let overlay = $state<HTMLCanvasElement>();
	let panelElement = $state<HTMLElement>();
	let viewer: OpenSeadragon.Viewer | null = null;
	let item: OpenSeadragon.TiledImage | null = null;
	let OSD: typeof OpenSeadragon | null = null;

	const wcs = $derived(Wcs.from(meta?.wcs));
	const scaleArcsec = $derived(meta?.pixelScaleArcsec ?? wcs?.scaleArcsec ?? null);
	const apiBase = $derived(image ? `/api/images/${image.kind}/${encodeURIComponent(image.id)}` : null);

	$effect(() => {
		const key = (e: KeyboardEvent) => e.key === 'Escape' && onclose();
		addEventListener('keydown', key);
		return () => removeEventListener('keydown', key);
	});

	// The image's details first (full-resolution URL, plate solve, histogram), then the viewer on the best picture there is.
	$effect(() => {
		const base = apiBase;
		const element = host;
		if (!element) return;
		let cancelled = false;
		(async () => {
			let details: ImageMeta | null = null;
			if (base) {
				try {
					const response = await fetch(base);
					if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`);
					details = (await response.json()) as ImageMeta;
				} catch (e) {
					metaError = `Image details unavailable: ${(e as Error).message}`;
				}
			}
			OSD = (await import('openseadragon')).default;
			if (cancelled) return;
			meta = details;
			viewer = OSD({
				element,
				// One plain picture, its zoom levels built in the browser; the typings lack this `type: 'image'` form.
				tileSources: { type: 'image', url: details?.url ?? src, buildPyramid: true } as unknown as string,
				drawer: 'canvas',
				showNavigationControl: false,
				visibilityRatio: 0.3,
				minZoomImageRatio: 0.8,
				// 8 screen pixels per image pixel at most.
				maxZoomPixelRatio: 8,
				animationTime: 0.35,
				zoomPerScroll: 1.4,
				gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true },
				gestureSettingsTouch: { clickToZoom: false, dblClickToZoom: true, pinchToZoom: true, flickEnabled: true },
				gestureSettingsPen: { clickToZoom: false, dblClickToZoom: true }
			});
			viewer.addHandler('open', () => {
				item = viewer?.world.getItemAt(0) ?? null;
				draw();
			});
			viewer.addHandler('open-failed', () => (loadError = 'The picture did not load.'));
			viewer.addHandler('update-viewport', draw);
			viewer.addHandler('resize', draw);
			viewer.addHandler('canvas-click', (e) => {
				if (e.quick) measure(e.position);
			});
		})();
		return () => {
			cancelled = true;
			viewer?.destroy();
			viewer = null;
			item = null;
		};
	});

	// Objects and stars on the image once its plate solve is known.
	$effect(() => {
		const solution = wcs;
		const m = meta;
		if (!solution || !m) {
			objects = [];
			stars = [];
			return;
		}
		objects = objectsOn(solution, m.width, m.height);
		starsOn(solution, m.width, m.height).then((list) => (stars = list));
	});

	// Redraw the overlay when what is shown changes (the viewer redraws it on every move).
	$effect(() => {
		void [showObjects, showStars, showGrid, objects, stars, star];
		draw();
	});

	/** Image pixels of the picture shown per display pixel of the metadata (1 unless only a smaller picture loaded). */
	function pictureScale(): number {
		const size = item?.getContentSize();
		return size && meta?.width ? size.x / meta.width : 1;
	}

	/** One image pixel per screen pixel (CSS pixels), about the centre. */
	function actualSize() {
		if (!viewer || !item) return;
		viewer.viewport.zoomTo(item.imageToViewportZoom(1 / pictureScale()));
	}

	async function measure(position: OpenSeadragon.Point) {
		if (!item || !apiBase || !meta) return;
		const k = pictureScale();
		const p = item.viewerElementToImageCoordinates(position);
		const x = p.x / k - 0.5;
		const y = p.y / k - 0.5;
		if (x < -0.5 || y < -0.5 || x > meta.width - 0.5 || y > meta.height - 0.5) return;
		panel = 'star';
		// A stack or final whose linear data is gone (older finals keep only their pictures); an upload is measured on its own pixels.
		if (!meta.measurable && meta.kind !== 'upload') {
			star = null;
			starError = 'The linear data of this image is no longer kept: no star measurement.';
			return;
		}
		starBusy = true;
		starError = null;
		try {
			const response = await fetch(`${apiBase}/star?x=${x.toFixed(1)}&y=${y.toFixed(1)}`);
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`);
			star = (await response.json()) as StarMeasure;
			await tick();
			revealStar();
		} catch (e) {
			star = null;
			starError = `Measurement failed: ${(e as Error).message}`;
		} finally {
			starBusy = false;
		}
	}

	/** When the panel covers the measured star, pan the star into the middle of the free part: above the sheet on a phone, left of the panel on a laptop. */
	function revealStar() {
		if (!viewer || !item || !OSD || !panelElement || !host || !star?.found || star.x === undefined || star.y === undefined) return;
		const k = pictureScale();
		const at = item.imageToViewerElementCoordinates(new OSD.Point((star.x + 0.5) * k, (star.y + 0.5) * k));
		const panelBox = panelElement.getBoundingClientRect();
		const stage = host.getBoundingClientRect();
		const x = at.x + stage.left;
		const y = at.y + stage.top;
		if (x < panelBox.left - 20 || x > panelBox.right + 20 || y < panelBox.top - 20 || y > panelBox.bottom + 20) return;
		const sheet = panelBox.width > stage.width * 0.8;
		const shift = sheet ? new OSD.Point(0, at.y - (panelBox.top - stage.top) / 2) : new OSD.Point(at.x - (panelBox.left - stage.left) / 2, 0);
		viewer.viewport.panBy(viewer.viewport.deltaPointsFromPixels(shift));
	}

	/** Colours of the overlay from the page's theme (red night mode included). */
	function palette() {
		const css = getComputedStyle(document.documentElement);
		const red = document.documentElement.classList.contains('red');
		return {
			object: red ? css.getPropertyValue('--warn') : '#fbbf24',
			star: red ? css.getPropertyValue('--line1') : '#7dd3fc',
			grid: red ? 'rgba(200, 20, 10, 0.45)' : 'rgba(220, 230, 255, 0.35)',
			gridText: red ? css.getPropertyValue('--muted') : 'rgba(220, 230, 255, 0.75)',
			measure: red ? css.getPropertyValue('--text') : '#34d399',
			halo: 'rgba(0, 0, 0, 0.85)'
		};
	}

	/** The overlay: grid, object outlines, stars and the measured star, with labels at a fixed size that do not overlap. */
	function draw() {
		const canvas = overlay;
		if (!canvas || !OSD) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const dpr = devicePixelRatio || 1;
		const cw = canvas.clientWidth;
		const ch = canvas.clientHeight;
		if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
			canvas.width = Math.round(cw * dpr);
			canvas.height = Math.round(ch * dpr);
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, cw, ch);
		if (!item || !meta) {
			zoom = null;
			return;
		}
		const k = pictureScale();
		// Display pixel -> screen: one scale and offset (the viewer does not rotate).
		const origin = item.imageToViewerElementCoordinates(new OSD.Point(0, 0));
		const unit = item.imageToViewerElementCoordinates(new OSD.Point(1000, 0));
		const s = ((unit.x - origin.x) / 1000) * k;
		zoom = s;
		const sx = (x: number) => origin.x + (x + 0.5) * s;
		const sy = (y: number) => origin.y + (y + 0.5) * s;
		const visible = (x: number, y: number, margin = 40) => x >= -margin && y >= -margin && x <= cw + margin && y <= ch + margin;
		const colours = palette();
		ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
		ctx.textBaseline = 'middle';
		ctx.lineJoin = 'round';
		/** Labels are placed after all shapes, most important first, each at the first of its spots where it covers no other. */
		type Spot = [text: string, x: number, y: number, align: 'left' | 'center'];
		const labels: { rank: number; colour: string; spots: Spot[] }[] = [];
		const stroke = (colour: string, width: number, path: () => void) => {
			ctx.strokeStyle = colour;
			ctx.lineWidth = width;
			ctx.beginPath();
			path();
			ctx.stroke();
		};

		if (showGrid && wcs) {
			const tl = item.viewerElementToImageCoordinates(new OSD.Point(0, 0));
			const br = item.viewerElementToImageCoordinates(new OSD.Point(cw, ch));
			const region = {
				x0: Math.max(-0.5, tl.x / k - 0.5),
				y0: Math.max(-0.5, tl.y / k - 0.5),
				x1: Math.min(meta.width - 0.5, br.x / k - 0.5),
				y1: Math.min(meta.height - 0.5, br.y / k - 0.5)
			};
			if (region.x1 > region.x0 && region.y1 > region.y0) {
				const lines = gridLines(wcs, region, cw < 500 ? 3 : 5);
				// Lines inside the picture only; labels where each line leaves the visible part of it: declinations at
				// the left, right ascensions at the bottom (above the tool bar).
				const left = Math.max(0, sx(region.x0));
				const bottom = Math.min(ch - 56, sy(region.y1));
				ctx.save();
				ctx.beginPath();
				ctx.rect(sx(-0.5), sy(-0.5), meta.width * s, meta.height * s);
				ctx.clip();
				for (const line of lines) stroke(colours.grid, 1, () => line.points.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)))));
				ctx.restore();
				for (const line of lines) {
					const screen = line.points.map(([x, y]) => [sx(x), sy(y)] as const).filter(([x, y]) => x >= left && x <= cw && y >= 0 && y <= bottom);
					if (!screen.length) continue;
					const [x, y] = line.axis === 'dec' ? screen.reduce((a, b) => (b[0] < a[0] ? b : a)) : screen.reduce((a, b) => (b[1] > a[1] ? b : a));
					labels.push({ rank: 4, colour: colours.gridText, spots: [line.axis === 'dec' ? [line.label, x + 4, y - 9, 'left'] : [line.label, x, y - 10, 'center']] });
				}
			}
		}

		if (star?.found && star.x !== undefined && star.y !== undefined) {
			const x = sx(star.x);
			const y = sy(star.y);
			const r = Math.max(10, ((star.fwhmPx ?? 4) * s) / 2 + 6);
			stroke(colours.measure, 1.5, () => {
				ctx.arc(x, y, r, 0, 2 * Math.PI);
				ctx.moveTo(x - r - 6, y);
				ctx.lineTo(x - r + 3, y);
				ctx.moveTo(x + r - 3, y);
				ctx.lineTo(x + r + 6, y);
			});
			if (star.fwhmPx !== undefined) labels.push({ rank: 0, colour: colours.measure, spots: [[`FWHM ${star.fwhmPx.toFixed(2)} px`, x + r + 8, y, 'left']] });
		}

		if (showObjects) {
			for (const o of objects) {
				const cx = sx(o.x);
				const cy = sy(o.y);
				const outline = o.outline?.map(([x, y]) => [sx(x), sy(y)] as const);
				const span = outline ? Math.max(...outline.map(([x]) => x)) - Math.min(...outline.map(([x]) => x)) : 0;
				if (outline && span >= 14) {
					if (!outline.some(([x, y]) => visible(x, y, 400))) continue;
					stroke(colours.object, 1.4, () => {
						outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
						ctx.closePath();
					});
					// Above the outline's top, else below its bottom, else under the centre, else on the outline where it
					// comes closest to the middle of the view (a large object reaching in from outside).
					const top = outline.reduce((a, b) => (b[1] < a[1] ? b : a));
					const low = outline.reduce((a, b) => (b[1] > a[1] ? b : a));
					const near = outline.reduce((a, b) => (Math.hypot(b[0] - cw / 2, b[1] - ch / 2) < Math.hypot(a[0] - cw / 2, a[1] - ch / 2) ? b : a));
					labels.push({ rank: 2, colour: colours.object, spots: [[o.label, top[0], top[1] - 10, 'center'], [o.label, low[0], low[1] + 10, 'center'], ...(visible(cx, cy, 0) ? ([[o.label, cx, cy + 16, 'center']] as Spot[]) : []), [o.label, near[0], near[1] - 10, 'center']] });
				} else {
					if (!visible(cx, cy)) continue;
					stroke(colours.object, 1.4, () => ctx.arc(cx, cy, 7, 0, 2 * Math.PI));
					labels.push({ rank: 2, colour: colours.object, spots: [[o.label, cx + 10, cy, 'left'], [o.label, cx, cy + 16, 'center'], [o.label, cx, cy - 16, 'center']] });
				}
			}
		}

		if (showStars) {
			for (const st of stars) {
				const x = sx(st.x);
				const y = sy(st.y);
				if (!visible(x, y)) continue;
				const r = Math.max(7, 13 - st.mag) + Math.min(10, s * 2);
				stroke(colours.star, 1.2, () => ctx.arc(x, y, r, 0, 2 * Math.PI));
				const full = st.designation ? `${st.label} (${st.designation})` : st.label;
				labels.push({ rank: st.designation ? 1 : 3, colour: colours.star, spots: [[full, x + r + 4, y, 'left'], [st.label, x + r + 4, y, 'left'], [st.label, x, y - r - 9, 'center'], [st.label, x, y + r + 9, 'center']] });
			}
		}

		const taken: [number, number, number, number][] = [];
		ctx.lineWidth = 3;
		ctx.strokeStyle = colours.halo;
		for (const { colour, spots } of labels.sort((a, b) => a.rank - b.rank)) {
			for (const [text, x, y, align] of spots) {
				const w = ctx.measureText(text).width;
				const left = align === 'center' ? x - w / 2 : x;
				const box: [number, number, number, number] = [left - 2, y - 8, left + w + 2, y + 8];
				if (box[0] < 0 || box[2] > cw || box[1] < 0 || box[3] > ch) continue;
				if (taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
				taken.push(box);
				ctx.strokeText(text, left, y);
				ctx.fillStyle = colour;
				ctx.fillText(text, left, y);
				break;
			}
		}
	}

	const zoomLabel = $derived(zoom === null ? '' : zoom >= 0.995 && zoom <= 1.005 ? '1:1' : `${zoom >= 1 ? Math.round(zoom * 100) : (zoom * 100).toFixed(zoom < 0.1 ? 1 : 0)} %`);
	const caption2 = $derived([caption, meta ? `${meta.width} × ${meta.height}` : null, scaleArcsec ? `${scaleArcsec.toFixed(2)}″/px` : null].filter(Boolean).join(' · '));
</script>

<div class="full" use:portal role="dialog" aria-modal="true" aria-label={alt}>
	<div class="stage">
		<div class="osd" bind:this={host} aria-label={alt} role="img"></div>
		<canvas class="overlay" bind:this={overlay} aria-hidden="true"></canvas>
		{#if loadError}<p class="note warn">{loadError}</p>{:else if metaError}<p class="note muted">{metaError}</p>{/if}
	</div>
	<div class="bar top">
		<span class="caption">{caption2}</span>
		<span class="zoom num" aria-live="polite">{zoomLabel}</span>
		<button class="btn" onclick={onclose} aria-label="Close">✕</button>
	</div>
	<div class="bar tools" role="toolbar" aria-label="View">
		<button class="btn" onclick={() => viewer?.viewport.goHome()}>Fit</button>
		<button class="btn" class:on={zoomLabel === '1:1'} onclick={actualSize}>1:1</button>
		{#if wcs}
			<button class="btn" class:on={showObjects} aria-pressed={showObjects} onclick={() => (showObjects = !showObjects)}>Objects{objects.length ? ` ${objects.length}` : ''}</button>
			<button class="btn" class:on={showStars} aria-pressed={showStars} onclick={() => (showStars = !showStars)}>Stars{stars.length ? ` ${stars.length}` : ''}</button>
			<button class="btn" class:on={showGrid} aria-pressed={showGrid} onclick={() => (showGrid = !showGrid)}>Grid</button>
		{/if}
		{#if meta?.histogram}<button class="btn" class:on={panel === 'histogram'} aria-pressed={panel === 'histogram'} onclick={() => (panel = panel === 'histogram' ? null : 'histogram')}>Histogram</button>{/if}
		{#if meta}<button class="btn" class:on={panel === 'star'} aria-pressed={panel === 'star'} onclick={() => (panel = panel === 'star' ? null : 'star')}>Star</button>{/if}
	</div>
	{#if panel && meta}
		<aside class="panel" bind:this={panelElement} aria-label={panel === 'star' ? 'Star measurement' : 'Histogram'}>
			<header>
				<strong>{panel === 'star' ? 'Star' : 'Histogram'}</strong>
				<button class="btn" onclick={() => (panel = null)} aria-label="Close panel">✕</button>
			</header>
			{#if panel === 'histogram' && meta.histogram}
				<Histogram histogram={meta.histogram} stats={meta.stats} />
			{:else if panel === 'star'}
				<StarPanel {star} busy={starBusy} error={starError} {wcs} {scaleArcsec} />
			{/if}
		</aside>
	{/if}
</div>

<style>
	.full {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: #000;
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
		touch-action: none;
	}
	.stage {
		position: absolute;
		inset: 0;
	}
	.osd {
		position: absolute;
		inset: 0;
		filter: var(--image-filter);
	}
	.overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.note {
		position: absolute;
		left: 50%;
		bottom: 80px;
		transform: translateX(-50%);
		margin: 0;
		padding: 6px 12px;
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.7);
		font-size: 13px;
		max-width: 90%;
	}
	.bar {
		position: absolute;
		left: max(10px, env(safe-area-inset-left));
		right: max(10px, env(safe-area-inset-right));
		display: flex;
		align-items: center;
		gap: 8px;
		pointer-events: none;
	}
	.bar > * {
		pointer-events: auto;
	}
	.bar.top {
		top: max(10px, env(safe-area-inset-top));
	}
	.bar.top .btn {
		color: var(--text);
	}
	.bar.tools {
		bottom: max(10px, env(safe-area-inset-bottom));
		flex-wrap: wrap;
		justify-content: center;
	}
	.bar .btn {
		background: rgba(10, 12, 20, 0.75);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}
	:global(:root.red) .bar .btn {
		background: rgba(0, 0, 0, 0.8);
	}
	.bar .btn.on {
		color: var(--text);
		border-color: var(--accent);
	}
	.caption {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-shadow: 0 1px 3px #000;
	}
	.zoom {
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
		text-shadow: 0 1px 3px #000;
	}
	.panel {
		position: absolute;
		right: max(10px, env(safe-area-inset-right));
		top: calc(max(10px, env(safe-area-inset-top)) + 44px);
		width: 330px;
		max-height: calc(100% - 140px);
		overflow: auto;
		padding: 12px 14px;
		border-radius: 16px;
		border: 1px solid var(--border);
		background: rgba(8, 10, 18, 0.88);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		display: flex;
		flex-direction: column;
		gap: 10px;
		touch-action: pan-y;
	}
	:global(:root.red) .panel {
		background: rgba(0, 0, 0, 0.9);
	}
	.panel header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.panel header .btn {
		padding: 3px 10px;
	}
	/* Phone: the panel as a sheet above the tools. */
	@media (max-width: 640px) {
		.panel {
			left: max(8px, env(safe-area-inset-left));
			right: max(8px, env(safe-area-inset-right));
			top: auto;
			bottom: calc(max(10px, env(safe-area-inset-bottom)) + 92px);
			width: auto;
			max-height: 40%;
		}
		.bar .btn {
			padding: 6px 11px;
		}
	}
</style>
