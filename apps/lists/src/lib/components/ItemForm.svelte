<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack, type Snippet } from 'svelte';
	import { personColor, SERVICE_SUGGESTIONS, type Item, type List, type Person } from '$lib/domain';

	interface Props {
		list: List;
		people: Person[];
		/** Services used before in this list, most used first. */
		services: string[];
		action: string;
		submitLabel: string;
		today: string;
		item?: Item | null;
		error?: string;
		/** Quick add: link and note behind "More", fields cleared after each add. */
		quick?: boolean;
		extra?: Snippet;
	}

	let props: Props = $props();
	// Form state starts from the props and is the user's from then on.
	const initial = untrack(() => props.item);
	let title = $state(initial?.title ?? '');
	let chosen = $state<number[]>(initial?.people ?? []);
	let day = $state(initial ? (initial.day ?? '') : untrack(() => props.today));
	let service = $state(initial?.service ?? '');
	let link = $state(initial?.link ?? '');
	let note = $state(initial?.note ?? '');
	let more = $state(false);
	let submitting = $state(false);

	const suggestions = $derived([...new Set([...props.services, ...SERVICE_SUGGESTIONS])]);
	const listId = $derived(`services-${props.list.id}`);
</script>

<form
	method="POST"
	action={props.action}
	use:enhance={() => {
		submitting = true;
		return async ({ result, update }) => {
			await update({ reset: false });
			submitting = false;
			// After a quick add, keep the people and date (the next item is often watched by the same
			// people on the same day) and clear the rest.
			if (result.type === 'success' && props.quick) {
				title = '';
				service = '';
				link = '';
				note = '';
			}
		};
	}}
>
	<label class="field">
		<span class:sr={props.quick}>Title</span>
		<input name="title" bind:value={title} required maxlength="200" autocomplete="off" placeholder={props.quick ? `Add to ${props.list.name}…` : ''} />
	</label>

	{#if props.list.usePeople}
		<fieldset>
			<legend class="sr">Who</legend>
			<div class="chips">
				{#each props.people as p, i (p.id)}
					<label class="chip" style:--c={personColor(i)}>
						<input type="checkbox" name="people" value={p.id} bind:group={chosen} />{p.name}
					</label>
				{/each}
			</div>
		</fieldset>
	{/if}

	{#if props.list.useDate || props.list.useService}
		<div class="row">
			{#if props.list.useDate}
				<label class="field">
					<span>{props.list.dateLabel}</span>
					<input type="date" name="day" bind:value={day} />
				</label>
			{/if}
			{#if props.list.useService}
				<label class="field">
					<span>Service</span>
					<input name="service" bind:value={service} list={listId} maxlength="60" autocomplete="off" placeholder="Netflix, Yle Areena…" />
					<datalist id={listId}>
						{#each suggestions as s (s)}<option value={s}></option>{/each}
					</datalist>
				</label>
			{/if}
		</div>
	{/if}

	{#if (props.list.useLink || props.list.useNote) && props.quick && !more}
		<button type="button" class="more" onclick={() => (more = true)}>
			+ {[props.list.useLink && 'link', props.list.useNote && 'note'].filter(Boolean).join(' and ')}
		</button>
	{:else}
		{#if props.list.useLink}
			<label class="field">
				<span>Link</span>
				<!-- Text, not type="url": pasted addresses without https:// are completed by the server. -->
				<input name="link" inputmode="url" autocapitalize="none" spellcheck="false" bind:value={link} maxlength="2000" autocomplete="off" placeholder="https://…" />
			</label>
		{/if}
		{#if props.list.useNote}
			<label class="field">
				<span>Note</span>
				<textarea name="note" bind:value={note} maxlength="2000" rows="3"></textarea>
			</label>
		{/if}
	{/if}

	{#if props.error}<p class="error" role="alert">{props.error}</p>{/if}

	<div class="actions">
		<button type="submit" class="button primary" disabled={submitting}>{props.submitLabel}</button>
		{@render props.extra?.()}
	</div>
</form>

<style>
	form {
		display: grid;
		gap: 12px;
	}
	fieldset {
		margin: 0;
		padding: 0;
		min-width: 0;
		border: 0;
	}
	.row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 10px;
	}
	.more {
		justify-self: start;
		padding: 4px 0;
		font-size: 14px;
		color: var(--accent);
		background: none;
		border: 0;
		cursor: pointer;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.actions > :global(.primary) {
		flex: 1;
	}
</style>
