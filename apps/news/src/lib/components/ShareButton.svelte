<script lang="ts">
	import { onMount, tick } from 'svelte';

	/**
	 * Shares an article's address: the system share sheet where there is one (Safari and Chrome over
	 * https), else copies the address (also over plain http, where neither the share sheet nor the
	 * clipboard API exists), else shows it to copy by hand. The Home Screen app has no address bar, so
	 * this is the only way to pass an article on there. Needs JavaScript: not rendered without it.
	 */
	let { url, title }: { url: string; title: string } = $props();

	let mounted = $state(false);
	let status = $state<'idle' | 'copied' | 'manual'>('idle');
	let field = $state<HTMLInputElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		mounted = true;
		return () => clearTimeout(timer);
	});

	/** document.execCommand('copy') through a hidden field: works in insecure contexts (plain http), within a tap. */
	function legacyCopy(text: string): boolean {
		const area = document.createElement('textarea');
		area.value = text;
		area.readOnly = true;
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.append(area);
		area.select();
		area.setSelectionRange(0, text.length);
		try {
			return document.execCommand('copy');
		} catch {
			return false;
		} finally {
			area.remove();
		}
	}

	async function share() {
		if (navigator.share) {
			try {
				await navigator.share({ title, url });
				return;
			} catch (e) {
				// Closing the share sheet is not a failure.
				if (e instanceof DOMException && e.name === 'AbortError') return;
			}
		}
		// Without the clipboard API (plain http) nothing is awaited first, so the tap still allows execCommand.
		let copied = false;
		if (navigator.clipboard) copied = await navigator.clipboard.writeText(url).then(() => true, () => false);
		if (!copied) copied = legacyCopy(url);
		status = copied ? 'copied' : 'manual';
		clearTimeout(timer);
		if (copied) timer = setTimeout(() => (status = 'idle'), 2500);
		else await tick().then(() => field?.select());
	}
</script>

{#if mounted}
	<button class="button" type="button" onclick={share} aria-live="polite">{status === 'copied' ? 'Link copied' : 'Share'}</button>
	{#if status === 'manual'}
		<label class="manual">
			<span class="visually-hidden">Article link</span>
			<input bind:this={field} readonly value={url} onfocus={(e) => e.currentTarget.select()} />
		</label>
	{/if}
{/if}

<style>
	.manual {
		flex-basis: 100%;
	}

	.manual input {
		width: 100%;
		font: inherit;
		font-family: var(--font-ui);
		font-size: var(--step--1);
		padding: var(--space-2);
		border: var(--hairline);
		background: var(--paper);
		color: var(--ink);
	}
</style>
