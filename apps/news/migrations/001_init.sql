-- Shilly Shally News schema v1.
-- Intensities and thresholds are smallints: 1 = mention, 2 = description, 3 = graphic.
-- A reader threshold hides an article when tag intensity >= threshold; no row = never hide.

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Accent-insensitive "simple" text search for blocked words (in addition to stemmed fi/en).
CREATE TEXT SEARCH CONFIGURATION simple_unaccent (COPY = simple);
ALTER TEXT SEARCH CONFIGURATION simple_unaccent ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;

CREATE TABLE outlets (
	id serial PRIMARY KEY,
	slug text NOT NULL UNIQUE,
	name text NOT NULL,
	language text NOT NULL,
	homepage text NOT NULL,
	enabled boolean NOT NULL DEFAULT true,
	-- Higher first in the classification queue.
	priority integer NOT NULL DEFAULT 50,
	-- Discovery sources and extraction hints; see src/lib/core/outlets.ts.
	config jsonb NOT NULL DEFAULT '{}',
	-- Paywalled content needs system-level credentials (later); such articles are stored but not shown.
	requires_auth boolean NOT NULL DEFAULT false,
	last_discovery_at timestamptz,
	last_discovery_error text,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE articles (
	id bigserial PRIMARY KEY,
	outlet_id integer NOT NULL REFERENCES outlets ON DELETE CASCADE,
	url text NOT NULL UNIQUE,
	title text NOT NULL,
	teaser text,
	author text,
	language text,
	published_at timestamptz NOT NULL,
	discovered_at timestamptz NOT NULL DEFAULT now(),

	-- Content phase. Only 'extracted' articles are classified and shown.
	content_state text NOT NULL DEFAULT 'pending' CHECK (content_state IN ('pending', 'extracted', 'paywalled', 'failed', 'skipped')),
	content_reason text,
	content_attempts smallint NOT NULL DEFAULT 0,
	content_next_at timestamptz NOT NULL DEFAULT now(),
	body jsonb,
	body_chars integer,
	extracted_at timestamptz,

	-- Classification phase.
	classify_state text NOT NULL DEFAULT 'pending' CHECK (classify_state IN ('pending', 'done', 'failed')),
	classify_attempts smallint NOT NULL DEFAULT 0,
	classify_next_at timestamptz NOT NULL DEFAULT now(),
	classify_error text,
	classified_at timestamptz,
	model text,
	prompt_version text,
	calm_title text,
	summary text,
	importance smallint,
	kind text,
	section text,
	-- Matched by readers' blocked words: title, calm title, summary, body text, captions.
	block_tsv tsvector,
	-- Reader search.
	search_tsv tsvector
);
CREATE INDEX articles_feed ON articles (published_at DESC) WHERE classify_state = 'done';
CREATE INDEX articles_section ON articles (section, published_at DESC) WHERE classify_state = 'done';
CREATE INDEX articles_content_queue ON articles (content_next_at) WHERE content_state = 'pending';
CREATE INDEX articles_classify_queue ON articles (classify_next_at) WHERE content_state = 'extracted' AND classify_state = 'pending';
CREATE INDEX articles_outlet ON articles (outlet_id, published_at DESC);
CREATE INDEX articles_block_tsv ON articles USING gin (block_tsv);
CREATE INDEX articles_search_tsv ON articles USING gin (search_tsv);

CREATE TABLE images (
	id bigserial PRIMARY KEY,
	article_id bigint NOT NULL REFERENCES articles ON DELETE CASCADE,
	-- Position: 0 = lead image, then body figures in order.
	position smallint NOT NULL,
	source_url text NOT NULL,
	caption text,
	credit text,
	alt text,
	state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'stored', 'failed')),
	-- Relative path under the image store; width/height of the stored rendition.
	path text,
	width integer,
	height integer,
	-- Visual assessment by the classifier: per-image tags; NULL = not assessed.
	assessed boolean NOT NULL DEFAULT false,
	UNIQUE (article_id, position)
);

CREATE TABLE image_tags (
	image_id bigint NOT NULL REFERENCES images ON DELETE CASCADE,
	tag text NOT NULL,
	intensity smallint NOT NULL CHECK (intensity BETWEEN 1 AND 3),
	PRIMARY KEY (image_id, tag)
);

