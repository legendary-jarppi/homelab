// Registry of outlet modules and idempotent seeding of the `outlets` table.
import type { Sql } from '../db.ts';
import { hs } from './hs.ts';
import { iltalehti } from './iltalehti.ts';
import { is } from './is.ts';
import { mtv } from './mtv.ts';
import { npr } from './npr.ts';
import { seiska } from './seiska.ts';
import type { OutletDef } from './types.ts';
import { yle } from './yle.ts';

export const OUTLETS: OutletDef[] = [yle, hs, is, iltalehti, mtv, seiska, npr];

export function outletBySlug(slug: string): OutletDef | undefined {
	return OUTLETS.find((o) => o.slug === slug);
}

/**
 * Inserts missing outlets with their defaults. Existing rows only get name, homepage and language
 * refreshed: `enabled` and `priority` belong to the admin once a row exists.
 */
export async function seedOutlets(sql: Sql): Promise<void> {
	for (const o of OUTLETS) {
		await sql`
			INSERT INTO outlets (slug, name, language, homepage, enabled, priority)
			VALUES (${o.slug}, ${o.name}, ${o.language}, ${o.homepage}, ${o.enabledByDefault}, ${o.priority})
			ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, homepage = EXCLUDED.homepage, language = EXCLUDED.language`;
	}
}
