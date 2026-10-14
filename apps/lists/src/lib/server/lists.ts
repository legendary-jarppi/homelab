// Lists, items and people in Postgres.
import type { Item, List, ListSort, Person } from '$lib/domain';
import { slugify } from '$lib/domain';
import type { Sql } from './db';

interface ListRow {
	id: number;
	slug: string;
	name: string;
	description: string;
	use_people: boolean;
	use_date: boolean;
	date_label: string;
	use_service: boolean;
	use_link: boolean;
	use_note: boolean;
	sort: ListSort;
	dashboard_count: number;
}

const toList = (r: ListRow): List => ({
	id: r.id,
	slug: r.slug,
	name: r.name,
	description: r.description,
	usePeople: r.use_people,
	useDate: r.use_date,
	dateLabel: r.date_label,
	useService: r.use_service,
	useLink: r.use_link,
	useNote: r.use_note,
	sort: r.sort,
	dashboardCount: r.dashboard_count
});

interface ItemRow {
	id: number;
	list_id: number;
	title: string;
	day: string | null;
	service: string | null;
	link: string | null;
	note: string | null;
	people: number[];
	created_at: Date;
}

const toItem = (r: ItemRow): Item => ({
	id: r.id,
	listId: r.list_id,
	title: r.title,
	day: r.day,
	service: r.service,
	link: r.link,
	note: r.note,
	people: r.people,
	createdAt: r.created_at.toISOString()
});

/** List fields as edited in the list form. */
export type ListInput = Omit<List, 'id' | 'slug'>;
/** Item fields as edited in the item form; fields the list does not use are null/empty. */
export type ItemInput = Pick<Item, 'title' | 'day' | 'service' | 'link' | 'note' | 'people'>;

export async function people(sql: Sql): Promise<Person[]> {
	return sql<Person[]>`SELECT id, name FROM people ORDER BY position, id`;
}

export async function lists(sql: Sql): Promise<List[]> {
	return (await sql<ListRow[]>`SELECT * FROM lists ORDER BY position, id`).map(toList);
}

export async function listBySlug(sql: Sql, slug: string): Promise<List | null> {
	const [row] = await sql<ListRow[]>`SELECT * FROM lists WHERE slug = ${slug}`;
	return row ? toList(row) : null;
}

/** A list's sort order as SQL on alias `i`. */
function orderBy(sql: Sql, sort: ListSort) {
	if (sort === 'title') return sql`lower(i.title), i.id`;
	if (sort === 'added') return sql`i.created_at DESC, i.id DESC`;
	return sql`i.day DESC NULLS LAST, i.created_at DESC, i.id DESC`;
}

const ITEM_COLUMNS = (sql: Sql) => sql`
	i.id, i.list_id, i.title, i.day, i.service, i.link, i.note, i.created_at,
	coalesce((SELECT array_agg(ip.person_id ORDER BY p.position, p.id)
		FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = i.id), '{}') AS people`;

/** A list's items in its sort order; `person` keeps those with that person, `q` matches title, service or note. */
export async function items(sql: Sql, list: List, filter: { person?: number | null; q?: string; limit?: number } = {}): Promise<Item[]> {
	const q = filter.q?.trim();
	const rows = await sql<ItemRow[]>`
		SELECT ${ITEM_COLUMNS(sql)}
		FROM items i
		WHERE i.list_id = ${list.id}
			${filter.person ? sql`AND EXISTS (SELECT 1 FROM item_people ip WHERE ip.item_id = i.id AND ip.person_id = ${filter.person})` : sql``}
			${q ? sql`AND (i.title ILIKE ${'%' + q + '%'} OR i.service ILIKE ${'%' + q + '%'} OR i.note ILIKE ${'%' + q + '%'})` : sql``}
		ORDER BY ${orderBy(sql, list.sort)}
		LIMIT ${filter.limit ?? 2000}`;
	return rows.map(toItem);
}

/** Item count per list id. */
export async function itemCounts(sql: Sql): Promise<Map<number, number>> {
	const rows = await sql<{ list_id: number; n: number }[]>`SELECT list_id, count(*)::int AS n FROM items GROUP BY list_id`;
	return new Map(rows.map((r) => [r.list_id, r.n]));
}

/** Services used before in this list, most used first: offered when adding. */
export async function usedServices(sql: Sql, listId: number): Promise<string[]> {
	const rows = await sql<{ service: string }[]>`
		SELECT service FROM items WHERE list_id = ${listId} AND service IS NOT NULL
		GROUP BY service ORDER BY count(*) DESC, service LIMIT 30`;
	return rows.map((r) => r.service);
}

