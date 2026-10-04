<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, scale } from 'svelte/transition';

	type LiveCamElement = HTMLElement & { src: string; video?: HTMLVideoElement; ondisconnect?: () => void };

	let {
		cameras,
		index = $bindable(),
		onclose
	}: { cameras: { id: string; label: string }[]; index: number; onclose: () => void } = $props();

	let host: HTMLDivElement;
	let ready = $state(false);
	let playing = $state(false);

	onMount(async () => {
		await import('$lib/live-cam');
		ready = true;
	});

	// One live stream at a time: switching camera tears down the previous player.
	$effect(() => {
		if (!ready) return;
		const camera = cameras[index];
		playing = false;
		const el = document.createElement('live-cam') as LiveCamElement;
		host.appendChild(el);
		el.video?.addEventListener('playing', () => (playing = true));
		el.src = `/cameras/live?src=${encodeURIComponent(camera.id)}`;
		return () => {
			el.ondisconnect?.();
			el.remove();
		};
	});

	const step = (delta: number) => (index = (index + delta + cameras.length) % cameras.length);

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
		else if (event.key === 'ArrowRight') step(1);
		else if (event.key === 'ArrowLeft') step(-1);
	}
</script>

<svelte:window {onkeydown} />

<div
	class="backdrop"
	transition:fade={{ duration: 180 }}
	onclick={(e) => e.target === e.currentTarget && onclose()}
	role="presentation"
>
	<div
		class="viewer"
		transition:scale={{ start: 0.96, duration: 220 }}
		role="dialog"
		aria-modal="true"
		aria-label="{cameras[index].label} live video"
		tabindex="-1"
	>
		<div class="video" bind:this={host}>
			{#if !playing}<div class="status">Connecting…</div>{/if}
		</div>
		<div class="bar">
			<span class="badge"><i></i>Live</span>
			<span class="title">{cameras[index].label}</span>
			<div class="actions">
				{#if cameras.length > 1}
					<button onclick={() => step(-1)} aria-label="Previous camera">
						<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></svg>
					</button>
					<button onclick={() => step(1)} aria-label="Next camera">
						<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
					</button>
				{/if}
				<button onclick={onclose} aria-label="Close">
					<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
			max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
		background: rgba(3, 5, 10, 0.78);
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
	}
	.viewer {
		width: min(100%, calc((100dvh - 120px) * 16 / 9), 1600px);
		display: grid;
		gap: 12px;
		outline: none;
	}
	.video {
		position: relative;
		aspect-ratio: 16 / 9;
		border-radius: 20px;
		overflow: hidden;
		background: #000;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
	}
	.video :global(live-cam) {
		display: block;
		width: 100%;
		height: 100%;
	}
	.status {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--muted);
		font-size: 15px;
		pointer-events: none;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.title {
		flex: 1;
		font-size: 20px;
		font-weight: 600;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border-radius: 999px;
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
	}
	.badge i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #ef4444;
		box-shadow: 0 0 8px #ef4444;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.actions button {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--surface-strong);
		cursor: pointer;
	}
	.actions svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
