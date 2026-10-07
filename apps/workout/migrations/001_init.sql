-- One row per workout. People and machines are fixed lists (src/lib/domain.ts); adding one is a migration.
CREATE TABLE workouts (
	id bigserial PRIMARY KEY,
	person text NOT NULL CHECK (person IN ('jari', 'elina')),
	machine text NOT NULL CHECK (machine IN ('treadmill', 'crosstrainer', 'rowing')),
	day date NOT NULL,
	meters integer NOT NULL CHECK (meters BETWEEN 1 AND 100000),
	-- NULL: logged in the app. 'sheet:<tab>!<cell>': imported from the Google Sheet; a re-import
	-- replaces exactly these rows.
	source text,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workouts_day ON workouts (day);
CREATE INDEX workouts_person_created ON workouts (person, created_at DESC);
