<script lang="ts" module>
	import type { Split } from '$lib/domain';

	export interface Bar {
		/** Axis label (may be empty). */
		label: string;
		/** Shown when the bar is tapped, e.g. "Week 12 · 16.3.–22.3.". */
		title: string;
		split: Split;
		/** Drill-down link offered for the tapped bar. */
		href?: string;
	}
</script>

<script lang="ts">
	import { MACHINES, formatKm, splitTotal } from '$lib/domain';

	interface Props {
		name?: string;
		bars: Bar[];
		/** Top of the scale in meters; shared between charts that are compared side by side. */
		max: number;
		/** Index of the bar to emphasise (current week/month), -1 for none. */
		current?: number;
		height?: number;
	}

	let { name, bars, max, current = -1, height = 150 }: Props = $props();
	/** Tapped bar; tied to the `bars` it was picked from, so new data (another year/month) clears it. */
	let selection = $state.raw<{ bars: Bar[]; index: number } | null>(null);
	const selected = $derived(selection?.bars === bars ? selection.index : null);

	/** Gridline spacing: 1, 2 or 5 x 10^n km, giving 2-5 lines. */
	const step = $derived.by(() => {
		const raw = Math.max(max, 1000) / 4;
		const magnitude = 10 ** Math.floor(Math.log10(raw));
		return ([1, 2, 5, 10].map((f) => f * magnitude).find((s) => s >= raw) ?? raw);
	});
	const top = $derived(Math.max(step, Math.ceil(max / step) * step));
	const ticks = $derived(Array.from({ length: Math.round(top / step) }, (_, i) => (i + 1) * step));
	const picked = $derived(selected === null ? null : bars[selected]);
</script>

<figure>
	{#if name}<figcaption>{name}</figcaption>{/if}
	<div class="plot" style="height: {height}px">
		{#each ticks as t (t)}
			<div class="grid" style="bottom: {(t / top) * 100}%"><span class="num">{formatKm(t, 0)}</span></div>
		{/each}
		<div class="bars">
			{#each bars as bar, i (i)}
				<button
					type="button"
					class="col"
					class:current={i === current}
					class:selected={i === selected}
					aria-label="{bar.title}: {formatKm(splitTotal(bar.split), 1)} km"
					onclick={() => (selection = selected === i ? null : { bars, index: i })}
				>
					<span class="stack" style="height: {(splitTotal(bar.split) / top) * 100}%">
						{#each MACHINES as m (m.id)}
							{#if bar.split[m.id] > 0}
								<span style="flex: {bar.split[m.id]}; background: var(--{m.id})"></span>
							{/if}
						{/each}
					</span>
				</button>
			{/each}
		</div>
	</div>
	<div class="labels" aria-hidden="true">
		{#each bars as bar, i (i)}
			<span class:current={i === current}>{bar.label}</span>
		{/each}
	</div>
	<p class="info" aria-live="polite">
		{#if picked}
			<strong>{picked.title}</strong>
			<span class="num">{formatKm(splitTotal(picked.split), 1)} km</span>
			{#each MACHINES as m (m.id)}
				{#if picked.split[m.id] > 0}
					<span class="muted num"><span class="dot" style="background: var(--{m.id})"></span> {formatKm(picked.split[m.id], 1)}</span>
				{/if}
			{/each}
			{#if picked.href}<a href={picked.href}>Open →</a>{/if}
		{:else}
			{#each MACHINES as m (m.id)}
				<span class="muted"><span class="dot" style="background: var(--{m.id})"></span> {m.name}</span>
			{/each}
			<span class="muted">· tap a bar</span>
		{/if}
	</p>
</figure>

<style>
	figure {
		margin: 0;
		min-width: 0;
	}
	figcaption {
		margin-bottom: 8px;
		font-weight: 600;
	}
	.plot {
		position: relative;
		margin-left: 26px;
	}
	.grid {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px dashed var(--border);
	}
	.grid span {
		position: absolute;
		right: calc(100% + 5px);
		top: -0.6em;
		font-size: 10px;
		color: var(--faint);
	}
	.bars {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-end;
		gap: 2px;
		border-bottom: 1px solid var(--muted);
	}
	.col {
		flex: 1;
		min-width: 0;
		height: 100%;
		padding: 0;
		display: flex;
		align-items: flex-end;
		background: none;
		border: 0;
		border-radius: 3px 3px 0 0;
		cursor: pointer;
	}
	.col.current,
	.col.selected {
		background: rgba(255, 255, 255, 0.05);
	}
	.col.selected {
		outline: 1px solid var(--muted);
	}
	.stack {
		width: 100%;
		display: flex;
		flex-direction: column-reverse;
		gap: 1px;
		border-radius: 3px 3px 0 0;
		overflow: hidden;
	}
	.labels {
		display: flex;
		gap: 2px;
		margin: 4px 0 0 26px;
		font-size: 10px;
		color: var(--muted);
	}
	.labels span {
		flex: 1;
		min-width: 0;
		text-align: center;
		white-space: nowrap;
		overflow: visible;
	}
	.labels .current {
		color: var(--text);
		font-weight: 600;
	}
	.info {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		align-items: baseline;
		min-height: 2.6em;
		margin: 8px 0 0;
		font-size: 13px;
	}
	.info a {
		color: var(--accent);
		text-decoration: none;
	}
</style>
