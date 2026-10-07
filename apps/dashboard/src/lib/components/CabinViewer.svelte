<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { snapshotUrl, type CabinEvent } from '$lib/cabin';
	import { eventTime } from '$lib/dates';
	import { night } from '$lib/night.svelte';

	/** Motion events newest first, as the strip below; `index` 0 is the latest. */
	let {
		events,
		index = $bindable(),
		onclose
	}: { events: CabinEvent[]; index: number; onclose: () => void } = $props();

	const current = $derived(events[Math.min(index, events.length - 1)]);
	/** Playing the current event's clip instead of showing its picture; reset when moving on. */
	let playing = $state(false);
	let strip: HTMLDivElement;

	const go = (i: number) => {
		index = Math.min(Math.max(i, 0), events.length - 1);
		playing = false;
	};

	$effect(() => {
		strip?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
	});

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
		else if (event.key === 'ArrowRight') go(index + 1);
		else if (event.key === 'ArrowLeft') go(index - 1);
	}
</script>

<svelte:window {onkeydown} />

<div class="backdrop" transition:fade={{ duration: 180 }} onclick={(e) => e.target === e.currentTarget && onclose()} role="presentation">
	<div class="viewer" transition:scale={{ start: 0.96, duration: 220 }} role="dialog" aria-modal="true" aria-label="Cabin camera pictures and clips" tabindex="-1">
		<div class="picture">
			{#if current.video && (playing || !current.image)}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={snapshotUrl(current.video.path)} controls autoplay={playing} playsinline preload="metadata"></video>
			{:else if current.image}
				<img src={snapshotUrl(current.image.path)} alt="Motion at the cabin" />
				{#if current.video}
					<button class="play" onclick={() => (playing = true)} aria-label="Play the clip">
						<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
					</button>
				{/if}
			{/if}
		</div>
		<div class="bar">
			<span class="badge">Motion</span>
			<span class="title">Cabin · {eventTime(new Date(current.time).toISOString(), night.now)}</span>
			<span class="count muted num">{index + 1} / {events.length}</span>
			<div class="actions">
				<button onclick={() => go(index - 1)} disabled={index === 0} aria-label="Newer">
					<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></svg>
				</button>
				<button onclick={() => go(index + 1)} disabled={index === events.length - 1} aria-label="Older">
					<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
				</button>
				<button onclick={onclose} aria-label="Close">
					<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
				</button>
			</div>
		</div>
		<div class="strip" bind:this={strip}>
			{#each events as e, i (e.image?.path ?? e.video?.path)}
				<button class:active={i === index} onclick={() => go(i)} aria-label="Event {i + 1}">
					{#if e.image}
						<img src={snapshotUrl(e.image.path)} alt="" loading="lazy" />
					{:else if e.video}
						<video src="{snapshotUrl(e.video.path)}#t=0.1" muted playsinline preload="metadata"></video>
					{/if}
					{#if e.video}<span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>{/if}
				</button>
			{/each}
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
		padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom))
			max(16px, env(safe-area-inset-left));
		background: rgba(3, 5, 10, 0.78);
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
	}
	.viewer {
		width: min(100%, calc((100dvh - 210px) * 16 / 9), 1600px);
		display: grid;
		gap: 12px;
		outline: none;
	}
	.picture {
		position: relative;
		aspect-ratio: 16 / 9;
		border-radius: 20px;
		overflow: hidden;
		background: #000;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
	}
	.picture img,
	.picture video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.play {
		position: absolute;
		inset: 0;
		margin: auto;
		width: 76px;
		height: 76px;
		display: grid;
		place-items: center;
		border: 1px solid rgba(255, 255, 255, 0.25);
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		cursor: pointer;
	}
	.play svg {
		width: 34px;
		height: 34px;
		fill: #fff;
		margin-left: 4px;
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
	.count {
		font-size: 14px;
	}
	.badge {
		padding: 4px 10px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border-radius: 999px;
		background: rgba(251, 191, 36, 0.15);
		color: var(--warn);
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
	.actions button:disabled {
		opacity: 0.35;
		cursor: default;
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
	.strip {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding-bottom: 4px;
		scrollbar-width: none;
	}
	.strip::-webkit-scrollbar {
		display: none;
	}
	.strip button {
		position: relative;
		flex: none;
		width: 112px;
		aspect-ratio: 16 / 9;
		padding: 0;
		border: 2px solid transparent;
		border-radius: 10px;
		overflow: hidden;
		background: #000;
		opacity: 0.6;
		cursor: pointer;
	}
	.strip button.active {
		border-color: var(--warn);
		opacity: 1;
	}
	.strip img,
	.strip video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
	}
	.mark {
		position: absolute;
		right: 5px;
		bottom: 5px;
		width: 20px;
		height: 20px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.6);
	}
	.mark svg {
		width: 10px;
		height: 10px;
		fill: #fff;
		margin-left: 1px;
	}
	@media (max-width: 640px) {
		.title {
			font-size: 16px;
		}
		.count {
			display: none;
		}
	}
</style>
