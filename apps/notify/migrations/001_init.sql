-- People are created on their first visit, identified by the email Cloudflare Access verified.
CREATE TABLE users (
	id bigserial PRIMARY KEY,
	email text NOT NULL UNIQUE,
	name text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	seen_at timestamptz NOT NULL DEFAULT now()
);

-- One web push subscription per installed app (browser) instance.
CREATE TABLE devices (
	id bigserial PRIMARY KEY,
	user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
	endpoint text NOT NULL UNIQUE,
	p256dh text NOT NULL,
	auth text NOT NULL,
	label text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	seen_at timestamptz NOT NULL DEFAULT now(),
	last_sent_at timestamptz,
	last_error text
);
CREATE INDEX devices_user ON devices (user_id);

-- A person's choice per topic; without a row the topic's default applies (deploy/topics.json).
CREATE TABLE topic_choices (
	user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
	topic text NOT NULL,
	enabled boolean NOT NULL,
	PRIMARY KEY (user_id, topic)
);

CREATE TABLE messages (
	id bigserial PRIMARY KEY,
	sender text NOT NULL,
	-- NULL for the app's own test messages.
	topic text,
	title text NOT NULL,
	body text NOT NULL,
	url text,
	created_at timestamptz NOT NULL DEFAULT now(),
	devices integer NOT NULL DEFAULT 0,
	delivered integer NOT NULL DEFAULT 0
);
CREATE INDEX messages_created ON messages (created_at);

-- Who a message was for (the history page), whether or not they had a device.
CREATE TABLE message_recipients (
	message_id bigint NOT NULL REFERENCES messages ON DELETE CASCADE,
	user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
	PRIMARY KEY (message_id, user_id)
);
CREATE INDEX message_recipients_user ON message_recipients (user_id, message_id);
