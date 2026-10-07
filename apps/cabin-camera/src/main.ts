// Snapshot service for the cabin camera (Reolink Go Plus, 4G): lists and serves the pictures and video
// clips the camera uploads over FTPS (SFTPGo, same pod, shared volume) and deletes them after
// RETENTION_DAYS. SFTPGo uploads atomically (to a folder outside SNAPSHOT_DIR, moved in when complete),
// so nothing half-uploaded is ever listed. Cluster-internal; the dashboard is the only client:
//   GET /api/snapshots?limit=N  { snapshots: [{ path, kind, time, size }], total, retentionDays }; newest
//                               first, kind image|video, time = upload time (file mtime, unix ms), path
//                               relative to SNAPSHOT_DIR
//   GET /snapshots/<path>       one file; Range requests supported (Safari plays video only with them)
//   GET /healthz
import { createReadStream } from 'node:fs';
import { readdir, rmdir, stat, unlink } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';

const root = path.resolve(process.env.SNAPSHOT_DIR ?? '/data/cabin');
const port = Number(process.env.PORT ?? 8080);
const retentionDays = Number(process.env.RETENTION_DAYS ?? 30);
if (!Number.isFinite(retentionDays) || retentionDays <= 0) throw new Error('RETENTION_DAYS must be a positive number');

type Kind = 'image' | 'video';
/** Only these are listed and served, whatever else lands on the volume. */
const TYPES: Record<string, { mime: string; kind: Kind }> = {
	'.jpg': { mime: 'image/jpeg', kind: 'image' },
	'.jpeg': { mime: 'image/jpeg', kind: 'image' },
	'.png': { mime: 'image/png', kind: 'image' },
	'.mp4': { mime: 'video/mp4', kind: 'video' }
};
const typeOf = (file: string) => TYPES[path.extname(file).toLowerCase()];

interface Snapshot {
	path: string;
	kind: Kind;
	time: number;
	size: number;
}

/** Every file under the upload root (the camera makes date folders), newest first. */
async function allFiles(): Promise<{ abs: string; rel: string; time: number; size: number }[]> {
	let names: string[];
	try {
		names = await readdir(root, { recursive: true });
	} catch (e) {
		if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return [];
		throw e;
	}
	const files = await Promise.all(
		names.map(async (rel) => {
			const abs = path.join(root, rel);
			const s = await stat(abs).catch(() => null);
			return s?.isFile() ? { abs, rel: rel.split(path.sep).join('/'), time: s.mtimeMs, size: s.size } : null;
		})
	);
	return files.filter((f) => f !== null).sort((a, b) => b.time - a.time);
}

async function list(limit: number): Promise<{ snapshots: Snapshot[]; total: number; retentionDays: number }> {
	const media = (await allFiles()).flatMap((f) => {
		const type = typeOf(f.rel);
		return type ? [{ path: f.rel, kind: type.kind, time: Math.round(f.time), size: f.size }] : [];
	});
	return { snapshots: media.slice(0, limit), total: media.length, retentionDays };
}

/** Delete files older than the retention, then the folders they leave empty. */
async function prune(): Promise<void> {
	const cutoff = Date.now() - retentionDays * 86_400_000;
	const old = (await allFiles()).filter((f) => f.time < cutoff);
	for (const f of old) await unlink(f.abs).catch(() => {});
	const dirs = new Set(old.map((f) => path.dirname(f.abs)));
	// Deepest first; rmdir fails (and is ignored) on folders that still have files.
	for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
		for (let d = dir; d.startsWith(root + path.sep); d = path.dirname(d)) {
			if (!(await rmdir(d).then(() => true, () => false))) break;
		}
	}
	if (old.length > 0) console.log(`pruned ${old.length} files older than ${retentionDays} days`);
}

/** `bytes=a-b`, `bytes=a-`, `bytes=-n` → inclusive [start, end]; null when unsatisfiable or malformed. */
function parseRange(header: string, size: number): [number, number] | null {
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m || (m[1] === '' && m[2] === '')) return null;
	const [start, end] =
		m[1] === '' ? [Math.max(size - Number(m[2]), 0), size - 1] : [Number(m[1]), m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)];
	return start <= end && start < size ? [start, end] : null;
}

async function serveFile(res: ServerResponse, abs: string, mime: string, rangeHeader: string | undefined): Promise<void> {
	const s = await stat(abs).catch(() => null);
	if (!s?.isFile()) {
		res.writeHead(404, { 'content-type': 'text/plain' }).end('not found\n');
		return;
	}
	// Uploads are never rewritten under the same name.
	const headers = { 'content-type': mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400, immutable' };
	if (rangeHeader) {
		const range = parseRange(rangeHeader, s.size);
		if (!range) {
			res.writeHead(416, { 'content-range': `bytes */${s.size}` }).end();
			return;
		}
		const [start, end] = range;
		res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${s.size}`, 'content-length': end - start + 1 });
		createReadStream(abs, { start, end }).pipe(res);
		return;
	}
	res.writeHead(200, { ...headers, 'content-length': s.size });
	createReadStream(abs).pipe(res);
}

const server = createServer(async (req, res) => {
	const send = (status: number, body: string, type = 'text/plain') => {
		res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	try {
		const url = new URL(req.url ?? '/', 'http://localhost');
		if (req.method !== 'GET') return send(405, 'method not allowed\n');
		if (url.pathname === '/healthz') return send(200, 'ok\n');
		if (url.pathname === '/api/snapshots') {
			const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 24) || 24, 1), 500);
			return send(200, JSON.stringify(await list(limit)), 'application/json');
		}
		if (url.pathname.startsWith('/snapshots/')) {
			const abs = path.resolve(root, decodeURIComponent(url.pathname.slice('/snapshots/'.length)));
			const type = typeOf(abs);
			// Inside the upload root and a known media type, nothing else.
			if (!abs.startsWith(root + path.sep) || !type) return send(404, 'not found\n');
			return await serveFile(res, abs, type.mime, req.headers.range);
		}
		send(404, 'not found\n');
	} catch (e) {
		console.error(e);
		if (!res.headersSent) send(500, 'error\n');
	}
});

server.listen(port, () => console.log(`snapshots: ${root}, kept ${retentionDays} days, listening on :${port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));

await prune().catch((e) => console.error('prune failed', e));
setInterval(() => prune().catch((e) => console.error('prune failed', e)), 3_600_000);
