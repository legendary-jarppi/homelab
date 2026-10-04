// Leak tests for the reader visibility rule against a real Postgres (DATABASE_URL, migrated).
// Each test runs in a transaction that is rolled back.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import postgres from 'postgres';
import { BIGINT_AS_NUMBER } from '../src/lib/core/db.ts';
import { blockedTermsQuery, visibleTo, type Reader } from '../src/lib/core/visibility.ts';

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {}, types: { bigint: BIGINT_AS_NUMBER } }) : null;
type Tx = postgres.TransactionSql;

/** Runs fn in a transaction and rolls it back. */
async function scenario(fn: (tx: Tx) => Promise<void>) {
	await sql!
		.begin(async (tx) => {
			await fn(tx);
			throw new Error('rollback');
		})
		.catch((e: Error) => {
			if (e.message !== 'rollback') throw e;
		});
}

async function fixture(tx: Tx) {
	const [outlet] = await tx`INSERT INTO outlets (slug, name, language, homepage) VALUES ('t', 'T', 'fi', 'https://t.example') RETURNING id`;
	const [user] = await tx`INSERT INTO users (username, display_name, password_hash) VALUES ('reader', 'Reader', 'x') RETURNING id`;
	const article = async (title: string, opts: { body?: string; state?: string; content?: string; kind?: string } = {}) => {
		const text = `${title} ${opts.body ?? ''}`;
		const [row] = await tx`
			INSERT INTO articles (outlet_id, url, title, published_at, content_state, classify_state, kind, section, block_tsv)
			VALUES (${outlet.id}, ${'https://t.example/' + title}, ${title}, now(), ${opts.content ?? 'extracted'}, ${opts.state ?? 'done'},
				${opts.kind ?? 'news'}, 'news',
				to_tsvector('simple_unaccent', ${text}) || to_tsvector('finnish', ${text}) || to_tsvector('english', ${text}))
			RETURNING id`;
		await tx`INSERT INTO article_topics (article_id, topic, rank) VALUES (${row.id}, 'world-news', 0)`;
		return row.id as number;
	};
	return { outletId: outlet.id as number, userId: user.id as number, article };
}

/** Visible articles of the fixture outlet only: the database may also hold real articles. */
async function visibleIds(tx: Tx, reader: Reader): Promise<number[]> {
	const rows = await tx`
		SELECT a.id FROM articles a
		WHERE a.outlet_id = (SELECT id FROM outlets WHERE slug = 't') AND ${visibleTo(tx as unknown as postgres.Sql, reader)} ORDER BY a.id`;
	return rows.map((r) => Number(r.id));
}

const reader = (id: number, terms: { term: string; whole_word: boolean }[] = []): Reader => ({
	id,
	blockQuery: blockedTermsQuery(sql!, terms)
});

test('threshold hides tags at or above it, allows below', { skip: !sql }, () =>
	scenario(async (tx) => {
		const f = await fixture(tx);
		const mention = await f.article('mention');
		const description = await f.article('description');
		const graphic = await f.article('graphic');
		for (const [id, intensity] of [[mention, 1], [description, 2], [graphic, 3]]) {
			await tx`INSERT INTO article_tags (article_id, tag, origin, intensity) VALUES (${id}, 'armed-conflict', 'ai', ${intensity})`;
		}
		await tx`INSERT INTO user_thresholds (user_id, tag, threshold) VALUES (${f.userId}, 'armed-conflict', 2)`;
		assert.deepEqual(await visibleIds(tx, reader(f.userId)), [mention]);
	}));

test('manual correction removing a tag overrides the AI tag; adding one hides', { skip: !sql }, () =>
	scenario(async (tx) => {
		const f = await fixture(tx);
		const cleared = await f.article('cleared');
		const added = await f.article('added');
		await tx`INSERT INTO article_tags (article_id, tag, origin, intensity) VALUES (${cleared}, 'death-general', 'ai', 3), (${cleared}, 'death-general', 'manual', 0)`;
		await tx`INSERT INTO article_tags (article_id, tag, origin, intensity) VALUES (${added}, 'death-general', 'manual', 1)`;
		await tx`INSERT INTO user_thresholds (user_id, tag, threshold) VALUES (${f.userId}, 'death-general', 1)`;
		assert.deepEqual(await visibleIds(tx, reader(f.userId)), [cleared]);
	}));

