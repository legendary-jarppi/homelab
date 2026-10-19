<script lang="ts">
	import { entryTitle, type GalleryEntry } from '$lib/gallery';
	import { formatBytes, formatDuration, nightLabel } from '$lib/format';
	import ImageViewer from './ImageViewer.svelte';

	/**
	 * D4: one picture of a target: a final stack (a version) or an own processed image. Tap for the viewer.
	 * In the lab: publish toggle, title and note, the original file, deleting an upload (with confirmation).
	 */
	let { entry: e, publicMode, featured = false, onchanged }: { entry: GalleryEntry; publicMode: boolean; featured?: boolean; onchanged: () => void } = $props();

	let viewing = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let editing = $state(false);
	let title = $state('');
	let note = $state('');

	const api = $derived(`/api/${e.kind === 'final' ? 'finals' : 'uploads'}/${encodeURIComponent(e.id)}`);
	const date = $derived(new Date((e.takenAt ?? e.at) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));
	const nights = $derived(e.nights.length === 1 ? nightLabel(e.nights[0]) : e.nights.length > 1 ? `${e.nights.length} nights, ${nightLabel(e.nights[0], false)} – ${nightLabel(e.nights.at(-1)!)}` : null);

	async function change(patch: Record<string, unknown>, method = 'PUT') {
		busy = true;
		problem = null;
		try {
			const response = await fetch(api, method === 'PUT' ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) } : { method });
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`);
			editing = false;
			onchanged();
		} catch (err) {
			problem = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	function edit() {
		title = e.title ?? '';
		note = e.note ?? '';
		editing = true;
	}

	function remove() {
		if (confirm(`Delete “${entryTitle(e)}” of ${e.target}? The uploaded file and its pictures are removed for good.`)) change({}, 'DELETE');
	}
</script>

<article class="item" class:featured>
	<button class="thumb" onclick={() => (viewing = true)} aria-label="Open {entryTitle(e)} full screen">
		<img src={featured ? e.url : e.smallUrl} alt="{entryTitle(e)}, {e.target}" loading="lazy" />
	</button>
	<div class="body">
		<div class="top">
			<strong>{entryTitle(e)}</strong>
			<span class="tag">{e.kind === 'final' ? `Final${e.version ? ` v${e.version}` : ''}` : 'Own processing'}</span>
			{#if !publicMode}<span class="tag" class:ok={e.published}>{e.published ? 'Published' : 'Private'}</span>{/if}
		</div>
		<span class="muted small num">
			{e.kind === 'final' ? `${date} · ${e.frames} frames · ${formatDuration(e.integrationS)}` : date}
		</span>
		{#if nights}<span class="muted small">{nights}</span>{/if}
		{#if e.note && !editing}<p class="note">{e.note}</p>{/if}
		{#if !publicMode}
			{#if editing}
				<form class="edit" onsubmit={(ev) => (ev.preventDefault(), change({ title: title.trim() || null, note: note.trim() || null }))}>
					<input class="field" bind:value={title} maxlength="200" placeholder="Title" aria-label="Title" />
					<textarea class="field" bind:value={note} maxlength="2000" rows="3" placeholder="Note" aria-label="Note"></textarea>
					<div class="row">
						<button class="btn primary" disabled={busy}>Save</button>
						<button type="button" class="btn" onclick={() => (editing = false)}>Cancel</button>
					</div>
				</form>
			{:else}
				<div class="row">
					<button class="btn" class:on={e.published} aria-pressed={e.published} disabled={busy} onclick={() => change({ published: !e.published })}>{e.published ? 'Unpublish' : 'Publish'}</button>
					<button class="btn" onclick={edit}>Edit</button>
					{#if e.original}<a class="btn" href="/uploads/{encodeURIComponent(e.id)}/original" download title="{e.original.filename}, {formatBytes(e.original.bytes)}">Original</a>{/if}
					{#if e.kind === 'upload'}<button class="btn" disabled={busy} onclick={remove}>Delete</button>{/if}
				</div>
			{/if}
			{#if problem}<span class="small warn">{problem}</span>{/if}
		{/if}
	</div>
</article>

{#if viewing}
	<ImageViewer image={{ kind: e.kind, id: e.id }} src={e.url} alt="{entryTitle(e)}, {e.target}" caption="{e.target} · {entryTitle(e)}" onclose={() => (viewing = false)} />
{/if}

<style>
	.item {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		min-width: 0;
	}
	.item.featured {
		flex-direction: column;
	}
	.thumb {
		flex: none;
		width: 112px;
		height: 112px;
		padding: 0;
		border-radius: 12px;
		overflow: hidden;
		background: #000;
		border: 1px solid var(--border);
		cursor: zoom-in;
	}
	.featured .thumb {
		width: 100%;
		height: auto;
		max-height: 70vh;
		aspect-ratio: auto;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.featured .thumb img {
		height: auto;
		max-height: 70vh;
		object-fit: contain;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}
	.top {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px 8px;
		font-size: 16px;
	}
	.small {
		font-size: 13px;
	}
	.note {
		margin: 2px 0 0;
		font-size: 14px;
		white-space: pre-wrap;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 4px;
	}
	.edit {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 4px;
	}
	textarea {
		resize: vertical;
	}
</style>
