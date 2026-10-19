<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { PIECE_MS } from '$lib/recording';

	/**
	 * Plays a camera's recording from `seek.at` onwards, at full resolution, in PIECE_MS pieces fetched
	 * whole from /cameras/<id>/recording (Protect's export has its index at the end, so a piece plays
	 * only once it is all here). Two <video> elements take turns: while one plays, the next piece
	 * waits in the other, already at its first frame, so the switch is only a frame or two.
	 * Mount one per camera (`{#key}`).
	 */
	let {
		camera,
		seek,
		paused,
		rate,
		ontime,
		onwaiting,
		onerror,
		oncaughtup
	}: {
		camera: string;
		/** Where to play from; a new object (same `at` too) seeks again. */
		seek: { at: number };
		paused: boolean;
		rate: number;
		/** The position shown, unix ms. */
		ontime: (ms: number) => void;
		onwaiting: (waiting: boolean) => void;
		onerror: (message: string) => void;
		/** Reached recordings that are not finished yet: time for live video. */
		oncaughtup: () => void;
	} = $props();

	interface Piece {
		/** Requested start (a multiple of PIECE_MS) and end; the video itself begins at `videoStart`. */
		start: number;
		end: number;
		videoStart: number;
		url: string;
	}

	/** Pieces must end this long before now to be asked for (Protect writes recordings as they come). */
	const LIVE_MARGIN_MS = 5_000;
	/** Pieces kept in memory around the one playing (about 12 MB each). */
	const KEEP_BEHIND = 1;
	const KEEP_AHEAD = 2;

	const videos: HTMLVideoElement[] = [];
	let front = $state(0);
	let current: Piece | null = null;
	/** The piece waiting in the back video, ready to play. */
	let next: Piece | null = null;
	/** Bumped by every seek, so a slower earlier one cannot take over. */
	let generation = 0;
	const pieces = new Map<number, Promise<Piece>>();

	const available = (start: number) => start + PIECE_MS <= Date.now() - LIVE_MARGIN_MS;

	function load(start: number): Promise<Piece> {
		let piece = pieces.get(start);
		if (!piece) {
			piece = (async () => {
				const res = await fetch(`/cameras/${encodeURIComponent(camera)}/recording?start=${start}`);
				if (!res.ok) throw new Error(res.status === 502 ? 'No recording at this time' : `Recording unavailable (${res.status})`);
				const videoStart = Number(res.headers.get('X-Recording-Start'));
				const end = Number(res.headers.get('X-Recording-End'));
				return { start, end, videoStart, url: URL.createObjectURL(await res.blob()) };
			})();
			piece.catch(() => pieces.delete(start));
			pieces.set(start, piece);
		}
		return piece;
	}

	/** Frees pieces far from the one playing. */
	function trim(around: number) {
		for (const [start, piece] of pieces) {
			if (start >= around - KEEP_BEHIND * PIECE_MS && start <= around + KEEP_AHEAD * PIECE_MS) continue;
			pieces.delete(start);
			piece.then((p) => URL.revokeObjectURL(p.url), () => {});
		}
	}

	function once(video: HTMLVideoElement, event: string): Promise<void> {
		const { promise, resolve } = Promise.withResolvers<void>();
		video.addEventListener(event, () => resolve(), { once: true });
		return promise;
	}

	/** Loads `piece` into `video` positioned at `ms`, paused. */
	async function prepare(video: HTMLVideoElement, piece: Piece, ms: number) {
		if (video.src !== piece.url) {
			const loaded = once(video, 'loadedmetadata');
			video.src = piece.url;
			await loaded;
		}
		const target = Math.max(0, (ms - piece.videoStart) / 1000);
		if (Math.abs(video.currentTime - target) < 0.01) return;
		const seeked = once(video, 'seeked');
		video.currentTime = target;
		await seeked;
	}

	function show(piece: Piece) {
		videos[front].pause();
		front = 1 - front;
		current = piece;
		next = null;
		const video = videos[front];
		video.playbackRate = rate;
		if (!paused) video.play().catch(() => {});
		trim(piece.start);
		void preloadNext(generation);
	}

	async function preloadNext(gen: number) {
		if (!current) return;
		const start = current.start + PIECE_MS;
		if (!available(start)) return;
		try {
			const piece = await load(start);
			if (gen !== generation || current?.start !== start - PIECE_MS) return;
			await prepare(videos[1 - front], piece, start);
			if (gen === generation && current?.start === start - PIECE_MS) next = piece;
		} catch {
			// Retried when the playing piece ends.
		}
	}

	async function seekTo(ms: number) {
		const gen = ++generation;
		if (current && ms >= current.videoStart && ms < current.end) {
			videos[front].currentTime = (ms - current.videoStart) / 1000;
			ontime(ms);
			void preloadNext(gen);
			return;
		}
		onwaiting(true);
		next = null;
		try {
			const piece = await load(Math.floor(ms / PIECE_MS) * PIECE_MS);
			if (gen !== generation) return;
			await prepare(videos[1 - front], piece, ms);
			if (gen !== generation) return;
			show(piece);
			ontime(ms);
			onwaiting(false);
		} catch (e) {
			if (gen === generation) onerror(e instanceof Error ? e.message : 'Recording unavailable');
		}
	}

	/** The front piece ended: on to the next one, or live video when recordings run out. */
	async function ended(event: Event) {
		if (event.target !== videos[front] || !current) return;
		if (next) return show(next);
		const start = current.start + PIECE_MS;
		if (!available(start)) return oncaughtup();
		await seekTo(start);
	}

	function timeupdate(event: Event) {
		if (event.target !== videos[front] || !current) return;
		ontime(current.videoStart + videos[front].currentTime * 1000);
	}

	$effect(() => {
		const at = seek.at;
		untrack(() => void seekTo(at));
	});

	$effect(() => {
		for (const v of videos) v.playbackRate = rate;
	});

	$effect(() => {
		const video = videos[front];
		if (paused) video.pause();
		else if (current) video.play().catch(() => {});
	});

	onDestroy(() => {
		generation++;
		for (const piece of pieces.values()) piece.then((p) => URL.revokeObjectURL(p.url), () => {});
	});
</script>

{#each [0, 1] as i (i)}
	<video bind:this={videos[i]} class:front={front === i} muted playsinline preload="auto" onended={ended} ontimeupdate={timeupdate}></video>
{/each}

<style>
	video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: #000;
		opacity: 0;
	}
	video.front {
		opacity: 1;
	}
</style>
