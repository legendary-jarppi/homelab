// Postgres client and migrations, shared by web and worker.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

export type Sql = postgres.Sql;

let client: Sql | null = null;

/** bigserial ids and counts as JS numbers (they stay far below 2^53). */
export const BIGINT_AS_NUMBER = { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) };

/** Lazily created pool; DATABASE_URL like postgres://news:pw@postgres:5432/news. */
export function db(): Sql {
	if (!client) {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error('DATABASE_URL is not set');
		client = postgres(url, { max: Number(process.env.DB_POOL ?? 10), idle_timeout: 60, onnotice: () => {}, types: { bigint: BIGINT_AS_NUMBER } });
	}
	return client;
}

/**
 * Applies migrations/NNN_*.sql in order, each in a transaction, recorded in schema_migrations.
 * Serialised with an advisory lock so web and worker can both call it at startup.
 */
export async function migrate(sql: Sql, dir: string): Promise<string[]> {
	const applied: string[] = [];
	await sql.begin(async (tx) => {
		await tx`SELECT pg_advisory_xact_lock(4242)`;
		await tx`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
		const done = new Set((await tx`SELECT name FROM schema_migrations`).map((r) => r.name as string));
		const files = (await readdir(dir)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
		for (const file of files) {
			if (done.has(file)) continue;
			await tx.unsafe(await readFile(path.join(dir, file), 'utf8'));
			await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
			applied.push(file);
		}
	});
	return applied;
}
