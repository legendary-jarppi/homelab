<script lang="ts">
	import SurveyFraming from './SurveyFraming.svelte';
	import { formatSize, framing, type Dso } from '$lib/catalog';
	import { portal } from '$lib/portal';

	/**
	 * B3 from the planner and Goals: a catalog object's framing on the survey, adjustable. The camera angle starts
	 * with the image's top edge along the object's major axis (0° without a position angle), the mosaic at the
	 * planner's panels (along the major axis × across it).
	 */
	let { dso, onclose }: { dso: Dso; onclose: () => void } = $props();

	const fit = $derived(framing(dso));
	const angle = $derived(dso.pa === null ? 0 : (((180 - dso.pa) % 180) + 180) % 180);
	const label = $derived(`${dso.id}${dso.maj !== null ? ` ${formatSize(dso.maj)}${dso.min !== null && dso.min !== dso.maj ? ` × ${formatSize(dso.min)}` : ''}` : ''}`);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" use:portal role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="dialog" role="dialog" aria-modal="true" aria-label="Framing of {dso.id}">
		<header>
			<h2>{dso.id} {#if dso.names[0]}<span class="muted">{dso.names[0]}</span>{/if}</h2>
			<span class="muted small">{fit.label}</span>
			<button class="btn close" onclick={onclose} aria-label="Close">✕</button>
		</header>
		<SurveyFraming ra={dso.ra} dec={dso.dec} object={{ ra: dso.ra, dec: dso.dec, maj: dso.maj, min: dso.min, pa: dso.pa, label }} {angle} panels={[fit.panels[1], fit.panels[0]]} adjustable />
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		overflow-y: auto;
		padding: max(20px, env(safe-area-inset-top)) 12px 20px;
		background: rgba(0, 0, 0, 0.7);
	}
	.dialog {
		width: min(720px, 100%);
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 16px;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--bg);
	}
	header {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 12px;
	}
	h2 {
		margin: 0;
		font-size: 19px;
	}
	h2 .muted {
		font-size: 15px;
		font-weight: 400;
	}
	.small {
		font-size: 13px;
	}
	.close {
		margin-left: auto;
		align-self: center;
	}
	@media (max-width: 640px) {
		.backdrop {
			padding: env(safe-area-inset-top) 0 0;
		}
		.dialog {
			min-height: 100%;
			border-radius: 0;
			border: 0;
			padding: 12px;
		}
	}
</style>