export async function item(sql: Sql, id: number): Promise<Item | null> {
	const [row] = await sql<ItemRow[]>`SELECT ${ITEM_COLUMNS(sql)} FROM items i WHERE i.id = ${id}`;
	return row ? toItem(row) : null;
}

/** A slug not taken by another list: "movies", then "movies-2", … */
async function freeSlug(sql: Sql, name: string, except?: number): Promise<string> {
	const base = slugify(name);
	const taken = new Set(
		(await sql<{ slug: string }[]>`SELECT slug FROM lists WHERE (slug = ${base} OR slug LIKE ${base + '-%'}) AND id IS DISTINCT FROM ${except ?? null}`).map((r) => r.slug)
	);
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

const listColumns = (input: ListInput) => ({
	name: input.name,
	description: input.description,
	use_people: input.usePeople,
	use_date: input.useDate,
	date_label: input.dateLabel,
	use_service: input.useService,
	use_link: input.useLink,
	use_note: input.useNote,
	sort: input.sort,
	dashboard_count: input.dashboardCount
});

export async function createList(sql: Sql, input: ListInput): Promise<List> {
	const slug = await freeSlug(sql, input.name);
	const c = listColumns(input);
	const [row] = await sql<ListRow[]>`
		INSERT INTO lists (slug, name, description, use_people, use_date, date_label, use_service, use_link, use_note, sort, dashboard_count, position)
		VALUES (${slug}, ${c.name}, ${c.description}, ${c.use_people}, ${c.use_date}, ${c.date_label}, ${c.use_service}, ${c.use_link},
			${c.use_note}, ${c.sort}, ${c.dashboard_count}, (SELECT coalesce(max(position), 0) + 1 FROM lists))
		RETURNING *`;
	return toList(row);
}

/** Saves a list's settings; a new name gives it a new slug (the URL follows the name). */
export async function updateList(sql: Sql, id: number, input: ListInput): Promise<List> {
	const [current] = await sql<{ name: string; slug: string }[]>`SELECT name, slug FROM lists WHERE id = ${id}`;
	const slug = current.name === input.name ? current.slug : await freeSlug(sql, input.name, id);
	const [row] = await sql<ListRow[]>`UPDATE lists SET ${sql({ ...listColumns(input), slug })} WHERE id = ${id} RETURNING *`;
	return toList(row);
}

export async function deleteList(sql: Sql, id: number): Promise<void> {
	await sql`DELETE FROM lists WHERE id = ${id}`;
}

async function setPeople(tx: Sql, itemId: number, personIds: number[]): Promise<void> {
	await tx`DELETE FROM item_people WHERE item_id = ${itemId}`;
	if (personIds.length > 0) {
		await tx`INSERT INTO item_people ${tx(personIds.map((person_id) => ({ item_id: itemId, person_id })))} ON CONFLICT DO NOTHING`;
	}
}

export async function createItem(sql: Sql, listId: number, input: ItemInput): Promise<number> {
	return sql.begin(async (tx) => {
		const [{ id }] = await tx<{ id: number }[]>`
			INSERT INTO items (list_id, title, day, service, link, note)
			VALUES (${listId}, ${input.title}, ${input.day}, ${input.service}, ${input.link}, ${input.note})
			RETURNING id`;
		await setPeople(tx as unknown as Sql, id, input.people);
		return id;
	}) as Promise<number>;
}

export async function updateItem(sql: Sql, id: number, input: ItemInput): Promise<void> {
	await sql.begin(async (tx) => {
		await tx`
			UPDATE items SET title = ${input.title}, day = ${input.day}, service = ${input.service}, link = ${input.link},
				note = ${input.note}, updated_at = now()
			WHERE id = ${id}`;
		await setPeople(tx as unknown as Sql, id, input.people);
	});
}

/**
 * Moves an item to another list ("Movies to watch" → "Watched movies"). Fields the target does not
 * use keep their values (shown again if it is moved back); a target that uses dates gets today's
 * date when the item has none.
 */
export async function moveItem(sql: Sql, id: number, target: List, today: string): Promise<void> {
	await sql`
		UPDATE items SET list_id = ${target.id}, updated_at = now(),
			day = ${target.useDate ? sql`coalesce(day, ${today}::date)` : sql`day`}
		WHERE id = ${id}`;
}

export async function deleteItem(sql: Sql, id: number): Promise<void> {
	await sql`DELETE FROM items WHERE id = ${id}`;
}
