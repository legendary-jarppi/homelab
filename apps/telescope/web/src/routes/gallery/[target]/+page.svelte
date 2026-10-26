<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Card from '$lib/components/Card.svelte';
	import GalleryItem from '$lib/components/GalleryItem.svelte';
	import UploadForm from '$lib/components/UploadForm.svelte';
	import { formatDuration, nightLabel } from '$lib/format';

	/**
	 * D4: one target: its newest picture large, every final stack (versions as the integration grew) and own
	 * processed image newest first, and the target's integration, nights and equipment. In the lab: publish,
	 * edit and delete, and uploads for this target.
	 */
	let { data } = $props();

	const t = $derived(data.target);
	const finals = $derived(t.entries.filter((e) => e.kind === 'final').length);
	const uploads = $derived(t.entries.length - finals);
	const published = $derived(t.entries.some((e) => e.published));
	const shareUrl = $derived(data.shareBase ? `${data.shareBase}/gallery/${encodeURIComponent(t.key)}` : null);
</script>

<svelte:head><title>{t.label} · Gallery · Telescope</title></svelte:head>

<main>
	<div class="title">
		<a href="/gallery" class="back">← Gallery</a>
		<h1>{t.label}</h1>
		{#if t.kind}<span class="muted">{t.kind}{t.constellation ? ` in ${t.constellation}` : ''}{t.size ? ` · ${t.size}` : ''}</span>{/if}
	</div>
	<div class="grid">
		<div class="pictures">
			{#if t.entries.length}
				<Card title="Newest">
					<GalleryItem entry={t.entries[0]} publicMode={data.public} featured onchanged={() => invalidateAll()} />
				</Card>
				{#if t.entries.length > 1}
					<Card title="All versions">
						{#snippet accessory()}<span class="num">{finals} final{finals === 1 ? '' : 's'}{uploads ? ` · ${uploads} own` : ''}</span>{/snippet}
						<ul>{#each t.entries.slice(1) as e (e.kind + e.id)}<li><GalleryItem entry={e} publicMode={data.public} onchanged={() => invalidateAll()} /></li>{/each}</ul>
					</Card>
				{/if}
			{:else}
				<Card title="Pictures"><p class="muted">No pictures yet: build a final stack on the Finals page, or upload your own processing.</p></Card>
			{/if}
		</div>
		<div class="side">
			<Card title="Target">
				<dl class="num">
					<div><dt>Integration</dt><dd>{t.integrationS ? formatDuration(t.integrationS) : '–'}</dd></div>
					<div><dt>Nights</dt><dd>{t.nights.length || '–'}</dd></div>
					<div class="wide"><dt>Equipment</dt><dd>{t.equipment.length ? t.equipment.join('; ') : '–'}</dd></div>
					{#if t.exposures.length}<div class="wide"><dt>Exposures</dt><dd>{t.exposures.join('; ')}</dd></div>{/if}
				</dl>
				{#if t.sessionLinks?.length}
					<ul class="nights">{#each t.sessionLinks as s (s.id)}<li><a href="/sessions/{encodeURIComponent(s.id)}">{nightLabel(s.night)}</a> <span class="muted num">{formatDuration(s.integrationS)}</span></li>{/each}</ul>
				{:else if t.nights.length}
					<p class="small muted">{t.nights.map((n) => nightLabel(n)).join(' · ')}</p>
				{/if}
			</Card>
			{#if !data.public && shareUrl}
				<Card title="Share link">
					{#if published}
						<p class="small">Anyone can open the published pictures here, without logging in:</p>
						<p class="small"><a href={shareUrl} target="_blank" rel="noopener">{shareUrl}</a></p>
					{:else}
						<p class="small muted">Publish a picture to show it at <span class="num">{shareUrl}</span>, open to anyone without logging in.</p>
					{/if}
				</Card>
			{/if}
			{#if !data.public}
				<Card title="Upload own processing">
					<UploadForm target={t.entries[0]?.target ?? t.key} targetNames={data.targetNames} onuploaded={() => invalidateAll()} />
				</Card>
			{/if}
		</div>
	</div>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
	}
	p {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.title {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 14px;
	}
	.back {
		flex-basis: 100%;
		font-size: 13px;
		text-decoration: none;
		color: var(--muted);
	}
	h1 {
		margin: 0;
		font-size: 28px;
		letter-spacing: -0.02em;
	}
	.grid,
	.pictures,
	.side {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
		min-width: 0;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
		gap: 16px 20px;
	}
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px 14px;
	}
	dl .wide {
		grid-column: 1 / -1;
	}
	dt {
		font-size: 11px;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	dd {
		margin: 0;
		font-size: 15px;
	}
	.nights {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 13px;
	}
	@media (min-width: 1000px) {
		.grid {
			display: grid;
			grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
			align-items: start;
		}
	}
</style>