CREATE TABLE article_topics (
	article_id bigint NOT NULL REFERENCES articles ON DELETE CASCADE,
	topic text NOT NULL,
	-- 0 = primary topic.
	rank smallint NOT NULL,
	confidence real,
	PRIMARY KEY (article_id, topic)
);

-- Sensitivity tags. origin 'ai' from the classifier; 'manual' rows are admin corrections that
-- replace all AI rows for that tag (intensity 0 = tag removed by the admin).
CREATE TABLE article_tags (
	article_id bigint NOT NULL REFERENCES articles ON DELETE CASCADE,
	tag text NOT NULL,
	origin text NOT NULL CHECK (origin IN ('ai', 'manual')),
	intensity smallint NOT NULL CHECK (intensity BETWEEN 0 AND 3),
	confidence real,
	PRIMARY KEY (article_id, tag, origin)
);

CREATE VIEW article_effective_tags AS
	SELECT article_id, tag, intensity FROM article_tags t
	WHERE origin = 'manual' AND intensity > 0
	UNION ALL
	SELECT article_id, tag, intensity FROM article_tags t
	WHERE origin = 'ai'
		AND NOT EXISTS (SELECT 1 FROM article_tags m WHERE m.article_id = t.article_id AND m.tag = t.tag AND m.origin = 'manual');

CREATE TABLE users (
	id serial PRIMARY KEY,
	username text NOT NULL UNIQUE,
	display_name text NOT NULL,
	password_hash text NOT NULL,
	role text NOT NULL DEFAULT 'reader' CHECK (role IN ('reader', 'admin')),
	-- Image display, theme, calm headlines, onboarding state; see src/lib/core/prefs.ts.
	settings jsonb NOT NULL DEFAULT '{}',
	invited_by integer REFERENCES users ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
	-- SHA-256 of the session token; the token itself is only in the reader's cookie.
	token_hash text PRIMARY KEY,
	user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	last_seen_at timestamptz NOT NULL DEFAULT now(),
	user_agent text
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE invites (
	code_hash text PRIMARY KEY,
	created_by integer REFERENCES users ON DELETE SET NULL,
	note text,
	role text NOT NULL DEFAULT 'reader' CHECK (role IN ('reader', 'admin')),
	created_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	used_by integer REFERENCES users ON DELETE SET NULL,
	used_at timestamptz
);

CREATE TABLE user_thresholds (
	user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
	tag text NOT NULL,
	threshold smallint NOT NULL CHECK (threshold BETWEEN 1 AND 3),
	PRIMARY KEY (user_id, tag)
);

CREATE TABLE user_hidden_topics (
	user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
	topic text NOT NULL,
	PRIMARY KEY (user_id, topic)
);

CREATE TABLE user_hidden_outlets (
	user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
	outlet_id integer NOT NULL REFERENCES outlets ON DELETE CASCADE,
	PRIMARY KEY (user_id, outlet_id)
);

CREATE TABLE user_blocked_terms (
	user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
	term text NOT NULL,
	-- false: word beginnings (default); true: whole words only.
	whole_word boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, term)
);

CREATE TABLE user_muted (
	user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
	article_id bigint NOT NULL REFERENCES articles ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, article_id)
);

CREATE TABLE user_reads (
	user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
	article_id bigint NOT NULL REFERENCES articles ON DELETE CASCADE,
	read_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, article_id)
);

-- "This upset me": hides the article for the reader at once and queues it for admin review.
CREATE TABLE reports (
	id serial PRIMARY KEY,
	user_id integer REFERENCES users ON DELETE SET NULL,
	article_id bigint NOT NULL REFERENCES articles ON DELETE CASCADE,
	note text,
	created_at timestamptz NOT NULL DEFAULT now(),
	resolved_at timestamptz,
	resolved_by integer REFERENCES users ON DELETE SET NULL
);

-- Front-page editions: the front page shows articles classified before `cutoff`.
CREATE TABLE editions (
	id serial PRIMARY KEY,
	cutoff timestamptz NOT NULL UNIQUE,
	label text NOT NULL
);

-- Classifier calls, for cost/latency/error monitoring.
CREATE TABLE llm_calls (
	id bigserial PRIMARY KEY,
	article_id bigint REFERENCES articles ON DELETE SET NULL,
	model text NOT NULL,
	ok boolean NOT NULL,
	latency_ms integer NOT NULL,
	input_tokens integer,
	output_tokens integer,
	cache_read_tokens integer,
	error text,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_time ON llm_calls (created_at DESC);
