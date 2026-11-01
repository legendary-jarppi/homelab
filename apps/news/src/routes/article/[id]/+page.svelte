<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Blocks from '$lib/components/Blocks.svelte';
	import Photo from '$lib/components/Photo.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import Story from '$lib/components/Story.svelte';
	import { useI18n } from '$lib/i18n';

	let { data } = $props();
	const i = useI18n();
	const a = $derived(data.article);
	const KIND = { person: 'entity.kind.person', organisation: 'entity.kind.organisation', place: 'entity.kind.place', other: 'entity.kind.other' } as const;

	// Optimistic state; reset whenever another article loads.
	let saved = $derived(data.article.saved);
	// Keyed by article id so a later navigation never inherits the put-away state.
	let putAwayState = $state<{ id: number; kind: 'muted' | 'reported' } | null>(null);
	const removed = $derived(putAwayState?.id === a.id ? putAwayState.kind : null);
	let busy = $state(false);

	const leadInBody = $derived(a.blocks.some((b) => b.type === 'figure' && b.image === 0));
	const lead = $derived(leadInBody ? undefined : a.photos[0]);
	const standfirst = $derived(a.standfirst ?? a.summary);
	/** One link per other paper in the byline; the rail lists every version. */
	const otherPapers = $derived([...new Map(a.alsoIn.map((m) => [m.outletSlug, m])).values()]);

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
	<div class="actions no-print" role="group" aria-label={i.t('article.actions')}>
		<form method="post" action="?/save" use:enhance={toggleSave}>
			<input type="hidden" name="on" value={saved ? '0' : '1'} />
			<button class="button" type="submit" aria-pressed={saved}>{saved ? i.t('article.saved') : i.t('article.save')}</button>
		</form>
		<ShareButton url={data.shareUrl} title={a.headline} />
		<form method="post" action="?/mute" use:enhance={putAway('muted')}>
			<button class="button" type="submit" disabled={busy}>{i.t('article.notForMe')}</button>
		</form>
		<form method="post" action="?/report" use:enhance={putAway('reported')}>
			<button class="button" type="submit" disabled={busy} aria-describedby="upset-hint-{where}">{i.t('article.upset')}</button>
			<span class="visually-hidden" id="upset-hint-{where}">{i.t('article.upsetHint')}</span>
		</form>
	</div>
{/snippet}

