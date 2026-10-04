-- Worker: where an AI sensitivity tag came from (shown in the admin article view).
-- NULL for manual rows.
ALTER TABLE article_tags
	ADD COLUMN basis text CHECK (basis IN ('text', 'images', 'both'));
