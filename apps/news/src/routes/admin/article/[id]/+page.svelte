<script lang="ts">
	import { enhance } from '$app/forms';
	import { keepValues } from '$lib/components/account/forms';
	import { INTENSITY_LABELS, when } from '$lib/components/account/format';
	import { SENSITIVITY_FAMILIES, SENSITIVITY_TAGS, TOPICS } from '$lib/core/taxonomy';

	let { data, form } = $props();

	const a = $derived(data.article);
	const tagLabel = (key: string) => SENSITIVITY_TAGS.find((t) => t.key === key)?.label ?? key;
	const topicLabel = (key: string) => TOPICS.find((t) => t.key === key)?.label ?? key;
	const families = SENSITIVITY_FAMILIES.map((f) => ({ ...f, tags: SENSITIVITY_TAGS.filter((t) => t.family === f.key) }));
</script>

<svelte:head>
	<title>Article #{a.id} · Admin</title>
</svelte:head>

<p class="banner" role="note">
	<strong>Unfiltered review.</strong> This page shows the article as stored, including anything readers have asked not to see. The text and
	photos stay folded until you open them.
</p>

{#if form?.message}<p class="flash" role="status">{form.message}</p>{/if}

<p class="kicker">{a.outlet} · #{a.id}</p>
<h1>{a.calm_title ?? a.title}</h1>
{#if a.calm_title}<p class="muted">Original headline: {a.title}</p>{/if}
{#if a.summary}<p class="summary-text">{a.summary}</p>{/if}

<dl class="facts">
	<dt>Published</dt>
	<dd>{when(a.published_at)} · discovered {when(a.discovered_at)}</dd>
	<dt>Original</dt>
	<dd><a href={a.url} rel="noreferrer noopener" target="_blank">{a.url}</a></dd>
	<dt>Content</dt>
	<dd>
		{a.content_state}{a.content_reason ? ` (${a.content_reason})` : ''}{a.body_chars !== null ? ` · ${a.body_chars.toLocaleString('en-GB')} characters` : ''}
		{#if a.body_purged_at}<span class="warn">· purged {when(a.body_purged_at)}</span>{/if}
	</dd>
	<dt>Classification</dt>
	<dd>
		{a.classify_state}{a.classify_error ? ` (${a.classify_error})` : ''} · {when(a.classified_at)}
	</dd>
	<dt>Model / prompt</dt>
	<dd>{a.model ?? '–'} / {a.prompt_version ?? '–'}</dd>
	<dt>Kind · section · importance</dt>
	<dd>{a.kind ?? '–'} · {a.section ?? '–'} · {a.importance ?? '–'} · {a.language ?? '–'}</dd>
	<dt>Topics</dt>
	<dd>
		{#each data.topics as t, i (t.topic)}{i > 0 ? ', ' : ''}{topicLabel(t.topic)}{t.rank === 0 ? ' (primary)' : ''}{/each}
		{#if data.topics.length === 0}–{/if}
	</dd>
</dl>

{#if data.openReports.length > 0}
	<h2>Open reports</h2>
	<ul class="plain">
		{#each data.openReports as r (r.id)}
			<li>
				{when(r.created_at)} · {r.reporter ?? 'deleted user'}{r.note ? `: ${r.note}` : ''}
				{#if data.reportId === r.id}<strong>(corrections below are linked to this report)</strong>{/if}
				<form class="inline-form" method="POST" action="?/resolve" use:enhance>
					<input type="hidden" name="report" value={r.id} />
					<button class="button">Resolve</button>
				</form>
			</li>
		{/each}
	</ul>
{/if}

<h2>Sensitivity tags</h2>
<p class="muted">A correction overrides the AI for that tag, survives re-classification and applies to readers on their next page.</p>
<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th scope="col">Tag</th>
				<th scope="col">AI</th>
				<th scope="col" class="num">Conf.</th>
				<th scope="col">Basis</th>
				<th scope="col">Manual</th>
				<th scope="col">Correct</th>
			</tr>
		</thead>
		<tbody>
			{#each data.tags as t (t.tag)}
				<tr class:struck={t.effective === 0}>
					<th scope="row">{tagLabel(t.tag)}<br /><span class="tag muted">{t.tag}</span></th>
					<td>{t.ai ? INTENSITY_LABELS[t.ai.intensity] : '–'}</td>
					<td class="num">{t.ai?.confidence != null ? t.ai.confidence.toFixed(2) : '–'}</td>
					<td>{t.ai?.basis ?? '–'}</td>
					<td>{t.manual !== null ? INTENSITY_LABELS[t.manual] : '–'}</td>
					<td>
						<form class="inline-form" method="POST" action="?/correct" use:enhance={keepValues}>
							<input type="hidden" name="tag" value={t.tag} />
							{#if data.reportId}<input type="hidden" name="report" value={data.reportId} />{/if}
							<select name="intensity" aria-label="New intensity for {tagLabel(t.tag)}">
								{#each INTENSITY_LABELS as label, i (i)}
									<option value={i} selected={i === t.effective}>{label}</option>
								{/each}
							</select>
							<button class="button">Set</button>
						</form>
					</td>
				</tr>
			{:else}
				<tr><td colspan="6" class="muted">No sensitivity tags.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<form class="inline-form add-tag" method="POST" action="?/correct" use:enhance>
	{#if data.reportId}<input type="hidden" name="report" value={data.reportId} />{/if}
	<label for="add-tag">Add a tag</label>
	<select id="add-tag" name="tag" required>
		<option value="">Choose…</option>
		{#each families as f (f.key)}
			<optgroup label={f.label}>
				{#each f.tags as t (t.key)}<option value={t.key}>{t.label}</option>{/each}
			</optgroup>
		{/each}
	</select>
	<select name="intensity" aria-label="Intensity">
		{#each INTENSITY_LABELS.slice(1) as label, i (i)}<option value={i + 1}>{label}</option>{/each}
	</select>
	<button class="button">Add</button>
</form>

{#if data.corrections.length > 0}
	<h3>Correction history</h3>
	<ul class="plain">
		{#each data.corrections as c (c.id)}
			<li>
				{when(c.created_at)} · <span class="tag">{c.tag}</span>: AI {INTENSITY_LABELS[c.ai_intensity]} → {INTENSITY_LABELS[c.new_intensity]} · {c.admin ??
					'–'}{c.report_id ? ` · report #${c.report_id}` : ''}
			</li>
		{/each}
	</ul>
{/if}

<h2>Photos</h2>
{#if data.images.length === 0}
	<p class="muted">No photos.</p>
{:else}
	<details>
		<summary>Show {data.images.length} photo{data.images.length === 1 ? '' : 's'} and their tags</summary>
		<ul class="photos">
			{#each data.images as img (img.id)}
				<li>
					{#if img.path}
						<img src="/admin/img/{img.id}" alt={img.alt ?? ''} width={img.width} height={img.height} loading="lazy" />
					{:else}
						<p class="muted">No stored file ({img.state}).</p>
					{/if}
					<p>
						#{img.position} · {img.assessed ? 'assessed' : 'not assessed'}
						{#if img.tags.length > 0}
							· {#each img.tags as t, i (t.tag)}{i > 0 ? ', ' : ''}<span class="tag">{t.tag}</span> {INTENSITY_LABELS[t.intensity]}{/each}
						{/if}
					</p>
					{#if img.caption}<p class="muted">{img.caption}{img.credit ? ` (${img.credit})` : ''}</p>{/if}
				</li>
			{/each}
		</ul>
	</details>
{/if}

<h2>Text</h2>
{#if a.body}
	<details>
		<summary>Show the stored text</summary>
		<div class="body">
			{#if a.teaser}<p><strong>{a.teaser}</strong></p>{/if}
			{#each a.body as block, i (i)}
				{#if block.type === 'p'}<p>{block.text}</p>
				{:else if block.type === 'h'}<h3>{block.text}</h3>
				{:else if block.type === 'quote'}<blockquote>{block.text}{block.cite ? ` — ${block.cite}` : ''}</blockquote>
				{:else if block.type === 'list'}
					<ul>{#each block.items as item, j (j)}<li>{item}</li>{/each}</ul>
				{:else}<p class="muted">[photo #{block.image}]</p>
				{/if}
			{/each}
		</div>
	</details>
{:else}
	<p class="muted">{a.body_purged_at ? 'Purged.' : 'No stored text.'}</p>
{/if}

<h2>Actions</h2>
<div class="controls">
	<form class="inline-form" method="POST" action="?/reclassify" use:enhance>
		<button class="button" disabled={!!a.body_purged_at || a.content_state !== 'extracted'}>Re-classify</button>
	</form>
</div>
{#if !a.body_purged_at}
	<form class="purge" method="POST" action="?/purge" use:enhance>
		<h3>Purge stored text</h3>
		<p>Deletes the stored text and photo files permanently and takes the article off every reader page. The record, summary and classification stay for the admin views.</p>
		<label class="confirm"><input type="checkbox" name="confirm" value="yes" required /> I understand this cannot be undone.</label>
		<button class="button">Purge</button>
	</form>
{/if}

<style>
	.banner {
		margin: 0 0 var(--space-5);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--accent);
		border-left-width: 4px;
	}

	h1 {
		margin-top: var(--space-1);
	}

	.summary-text {
		max-width: var(--measure);
		font-family: var(--font-body);
		font-size: var(--step-0);
	}

	.plain {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.plain li {
		padding: var(--space-2) 0;
		border-bottom: var(--hairline);
	}

	.struck th,
	.struck td:not(:last-child) {
		text-decoration: line-through;
		color: var(--ink-3);
	}

	.add-tag {
		margin: var(--space-2) 0 var(--space-4);
	}

	summary {
		display: flex;
		align-items: center;
		min-height: var(--touch);
		font-weight: 600;
		cursor: pointer;
	}

	.photos {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: var(--space-4);
		margin: var(--space-3) 0 0;
		padding: 0;
		list-style: none;
	}

	.photos img {
		width: 100%;
		height: auto;
		border: var(--hairline);
	}

	.body {
		max-width: var(--measure);
		font-family: var(--font-body);
		font-size: var(--step-0);
	}

	.purge {
		max-width: 40rem;
		margin-top: var(--space-4);
		padding-top: var(--space-2);
		border-top: var(--hairline);
	}
</style>