{#snippet links(list: { id: number; headline: string; outlet: string; outletSlug: string; language: string | null; publishedAt: Date }[], showOutlet = true)}
	<ul class="links">
		{#each list as s (s.id)}
			<li>
				<a class="hed hed-1" href="/article/{s.id}" lang={s.language ?? undefined}>{s.headline}</a>
				<p class="byline">
					{#if showOutlet}<a class="paper" href="/papers/{s.outletSlug}">{s.outlet}</a> <span aria-hidden="true">·</span>{/if}
					<time datetime={s.publishedAt.toISOString()} title={i.fullDate(s.publishedAt)}>{i.when(s.publishedAt)}</time>
				</p>
			</li>
		{/each}
	</ul>
{/snippet}

{#if removed}
	<section class="removed" aria-live="polite">
		{#if removed === 'reported'}
			<h1 class="hed hed-3">{i.t('article.reportedTitle')}</h1>
			<p>{i.t('article.reportedText')}</p>
		{:else}
			<h1 class="hed hed-3">{i.t('article.mutedTitle')}</h1>
			<p>{i.t('article.mutedText')}</p>
			<form method="post" action="?/unmute" use:enhance={undo}>
				<button class="button" type="submit" disabled={busy}>{i.t('article.undo')}</button>
			</form>
		{/if}
		<p><a class="button button-primary" href="/">{i.t('article.backToFront')}</a></p>
	</section>
{:else}
	<div class="layout">
		<article class="article">
			<header class="head">
				{#if a.topic}
					<p class="kicker">
						{#if a.section}<a href="/section/{a.section}">{i.topic(a.topic).label}</a>{:else}{i.topic(a.topic).label}{/if}
					</p>
				{/if}
				<h1 class="hed hed-6 headline" lang={a.language ?? undefined}>{a.headline}</h1>
				{#if standfirst}<p class="standfirst" lang={a.language ?? undefined}>{standfirst}</p>{/if}
				<p class="byline">
					{#if a.author}<span lang={a.language ?? undefined}>{a.author}</span> <span aria-hidden="true">·</span>{/if}
					<a class="paper" href="/papers/{a.outletSlug}">{a.outlet}</a>
					<span aria-hidden="true">·</span>
					<time datetime={a.publishedAt.toISOString()} title={i.fullDate(a.publishedAt)}>{i.when(a.publishedAt)}</time>
					<span aria-hidden="true">·</span>
					{i.t('story.minutes', { n: a.minutes })}
				</p>
				{#if otherPapers.length > 0}
					<p class="also-line">
						<span class="also-label">{i.t('story.alsoIn')}</span>
						{#each otherPapers as m, n (m.id)}<a href="/article/{m.id}">{m.outlet}</a>{#if n < otherPapers.length - 1}<span aria-hidden="true">,</span>{/if}{/each}
					</p>
				{/if}
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
					{i.t('article.originally', { outlet: a.outlet })} <q lang={a.language ?? undefined}>{a.originalTitle}</q>
				</p>
				<p><a href={a.url} rel="noreferrer noopener" target="_blank">{i.t('article.readAt', { outlet: a.outlet })}</a></p>
				{@render actions('bottom')}
			</footer>

			{#if a.next}
				<section class="next no-print" aria-labelledby="read-next">
					<h2 class="section-head" id="read-next">{i.t('article.next')}</h2>
					<Story card={a.next} variant="secondary" photo summary />
				</section>
			{/if}
		</article>

		<aside class="rail rail-left no-print" aria-label={i.t('article.coverage')}>
			{#if a.alsoIn.length > 0}
				<section class="box also" aria-labelledby="also-in">
					<h2 class="section-head" id="also-in">{i.t('article.alsoInTitle')}</h2>
					<p class="hint">{i.t('article.alsoInHint')}</p>
					<ul class="links">
						{#each a.alsoIn as m (m.id)}
							<li>
								<a class="paper-name" href="/papers/{m.outletSlug}">{m.outlet}</a>
								<a class="hed hed-1" href="/article/{m.id}" lang={m.language ?? undefined}>{m.headline}</a>
								<p class="byline">
									<time datetime={m.publishedAt.toISOString()} title={i.fullDate(m.publishedAt)}>{i.when(m.publishedAt)}</time>
									<span aria-hidden="true">·</span>
									{i.t('story.minutes', { n: m.minutes })}
								</p>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
			{#if a.morePaper.length > 0}
				<section class="box" aria-labelledby="more-paper">
					<h2 class="section-head" id="more-paper"><a href="/papers/{a.outletSlug}">{i.t('article.morePaper', { paper: a.outlet })}</a></h2>
					{@render links(a.morePaper, false)}
				</section>
			{/if}
		</aside>

		<aside class="rail rail-right no-print" aria-label={i.t('article.around')}>
			{#if a.related.length > 0}
				<section class="box" aria-labelledby="related">
					<h2 class="section-head" id="related">{i.t('article.related')}</h2>
					<div class="related">
						{#each a.related as card (card.id)}
							<Story {card} variant="brief" photo />
						{/each}
					</div>
				</section>
			{/if}
			{#if a.entities.length > 0}
				<section class="box" aria-labelledby="entities">
					<h2 class="section-head" id="entities">{i.t('article.entities')}</h2>
					{#each a.entities as e (e.id)}
						<section class="entity" aria-labelledby="entity-{e.id}">
							<h3 class="entity-name" id="entity-{e.id}">
								<a href="/entity/{e.id}">{e.name}</a>
								<span class="entity-kind">{i.t(KIND[e.kind])}</span>
							</h3>
							{#if e.stories.length > 0}{@render links(e.stories)}{/if}
							<p class="more"><a href="/entity/{e.id}">{i.t('article.allAbout', { name: e.name })}</a></p>
						</section>
					{/each}
				</section>
			{/if}
			{#if a.moreSection.length > 0 && a.section}
				<section class="box" aria-labelledby="more-section">
					<h2 class="section-head" id="more-section"><a href="/section/{a.section}">{i.t('article.moreSection', { section: i.section(a.section) })}</a></h2>
					{@render links(a.moreSection)}
				</section>
			{/if}
		</aside>
	</div>
{/if}

<style>
	/* Phones and iPads: the article, then the rails below it. Wide screens: rails either side. */
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: 'main' 'left' 'right';
		gap: var(--space-7) var(--gutter);
		margin-top: var(--space-6);
	}

	.article {
		grid-area: main;
		--column: min(100%, 44rem);
		display: grid;
		justify-items: center;
		align-content: start;
	}

	.rail-left {
		grid-area: left;
	}

	.rail-right {
		grid-area: right;
	}

	.rail {
		display: grid;
		align-content: start;
		gap: var(--space-6);
	}

	.head,
	.body-wrap,
	.source,
	.next {
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

	.also-line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 0.35em;
		font-family: var(--font-ui);
		font-size: var(--step--1);
		color: var(--ink-2);
	}

	.also-line span[aria-hidden] {
		margin-left: -0.35em;
	}

	.also-line a {
		color: var(--ink);
		font-weight: 600;
	}

	.also-label {
		margin-right: var(--space-1);
		font-weight: 600;
		color: var(--accent);
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

	.next {
		margin-top: var(--space-7);
	}

	.box .section-head {
		margin-bottom: var(--space-3);
	}

	.hint {
		margin-bottom: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		color: var(--ink-2);
	}

	.links {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.links li {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3) 0;
		border-top: var(--hairline);
	}

	.links li:first-child {
		border-top: 0;
		padding-top: 0;
	}

	.links .hed {
		text-decoration: none;
	}

	.links .hed:hover {
		text-decoration: underline;
	}

	/* "Also in": each paper's name as a small nameplate over its headline. */
	.also .paper-name {
		font-family: var(--font-head);
		font-size: var(--step-0);
		font-weight: 700;
		color: var(--ink);
		text-decoration: none;
	}

	.also .paper-name:hover {
		text-decoration: underline;
		text-decoration-color: var(--accent);
	}

	.also {
		padding: var(--space-4);
		background: var(--paper-2);
	}

	.related {
		display: grid;
		gap: var(--space-3);
	}

	.related > :global(.story + .story) {
		padding-top: var(--space-3);
		border-top: var(--hairline);
	}

	/* Related: a small photo beside the headline, so the rail stays a list. */
	.related :global(.story.has-photo .inner) {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 30%;
		gap: var(--space-3);
	}

	.related :global(.story.has-photo .art) {
		grid-column: 2;
		grid-row: 1;
		margin: 0.2em 0 0;
	}

	.related :global(.story.has-photo .text) {
		grid-column: 1;
		grid-row: 1;
	}

	.entity {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) 0 var(--space-4);
	}

	.entity + .entity {
		border-top: 1px solid var(--ink);
	}

	.entity-name {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
		font-family: var(--font-head);
		font-size: var(--step-1);
		font-weight: 700;
		line-height: 1.2;
	}

	.entity-name a {
		text-decoration: none;
	}

	.entity-name a:hover {
		text-decoration: underline;
		text-decoration-color: var(--accent);
	}

	.entity-kind {
		font-family: var(--font-ui);
		font-size: var(--step--2);
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.more {
		font-family: var(--font-ui);
		font-size: var(--step--1);
		font-weight: 600;
	}

	.more a {
		text-decoration-color: var(--accent);
	}

	.removed {
		display: grid;
		gap: var(--space-4);
		justify-items: start;
		max-width: 36rem;
		margin: var(--space-8) auto;
	}

	/* iPad landscape: rails side by side under the article. */
	@media (min-width: 48rem) and (max-width: 79.99rem) {
		.layout {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			grid-template-areas: 'main main' 'left right';
		}
	}

	/* Wide screens: the coverage rail left of the article, the context rail right of it. */
	@media (min-width: 80rem) {
		.layout {
			grid-template-columns: minmax(14rem, 17rem) minmax(0, 44rem) minmax(15rem, 19rem);
			grid-template-areas: 'left main right';
			justify-content: center;
		}

		.article {
			--column: 100%;
		}

		.lead-figure {
			width: 100%;
		}

		.rail-left,
		.rail-right {
			position: relative;
		}

		.rail-left::after,
		.rail-right::before {
			content: '';
			position: absolute;
			top: 0;
			bottom: 0;
			border-left: var(--hairline);
		}

		.rail-left::after {
			right: calc(var(--gutter) / -2);
		}

		.rail-right::before {
			left: calc(var(--gutter) / -2);
		}
	}

	@media print {
		.layout {
			display: block;
		}

		.article {
			--column: 100%;
		}

		.headline {
			font-size: 24pt;
		}
	}
</style>
