<script lang="ts">
	import Card from './Card.svelte';
	import FinalActions from './FinalActions.svelte';
	import FinalItem from './FinalItem.svelte';
	import GoalRow from './GoalRow.svelte';
	import { FinalsData, loadFinals } from '$lib/finals.svelte';
	import { progressByTarget, sessionKey } from '$lib/goals';
	import { planNight } from '$lib/planner';
	import { nightNoon } from '$lib/sky';
	import { loadTargets, TargetStore } from '$lib/targets.svelte';
	import type { SessionDetail, SessionSummary } from '$lib/types';

	/**
	 * On the session report: the target across every night (C5: integration against the goal) and its
	 * final stacks (D3: the latest one, build, download). Loaded in the browser after the report.
	 */
	let { session, site, nowMs }: { session: SessionDetail; site: { lat: number; lon: number } | null; nowMs: number } = $props();

	let sessions = $state.raw<SessionSummary[] | null>(null);
	let store = $state.raw<TargetStore | null>(null);
	const finals = new FinalsData();

	$effect(() => {
		let cancelled = false;
		Promise.all([fetch('/api/sessions').then((r) => (r.ok ? (r.json() as Promise<SessionSummary[]>) : [])), loadTargets(fetch), loadFinals(fetch)])
			.then(([list, goals, f]) => {
				if (cancelled) return;
				sessions = list;
				store = new TargetStore(goals.targets, goals.targetsError);
				finals.list = f.finals ?? [];
				finals.error = f.finalsError;
			})
			.catch(() => {});
		return () => (cancelled = true);
	});
	$effect(() => finals.poll());

	const key = $derived(sessionKey(session));
	const row = $derived(sessions && store ? progressByTarget(sessions, store.targets).find((r) => r.key === key) : undefined);
	const nights = $derived(sessions ? [...new Set(sessions.filter((s) => s.target === session.target).map((s) => s.night))] : [session.night]);
	const night = $derived(site ? planNight(site, nightNoon(Date.now())) : null);
	const mine = $derived(finals.list.filter((f) => f.target === session.target));
	/** The one running or queued, and the newest finished (done or failed): both when there are both. */
	const shown = $derived([mine.find((f) => f.status === 'queued' || f.status === 'running'), mine.find((f) => f.status === 'done' || f.status === 'failed')].filter((f) => f !== undefined));
</script>

<Card title="Target">
	{#if row && store}
		<GoalRow {row} {store} {night} finals={finals.list} compact />
	{:else if sessions === null}
		<p class="muted small">Loading…</p>
	{/if}
	<h3>Final stack</h3>
	{#each shown as f (f.id)}<FinalItem final={f} {nowMs} />{:else}{#if !finals.error}<p class="muted small">None of {session.target} yet.</p>{/if}{/each}
	{#if finals.error}<p class="muted small">Processor: {finals.error}</p>{/if}
	<FinalActions target={session.target} {nights} {finals} />
	{#if mine.length}<a class="small" href="/finals?target={encodeURIComponent(session.target)}">All finals of {session.target}</a>{/if}
</Card>

<style>
	h3 {
		margin: 6px 0 0;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	p {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.small:is(a) {
		text-decoration: none;
	}
</style>
