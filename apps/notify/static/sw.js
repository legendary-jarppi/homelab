// Shows pushed messages and opens their link when tapped. Payload from src/lib/server/notify.ts send():
// { id, title, body, url, tag }. iOS revokes the subscription of a web app that receives a push
// without showing a notification, so every push shows one.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
	let m = {};
	try {
		m = event.data ? event.data.json() : {};
	} catch {
		m = { body: event.data ? event.data.text() : '' };
	}
	event.waitUntil(
		self.registration.showNotification(m.title || 'Notify', {
			body: m.body || '',
			tag: m.tag,
			icon: '/icons/icon-192.png',
			data: { url: m.url || '/' }
		})
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
	event.waitUntil(
		(async () => {
			const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const same = open.find((c) => c.url === url);
			if (same) return same.focus();
			return self.clients.openWindow(url);
		})()
	);
});
