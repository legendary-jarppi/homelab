import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entityNorm } from '../src/lib/core/pipeline/entities.ts';
import { RELATED_FLOOR, relatedFor, unitVector, type Neighbour } from '../src/lib/core/pipeline/related.ts';

const day = 86_400_000;
const at = (days: number) => new Date(Date.UTC(2026, 10, 1) + days * day);
/** A story whose vector has `similarity` cosine to [1, 0]. */
const story = (id: number, similarity: number, days = 0, cluster_id: number | null = null): Neighbour => ({
	id,
	published_at: at(days),
	cluster_id,
	vector: unitVector([similarity, Math.sqrt(1 - similarity ** 2)])
});

test('an unclustered article keeps unclustered candidates (null is not a shared cluster)', () => {
	const article = story(1, 1);
	const found = relatedFor(article, [article, story(2, 0.9), story(3, 0.8, 0, 5)]);
	assert.deepEqual(found.map((r) => r.id), [2, 3]);
});

test('skips its own cluster, the floor and anything beyond 7 days; best first, at most 8', () => {
	const article = story(1, 1, 0, 9);
	const candidates = [
		story(2, 0.95, 0, 9),
		story(3, 0.9, 7.5),
		story(4, RELATED_FLOOR - 0.01),
		...Array.from({ length: 10 }, (_, i) => story(10 + i, 0.6 + i / 100, i % 2 ? 6.5 : -6.5))
	];
	const found = relatedFor(article, candidates);
	assert.deepEqual(found.map((r) => r.id), [19, 18, 17, 16, 15, 14, 13, 12]);
	assert.ok(found[0].similarity > found[7].similarity);
});

test('entity norm: one row per entity whatever the case, accents or spacing', () => {
	assert.equal(entityNorm('Venäjä'), 'venaja');
	assert.equal(entityNorm('  Laurent \u00a0 Nuñez '), 'laurent nunez');
	assert.equal(entityNorm('ZEN CAFÉ'), entityNorm('Zen Cafe'));
});
