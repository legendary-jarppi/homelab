<script lang="ts">
	import { eventTime } from '$lib/dates';
	import { formatAgo } from '$lib/format';
	import { night } from '$lib/night.svelte';
	import type { TelescopeData, TelescopeFrame } from '$lib/types';

	/** A frame's details; `full` adds the camera, optics and sky measurements (the viewer). */
	let { frame, plan, full = false }: { frame: TelescopeFrame; plan: TelescopeData['plan']; full?: boolean } = $props();

	/** While a plan shoots this target: "23 / 70" for its newest frame, "17 · 23 / 70" for older ones. */
	const planned = $derived(plan && plan.state === 'running' && plan.target === frame.target && plan.planned ? plan : null);
	const at = $derived(frame.at * 1000);
	const temp = (v: number | null) => (v === null ? '–' : `${v.toFixed(0).replace('-', '−')} °C`);
</script>

<dl class="facts" class:full>
	<div class="wide"><dt>Target</dt><dd class="target">{frame.target}</dd></div>
	<div>
		<dt>Frame</dt>
		<dd class="num">
			{frame.number ?? '–'}{#if planned}<span class="muted"
					>{planned.current === frame.number ? ` / ${planned.planned}` : ` · ${planned.current ?? '–'} / ${planned.planned}`}</span
				>{/if}
		</dd>
	</div>
	<div><dt>Exposure</dt><dd class="num">{frame.exposureS === null ? '–' : `${frame.exposureS} s`}</dd></div>
	<div><dt>Gain</dt><dd class="num">{frame.gain ?? '–'}</dd></div>
	<div>
		<dt>Sensor</dt>
		<dd class="num">{temp(frame.sensorTempC)}{#if frame.setTempC !== null && frame.setTempC !== frame.sensorTempC}<span class="muted">{` (set ${temp(frame.setTempC)})`}</span>{/if}</dd>
	</div>
	<div class="wide">
		<dt>Taken</dt>
		<dd class="num">{eventTime(new Date(at).toISOString(), night.now)} <span class="muted">· {formatAgo(frame.at, night.now.getTime())}</span></dd>
	</div>
	{#if full}
		<div><dt>Background</dt><dd class="num">{frame.backgroundAdu === null ? '–' : `${Math.round(frame.backgroundAdu)} ADU`}</dd></div>
		<div><dt>Stars</dt><dd class="num">{frame.stars ?? '–'}</dd></div>
		<div><dt>HFR</dt><dd class="num">{frame.hfr === null ? '–' : `${frame.hfr.toFixed(2)} px`}</dd></div>
		<div><dt>Mode</dt><dd>{frame.mode}</dd></div>
		<div class="wide">
			<dt>Camera</dt>
			<dd>{frame.camera ?? '–'}{#if frame.focalLengthMm}<span class="muted num">{` · ${frame.focalLengthMm} mm`}</span>{/if}</dd>
		</div>
	{/if}
</dl>

<style>
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 10px 16px;
	}
	.wide {
		grid-column: span 2;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 15px;
		font-weight: 550;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	dd .muted {
		font-weight: 500;
	}
	.target {
		font-size: 20px;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
</style>
