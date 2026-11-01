<script lang="ts">
	import { useI18n } from '$lib/i18n';

	let { images, calmHeadlines }: { images: 'show' | 'click' | 'hide'; calmHeadlines: boolean } = $props();

	const i = useI18n();

	const PHOTO_CHOICES = $derived([
		{ value: 'show', label: i.t('display.show'), hint: i.t('display.showHint') },
		{ value: 'click', label: i.t('display.click'), hint: i.t('display.clickHint') },
		{ value: 'hide', label: i.t('display.hide'), hint: i.t('display.hideHint') }
	] as const);
</script>

<fieldset class="choices">
	<legend>{i.t('display.photos')}</legend>
	{#each PHOTO_CHOICES as choice (choice.value)}
		<label class="choice">
			<input type="radio" name="images" value={choice.value} checked={images === choice.value} />
			<span class="label">{choice.label}</span>
			<span class="hint">{choice.hint}</span>
		</label>
	{/each}
</fieldset>

<fieldset class="choices">
	<legend>{i.t('display.headlines')}</legend>
	<label class="choice">
		<input type="checkbox" name="calmHeadlines" checked={calmHeadlines} />
		<span class="label">{i.t('display.calm')}</span>
		<span class="hint">{i.t('display.calmHint')}</span>
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
