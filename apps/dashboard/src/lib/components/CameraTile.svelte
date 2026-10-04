<script lang="ts">
	let {
		id,
		label,
		refreshMs,
		paused = false,
		onopen
	}: { id: string; label: string; refreshMs: number; paused?: boolean; onopen: () => void } = $props();

	let width = $state(0);
	let src = $state<string | null>(null);
	let failed = $state(false);
	let updatedAt = $state(0);

	$effect(() => {
		if (paused || width === 0) return;
		// Request roughly the displayed pixel width (rounded to limit distinct sizes).
		const requestWidth = Math.min(1920, Math.max(320, Math.ceil((width * devicePixelRatio) / 320) * 320));
		let cancelled = false;
		let current: string | null = null;

		const load = async () => {
			try {
				const response = await fetch(`/cameras/${encodeURIComponent(id)}/frame?width=${requestWidth}`, { cache: 'no-store' });
				if (!response.ok) throw new Error(String(response.status));
				const url = URL.createObjectURL(await response.blob());
				if (cancelled) return URL.revokeObjectURL(url);
				if (current) URL.revokeObjectURL(current);
				current = url;
				src = url;
				failed = false;
				updatedAt = Date.now();
			} catch {
				if (!cancelled) failed = true;
			}
		};
		load();
		const timer = setInterval(load, refreshMs);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	});
</script>

<button class="tile" bind:clientWidth={width} onclick={onopen} aria-label="Open {label} live">
	{#if src}
		<img {src} alt="{label} snapshot" />
	{:else}
		<div class="placeholder"></div>
	{/if}
	<div class="shade"></div>
	<span class="label">{label}</span>
	<span class="badge" class:offline={failed}>
		{#if failed}Offline{:else}<i></i>Live{/if}
	</span>
	{#if updatedAt && !failed}<span class="hint">Tap for live video</span>{/if}
</button>

<style>
	.tile {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 18px;
		overflow: hidden;
		background: #0b0f19;
		cursor: pointer;
		transition: transform 0.2s ease, border-color 0.2s;
	}
	.tile:active {
		transform: scale(0.985);
	}
	img,
	.placeholder {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.placeholder {
		background: linear-gradient(110deg, #0b0f19 30%, #151b2b 50%, #0b0f19 70%);
		background-size: 200% 100%;
		animation: shimmer 1.6s infinite linear;
	}
	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}
	.shade {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.65), transparent 45%);
	}
	.label {
		position: absolute;
		left: 14px;
		bottom: 11px;
		font-size: 16px;
		font-weight: 600;
		text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
	}
	.badge {
		position: absolute;
		top: 10px;
		left: 10px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 9px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}
	.badge i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #ef4444;
		box-shadow: 0 0 8px #ef4444;
		animation: pulse 2s infinite;
	}
	.badge.offline {
		color: var(--bad);
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}
	.hint {
		position: absolute;
		right: 12px;
		bottom: 12px;
		font-size: 12px;
		color: rgba(255, 255, 255, 0.7);
		opacity: 0;
		transition: opacity 0.2s;
	}
	@media (hover: hover) {
		.tile:hover {
			border-color: rgba(255, 255, 255, 0.2);
		}
		.tile:hover .hint {
			opacity: 1;
		}
	}
</style>
