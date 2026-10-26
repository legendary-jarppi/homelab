<script lang="ts">
	import Card from './Card.svelte';
	import { clock, nightLabel } from '$lib/format';
	import type { Digest } from '$lib/types';

	/**
	 * R6: tonight's pick (Conditions) or a night's morning report (session report) as the push notification
	 * says it, from the server's preview (composed now, never sent), and whether it went out.
	 */
	let { kind, night }: { kind: 'pick' | 'report'; night?: string } = $props();

	let data = $state<Digest | null>(null);
	let failure = $state<string | null>(null);

	$effect(() => {
		const url = `/api/digest/preview?kind=${kind}${night ? `&night=${night}` : ''}`;
		const abort = new AbortController();
		failure = null;
		fetch(url, { signal: abort.signal })
			.then(async (r) => {
				if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? `HTTP ${r.status}`);
				data = (await r.json()) as Digest;
			})
			.catch((e: Error) => {
				if (!abort.signal.aborted) failure = e.message;
			});
		return () => abort.abort();
	});

	/** The link as a path, so it opens on whichever host the app is used (home or behind Access). */
	const href = $derived(data ? new URL(data.url).pathname + new URL(data.url).search : null);
	const status = $derived.by(() => {
		if (!data) return '';
		if (data.sentAt !== null) return `Sent ${new Date(data.sentAt * 1000).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
		if (!data.send) return 'No notification';
		if (data.dueAt === null) return 'Goes out an hour after the last frame';
		const due = `${data.dueAt * 1000 > Date.now() ? 'Due' : 'Was due'} ${clock(data.dueAt * 1000)}`;
		return data.notifyConfigured ? due : `${due} · not sent: no notify token`;
	});
</script>

<Card title={kind === 'pick' ? "Tonight's pick" : 'Morning report'}>
	{#snippet accessory()}
		{#if data}<span class="num">{nightLabel(data.night, false)}</span>{/if}
	{/snippet}
	{#if failure && !data}
		<p class="warn small">Unavailable: {failure}</p>
	{:else if !data}
		<p class="muted small">Composing…</p>
	{:else}
		{#if data.send}
			<p class="title">{#if href}<a href={href}>{data.title}</a>{:else}{data.title}{/if}</p>
			<p class="body small">{data.body}</p>
		{:else}
			<p class="muted small">{data.reason}</p>
		{/if}
		<p class="muted small">{status}</p>
	{/if}
</Card>

<style>
	p {
		margin: 0;
	}
	.title {
		font-weight: 600;
	}
	.title a {
		color: inherit;
	}
	.body {
		white-space: pre-line;
		line-height: 1.45;
	}
</style>
