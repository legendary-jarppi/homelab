<script lang="ts">
	import { PRESETS } from '$lib/core/taxonomy';

	let { selected }: { selected: string | null } = $props();
</script>

<fieldset class="presets">
	<legend class="visually-hidden">Comfort level</legend>
	{#each PRESETS as preset (preset.key)}
		<label class="preset">
			<input type="radio" name="preset" value={preset.key} checked={selected === preset.key} required />
			<span class="name">{preset.label}</span>
			<span class="description">{preset.description}</span>
		</label>
	{/each}
</fieldset>

<style>
	.presets {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-4);
		margin: 0 0 var(--space-5);
		padding: 0;
		border: 0;
		min-width: 0;
	}

	@media (max-width: 36rem) {
		.presets {
			grid-template-columns: 1fr;
		}
	}

	@media (min-width: 75rem) {
		.presets {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.preset {
		position: relative;
		display: grid;
		align-content: start;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-4) var(--space-4) calc(var(--space-4) + 1.75rem);
		border: 1px solid var(--rule);
		cursor: pointer;
	}

	.preset:hover {
		background: var(--paper-2);
	}

	.preset:has(input:checked) {
		border-color: var(--ink);
		background: var(--paper-2);
	}

	.preset:has(input:focus-visible) {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}

	input {
		position: absolute;
		left: var(--space-4);
		top: calc(var(--space-4) + 0.3rem);
		width: 1.1rem;
		height: 1.1rem;
		margin: 0;
		accent-color: var(--ink);
	}

	input:focus-visible {
		outline: none;
	}

	.name {
		font-family: var(--font-head);
		font-size: var(--step-1);
		font-weight: 600;
		line-height: 1.2;
	}

	.description {
		color: var(--ink-2);
		font-size: var(--step--1);
		line-height: 1.45;
	}
</style>
