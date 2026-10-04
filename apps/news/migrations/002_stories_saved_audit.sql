-- Story clustering, saved articles, outlet-provided metadata, body purge, correction audit.

-- Cross-outlet story clustering (worker): embedding of calm title + summary
-- (text-embedding-3-small, 1536 dims). cluster_id = id of the cluster's first article; NULL = alone.
ALTER TABLE articles
	ADD COLUMN embedding real[],
	ADD COLUMN cluster_id bigint,
	-- Outlet metadata kept for classification hints and admin views (e.g. Iltalehti sentiment).
	ADD COLUMN source_meta jsonb NOT NULL DEFAULT '{}',
	-- Admin purge of the stored body (rights-holder request). Purged articles keep their
	-- classification and are never re-extracted or re-classified.
	ADD COLUMN body_purged_at timestamptz;
CREATE INDEX articles_cluster ON articles (cluster_id) WHERE cluster_id IS NOT NULL;
CREATE INDEX articles_classified ON articles (classified_at DESC) WHERE classify_state = 'done';

ALTER TABLE outlets
	ADD COLUMN last_discovery_found integer,
	ADD COLUMN last_discovery_new integer;

CREATE TABLE user_saved (
	user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
	article_id bigint NOT NULL REFERENCES articles ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, article_id)
);

-- Every manual tag change by an admin (audit trail and labelled examples for prompt work).
-- Intensities: 0 = absent, 1..3 = mention..graphic.
CREATE TABLE tag_corrections (
	id serial PRIMARY KEY,
	article_id bigint NOT NULL REFERENCES articles ON DELETE CASCADE,
	tag text NOT NULL,
	ai_intensity smallint NOT NULL,
	new_intensity smallint NOT NULL,
	admin_id integer REFERENCES users ON DELETE SET NULL,
	report_id integer REFERENCES reports ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tag_corrections_article ON tag_corrections (article_id);
