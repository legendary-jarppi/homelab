-- People who can be attached to items (who watched, who wants to watch, …).
CREATE TABLE people (
	id serial PRIMARY KEY,
	name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 40),
	position integer NOT NULL DEFAULT 0
);

-- A list, and which optional item fields it uses (every item has a title).
CREATE TABLE lists (
	id serial PRIMARY KEY,
	slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
	description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
	use_people boolean NOT NULL DEFAULT true,
	use_date boolean NOT NULL DEFAULT true,
	date_label text NOT NULL DEFAULT 'Date' CHECK (length(date_label) BETWEEN 1 AND 30),
	use_service boolean NOT NULL DEFAULT false,
	use_link boolean NOT NULL DEFAULT false,
	use_note boolean NOT NULL DEFAULT false,
	sort text NOT NULL DEFAULT 'date' CHECK (sort IN ('date', 'added', 'title')),
	-- Items shown on the home dashboard; 0 = not shown.
	dashboard_count integer NOT NULL DEFAULT 0 CHECK (dashboard_count BETWEEN 0 AND 20),
	position integer NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL DEFAULT now()
);

-- Fields a list does not use stay NULL (or keep their value when an item moves between lists).
CREATE TABLE items (
	id bigserial PRIMARY KEY,
	list_id integer NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
	title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
	day date,
	service text CHECK (service IS NULL OR length(service) BETWEEN 1 AND 60),
	link text CHECK (link IS NULL OR (length(link) <= 2000 AND link ~ '^https?://')),
	note text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_list_day ON items (list_id, day DESC NULLS LAST, id DESC);
CREATE INDEX items_list_created ON items (list_id, created_at DESC, id DESC);

CREATE TABLE item_people (
	item_id bigint NOT NULL REFERENCES items (id) ON DELETE CASCADE,
	person_id integer NOT NULL REFERENCES people (id) ON DELETE CASCADE,
	PRIMARY KEY (item_id, person_id)
);

INSERT INTO people (name, position) VALUES ('Jari', 1), ('Elina', 2), ('Anna-Linnea', 3), ('Jussi', 4);

INSERT INTO lists (slug, name, description, use_people, use_date, date_label, use_service, use_link, use_note, sort, dashboard_count, position) VALUES
	('watched-movies', 'Watched movies', 'Movies and series we have watched, and who watched them.', true, true, 'Watched', true, true, true, 'date', 5, 1),
	('movies-to-watch', 'Movies to watch', 'Movies and series we want to see, and where they are available.', true, false, 'Date', true, true, true, 'added', 0, 2);
