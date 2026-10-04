<script lang="ts">
	import { enhance } from '$app/forms';
	import { autosubmit, keepValues } from './forms';

	let { terms, maxLength }: { terms: { term: string; whole_word: boolean }[]; maxLength: number } = $props();

	let interactive = $state(false);
	$effect(() => {
		interactive = true;
	});
</script>

<p class="explain">
	We hide articles where a word <em>starts with</em> what you type, so <kbd>hämähäkki</kbd> also hides <kbd>hämähäkkejä</kbd> and
	<kbd>hämähäkeistä</kbd>. Short words may occasionally hide more than you expect; choose “Whole word only” when a short word should not
	also catch longer words that begin with it. Headlines, summaries, the full text and photo captions are all checked.
</p>

<form class="add" method="POST" action="?/addTerm" use:enhance>
	<div class="field">
		<label for="new-term">Word or phrase</label>
		<input id="new-term" name="term" required maxlength={maxLength} autocomplete="off" autocapitalize="off" spellcheck="false" />
	</div>
	<label class="check">
		<input type="checkbox" name="whole_word" />
		<span>Whole word only</span>
	</label>
	<button class="button">Add</button>
</form>

{#if terms.length > 0}
	<ul class="terms">
		{#each terms as t (t.term)}
			<li>
				<span class="term">{t.term}</span>
				<form method="POST" action="?/termWhole" use:enhance={keepValues} use:autosubmit>
					<input type="hidden" name="term" value={t.term} />
					<label class="check">
						<input type="checkbox" name="whole_word" checked={t.whole_word} />
						<span>Whole word only</span>
					</label>
					{#if !interactive}
						<button class="button">Update</button>
					{/if}
				</form>
				<form method="POST" action="?/removeTerm" use:enhance>
					<input type="hidden" name="term" value={t.term} />
					<button class="button" aria-label="Remove {t.term}">Remove</button>
				</form>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.explain {
		max-width: var(--measure);
		color: var(--ink-2);
	}

	kbd {
		font-family: var(--font-body);
		font-style: italic;
		color: var(--ink);
	}

	.add {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: var(--space-3);
		align-items: end;
		max-width: 44rem;
	}

	.add .field {
		margin: 0;
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--touch);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		cursor: pointer;
	}

	.check input {
		width: 1.1rem;
		height: 1.1rem;
		margin: 0;
		accent-color: var(--ink);
	}

	.terms {
		max-width: 44rem;
		margin: var(--space-5) 0 0;
		padding: 0;
		list-style: none;
	}

	.terms li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: var(--space-3);
		align-items: center;
		padding: var(--space-2) 0;
		border-top: var(--hairline);
	}

	.terms form {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.term {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	@media (max-width: 30rem) {
		.add {
			grid-template-columns: 1fr auto;
		}

		.add .field {
			grid-column: 1 / -1;
		}

		.terms li {
			grid-template-columns: 1fr auto;
		}

		.term {
			grid-column: 1 / -1;
		}
	}
</style>
