<script lang="ts">
	import { clipLength, tagLabel, type MotionItem } from '$lib/motion';

	/** `caption`: the time (and camera) shown on the picture. */
	let { item, caption, onopen }: { item: MotionItem; caption: string; onopen: () => void } = $props();
</script>

<button class="tile" onclick={onopen} aria-label="{item.place}, {caption}">
	{#if item.image}
		<img src={item.image} alt="" loading="lazy" />
	{:else if item.video}
		<!-- A clip without its picture: its first frame stands in. -->
		<video src="{item.video}#t=0.1" muted playsinline preload="metadata"></video>
	{/if}
	{#if item.tags.length > 0}<span class="tags">{item.tags.map(tagLabel).join(' · ')}</span>{/if}
	<span class="caption">{caption}</span>
	{#if item.seconds !== null}
		<span class="length num">{clipLength(item.seconds)}</span>
	{:else if item.video}
		<span class="play" aria-label="Has a video clip"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
	{/if}
</button>

<style>
	.tile {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		padding: 0;
		border: 0;
		border-radius: 12px;
		overflow: hidden;
		background: #000;
		cursor: pointer;
	}
	img,
	video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
	}
	.caption,
	.length,
	.tags,
	.play {
		position: absolute;
		bottom: 8px;
		padding: 3px 9px;
		font-size: 12px;
		font-weight: 600;
		color: #fff;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		white-space: nowrap;
	}
	.caption {
		left: 8px;
		max-width: calc(100% - 70px);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.length {
		right: 8px;
	}
	.tags {
		top: 8px;
		bottom: auto;
		left: 8px;
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--warn);
	}
	.play {
		right: 8px;
		width: 26px;
		height: 26px;
		padding: 0;
		display: grid;
		place-items: center;
		border-radius: 50%;
	}
	.play svg {
		width: 13px;
		height: 13px;
		fill: #fff;
		margin-left: 2px;
	}
</style>
