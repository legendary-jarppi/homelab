<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Blocks from '$lib/components/Blocks.svelte';
	import Photo from '$lib/components/Photo.svelte';
	import Story from '$lib/components/Story.svelte';
	import { fullDate, when } from '$lib/components/format';

	let { data } = $props();
	const a = $derived(data.article);

	// Optimistic state; reset whenever another article loads.
	let saved = $derived(data.article.saved);
	// Keyed by article id so a later navigation never inherits the put-away state.
	let putAwayState = $state<{ id: number; kind: 'muted' | 'reported' } | null>(null);
	const removed = $derived(putAwayState?.id === a.id ? putAwayState.kind : null);
	let busy = $state(false);

	const leadInBody = $derived(a.blocks.some((b) => b.type === 'figure' && b.image === 0));
	const lead = $derived(leadInBody ? undefined : a.photos[0]);
	const standfirst = $derived(a.standfirst ?? a.summary);

	const toggleSave: SubmitFunction = () => {
		const before = saved;
		saved = !saved;
		return async ({ result }) => {
			if (result.type !== 'success') saved = before;
		};
	};

	// Mute and report redirect to the front page without JS; with JS the article is put away in place.
	function putAway(kind: 'muted' | 'reported'): SubmitFunction {
		return () => {
			putAwayState = { id: a.id, kind };
			busy = true;
			window.scrollTo({ top: 0 });
			return async ({ result }) => {
				busy = false;
				if (result.type === 'error' || result.type === 'failure') putAwayState = null;
			};
		};
	}

	const undo: SubmitFunction = () => {
		busy = true;
		return async ({ result }) => {
			busy = false;
			if (result.type === 'redirect' || result.type === 'success') putAwayState = null;
		};
	};
</script>

<svelte:head>
	<title>{a.headline} · Shilly Shally News</title>
</svelte:head>

