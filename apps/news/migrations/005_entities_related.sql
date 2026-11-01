-- People, organisations, places and other named things per article (worker stage after
-- classification), precomputed related stories (embedding neighbours outside the article's own
-- cluster), and the purpose of each model call.

-- One row per kind and normalised name; `name` is the display form first seen.
CREATE TABLE entities (
	id serial PRIMARY KEY,
	kind text NOT NULL CHECK (kind IN ('person', 'organisation', 'place', 'other')),
	name text NOT NULL,
	-- lower(unaccent(name)) with whitespace collapsed; see src/lib/core/pipeline/entities.ts.
	norm text NOT NULL,
	UNIQUE (kind, norm)
);

CREATE TABLE article_entities (
	article_id bigint NOT NULL REFERENCES articles ON DELETE CASCADE,
	entity_id integer NOT NULL REFERENCES entities ON DELETE CASCADE,
	-- 0 = most central to the article.
	rank smallint NOT NULL,
	PRIMARY KEY (article_id, entity_id)
);
CREATE INDEX article_entities_entity ON article_entities (entity_id, article_id);

-- Symmetric pairs: both (a, b) and (b, a) are stored.
CREATE TABLE article_related (
	article_id bigint NOT NULL REFERENCES articles ON DELETE CASCADE,
	related_id bigint NOT NULL REFERENCES articles ON DELETE CASCADE,
	similarity real NOT NULL,
	PRIMARY KEY (article_id, related_id)
);

ALTER TABLE articles
	-- Entity extraction done (also when it found none); NULL = pending.
	ADD COLUMN entities_at timestamptz,
	ADD COLUMN entities_attempts smallint NOT NULL DEFAULT 0,
	-- Related stories computed; NULL = pending (needs an embedding first).
	ADD COLUMN related_at timestamptz;
CREATE INDEX articles_entities_queue ON articles (published_at DESC) WHERE classify_state = 'done' AND entities_at IS NULL;
CREATE INDEX articles_related_queue ON articles (published_at DESC) WHERE embedding IS NOT NULL AND related_at IS NULL;

ALTER TABLE llm_calls ADD COLUMN purpose text NOT NULL DEFAULT 'classify' CHECK (purpose IN ('classify', 'entities'));
