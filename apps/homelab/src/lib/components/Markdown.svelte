<script lang="ts">
	/**
	 * Markdown rendered on the server ($lib/server/docs). ```mermaid``` blocks arrive as
	 * <pre class="mermaid"> and are drawn here; mermaid is loaded only on pages that have one.
	 */
	let { html }: { html: string } = $props();

	let root: HTMLDivElement;

	$effect(() => {
		void html;
		const nodes = [...root.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed])')];
		if (nodes.length === 0) return;
		let cancelled = false;
		(async () => {
			const { default: mermaid } = await import('mermaid');
			if (cancelled) return;
			mermaid.initialize({
				startOnLoad: false,
				theme: 'dark',
				securityLevel: 'strict',
				fontFamily: getComputedStyle(document.body).fontFamily,
				themeVariables: { background: '#070a12', primaryColor: '#16213a', primaryTextColor: '#eef1f7', primaryBorderColor: '#38bdf8', lineColor: '#8a93a8', edgeLabelBackground: '#111726' }
			});
			await mermaid.run({ nodes });
		})().catch((e) => console.error('mermaid:', e));
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="md" bind:this={root}>{@html html}</div>

<style>
	.md {
		font-size: 15px;
		line-height: 1.6;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.md :global(h1) {
		margin: 0 0 14px;
		font-size: 26px;
		line-height: 1.25;
	}
	.md :global(h2) {
		margin: 30px 0 10px;
		padding-top: 4px;
		font-size: 20px;
	}
	.md :global(h3) {
		margin: 22px 0 8px;
		font-size: 16px;
	}
	.md :global(h4) {
		margin: 18px 0 6px;
		font-size: 14px;
	}
	.md :global(:is(h1, h2, h3, h4)) {
		position: relative;
		scroll-margin-top: 70px;
	}
	.md :global(.anchor) {
		position: absolute;
		left: -0.9em;
		padding-right: 0.2em;
		color: var(--faint);
		text-decoration: none;
		opacity: 0;
	}
	.md :global(:is(h1, h2, h3, h4):hover .anchor) {
		opacity: 1;
	}
	.md > :global(:first-child) {
		margin-top: 0;
	}
	.md :global(p),
	.md :global(ul),
	.md :global(ol) {
		margin: 0 0 12px;
	}
	.md :global(:is(ul, ol)) {
		padding-left: 22px;
	}
	.md :global(li + li) {
		margin-top: 3px;
	}
	.md :global(a) {
		color: var(--down);
		text-decoration: none;
	}
	.md :global(a:hover) {
		text-decoration: underline;
	}
	.md :global(strong) {
		color: #fff;
	}
	.md :global(code) {
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		font-size: 0.86em;
		padding: 1px 5px;
		border-radius: 5px;
		background: var(--surface-strong);
	}
	.md :global(pre.code) {
		margin: 0 0 14px;
		padding: 12px 14px;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.35);
		line-height: 1.5;
	}
	.md :global(pre.code code) {
		padding: 0;
		background: none;
		font-size: 13px;
		overflow-wrap: normal;
		white-space: pre;
	}
	.md :global(pre.mermaid) {
		margin: 0 0 14px;
		padding: 14px;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		text-align: center;
		white-space: pre;
		color: var(--muted);
		font-size: 12px;
	}
	.md :global(pre.mermaid[data-processed]) {
		white-space: normal;
	}
	.md :global(pre.mermaid svg) {
		max-width: 100%;
		height: auto;
	}
	.md :global(.table) {
		margin: 0 0 14px;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.md :global(table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
		line-height: 1.45;
	}
	.md :global(th) {
		text-align: left;
		font-weight: 600;
		color: var(--muted);
		background: var(--surface-strong);
	}
	.md :global(:is(th, td)) {
		padding: 7px 10px;
		vertical-align: top;
		border-bottom: 1px solid var(--border);
		overflow-wrap: normal;
		min-width: 90px;
	}
	.md :global(td:last-child) {
		min-width: 220px;
	}
	.md :global(tr:last-child td) {
		border-bottom: 0;
	}
	.md :global(tbody tr:nth-child(even)) {
		background: rgba(255, 255, 255, 0.02);
	}
	.md :global(blockquote) {
		margin: 0 0 12px;
		padding: 2px 14px;
		border-left: 3px solid var(--border);
		color: var(--muted);
	}
	.md :global(hr) {
		border: 0;
		border-top: 1px solid var(--border);
		margin: 20px 0;
	}
	.md :global(img) {
		max-width: 100%;
	}
	.md :global(.file) {
		color: var(--text);
	}
</style>
