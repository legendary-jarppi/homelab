-- Subscriber sessions for outlets (system-level, never per reader). Seeded from the worker's
-- COOKIES_<SLUG> secret value; cookies the outlet updates through Set-Cookie are kept here so a
-- restart does not fall back to stale tokens. See src/lib/core/sessions.ts.
CREATE TABLE outlet_sessions (
	slug text PRIMARY KEY,
	-- SHA-256 of the secret value the jar was seeded from; a new secret value reseeds the jar.
	seed_hash text NOT NULL,
	cookies jsonb NOT NULL,
	-- 'unknown' until a subscriber-only article was fetched; 'ok' = it opened; 'rejected' = still locked.
	state text NOT NULL DEFAULT 'unknown' CHECK (state IN ('unknown', 'ok', 'rejected')),
	state_at timestamptz,
	state_url text,
	updated_at timestamptz NOT NULL DEFAULT now()
);
