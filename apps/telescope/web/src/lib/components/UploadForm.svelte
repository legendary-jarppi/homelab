<script lang="ts">
	import { untrack } from 'svelte';
	import { catalog, findDso } from '$lib/catalog';
	import { formatBytes } from '$lib/format';

	/**
	 * D4: upload an own processed image (PixInsight or Siril export: JPEG, PNG, 8/16-bit TIFF, FITS; at most
	 * 300 MB) for a target, with a title, note and the date of the data; sent with progress to /api/uploads.
	 */
	let { target: initial = '', targetNames, onuploaded }: { target?: string; targetNames: string[]; onuploaded: () => void } = $props();

	const MAX_BYTES = 300 * 1024 * 1024;
	const ACCEPT = '.jpg,.jpeg,.png,.tif,.tiff,.fit,.fits,.fts,image/jpeg,image/png,image/tiff';

	let file = $state<File | null>(null);
	let target = $state(untrack(() => initial));
	let title = $state('');
	let note = $state('');
	let takenOn = $state('');
	let progress = $state<number | null>(null);
	let problem = $state<string | null>(null);
	let done = $state<string | null>(null);
	let input = $state<HTMLInputElement>();

	const dso = $derived(target.trim() ? findDso(target) : null);
	/** The sessions' targets first, then every catalog id with its common name. */
	const options = $derived([...targetNames, ...catalog.map((o) => o.id)].filter((v, i, all) => all.indexOf(v) === i));
	const tooBig = $derived(file !== null && file.size > MAX_BYTES);

	function submit(ev: SubmitEvent) {
		ev.preventDefault();
		if (!file || tooBig || !target.trim()) return;
		const form = new FormData();
		form.set('file', file);
		form.set('target', target.trim());
		form.set('title', title.trim());
		form.set('note', note.trim());
		if (takenOn) form.set('takenAt', String(Math.round(new Date(`${takenOn}T12:00:00`).getTime() / 1000)));
		// XMLHttpRequest for the upload progress (fetch has none).
		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/uploads');
		xhr.upload.onprogress = (e) => e.lengthComputable && (progress = e.loaded / e.total);
		xhr.onload = () => {
			progress = null;
			if (xhr.status >= 200 && xhr.status < 300) {
				done = `Uploaded ${file?.name ?? ''}.`;
				file = null;
				title = '';
				note = '';
				takenOn = '';
				if (input) input.value = '';
				onuploaded();
			} else {
				let message = `HTTP ${xhr.status}`;
				try {
					message = JSON.parse(xhr.responseText).message ?? message;
				} catch {
					// Not JSON: keep the status.
				}
				problem = `Upload failed: ${message}`;
			}
		};
		xhr.onerror = () => {
			progress = null;
			problem = 'Upload failed: the connection broke.';
		};
		problem = null;
		done = null;
		progress = 0;
		xhr.send(form);
	}
</script>

<form class="upload" onsubmit={submit}>
	<label class="wide">
		<span>File</span>
		<input bind:this={input} class="field" type="file" accept={ACCEPT} required onchange={(e) => (file = e.currentTarget.files?.[0] ?? null)} />
	</label>
	{#if file}<span class="small muted wide">{file.name} · {formatBytes(file.size)}{#if tooBig}<span class="warn"> · more than 300 MB</span>{/if}</span>{/if}
	<label>
		<span>Target</span>
		<input class="field" bind:value={target} list="upload-targets" required maxlength="128" placeholder="M 31, NGC 7000, C 9 …" />
		<datalist id="upload-targets">{#each options as o (o)}<option value={o}></option>{/each}</datalist>
		<small class="muted">{dso ? `${dso.id}${dso.names[0] ? ` · ${dso.names[0]}` : ''}` : target.trim() ? 'Not in the catalog: kept under this name' : ''}</small>
	</label>
	<label>
		<span>Date of the data</span>
		<input class="field" type="date" bind:value={takenOn} />
	</label>
	<label class="wide">
		<span>Title</span>
		<input class="field" bind:value={title} maxlength="200" placeholder="HOO, 14 h, PixInsight" />
	</label>
	<label class="wide">
		<span>Note</span>
		<textarea class="field" bind:value={note} maxlength="2000" rows="2"></textarea>
	</label>
	<div class="wide row">
		<button class="btn primary" disabled={!file || tooBig || !target.trim() || progress !== null}>Upload</button>
		{#if progress !== null}
			<div class="progress" role="progressbar" aria-label="Upload" aria-valuemin="0" aria-valuemax="1" aria-valuenow={progress}><span style:width="{progress * 100}%"></span></div>
			<span class="small num">{Math.round(progress * 100)} %{progress >= 1 ? ' · converting' : ''}</span>
		{/if}
		{#if problem}<span class="small warn">{problem}</span>{/if}
		{#if done}<span class="small">{done}</span>{/if}
	</div>
	<p class="small muted wide">JPEG, PNG, TIFF (8 or 16 bit) or FITS, up to 300 MB. Kept on the backed-up data volume; a FITS with a plate solve gets annotated. Private until published.</p>
</form>

<style>
	.upload {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px 14px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		font-size: 13px;
		color: var(--muted);
	}
	.wide {
		grid-column: 1 / -1;
	}
	.small {
		font-size: 12px;
	}
	small {
		font-size: 12px;
		min-height: 1em;
	}
	p {
		margin: 0;
	}
	.row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px 12px;
	}
	.progress {
		flex: 1;
		min-width: 120px;
	}
	textarea {
		resize: vertical;
	}
	@media (max-width: 640px) {
		.upload {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
