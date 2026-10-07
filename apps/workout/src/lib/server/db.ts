// Postgres client and migrations (same scheme as apps/news).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

export type Sql = postgres.Sql;

let client: Sql | null = null;

/**
 * Lazily created pool; DATABASE_URL like postgres://workout:pw@postgres:5432/workout.
 * `date` columns stay YYYY-MM-DD strings (the default parse would make them local-midnight Dates)
 * and bigint ids/sums become numbers (they stay far below 2^53).
 */
export function db(url = process.env.DATABASE_URL): Sql {
	if (!client) {
		if (!url) throw new Error('DATABASE_URL is not set');
		client = postgres(url, {
			max: 5,
			idle_timeout: 60,
			onnotice: () => {},
			types: {
				date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
				bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) }
			}
		});
	}
	return client;
}

/** Applies migrations/NNN_*.sql in order, each once, recorded in schema_migrations. */
export async function migrate(sql: Sql, dir: string): Promise<string[]> {
	const applied: string[] = [];
	await sql.begin(async (tx) => {
		await tx`SELECT pg_advisory_xact_lock(4243)`;
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
