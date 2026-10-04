<script lang="ts">
	import { percent, when } from '$lib/components/account/format';

	let { data } = $props();

	const n = (value: number) => value.toLocaleString('en-GB');
</script>

<svelte:head>
	<title>Pipeline · Admin</title>
</svelte:head>

<h1>Pipeline</h1>

<h2>Queues</h2>
<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th scope="col">Queue</th>
				<th scope="col" class="num">Waiting</th>
				<th scope="col" class="num">Due now</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<th scope="row">Extraction</th>
				<td class="num">{n(data.queues.pending_content)}</td>
				<td class="num">{n(data.queues.due_content)}</td>
			</tr>
			<tr>
				<th scope="row">Classification</th>
				<td class="num">{n(data.queues.pending_classify)}</td>
				<td class="num">{n(data.queues.due_classify)}</td>
			</tr>
			<tr>
				<th scope="row">Failed extraction</th>
				<td class="num" class:warn={data.queues.failed_content > 0}>{n(data.queues.failed_content)}</td>
				<td class="num muted">–</td>
			</tr>
			<tr>
				<th scope="row">Failed classification</th>
				<td class="num" class:warn={data.queues.failed_classify > 0}>{n(data.queues.failed_classify)}</td>
				<td class="num muted">–</td>
			</tr>
		</tbody>
	</table>
</div>

<h2>Model, last 24 hours</h2>
<dl class="facts">
	<dt>Configured here (LLM_MODEL)</dt>
	<dd>{data.configuredModel ?? 'not set in the web environment (the worker’s setting applies)'}</dd>
	<dt>Last call</dt>
	<dd>{data.lastCall ? `${data.lastCall.model}, ${when(data.lastCall.created_at)}` : 'none yet'}</dd>
</dl>
<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th scope="col">Model</th>
				<th scope="col" class="num">Calls</th>
				<th scope="col" class="num">Errors</th>
				<th scope="col" class="num">p50</th>
				<th scope="col" class="num">p90</th>
				<th scope="col" class="num">Tokens in</th>
				<th scope="col" class="num">Cached</th>
				<th scope="col" class="num">Tokens out</th>
			</tr>
		</thead>
		<tbody>
			{#each data.models as m (m.model)}
				<tr>
					<th scope="row">{m.model}</th>
					<td class="num">{n(m.calls)}</td>
					<td class="num" class:warn={m.errors > 0}>{n(m.errors)} ({percent(m.calls ? m.errors / m.calls : null)})</td>
					<td class="num">{m.p50_ms === null ? '–' : `${(m.p50_ms / 1000).toFixed(1)} s`}</td>
					<td class="num">{m.p90_ms === null ? '–' : `${(m.p90_ms / 1000).toFixed(1)} s`}</td>
					<td class="num">{n(m.input_tokens)}</td>
					<td class="num">{n(m.cache_read_tokens)}</td>
					<td class="num">{n(m.output_tokens)}</td>
				</tr>
			{:else}
				<tr><td colspan="8" class="muted">No calls in the last 24 hours.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<h2>Recent model errors</h2>
{#if data.llmErrors.length === 0}
	<p class="muted">None.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead><tr><th scope="col">When</th><th scope="col">Model</th><th scope="col">Article</th><th scope="col">Error</th></tr></thead>
			<tbody>
				{#each data.llmErrors as e, i (i)}
					<tr>
						<td>{when(e.created_at)}</td>
						<td>{e.model}</td>
						<td>{#if e.article_id}<a href="/admin/article/{e.article_id}">#{e.article_id}</a>{/if}</td>
						<td>{e.error}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Recent article failures</h2>
{#if data.articleErrors.length === 0}
	<p class="muted">None.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead><tr><th scope="col">When</th><th scope="col">Outlet</th><th scope="col">Stage</th><th scope="col">Article</th><th scope="col">Reason</th></tr></thead>
			<tbody>
				{#each data.articleErrors as e (e.id)}
					<tr>
						<td>{when(e.at)}</td>
						<td>{e.outlet}</td>
						<td>{e.stage}</td>
						<td><a href="/admin/article/{e.id}">#{e.id}</a></td>
						<td>{e.reason ?? '–'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if data.discoveryErrors.length > 0}
	<h2>Discovery errors</h2>
	<div class="table-wrap">
		<table>
			<thead><tr><th scope="col">Outlet</th><th scope="col">When</th><th scope="col">Error</th></tr></thead>
			<tbody>
				{#each data.discoveryErrors as e (e.name)}
					<tr><td>{e.name}</td><td>{when(e.last_discovery_at)}</td><td>{e.last_discovery_error}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Editions</h2>
{#if data.editions.length === 0}
	<p class="muted">No editions published yet.</p>
{:else}
	<ul class="editions">
		{#each data.editions as e (e.id)}
			<li>{e.label} <span class="muted">· {when(e.cutoff)}</span></li>
		{/each}
	</ul>
{/if}

<style>
	.editions {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.editions li {
		padding: var(--space-1) 0;
		border-bottom: var(--hairline);
	}
</style>
