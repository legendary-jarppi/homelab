<script lang="ts">
	import { enhance } from '$app/forms';
	import { TOPIC_FAMILIES, TOPICS } from '$lib/core/taxonomy';
	import { useI18n } from '$lib/i18n';
	import { autosubmit, keepValues } from './forms';

	let { hidden }: { hidden: string[] } = $props();

	const i = useI18n();

	let interactive = $state(false);
	$effect(() => {
		interactive = true;
	});

	const families = TOPIC_FAMILIES.map((f) => ({ ...f, topics: TOPICS.filter((t) => t.family === f.key) }));
</script>

<form method="POST" action="?/topics" use:enhance={keepValues} use:autosubmit>
	{#each families as family (family.key)}
		<fieldset class="family">
			<legend>{i.topicFamily(family.key)}</legend>
			<div class="bulk">
				<button class="link" name="bulk" value="{family.key}:show">{i.t('topics.showAll')}</button>
				<button class="link" name="bulk" value="{family.key}:hide">{i.t('topics.hideAll')}</button>
			</div>
			<ul>
				{#each family.topics as topic (topic.key)}
					{@const topicText = i.topic(topic.key)}
					<li>
						<label title={topicText.description}>
							<input type="checkbox" name="topic" value={topic.key} checked={!hidden.includes(topic.key)} />
							<span>{topicText.label}</span>
						</label>
					</li>
				{/each}
			</ul>
		</fieldset>
	{/each}
	{#if !interactive}
		<button class="button">{i.t('topics.save')}</button>
	{/if}
</form>

<style>
	.family {
		margin: 0;
		padding: var(--space-3) 0 var(--space-4);
		border: 0;
		border-top: var(--hairline);
		min-width: 0;
	}

	legend {
		float: left;
		width: auto;
		padding: 0;
		font-family: var(--font-head);
		font-size: var(--step-1);
		font-weight: 600;
	}

	.bulk {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-3);
	}

	.link {
		min-height: var(--touch);
		padding: 0 var(--space-1);
		border: 0;
		background: none;
		color: var(--ink-2);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		text-decoration: underline;
		text-decoration-color: var(--rule);
		text-underline-offset: 0.2em;
		cursor: pointer;
	}

	.link:hover {
		color: var(--ink);
	}

	ul {
		clear: both;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 0 var(--space-5);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	label {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--touch);
		cursor: pointer;
	}

	input {
		width: 1.1rem;
		height: 1.1rem;
		margin: 0;
		flex: none;
		accent-color: var(--ink);
	}
</style>