test('blocked word matches Finnish inflections, accents and word beginnings', { skip: !sql }, () =>
	scenario(async (tx) => {
		const f = await fixture(tx);
		const partitive = await f.article('Hämähäkkejä löytyi kellarista');
		const elative = await f.article('Tutkijat kertovat hämähäkeistä');
		const unaccented = await f.article('Hamahakki uutinen');
		const unrelated = await f.article('Talvi tulee aikaisin');
		const visible = await visibleIds(tx, reader(f.userId, [{ term: 'hämähäkki', whole_word: false }]));
		assert.deepEqual(visible, [unrelated]);
		assert.ok(!visible.includes(partitive) && !visible.includes(elative) && !visible.includes(unaccented));
	}));

test('whole-word blocked term does not hide longer words', { skip: !sql }, () =>
	scenario(async (tx) => {
		const f = await fixture(tx);
		const exact = await f.article('The cat sat');
		const longer = await f.article('Catalogue of autumn colours');
		assert.deepEqual(await visibleIds(tx, reader(f.userId, [{ term: 'cat', whole_word: true }])), [longer]);
		assert.deepEqual(await visibleIds(tx, reader(f.userId, [{ term: 'cat', whole_word: false }])), []);
		void exact;
	}));

test('blocked terms with query syntax are treated literally', { skip: !sql }, () =>
	scenario(async (tx) => {
		const f = await fixture(tx);
		const a = await f.article('Weather report');
		// Operators are stripped: these must neither error nor hide everything.
		const visible = await visibleIds(tx, reader(f.userId, [{ term: "x | !y & '*", whole_word: false }, { term: ':*', whole_word: false }]));
		assert.deepEqual(visible, [a]);
	}));

test('blocked word matches body text, not just the headline', { skip: !sql }, () =>
	scenario(async (tx) => {
		const f = await fixture(tx);
		await f.article('Neutral headline', { body: 'A long story that mentions snakes near the end.' });
		assert.deepEqual(await visibleIds(tx, reader(f.userId, [{ term: 'snake', whole_word: false }])), []);
	}));

test('unclassified, failed, paywalled, sponsored and purged articles are never visible', { skip: !sql }, () =>
	scenario(async (tx) => {
		const f = await fixture(tx);
		await f.article('pending', { state: 'pending' });
		await f.article('failed', { state: 'failed' });
		await f.article('paywalled', { content: 'paywalled' });
		await f.article('sponsored', { kind: 'sponsored' });
		const purged = await f.article('purged');
		await tx`UPDATE articles SET body_purged_at = now() WHERE id = ${purged}`;
		const ok = await f.article('ok');
		assert.deepEqual(await visibleIds(tx, reader(f.userId)), [ok]);
	}));

test('a hidden topic hides articles where it is any of the topics; hidden outlets and muted articles are excluded', { skip: !sql }, () =>
	scenario(async (tx) => {
		const f = await fixture(tx);
		const secondary = await f.article('secondary');
		await tx`INSERT INTO article_topics (article_id, topic, rank) VALUES (${secondary}, 'sports', 1)`;
		const plain = await f.article('plain');
		const muted = await f.article('muted');
		await tx`INSERT INTO user_hidden_topics (user_id, topic) VALUES (${f.userId}, 'sports')`;
		await tx`INSERT INTO user_muted (user_id, article_id) VALUES (${f.userId}, ${muted})`;
		assert.deepEqual(await visibleIds(tx, reader(f.userId)), [plain]);
		await tx`INSERT INTO user_hidden_outlets (user_id, outlet_id) VALUES (${f.userId}, ${f.outletId})`;
		assert.deepEqual(await visibleIds(tx, reader(f.userId)), []);
	}));

test.after(() => sql?.end());
