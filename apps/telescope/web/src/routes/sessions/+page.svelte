<script lang="ts">
	import Card from '$lib/components/Card.svelte';
	import { clock, formatDuration, nightLabel } from '$lib/format';
	import { stackUrl } from '$lib/session.svelte';

	/** D5: the observing log, a card per night and target (newest first), each opening its report. */
	let { data } = $props();

	const months = $derived.by(() => {
		const out: { month: string; sessions: typeof data.sessions }[] = [];
		for (const s of data.sessions) {
			const [y, m] = s.night.split('-').map(Number);
			const month = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
			if (out.at(-1)?.month !== month) out.push({ month, sessions: [] });
			out.at(-1)!.sessions.push(s);
		}
		return out;
	});
	const total = $derived(data.sessions.reduce((sum, s) => sum + s.integrationS, 0));
</script>

<svelte:head><title>Sessions · Telescope</title></svelte:head>

<main>
	{#if data.sessions.length === 0}
		<Card title="Observing log"><p class="muted">No sessions yet.</p></Card>
	{:else}
		<p class="muted summary">{data.sessions.length} sessions · {formatDuration(total)} in stacks</p>
		{#each months as m (m.month)}
			<h2>{m.month}</h2>
			<ul>
				{#each m.sessions as s (s.id)}
					<li>
						<a href="/sessions/{s.id}">
							<span class="thumb">
								{#if s.hasStack}<img src={stackUrl(s.id, `${s.lastFrameAt}-${s.accepted}`, true)} alt="" loading="lazy" />{/if}
							</span>
							<span class="body">
								<span class="top"><strong>{s.target}</strong>{#if s.active}<span class="badge">Imaging</span>{/if}</span>
								<span class="muted small">{nightLabel(s.night)} · {s.mode} · {clock(s.firstFrameAt * 1000)}–{clock(s.lastFrameAt * 1000)}</span>
								<span class="small num">
									{formatDuration(s.integrationS)} · {s.accepted} frames in{#if s.rejected}, <span class="warn">{s.rejected} out</span>{/if}
								</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/each}
	{/if}
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	p {
		margin: 0;
	}
	.summary {
		font-size: 14px;
	}
	h2 {
		margin: 8px 0 0;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
		gap: var(--gap);
	}
	a {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 10px;
		border-radius: 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		color: var(--text);
		text-decoration: none;
	}
	a:hover {
		background: var(--surface-strong);
	}
	.thumb {
		flex: none;
		width: 84px;
		height: 84px;
		border-radius: 12px;
		overflow: hidden;
		background: #000;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 17px;
	}
	.small {
		font-size: 13px;
	}
	.badge {
		padding: 1px 8px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 700;
		color: var(--ok);
		border: 1px solid currentColor;
	}
</style>
