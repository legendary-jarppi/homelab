<script lang="ts">
	import type { TiltSummary } from '$lib/types';

	/** A6: the tilt summary in numbers: corner spread, which side is larger, corners against the centre. */
	let { summary }: { summary: TiltSummary } = $props();

	const pct = (v: number | null) => (v === null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(0)} %`);
	const side = (v: number | null, plus: string, minus: string) => (v === null || Math.abs(v) < 0.5 ? '' : v > 0 ? plus : minus);
</script>

<dl class="numbers">
	<div>
		<dt>Corner to corner</dt>
		<dd class="num">{summary.tiltPct === null ? '–' : `${summary.tiltPct.toFixed(0)} %`}</dd>
		{#if summary.worstCorner}<dd class="sub">largest {summary.worstCorner}</dd>{/if}
	</div>
	<div>
		<dt>Left vs right</dt>
		<dd class="num">{pct(summary.leftRightPct)}</dd>
		<dd class="sub">{side(summary.leftRightPct, 'left larger', 'right larger')}</dd>
	</div>
	<div>
		<dt>Top vs bottom</dt>
		<dd class="num">{pct(summary.topBottomPct)}</dd>
		<dd class="sub">{side(summary.topBottomPct, 'top larger', 'bottom larger')}</dd>
	</div>
	<div>
		<dt>Corners vs centre</dt>
		<dd class="num">{pct(summary.curvaturePct)}</dd>
		<dd class="sub">
			{summary.centerFwhmPx !== null && summary.cornersFwhmPx !== null ? `${summary.cornersFwhmPx.toFixed(2)} / ${summary.centerFwhmPx.toFixed(2)} px` : ''}
		</dd>
	</div>
</dl>

<style>
	.numbers {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 8px 14px;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 16px;
		font-weight: 600;
	}
	.sub {
		font-size: 11px;
		font-weight: 400;
		color: var(--faint);
		margin: 0;
	}
</style>
