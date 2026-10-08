import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { clipFile, isEventId } from '$lib/server/protect';
import type { RequestHandler } from './$types';

/**
 * A Protect motion event's clip (MP4), exported once and then served from the pod's disk with Range
 * support: Safari plays video only through Range requests, which Protect's export ignores.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	if (!config.protectUser || !isEventId(params.id)) error(404, 'Unknown event');
	let file: string;
	try {
		file = await clipFile(params.id);
	} catch (e) {
		console.error(`protect clip ${params.id}:`, e instanceof Error ? e.message : e);
		error(502, 'Clip unavailable');
	}
	const { size } = await stat(file);
	const headers = new Headers({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400' });

	const range = request.headers.get('range');
	if (!range) {
		headers.set('Content-Length', String(size));
		return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers });
	}
	// One range: "bytes=start-end", "bytes=start-" or "bytes=-suffix".
	const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
	let start = m?.[1] ? Number(m[1]) : NaN;
	let end = m?.[2] ? Number(m[2]) : size - 1;
	if (m && !m[1] && m[2]) {
		start = Math.max(0, size - Number(m[2]));
		end = size - 1;
	}
	end = Math.min(end, size - 1);
	if (!Number.isInteger(start) || start > end) {
		return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
	}
	headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
	headers.set('Content-Length', String(end - start + 1));
	return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers });
};
