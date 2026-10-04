import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestMatch, CLUSTER_THRESHOLD, cosine } from '../src/lib/core/pipeline/clustering.ts';

const at = (hours: number) => new Date(Date.UTC(2026, 9, 4) + hours * 3600_000);
/** A unit vector at `similarity` cosine to [1, 0]. */
const near = (similarity: number) => [similarity, Math.sqrt(1 - similarity ** 2)];

test('cosine of identical and orthogonal vectors', () => {
	assert.equal(cosine([1, 2, 3], [1, 2, 3]).toFixed(6), '1.000000');
	assert.equal(cosine([1, 0], [0, 1]), 0);
});

test('matches only other outlets within 48 hours and above the threshold', () => {
	const article = { id: 10, outlet_id: 1, published_at: at(0), cluster_id: null };
	const strong = Math.min(1, CLUSTER_THRESHOLD + 0.1);
	const candidates = [
		{ id: 1, outlet_id: 1, published_at: at(-1), cluster_id: null, embedding: near(1) },
		{ id: 2, outlet_id: 2, published_at: at(-49), cluster_id: null, embedding: near(1) },
		{ id: 3, outlet_id: 3, published_at: at(-2), cluster_id: 7, embedding: near(strong) },
		{ id: 4, outlet_id: 4, published_at: at(5), cluster_id: null, embedding: near(CLUSTER_THRESHOLD - 0.05) }
	];
	const found = bestMatch(article, [1, 0], candidates);
	assert.equal(found?.match.id, 3);
	assert.equal(bestMatch(article, [1, 0], [candidates[3]]), null);
});
