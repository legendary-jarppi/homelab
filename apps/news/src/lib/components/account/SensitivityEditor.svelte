<script lang="ts">
	import { enhance } from '$app/forms';
	import { SENSITIVITY_FAMILIES, SENSITIVITY_TAGS, THRESHOLDS, type Threshold } from '$lib/core/taxonomy';
	import { autosubmit, keepValues } from './forms';
	import ThresholdControl from './ThresholdControl.svelte';

	let { thresholds, saved = null }: { thresholds: Record<string, Threshold>; saved?: string | null } = $props();

	let interactive = $state(false);
	$effect(() => {
		interactive = true;
	});

	const families = SENSITIVITY_FAMILIES.map((f) => ({ ...f, tags: SENSITIVITY_TAGS.filter((t) => t.family === f.key) }));

	/** The family's shared value, or (when its subjects differ) the most common one and how many differ from it. */
	function familyValue(tags: { key: string }[]): { shared: Threshold | null; mostly: string; differing: number } {
		const values = tags.map((t) => thresholds[t.key] ?? 'off');
		const counts = THRESHOLDS.map((t) => ({ t, n: values.filter((v) => v === t.value).length }));
		const top = counts.reduce((best, c) => (c.n > best.n ? c : best));
		return { shared: top.n === values.length ? top.t.value : null, mostly: top.t.label, differing: values.length - top.n };
	}
</script>

<dl class="legend">
	{#each THRESHOLDS as t (t.value)}
		<div>
			<dt>{t.label}</dt>
			<dd>{t.hint}</dd>
		</div>
	{/each}
</dl>

<ul class="families">
	{#each families as family (family.key)}
		{@const summary = familyValue(family.tags)}
		<li class="family">
			<h3 id="family-{family.key}">{family.label}</h3>
			<p class="description">{family.description}</p>
			<form method="POST" action="?/family" use:enhance={keepValues} use:autosubmit>
				<input type="hidden" name="family" value={family.key} />
				<ThresholdControl name="threshold" value={summary.shared} legend="{family.label}: every subject" id="family-{family.key}-value" />
				{#if summary.shared === null}
					<p class="mixed">
						Mostly “{summary.mostly}”; {summary.differing === 1 ? 'one subject has its own setting' : `${summary.differing} subjects have their own settings`}.
					</p>
				{/if}
				{#if !interactive}
					<button class="button">Apply to the whole group</button>
				{/if}
			</form>
			<details>
				<summary>Single subjects</summary>
				<form method="POST" action="?/tags" use:enhance={keepValues} use:autosubmit>
					<input type="hidden" name="family" value={family.key} />
					<ul class="tags">
						{#each family.tags as tag (tag.key)}
							<li>
								<div class="tag-text">
									<span class="tag-label">{tag.label}</span>
									<span class="tag-description">{tag.description}</span>
								</div>
								<ThresholdControl name="tag:{tag.key}" value={thresholds[tag.key] ?? 'off'} legend={tag.label} id="tag-{tag.key}" />
							</li>
						{/each}
					</ul>
					{#if !interactive}
						<button class="button">Save these subjects</button>
					{/if}
				</form>
			</details>
			<p class="status" aria-live="polite">{saved === `family:${family.key}` ? 'Saved.' : ''}</p>
		</li>
	{/each}
</ul>

<style>
	.legend {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: var(--space-2) var(--space-5);
		margin: 0 0 var(--space-5);
		font-family: var(--font-ui);
		font-size: var(--step--1);
	}

	.legend dt {
		font-weight: 600;
	}

	.legend dd {
		margin: 0;
		color: var(--ink-2);
	}

	.families,
	.tags {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.family {
		padding: var(--space-4) 0 var(--space-2);
		border-top: var(--hairline);
	}

	h3 {
		margin: 0;
		font-family: var(--font-head);
		font-size: var(--step-1);
		font-weight: 600;
	}

	.description {
		margin: var(--space-1) 0 var(--space-3);
		color: var(--ink-2);
		font-size: var(--step--1);
	}

	.mixed,
	.status {
		margin: var(--space-1) 0 0;
		font-family: var(--font-ui);
		font-size: var(--step--2);
		color: var(--ink-2);
	}

	.status:empty {
		display: none;
	}

	form .button {
		margin-top: var(--space-2);
	}

	details {
		margin-top: var(--space-2);
	}

	summary {
		display: flex;
		align-items: center;
		min-height: var(--touch);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		font-weight: 600;
		cursor: pointer;
	}

	summary::before {
		content: '+';
		display: inline-block;
		width: 1.25em;
		font-weight: 400;
	}

	details[open] > summary::before {
		content: '−';
	}

	.tags li {
		display: grid;
		grid-template-columns: minmax(10rem, 1fr) minmax(0, 2fr);
		gap: var(--space-2) var(--space-4);
		align-items: center;
		padding: var(--space-3) 0;
		border-top: var(--hairline);
	}

	.tag-text {
		display: grid;
	}

	.tag-label {
		font-weight: 600;
	}

	.tag-description {
		font-size: var(--step--1);
		color: var(--ink-2);
	}

	@media (max-width: 40rem) {
		.tags li {
			grid-template-columns: 1fr;
		}
	}
</style>
