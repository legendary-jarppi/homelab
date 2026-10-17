<script lang="ts">
	import Card from './Card.svelte';
	import { dayOf, eventTime } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type { PresenceData } from '$lib/types';

	/** `configured`: PRESENCE_URL is set; `presence` null until the first answer. */
	let { presence, configured }: { presence: PresenceData | null; configured: boolean } = $props();

	type Person = PresenceData['people'][number];

	/** The service polls every 30 s and the dashboard every 30 s: older than 3 min means it is not answering. */
	const fresh = $derived(presence !== null && night.now.getTime() - presence.updatedAt < 3 * 60_000);
	/** A source down freezes the state at its last answer. */
	const sourcesOk = $derived(presence !== null && Object.values(presence.sources).every((s) => s.ok));
	const homeId = $derived(presence?.sites[0]?.id ?? 'home');
	const label = (place: string) => presence?.sites.find((s) => s.id === place)?.label ?? place;
	/** "Everyone home", "2 of 4 home · 2 at Cabin", "Nobody home · 1 at Cabin". */
	const summary = $derived.by(() => {
		if (!presence) return '';
		const at = (place: string) => presence.people.filter((p) => p.place === place).length;
		const home = at(homeId);
		const total = presence.people.length;
		const others = presence.sites.slice(1).flatMap((s) => (at(s.id) > 0 ? [`${at(s.id)} at ${s.label}`] : []));
		const first = home === 0 ? 'Nobody home' : home === total ? 'Everyone home' : `${home} of ${total} home`;
		return [first, ...others].join(' · ');
	});

	/** Today: "16:59"; earlier: just the day, "ti 6.10." (the card's columns are narrow). */
	function at(unixS: number): string {
		const iso = new Date(unixS * 1000).toISOString();
		return dayOf(iso) === dayOf(night.now.toISOString()) ? eventTime(iso, night.now) : dayOf(iso);
	}

	function status(p: Person): string {
		if (p.place === null) return 'Unknown';
		const word = p.place === 'away' ? 'Away' : label(p.place);
		// Not reporting: as far as anyone knows, without a time that would look current.
		if (p.stale) return `${word}, no fresh data`;
		// Non-breaking: a narrow column wraps before "since", never inside the date.
		return p.since === null ? word : `${word} since\u00a0${at(p.since).replaceAll(' ', '\u00a0')}`;
	}
</script>

<Card title="Who's home">
	{#snippet accessory()}
		{#if presence && (!fresh || !sourcesOk)}
			<span class="warn">No fresh data</span>
		{:else if presence}
			<span>{summary}</span>
		{/if}
	{/snippet}
	{#if !configured}
		<p class="muted">Presence not set up.</p>
	{:else if !presence}
		<p class="muted">Presence unavailable.</p>
	{:else}
		<ul class="people" class:stale={!fresh || !sourcesOk}>
			{#each presence.people as p (p.id)}
				<li class:home={p.place === homeId} class:elsewhere={p.place !== null && p.place !== 'away' && p.place !== homeId} class:away={p.place === 'away'} class:stale={p.stale}>
					<span class="avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
					<span class="text">
						<span class="name">{p.name}</span>
						<span class="status">{status(p)}</span>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</Card>

<style>
	p {
		margin: 0;
		font-size: 14px;
	}
	.warn {
		color: var(--warn);
		font-weight: 600;
	}
	.people {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 10px 14px;
	}
	.people.stale {
		opacity: 0.6;
	}
	li {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		--c: var(--muted);
	}
	li.home {
		--c: var(--ok);
	}
	li.elsewhere {
		--c: var(--down);
	}
	li.stale {
		opacity: 0.6;
	}
	.avatar {
		width: 34px;
		height: 34px;
		flex: none;
		display: grid;
		place-items: center;
		font-size: 15px;
		font-weight: 700;
		border-radius: 50%;
		color: var(--c);
		border: 2px solid var(--c);
		background: rgba(255, 255, 255, 0.04);
	}
	li.home .avatar {
		background: rgba(52, 211, 153, 0.12);
		box-shadow: 0 0 10px rgba(52, 211, 153, 0.25);
	}
	li.elsewhere .avatar {
		background: color-mix(in srgb, var(--c) 12%, transparent);
	}
	li.away .avatar {
		opacity: 0.6;
	}
	.text {
		display: grid;
		min-width: 0;
	}
	.name {
		font-size: 15px;
		font-weight: 600;
	}
	li.away .name {
		color: var(--muted);
	}
	.status {
		font-size: 12px;
		color: var(--muted);
	}
	li:is(.home, .elsewhere) .status {
		color: var(--c);
	}
</style>
