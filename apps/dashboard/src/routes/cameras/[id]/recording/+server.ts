import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { PIECE_MS } from '$lib/recording';
import { linkedCamera } from '$lib/server/protect';
import type { RequestHandler } from './$types';

/** How far back a piece may be asked for; Protect itself keeps what its disk holds. */
const MAX_AGE_MS = 365 * 86_400_000;

/**
 * The recording piece starting at `?start=` (unix ms, a multiple of PIECE_MS) as MP4, full
 * resolution. X-Recording-Start says when its video really begins (the keyframe before `start`),
 * X-Recording-End when it ends; the viewer fetches it whole and plays it from memory.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const linked = linkedCamera(params.id);
	if (!linked) error(404, 'No recordings for this camera');
	const start = Number(url.searchParams.get('start'));
	const now = Date.now();
	if (!Number.isSafeInteger(start) || start % PIECE_MS !== 0 || start + PIECE_MS > now || start < now - MAX_AGE_MS) {
		error(400, 'Bad start');
	}
	let piece: { file: string; start: number; end: number };
	try {
		piece = await linked.protect.recording(linked.name, start);
	} catch (e) {
		console.error(`protect ${linked.protect.site} recording ${linked.name} ${start}:`, e instanceof Error ? e.message : e);
		error(502, 'Recording unavailable');
	}
	const { size } = await stat(piece.file);
	return new Response(Readable.toWeb(createReadStream(piece.file)) as ReadableStream, {
		headers: {
			'Content-Type': 'video/mp4',
			'Content-Length': String(size),
			'X-Recording-Start': String(piece.start),
			'X-Recording-End': String(piece.end),
			'Cache-Control': 'private, max-age=86400'
		}
	});
};
