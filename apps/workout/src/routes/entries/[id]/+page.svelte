<script lang="ts">
	import EntryForm from '$lib/components/EntryForm.svelte';
	import { formatKm } from '$lib/domain';

	let { data, form } = $props();
</script>

<svelte:head><title>Edit workout · Workouts</title></svelte:head>

<section class="card">
	<h2>Edit workout</h2>
	<EntryForm
		action="?/save"
		person={data.workout.person}
		machine={data.workout.machine}
		day={data.workout.day}
		km={formatKm(data.workout.meters, 3)}
		today={data.today}
		submitLabel="Save"
		error={form?.error}
	>
		{#snippet extra()}
			<button
				type="submit"
				formaction="?/delete"
				formnovalidate
				class="delete"
				onclick={(e) => {
					if (!confirm('Delete this workout?')) e.preventDefault();
				}}>Delete</button
			>
		{/snippet}
	</EntryForm>
	<p><a href="/" class="muted">Cancel</a></p>
</section>

<style>
	section {
		width: 100%;
		max-width: 560px;
		margin: 0 auto;
	}
	.delete {
		min-height: 50px;
		padding: 0 18px;
		font-weight: 600;
		color: var(--bad);
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid rgba(248, 113, 113, 0.3);
		border-radius: 14px;
		cursor: pointer;
	}
	p {
		margin: 14px 0 0;
		text-align: center;
	}
</style>
