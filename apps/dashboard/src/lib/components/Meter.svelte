<script lang="ts">
	let {
		label,
		/** 0..1 */
		value,
		detail = ''
	}: { label: string; value: number | null; detail?: string } = $props();

	const pct = $derived(value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100));
	const level = $derived(pct === null ? 'none' : pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'ok');
</script>

<div class="meter">
	<div class="row">
		<span class="label">{label}</span>
		<span class="value num">{pct === null ? '–' : `${pct}%`}{#if detail}<span class="detail"> {detail}</span>{/if}</span>
	</div>
	<div class="track"><div class="fill {level}" style:width="{pct ?? 0}%"></div></div>
</div>

<style>
	.meter {
		display: grid;
		gap: 5px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-size: 13px;
		white-space: nowrap;
	}
	.label {
		color: var(--muted);
	}
	.value {
		font-weight: 600;
	}
	.detail {
		margin-left: 4px;
		font-weight: 400;
		color: var(--faint);
	}
	.track {
		height: 6px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.07);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: 3px;
		transition: width 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.fill.ok {
		background: linear-gradient(90deg, #22d3ee, #34d399);
	}
	.fill.warn {
		background: linear-gradient(90deg, #f59e0b, #fbbf24);
	}
	.fill.bad {
		background: linear-gradient(90deg, #ef4444, #f87171);
	}
</style>
