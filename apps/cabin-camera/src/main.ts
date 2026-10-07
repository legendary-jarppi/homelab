// Snapshot service for the cabin camera (Reolink Go Plus, 4G): lists and serves the pictures the
// camera uploads over FTPS (SFTPGo, same pod, shared volume) and deletes them after RETENTION_DAYS.
// Cluster-internal; the dashboard is the only client:
//   GET /api/snapshots?limit=N  { snapshots: [{ path, time, size }], total, retentionDays }; newest first,
//                               time = upload time (file mtime, unix ms), path relative to the upload root
//   GET /snapshots/<path>       one picture
//   GET /healthz
import { createReadStream } from 'node:fs';
import { readdir, rmdir, stat, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve(process.env.SNAPSHOT_DIR ?? '/data/cabin');
const port = Number(process.env.PORT ?? 8080);
const retentionDays = Number(process.env.RETENTION_DAYS ?? 30);
if (!Number.isFinite(retentionDays) || retentionDays <= 0) throw new Error('RETENTION_DAYS must be a positive number');

/** Only pictures are listed and served, whatever else lands on the volume. */
const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

interface Snapshot {
	path: string;
	time: number;
	size: number;
}

/** Every file under the upload root (the camera makes date folders), newest first. */
async function allFiles(): Promise<{ abs: string; rel: string; time: number; size: number }[]> {
	let names: string[];
	try {
		names = await readdir(root, { recursive: true });
	} catch (e) {
		if ((e instanceof Error && 'code' in e && e.code === 'ENOENT')) return [];
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
	const pictures = (await allFiles()).filter((f) => path.extname(f.rel).toLowerCase() in TYPES);
	return {
		snapshots: pictures.slice(0, limit).map(({ rel, time, size }) => ({ path: rel, time: Math.round(time), size })),
		total: pictures.length,
		retentionDays
	};
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
			const rel = decodeURIComponent(url.pathname.slice('/snapshots/'.length));
			const abs = path.resolve(root, rel);
			const type = TYPES[path.extname(abs).toLowerCase()];
			// Inside the upload root and a picture, nothing else.
			if (!abs.startsWith(root + path.sep) || !type) return send(404, 'not found\n');
			const s = await stat(abs).catch(() => null);
			if (!s?.isFile()) return send(404, 'not found\n');
			// Uploads are never rewritten under the same name.
			res.writeHead(200, { 'content-type': type, 'content-length': s.size, 'cache-control': 'private, max-age=86400, immutable' });
			createReadStream(abs).pipe(res);
			return;
		}
		send(404, 'not found\n');
	} catch (e) {
		console.error(e);
		send(500, 'error\n');
	}
});

server.listen(port, () => console.log(`snapshots: ${root}, kept ${retentionDays} days, listening on :${port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));

await prune().catch((e) => console.error('prune failed', e));
setInterval(() => prune().catch((e) => console.error('prune failed', e)), 3_600_000);
