<script lang="ts">
	import { useI18n } from '$lib/i18n';

	/** The stored setting: null follows the browser. */
	let { language }: { language: 'fi' | 'en' | null } = $props();

	const i = useI18n();

	// Each language is named in itself, so a reader can find their own whatever the current one.
	const CHOICES = [
		{ value: 'fi', label: 'Suomi', lang: 'fi' },
		{ value: 'en', label: 'English', lang: 'en' }
	] as const;
</script>

<fieldset class="choices">
	<legend>{i.t('language.legend')}</legend>
	<label class="choice">
		<input type="radio" name="language" value="auto" checked={language === null} />
		<span class="label">{i.t('language.auto')}</span>
		<span class="hint">{i.t('language.autoHint')}</span>
	</label>
	{#each CHOICES as choice (choice.value)}
		<label class="choice">
			<input type="radio" name="language" value={choice.value} checked={language === choice.value} />
			<span class="label" lang={choice.lang}>{choice.label}</span>
		</label>
	{/each}
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
