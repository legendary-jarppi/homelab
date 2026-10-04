<script lang="ts">
	let { images, calmHeadlines }: { images: 'show' | 'click' | 'hide'; calmHeadlines: boolean } = $props();

	const PHOTO_CHOICES = [
		{ value: 'show', label: 'Show photos', hint: 'Photos that fit your choices are shown. Any other photo waits behind a “Show photo” button.' },
		{ value: 'click', label: 'Ask first', hint: 'Every photo waits behind a “Show photo” button until you choose to see it.' },
		{ value: 'hide', label: 'No photos', hint: 'Articles are shown with text only.' }
	] as const;
</script>

<fieldset class="choices">
	<legend>Photos</legend>
	{#each PHOTO_CHOICES as choice (choice.value)}
		<label class="choice">
			<input type="radio" name="images" value={choice.value} checked={images === choice.value} />
			<span class="label">{choice.label}</span>
			<span class="hint">{choice.hint}</span>
		</label>
	{/each}
</fieldset>

<fieldset class="choices">
	<legend>Headlines</legend>
	<label class="choice">
		<input type="checkbox" name="calmHeadlines" checked={calmHeadlines} />
		<span class="label">Calm headlines</span>
		<span class="hint">Use a plain, factual headline written for this paper instead of the outlet’s own. The original headline is still shown, in small type, on the article page.</span>
	</label>
</fieldset>

<style>
	.choices {
		margin: 0 0 var(--space-5);
		padding: 0;
		border: 0;
		min-width: 0;
	}

	legend {
		margin-bottom: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.choice {
		display: grid;
		grid-template-columns: 1.75rem 1fr;
		column-gap: var(--space-2);
		align-items: baseline;
		padding: var(--space-3) 0;
		border-top: var(--hairline);
		cursor: pointer;
	}

	input {
		grid-row: span 2;
		width: 1.1rem;
		height: 1.1rem;
		margin: 0;
		accent-color: var(--ink);
		align-self: start;
		margin-top: 0.3rem;
	}

	.label {
		font-weight: 600;
	}

	.hint {
		grid-column: 2;
		font-size: var(--step--1);
		color: var(--ink-2);
	}
</style>
