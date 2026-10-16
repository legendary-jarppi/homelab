// People, their devices (web push subscriptions), topic choices, and delivery of messages to them.
import webpush, { WebPushError } from 'web-push';
import { config } from './config';
import type { Sql } from './db';
import { topic as topicById, topics } from './topics';

export interface User {
	id: number;
	email: string;
	name: string;
}

export interface Device {
	id: number;
	endpoint: string;
	label: string;
	createdAt: Date;
	lastSentAt: Date | null;
	lastError: string | null;
}

export interface Subscription {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

export interface HistoryEntry {
	id: number;
	sender: string;
	topic: string | null;
	title: string;
	body: string;
	url: string | null;
	createdAt: Date;
}

export interface SendResult {
	id: number;
	recipients: number;
	devices: number;
	delivered: number;
	failed: number;
}

/** "jari.sukanen@gmail.com" -> "Jari": the default name, until the person changes it. */
const nameFrom = (email: string) => {
	const first = email.split('@')[0].split(/[._+-]/)[0] || email;
	return first.charAt(0).toUpperCase() + first.slice(1);
};

/** The signed-in person, created on their first visit. */
export async function userByEmail(sql: Sql, email: string): Promise<User> {
	const [u] = await sql<User[]>`
		INSERT INTO users (email, name) VALUES (${email}, ${nameFrom(email)})
		ON CONFLICT (email) DO UPDATE SET seen_at = now()
		RETURNING id, email, name`;
	return u;
}

export async function rename(sql: Sql, userId: number, name: string): Promise<void> {
	await sql`UPDATE users SET name = ${name} WHERE id = ${userId}`;
}

export const devices = (sql: Sql, userId: number) => sql<Device[]>`
	SELECT id, endpoint, label, created_at AS "createdAt", last_sent_at AS "lastSentAt", last_error AS "lastError"
	FROM devices WHERE user_id = ${userId} ORDER BY created_at`;

/** Adds the subscription, or refreshes it (keys rotate; a device may change hands). */
export async function saveDevice(sql: Sql, userId: number, sub: Subscription, label: string): Promise<void> {
	await sql`
		INSERT INTO devices (user_id, endpoint, p256dh, auth, label)
		VALUES (${userId}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${label})
		ON CONFLICT (endpoint) DO UPDATE
		SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, seen_at = now()`;
}

export async function removeDevice(sql: Sql, userId: number, by: { id: number } | { endpoint: string }): Promise<void> {
	if ('id' in by) await sql`DELETE FROM devices WHERE user_id = ${userId} AND id = ${by.id}`;
	else await sql`DELETE FROM devices WHERE user_id = ${userId} AND endpoint = ${by.endpoint}`;
}

/** Every configured topic with this person's current choice. */
export async function topicChoices(sql: Sql, userId: number) {
	const rows = await sql<{ topic: string; enabled: boolean }[]>`SELECT topic, enabled FROM topic_choices WHERE user_id = ${userId}`;
	const chosen = new Map(rows.map((r) => [r.topic, r.enabled]));
	return topics().map((t) => ({ ...t, enabled: chosen.get(t.id) ?? t.default }));
}

export async function setTopic(sql: Sql, userId: number, topic: string, enabled: boolean): Promise<void> {
	await sql`
		INSERT INTO topic_choices (user_id, topic, enabled) VALUES (${userId}, ${topic}, ${enabled})
		ON CONFLICT (user_id, topic) DO UPDATE SET enabled = EXCLUDED.enabled`;
}

export const history = (sql: Sql, userId: number, limit = 50) => sql<HistoryEntry[]>`
	SELECT m.id, m.sender, m.topic, m.title, m.body, m.url, m.created_at AS "createdAt"
	FROM message_recipients r JOIN messages m ON m.id = r.message_id
	WHERE r.user_id = ${userId}
	ORDER BY m.created_at DESC, m.id DESC
	LIMIT ${limit}`;

export class SendError extends Error {}

/**
 * Records the message and pushes it to every device of its recipients: the given users (the app's
 * test message), or everyone who has `topic` on, optionally only those in `to` (emails).
 * Subscriptions the push service no longer knows (404/410) are deleted.
 */
export async function send(
	sql: Sql,
	m: { sender: string; title: string; body: string; url: string | null } & ({ topic: string; to?: string[] } | { userIds: number[] })
): Promise<SendResult> {
	if (!config.vapidPublicKey || !config.vapidPrivateKey || !config.vapidSubject) throw new SendError('VAPID keys are not configured');
	const topic = 'topic' in m ? topicById(m.topic) : null;
	if ('topic' in m && !topic) throw new SendError(`unknown topic "${m.topic}"`);

	const recipients: number[] = topic
		? (
				await sql<{ id: number }[]>`
					SELECT u.id FROM users u
					LEFT JOIN topic_choices c ON c.user_id = u.id AND c.topic = ${topic.id}
					WHERE coalesce(c.enabled, ${topic.default})
					${'to' in m && m.to ? sql`AND u.email IN ${sql(m.to.map((e) => e.toLowerCase()))}` : sql``}`
			).map((r) => r.id)
		: 'userIds' in m
			? m.userIds
			: [];

	const [{ id }] = await sql<{ id: number }[]>`
		INSERT INTO messages (sender, topic, title, body, url)
		VALUES (${m.sender}, ${topic?.id ?? null}, ${m.title}, ${m.body}, ${m.url})
		RETURNING id`;
	if (recipients.length > 0) {
		await sql`INSERT INTO message_recipients ${sql(recipients.map((user_id) => ({ message_id: id, user_id })))}`;
	}

	const targets =
		recipients.length > 0
			? await sql<{ id: number; endpoint: string; p256dh: string; auth: string }[]>`
					SELECT id, endpoint, p256dh, auth FROM devices WHERE user_id IN ${sql(recipients)}`
			: [];
	// The service worker shows exactly this (static/sw.js); tag replaces an older copy of the same message.
	const payload = JSON.stringify({ id, title: m.title, body: m.body, url: m.url ?? '/', tag: `m${id}` });
	const outcomes = await Promise.all(
		targets.map(async (d) => {
			try {
				await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, {
					vapidDetails: { subject: config.vapidSubject, publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey },
					TTL: 24 * 3600,
					urgency: 'high',
					timeout: 15_000
				});
				await sql`UPDATE devices SET last_sent_at = now(), last_error = NULL WHERE id = ${d.id}`;
				return true;
			} catch (e) {
				const status = e instanceof WebPushError ? e.statusCode : null;
				if (status === 404 || status === 410) {
					await sql`DELETE FROM devices WHERE id = ${d.id}`;
				} else {
					const why = e instanceof WebPushError ? `HTTP ${e.statusCode} ${e.body}`.trim() : (e as Error).message;
					console.error(`push to device ${d.id} failed: ${why}`);
					await sql`UPDATE devices SET last_error = ${why.slice(0, 300)} WHERE id = ${d.id}`;
				}
				return false;
			}
		})
	);
	const delivered = outcomes.filter(Boolean).length;
	await sql`UPDATE messages SET devices = ${targets.length}, delivered = ${delivered} WHERE id = ${id}`;
	await sql`DELETE FROM messages WHERE created_at < now() - make_interval(days => ${config.historyDays})`;
	return { id, recipients: recipients.length, devices: targets.length, delivered, failed: targets.length - delivered };
}

/** "iPhone", "iPad", "Mac", … from the browser's user agent, for the device list. */
export function deviceLabel(userAgent: string | null): string {
	const ua = userAgent ?? '';
	if (/iPhone/.test(ua)) return 'iPhone';
	if (/iPad/.test(ua)) return 'iPad';
	if (/Android/.test(ua)) return 'Android';
	if (/Macintosh/.test(ua)) return 'Mac';
	if (/Windows/.test(ua)) return 'Windows';
	if (/Linux/.test(ua)) return 'Linux';
	return 'Browser';
}
