<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Card from '$lib/components/Card.svelte';
	import UploadForm from '$lib/components/UploadForm.svelte';
	import { formatDuration } from '$lib/format';
	import { galleryHref } from '$lib/gallery';

	/**
	 * D4: every target with pictures, the most recent first: the app's final stacks and the owner's own
	 * processed images. In the lab also the private ones and the upload form; on the public host only what
	 * is published.
	 */
	let { data } = $props();
</script>

<svelte:head><title>Gallery · Telescope</title></svelte:head>

<main>
	<Card title="Gallery">
		{#snippet accessory()}<span class="num">{data.targets.length} {data.targets.length === 1 ? 'target' : 'targets'}</span>{/snippet}
		<p class="muted small">
			{#if data.public}Deep-sky pictures from the cabin telescope (670 mm, ZWO ASI533MC Pro): the telescope's own final stacks and processed versions, newest first.{:else}Final stacks and own processed images per target, newest first. Published ones are also at telescope.shillyshally.org (behind Cloudflare Access).{/if}
		</p>
		{#each data.problems as p (p)}<p class="small warn">{p}</p>{/each}
		{#if data.targets.length}
			<ul class="targets">
				{#each data.targets as t (t.key)}
					{@const cover = t.entries[0]}
					<li>
						<a href={galleryHref(t.key)} class="target">
							<span class="cover">{#if cover}<img src={cover.smallUrl} alt={t.label} loading="lazy" />{/if}</span>
							<span class="label"><strong>{t.label}</strong>{#if t.kind}<span class="muted small">{t.kind}{t.constellation ? ` in ${t.constellation}` : ''}</span>{/if}</span>
							<span class="muted small num">
								{[`${t.entries.length} ${t.entries.length === 1 ? 'picture' : 'pictures'}`, !data.public && t.entries.some((e) => e.published) ? `${t.entries.filter((e) => e.published).length} published` : null, t.integrationS ? `${formatDuration(t.integrationS)} on ${t.nights.length} ${t.nights.length === 1 ? 'night' : 'nights'}` : null].filter(Boolean).join(' · ')}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">{data.public ? 'Nothing published yet.' : 'No pictures yet: finished final stacks and uploads show up here.'}</p>
		{/if}
	</Card>
	{#if !data.public}
		<Card title="Upload own processing">
			<UploadForm targetNames={data.targetNames} onuploaded={() => invalidateAll()} />
		</Card>
	{/if}
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
	.targets {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
		gap: 16px;
	}
	.target {
		display: flex;
		flex-direction: column;
		gap: 6px;
		color: var(--text);
		text-decoration: none;
	}
	.cover {
		display: block;
		aspect-ratio: 1;
		border-radius: 14px;
		overflow: hidden;
		background: #000;
		border: 1px solid var(--border);
	}
	.cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 16px;
	}
</style>
