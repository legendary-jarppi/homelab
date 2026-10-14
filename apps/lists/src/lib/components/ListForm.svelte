<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { DASHBOARD_COUNTS, SORTS, type List } from '$lib/domain';

	interface Props {
		list?: List | null;
		action: string;
		submitLabel: string;
		error?: string;
	}

	let props: Props = $props();
	const initial = untrack(() => props.list);
	let useDate = $state(initial?.useDate ?? true);
	let sort = $state(initial?.sort ?? 'date');
	let submitting = $state(false);

	const FIELDS = [
		{ name: 'usePeople', label: 'People', hint: 'who (any combination)', on: initial?.usePeople ?? true },
		{ name: 'useService', label: 'Service', hint: 'Netflix, Yle Areena…', on: initial?.useService ?? false },
		{ name: 'useLink', label: 'Link', hint: 'web address', on: initial?.useLink ?? false },
		{ name: 'useNote', label: 'Note', hint: 'free text', on: initial?.useNote ?? false }
	];
</script>

<form
	method="POST"
	action={props.action}
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
		};
	}}
>
	<label class="field">
		<span>Name</span>
		<input name="name" value={initial?.name ?? ''} required maxlength="80" autocomplete="off" placeholder="Watched movies" />
	</label>
	<label class="field">
		<span>Description <small>(optional)</small></span>
		<input name="description" value={initial?.description ?? ''} maxlength="500" autocomplete="off" />
	</label>

	<fieldset>
		<legend>Fields <small class="muted">Every item has a title; pick what else it has.</small></legend>
		<div class="fields">
			<label class="check">
				<input type="checkbox" name="useDate" bind:checked={useDate} />
				<span><b>Date</b> <small class="muted">labelled</small></span>
				<input class="label-input" name="dateLabel" value={initial?.dateLabel ?? 'Date'} maxlength="30" readonly={!useDate} aria-label="Date label" />
			</label>
			{#each FIELDS as f (f.name)}
				<label class="check">
					<input type="checkbox" name={f.name} checked={f.on} />
					<span><b>{f.label}</b> <small class="muted">{f.hint}</small></span>
				</label>
			{/each}
		</div>
	</fieldset>

	<fieldset>
		<legend>Order</legend>
		<div class="chips">
			{#each SORTS as s (s.id)}
				<label class="chip">
					<input type="radio" name="sort" value={s.id} bind:group={sort} disabled={s.id === 'date' && !useDate} />{s.id === 'date' ? 'Newest date first' : s.id === 'added' ? 'Newest added first' : 'Title A–Z'}
				</label>
			{/each}
		</div>
	</fieldset>

	<label class="field">
		<span>On the home dashboard</span>
		<select name="dashboardCount">
			{#each DASHBOARD_COUNTS as n (n)}
				<option value={n} selected={(initial?.dashboardCount ?? 0) === n}>{n === 0 ? 'Not shown' : `First ${n} items`}</option>
			{/each}
		</select>
	</label>

	{#if props.error}<p class="error" role="alert">{props.error}</p>{/if}
	<button type="submit" class="button primary" disabled={submitting}>{props.submitLabel}</button>
</form>

<style>
	form {
		display: grid;
		gap: 14px;
	}
	fieldset {
		margin: 0;
		padding: 0;
		min-width: 0;
		border: 0;
		display: grid;
		gap: 8px;
	}
	legend {
		margin-bottom: 8px;
		font-size: 13px;
		color: var(--muted);
	}
	legend small,
	.field small {
		font-size: 12px;
		color: var(--faint);
	}
	.fields {
		display: grid;
		gap: 6px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 46px;
		padding: 6px 12px;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid var(--border);
		border-radius: 12px;
		cursor: pointer;
	}
	.check input[type='checkbox'] {
		width: 20px;
		height: 20px;
		accent-color: var(--accent);
		flex: none;
	}
	.check span {
		flex: 1;
	}
	.label-input {
		width: 130px;
		min-height: 34px;
		padding: 4px 10px;
		font-size: 15px;
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid var(--border);
		border-radius: 10px;
		outline: none;
	}
	.label-input:read-only {
		opacity: 0.4;
	}
	.chip:has(input:disabled) {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