{#snippet actions(where: string)}
	<div class="actions no-print" role="group" aria-label="Article actions">
		<form method="post" action="?/save" use:enhance={toggleSave}>
			<input type="hidden" name="on" value={saved ? '0' : '1'} />
			<button class="button" type="submit" aria-pressed={saved}>{saved ? 'Saved' : 'Save'}</button>
		</form>
		<form method="post" action="?/mute" use:enhance={putAway('muted')}>
			<button class="button" type="submit" disabled={busy}>Not for me</button>
		</form>
		<form method="post" action="?/report" use:enhance={putAway('reported')}>
			<button class="button" type="submit" disabled={busy} aria-describedby="upset-hint-{where}">This upset me</button>
			<span class="visually-hidden" id="upset-hint-{where}">Hides this article at once and asks an editor to look at it.</span>
		</form>
	</div>
{/snippet}

{#if removed}
	<section class="removed" aria-live="polite">
		{#if removed === 'reported'}
			<h1 class="hed hed-3">Thank you for telling us.</h1>
			<p>This article is gone from your paper, and an editor will look at it. You don’t need to do anything else.</p>
		{:else}
			<h1 class="hed hed-3">Put away.</h1>
			<p>This article won’t appear in your paper again.</p>
			<form method="post" action="?/unmute" use:enhance={undo}>
				<button class="button" type="submit" disabled={busy}>Undo</button>
			</form>
		{/if}
		<p><a class="button button-primary" href="/">Back to the front page</a></p>
	</section>
{:else}
	<article class="article">
		<header class="head">
			{#if a.kicker}
				<p class="kicker">
					{#if a.section && a.sectionLabel}<a href="/section/{a.section}">{a.kicker}</a>{:else}{a.kicker}{/if}
				</p>
			{/if}
			<h1 class="hed hed-6 headline" lang={a.language ?? undefined}>{a.headline}</h1>
			{#if standfirst}<p class="standfirst" lang={a.language ?? undefined}>{standfirst}</p>{/if}
			<p class="byline">
				{#if a.author}<span lang={a.language ?? undefined}>{a.author}</span> <span aria-hidden="true">·</span>{/if}
				{a.outlet}
				<span aria-hidden="true">·</span>
				<time datetime={a.publishedAt.toISOString()} title={fullDate(a.publishedAt)}>{when(a.publishedAt)}</time>
				<span aria-hidden="true">·</span>
				{a.minutes} min read
			</p>
			{@render actions('top')}
		</header>

		{#if lead}
			<div class="lead-figure">
				<Photo photo={lead} eager />
			</div>
		{/if}

		<div class="body-wrap">
			<Blocks blocks={a.blocks} photos={a.photos} lang={a.language ?? undefined} />
		</div>

		<footer class="source">
			<p class="original">
				Originally published by {a.outlet} as <q lang={a.language ?? undefined}>{a.originalTitle}</q>
			</p>
			<p><a href={a.url} rel="noreferrer noopener" target="_blank">Read at {a.outlet}</a></p>
			{@render actions('bottom')}
		</footer>
	</article>

	{#if a.alsoIn.length > 0}
		<section class="also" aria-labelledby="also-in">
			<h2 class="section-head" id="also-in">Also in</h2>
			<ul>
				{#each a.alsoIn as m (m.id)}
					<li>
						<span class="kicker">{m.outlet}</span>
						<a class="hed hed-1" href="/article/{m.id}">{m.headline}</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if a.more.length > 0}
		<section class="more no-print" aria-labelledby="more-from">
			<h2 class="section-head" id="more-from">
				<a href="/section/{a.section}">More from {a.sectionLabel ?? 'the paper'}</a>
			</h2>
			<div class="more-grid">
				{#each a.more as card (card.id)}
					<Story {card} summary />
				{/each}
			</div>
		</section>
	{/if}
{/if}

<style>
	.article {
		--column: min(100%, 44rem);
		display: grid;
		justify-items: center;
		margin-top: var(--space-6);
	}

	.head,
	.body-wrap,
	.source {
		width: var(--column);
	}

	.head {
		display: grid;
		gap: var(--space-3);
	}

	.head .kicker a {
		text-decoration: none;
	}

	.headline {
		line-height: 1.06;
	}

	.standfirst {
		font-size: var(--step-1);
		line-height: 1.42;
		color: var(--ink-2);
	}

	.head .byline {
		padding-top: var(--space-3);
		border-top: var(--hairline);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.actions .button[aria-pressed='true'] {
		background: var(--ink);
		color: var(--paper);
	}

	.lead-figure {
		width: min(100%, 60rem);
		margin: var(--space-6) 0;
	}

	.body-wrap {
		margin-top: var(--space-5);
	}

	.lead-figure + .body-wrap {
		margin-top: 0;
	}

	.source {
		display: grid;
		gap: var(--space-3);
		margin-top: var(--space-7);
		padding-top: var(--space-4);
		border-top: 3px double var(--ink);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		color: var(--ink-2);
	}

	.source a {
		color: var(--ink);
		font-weight: 600;
	}

	.also,
	.more {
		margin-top: var(--space-7);
	}

	.also {
		width: min(100%, 44rem);
		margin-inline: auto;
	}

	.also ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.also li {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3) 0;
		border-top: var(--hairline);
	}

	.also li:first-child {
		border-top: 0;
	}

	.also .hed {
		text-decoration: none;
	}

	.also .hed:hover {
		text-decoration: underline;
	}

	.more-grid {
		columns: 4 14rem;
		column-gap: var(--gutter);
		column-rule: var(--hairline);
	}

	.removed {
		display: grid;
		gap: var(--space-4);
		justify-items: start;
		max-width: 36rem;
		margin: var(--space-8) auto;
	}

	@media print {
		.article {
			--column: 100%;
		}

		.headline {
			font-size: 24pt;
		}
	}
</style>
