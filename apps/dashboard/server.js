// Production entry: SvelteKit's adapter-node handler plus an authenticated WebSocket relay
// for live camera video (browser <-> /cameras/live?src=<id> <-> go2rtc /api/ws?src=<id>).
// SvelteKit endpoints cannot accept WebSocket upgrades, hence this wrapper.
import http from 'node:http';
import net from 'node:net';
import { handler } from './build/handler.js';
import { SESSION_COOKIE, readCookie, verifySession } from './session.js';

const port = Number(process.env.PORT ?? 3000);
const go2rtc = new URL(process.env.GO2RTC_URL ?? 'http://localhost:1984');
const cameraIds = (process.env.CAMERAS ?? '')
	.split(',')
	.map((entry) => entry.split(':')[0].trim())
	.filter(Boolean);
/** Headers go2rtc needs for the upgrade. Origin is dropped: go2rtc accepts upgrades without one. */
const FORWARDED_HEADERS = ['upgrade', 'connection', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions'];

const server = http.createServer(handler);

server.on('upgrade', (req, socket, head) => {
	const url = new URL(req.url ?? '/', 'http://localhost');
	const src = url.searchParams.get('src') ?? '';
	if (url.pathname !== '/cameras/live' || !cameraIds.includes(src)) {
		socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
		return;
	}
	if (!verifySession(readCookie(req.headers.cookie, SESSION_COOKIE))) {
		socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
		return;
	}

	const upstream = net.connect(Number(go2rtc.port || 80), go2rtc.hostname, () => {
		const lines = [`GET /api/ws?src=${encodeURIComponent(src)} HTTP/1.1`, `Host: ${go2rtc.host}`];
		for (const name of FORWARDED_HEADERS) {
			const value = req.headers[name];
			if (value) lines.push(`${name}: ${value}`);
		}
		upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
		if (head.length > 0) upstream.write(head);
		upstream.pipe(socket);
		socket.pipe(upstream);
	});
	const close = () => {
		upstream.destroy();
		socket.destroy();
	};
	upstream.on('error', close);
	upstream.on('close', close);
	socket.on('error', close);
	socket.on('close', close);
});

server.listen(port, () => console.log(`dashboard listening on :${port}`));

for (const signal of ['SIGTERM', 'SIGINT']) {
	process.on(signal, () => {
		server.close();
		server.closeAllConnections();
		process.exit(0);
	});
}
