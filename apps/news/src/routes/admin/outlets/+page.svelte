<script lang="ts">
	import { enhance } from '$app/forms';
	import { keepValues } from '$lib/components/account/forms';
	import { percent, when } from '$lib/components/account/format';

	let { data, form } = $props();

	const CONTENT = ['pending', 'extracted', 'paywalled', 'failed', 'skipped'] as const;
	const CLASSIFY = ['pending', 'done', 'failed'] as const;
</script>

<svelte:head>
	<title>Outlets · Admin</title>
</svelte:head>

<h1>Outlets</h1>
<p class="muted">Counts are by discovery time. Classification counts cover extracted articles only.</p>

{#each data.outlets as outlet (outlet.id)}
	<section class="entry" aria-labelledby="outlet-{outlet.id}">
		<div class="entry-head">
			<h2 id="outlet-{outlet.id}">{outlet.name} <span class="muted">· {outlet.slug} · {outlet.language}</span></h2>
			<span class:warn={!outlet.enabled}>{outlet.enabled ? 'Enabled' : 'Disabled'}{outlet.requires_auth ? ' · needs credentials' : ''}</span>
		</div>

		{#if form?.outletId === outlet.id && form.message}
			<p class="flash" role="status">{form.message}</p>
		{/if}

		<dl class="facts">
			<dt>Last discovery</dt>
			<dd>
				{when(outlet.last_discovery_at)}
				{#if outlet.last_discovery_found !== null}· found {outlet.last_discovery_found}, new {outlet.last_discovery_new}{/if}
			</dd>
			{#if outlet.last_discovery_error}
				<dt>Discovery error</dt>
				<dd class="warn">{outlet.last_discovery_error}</dd>
			{/if}
			<dt>Paywalled share</dt>
			<dd>24 h {percent(outlet.windows['24h'].paywalledShare)} · 7 d {percent(outlet.windows['7d'].paywalledShare)}</dd>
			{#if outlet.session}
				<dt>Subscriber login</dt>
				{#if outlet.session.state === 'ok'}
					<dd>Working · a subscriber article opened {when(outlet.session.stateAt)}</dd>
				{:else if outlet.session.state === 'rejected'}
					<dd class="warn">Expired · a subscriber article was still locked {when(outlet.session.stateAt)}. Renew the cookies (see apps/news/README.md), then re-fetch paywalled articles.</dd>
				{:else}
					<dd>Not yet tested · waits for the next subscriber article</dd>
				{/if}
			{/if}
		</dl>

		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<td colspan="2"></td>
						<th scope="colgroup" colspan={CONTENT.length} class="group">Content</th>
						<th scope="colgroup" colspan={CLASSIFY.length} class="group">Classification</th>
					</tr>
					<tr>
						<th scope="col">Window</th>
						<th scope="col" class="num">All</th>
						{#each CONTENT as s (s)}<th scope="col" class="num">{s}</th>{/each}
						{#each CLASSIFY as s (s)}<th scope="col" class="num">{s}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each ['24h', '7d'] as const as win (win)}
						{@const w = outlet.windows[win]}
						<tr>
							<th scope="row">{win === '24h' ? '24 h' : '7 d'}</th>
							<td class="num">{w.total}</td>
							{#each CONTENT as s (s)}<td class="num" class:warn={s === 'failed' && w.content[s] > 0}>{w.content[s]}</td>{/each}
							{#each CLASSIFY as s (s)}<td class="num" class:warn={s === 'failed' && w.classify[s] > 0}>{w.classify[s]}</td>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if outlet.failedReasons.length > 0}
			<h3>Failure reasons, 7 d</h3>
			<ol class="reasons">
				{#each outlet.failedReasons as r (r.reason)}
					<li><span class="num">{r.n}×</span> {r.reason}</li>
				{/each}
			</ol>
		{/if}

		<div class="controls">
			<form class="inline-form" method="POST" action="?/enabled" use:enhance>
				<input type="hidden" name="id" value={outlet.id} />
				<input type="hidden" name="enabled" value={outlet.enabled ? 'false' : 'true'} />
				<button class="button">{outlet.enabled ? 'Disable' : 'Enable'}</button>
			</form>
			<form class="inline-form" method="POST" action="?/priority" use:enhance={keepValues}>
				<input type="hidden" name="id" value={outlet.id} />
				<label for="priority-{outlet.id}">Priority</label>
				<input id="priority-{outlet.id}" type="number" name="priority" min="0" max="1000" step="1" value={outlet.priority} />
				<button class="button">Set</button>
			</form>
			<form class="inline-form" method="POST" action="?/discover" use:enhance>
				<input type="hidden" name="id" value={outlet.id} />
				<button class="button" disabled={!outlet.enabled}>Discover now</button>
			</form>
			<form class="inline-form" method="POST" action="?/reextract" use:enhance>
				<input type="hidden" name="id" value={outlet.id} />
				<button class="button">Re-extract failed</button>
			</form>
			<form class="inline-form" method="POST" action="?/refetchPaywalled" use:enhance>
				<input type="hidden" name="id" value={outlet.id} />
				<button class="button">Re-fetch paywalled, last {data.refetchDays} days</button>
			</form>
			<form class="inline-form" method="POST" action="?/reclassify" use:enhance>
				<input type="hidden" name="id" value={outlet.id} />
				<button class="button">Re-classify last {data.reclassifyDays} days</button>
			</form>
		</div>
	</section>
{:else}
	<p>No outlets yet. The worker seeds them on start.</p>
{/each}

<style>
	.reasons {
		margin: 0 0 var(--space-3);
		padding-left: 0;
		list-style: none;
	}

	.reasons li {
		padding: var(--space-1) 0;
		overflow-wrap: anywhere;
	}

	.reasons .num {
		display: inline-block;
		min-width: 3rem;
		font-variant-numeric: tabular-nums;
	}

	thead tr:first-child > td {
		border-bottom: 0;
	}

	.group {
		text-align: center;
		color: var(--ink-2);
		border-bottom: var(--hairline);
	}
</style>
