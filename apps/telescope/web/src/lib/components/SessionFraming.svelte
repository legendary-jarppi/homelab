<script lang="ts">
	import Card from './Card.svelte';
	import SurveyFraming from './SurveyFraming.svelte';
	import { findDso, formatSize, separation } from '$lib/catalog';
	import { formatDec, formatRa } from '$lib/format';
	import type { ImageMeta, SessionDetail } from '$lib/types';
	import { Wcs, tanProject } from '$lib/wcs';

	/**
	 * B3 on the session report: the stack's plate-solved footprint over the survey, against the planned field (the
	 * ASIAIR's target position at the session's camera angle) and the catalog object. Loaded in the browser.
	 */
	let { session }: { session: SessionDetail } = $props();

	/** Points per edge of the footprint (the plate solve may bend the edges a little: SIP). */
	const EDGE_POINTS = 8;

	let meta = $state.raw<ImageMeta | null>(null);
	let failed = $state(false);
	const version = $derived(session.stack?.imageId ?? (session.hasStack ? 'stack' : null));

	$effect(() => {
		const id = session.id;
		if (!version) return;
		let cancelled = false;
		fetch(`/api/images/stack/${encodeURIComponent(id)}`)
			.then((r) => (r.ok ? (r.json() as Promise<ImageMeta>) : null))
			.then((m) => {
				if (cancelled) return;
				meta = m;
				failed = m === null;
			})
			.catch(() => !cancelled && (failed = true));
		return () => (cancelled = true);
	});

	const solve = $derived.by(() => {
		const wcs = meta ? Wcs.from(meta.wcs) : null;
		if (!meta || !wcs) return null;
		const { width: w, height: h } = meta;
		const edge: [number, number][] = [];
		for (let i = 0; i < EDGE_POINTS; i++) edge.push([-0.5 + (w * i) / EDGE_POINTS, -0.5]);
		for (let i = 0; i < EDGE_POINTS; i++) edge.push([w - 0.5, -0.5 + (h * i) / EDGE_POINTS]);
		for (let i = 0; i < EDGE_POINTS; i++) edge.push([w - 0.5 - (w * i) / EDGE_POINTS, h - 0.5]);
		for (let i = 0; i < EDGE_POINTS; i++) edge.push([-0.5, h - 0.5 - (h * i) / EDGE_POINTS]);
		const centre = wcs.pixelToWorld((w - 1) / 2, (h - 1) / 2);
		// The camera angle as the ASIAIR counts it: the image's top edge points that far west of north.
		const up = tanProject(...wcs.pixelToWorld((w - 1) / 2, (h - 1) / 2 - 100), ...centre);
		const angle = up ? (((-Math.atan2(up[0], up[1]) * 180) / Math.PI) % 360 + 360) % 360 : null;
		return { footprint: edge.map(([x, y]) => wcs.pixelToWorld(x, y)), centre, angle };
	});
	/** The camera angle the session's frames were taken at (the most frequent ROTATOR). */
	const rotator = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const f of session.frames) if (f.rotatorDeg !== null && f.rotatorDeg !== undefined) counts[f.rotatorDeg] = (counts[f.rotatorDeg] ?? 0) + 1;
		const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
		return best ? Number(best[0]) : null;
	});
	const dso = $derived(findDso(session.target));
	const centre = $derived<[number, number] | null>(session.ra !== null && session.dec !== null ? [session.ra, session.dec] : (solve?.centre ?? null));
	const offset = $derived(solve && session.ra !== null && session.dec !== null ? separation(session.ra, session.dec, ...solve.centre) * 60 : null);
</script>

<Card title="Framing">
	{#snippet accessory()}
		{#if solve?.angle !== null && solve?.angle !== undefined}<span class="num">solved {solve.angle.toFixed(1)}°{offset !== null ? ` · ${offset.toFixed(1)}′ off` : ''}</span>{/if}
	{/snippet}
	{#if version && meta === null && !failed}
		<p class="small muted">Loading…</p>
	{:else if centre}
		<SurveyFraming
			ra={centre[0]}
			dec={centre[1]}
			object={dso ? { ra: dso.ra, dec: dso.dec, maj: dso.maj, min: dso.min, pa: dso.pa, label: `${dso.id}${dso.maj !== null ? ` ${formatSize(dso.maj)}` : ''}` } : null}
			angle={rotator ?? solve?.angle ?? 0}
			footprint={solve?.footprint ?? null}
		/>
		{#if solve}
			<p class="small muted">Plate solve of the stack: centre {formatRa(solve.centre[0])} {formatDec(solve.centre[1])}{solve.angle !== null ? `, camera angle ${solve.angle.toFixed(1)}°` : ''}{rotator !== null ? ` (ASIAIR ${rotator}°)` : ''}{offset !== null ? `, ${offset.toFixed(1)}′ from the target position` : ''}. Planned: the target position at the ASIAIR's camera angle.</p>
		{:else}
			<p class="small muted">No plate-solved stack: the planned field only.</p>
		{/if}
	{:else}
		<p class="small muted">No position: the frames have neither RA/Dec nor a plate solve.</p>
	{/if}
</Card>

<style>
	p {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
</style>
