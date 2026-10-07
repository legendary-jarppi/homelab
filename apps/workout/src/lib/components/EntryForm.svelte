<script lang="ts">
	import { enhance } from '$app/forms';
	import { MACHINES, PEOPLE, type MachineId, type PersonId } from '$lib/domain';
	import { untrack, type Snippet } from 'svelte';

	interface Props {
		action: string;
		person: PersonId;
		machine: MachineId;
		day: string;
		km?: string;
		today: string;
		submitLabel: string;
		error?: string;
		/** Each person's last machine: picking a person switches to it. */
		lastMachines?: Partial<Record<PersonId, MachineId>>;
		/** Clear the distance after a successful submit (logging several in a row). */
		clearOnSuccess?: boolean;
		extra?: Snippet;
	}

	let props: Props = $props();
	// Form state starts from the props and is the user's from then on.
	const initial = untrack(() => ({ ...props }));
	let person = $state(initial.person);
	let machine = $state(initial.machine);
	let day = $state(initial.day);
	let km = $state(initial.km ?? '');
	let submitting = $state(false);
</script>

<form
	method="POST"
	action={props.action}
	use:enhance={() => {
		submitting = true;
		return async ({ result, update }) => {
			await update({ reset: false });
			submitting = false;
			if (result.type === 'success' && props.clearOnSuccess) km = '';
		};
	}}
>
	<fieldset class="segmented">
		<legend class="sr">Who</legend>
		{#each PEOPLE as p (p.id)}
			<label>
				<input
					type="radio"
					name="person"
					value={p.id}
					bind:group={person}
					onchange={() => (machine = props.lastMachines?.[p.id] ?? machine)}
				/>{p.name}
			</label>
		{/each}
	</fieldset>

	<fieldset class="machines">
		<legend class="sr">Machine</legend>
		{#each MACHINES as m (m.id)}
			<label style="--c: var(--{m.id})">
				<input type="radio" name="machine" value={m.id} bind:group={machine} />
				<span class="dot" style="background: var(--c)"></span>
				{m.name}
			</label>
		{/each}
	</fieldset>

	<div class="row">
		<label class="field distance">
			<span class="muted">Distance</span>
			<span class="input">
				<input
					name="km"
					bind:value={km}
					inputmode="decimal"
					autocomplete="off"
					placeholder="0.0"
					required
					class="num"
				/>
				<span class="muted">km</span>
			</span>
		</label>
		<label class="field">
			<span class="muted">Date</span>
			<input type="date" name="day" bind:value={day} max={props.today} required />
		</label>
	</div>

	{#if props.error}<p class="error" role="alert">{props.error}</p>{/if}

	<div class="actions">
		<button type="submit" class="primary" disabled={submitting}>{props.submitLabel}</button>
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
		min-width: 0;
		border: 0;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.machines {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		padding: 0;
	}
	.machines label {
		position: relative;
		display: grid;
		justify-items: center;
		gap: 6px;
		padding: 12px 4px;
		font-size: 14px;
		text-align: center;
		color: var(--muted);
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid var(--border);
		border-radius: 14px;
		cursor: pointer;
	}
	.machines label:has(input:checked) {
		color: var(--text);
		font-weight: 600;
		border-color: var(--c);
		background: color-mix(in srgb, var(--c) 14%, transparent);
	}
	.machines label:has(input:focus-visible) {
		outline: 2px solid var(--accent);
	}
	.machines input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.field {
		display: grid;
		gap: 4px;
		font-size: 13px;
	}
	.field input,
	.input {
		width: 100%;
		min-height: 48px;
		padding: 0 12px;
		font-size: 17px;
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid var(--border);
		border-radius: 12px;
		outline: none;
	}
	.input {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.input input {
		min-width: 0;
		padding: 0;
		font-size: 22px;
		font-weight: 600;
		background: none;
		border: 0;
	}
	.field input:focus,
	.input:focus-within {
		border-color: var(--accent);
	}
	.error {
		margin: 0;
		color: var(--bad);
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.primary {
		flex: 1;
		min-height: 50px;
		font-size: 17px;
		font-weight: 600;
		border: 0;
		border-radius: 14px;
		background: linear-gradient(135deg, #0ea5e9, #8b5cf6);
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.6;
	}
</style>
