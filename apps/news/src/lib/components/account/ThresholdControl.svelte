<script lang="ts">
	import { THRESHOLDS, type Threshold } from '$lib/core/taxonomy';

	let { name, value, legend, id }: { name: string; value: Threshold | null; legend: string; id: string } = $props();
</script>

<fieldset class="segmented">
	<legend class="visually-hidden">{legend}</legend>
	{#each THRESHOLDS as t (t.value)}
		<input type="radio" id="{id}-{t.value}" {name} value={t.value} checked={value === t.value} />
		<label for="{id}-{t.value}" title={t.hint}>{t.label}</label>
	{/each}
</fieldset>

<style>
	.segmented {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		margin: 0;
		padding: 0;
		border: 1px solid var(--ink-3);
		min-width: 0;
	}

	input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
		margin: 0;
	}

	label {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--touch);
		padding: var(--space-1) var(--space-2);
		border-left: 1px solid var(--rule);
		font-family: var(--font-ui);
		font-size: var(--step--2);
		font-weight: 500;
		letter-spacing: 0.02em;
		line-height: 1.2;
		text-align: center;
		color: var(--ink-2);
		cursor: pointer;
	}

	label:first-of-type {
		border-left: 0;
	}

	label:hover {
		background: var(--paper-2);
	}

	input:checked + label {
		background: var(--ink);
		color: var(--paper);
		font-weight: 600;
	}

	input:focus-visible + label {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
		position: relative;
		z-index: 1;
	}

	@media (max-width: 30rem) {
		.segmented {
			grid-template-columns: repeat(2, 1fr);
		}

		label:nth-of-type(3) {
			border-left: 0;
		}

		label:nth-of-type(n + 3) {
			border-top: 1px solid var(--rule);
		}
	}
</style>
