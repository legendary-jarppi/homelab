// Shared by server and pages: what a list and an item are, and small display helpers.

export interface Person {
	id: number;
	name: string;
}

export type ListSort = 'date' | 'added' | 'title';

export const SORTS: { id: ListSort; label: string }[] = [
	{ id: 'date', label: 'Date' },
	{ id: 'added', label: 'Added' },
	{ id: 'title', label: 'Title' }
];

/** A list and which of the optional item fields it uses. Every item has a title. */
export interface List {
	id: number;
	slug: string;
	name: string;
	description: string;
	usePeople: boolean;
	useDate: boolean;
	/** What the date means in this list: "Watched", "Visited", … */
	dateLabel: string;
	useService: boolean;
	useLink: boolean;
	useNote: boolean;
	sort: ListSort;
	/** Items shown on the home dashboard; 0 = not shown. */
	dashboardCount: number;
}

export interface Item {
	id: number;
	listId: number;
	title: string;
	/** YYYY-MM-DD */
	day: string | null;
	service: string | null;
	link: string | null;
	note: string | null;
	/** Person ids, in the people's order. */
	people: number[];
	createdAt: string;
}

export const DASHBOARD_COUNTS = [0, 3, 5, 10] as const;

/** Offered for the service field (any text is accepted; values used before in the list are offered too). */
export const SERVICE_SUGGESTIONS = ['Netflix', 'Yle Areena', 'HBO Max', 'Disney+', 'Prime Video', 'Apple TV+', 'Viaplay', 'MTV Katsomo', 'Ruutu', 'SkyShowtime', 'Elisa Viihde', 'Cinema', 'Blu-ray / DVD'];

/** Two letters per person: "Jari" → "Ja", "Anna-Linnea" → "AL". */
export function initials(name: string): string {
	const parts = name.split(/[\s-]+/).filter(Boolean);
	if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
	return name.slice(0, 2);
}

/** One colour per person, by their position in the people list. */
const PERSON_COLORS = ['#38bdf8', '#f472b6', '#fbbf24', '#34d399', '#c084fc', '#fb923c', '#a3e635', '#22d3ee'];
export const personColor = (index: number): string => PERSON_COLORS[index % PERSON_COLORS.length];

/** "13.10.2026" for a YYYY-MM-DD day. */
export function formatDay(day: string): string {
	const [y, m, d] = day.split('-').map(Number);
	return `${d}.${m}.${y}`;
}

/** URL-safe name for a list: "Katsotut elokuvat" → "katsotut-elokuvat". */
export function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[äå]/g, 'a')
		.replace(/ö/g, 'o')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 50)
		.replace(/-+$/, '');
	return slug || 'list';
}

/** YYYY-MM-DD in the given zone. */
export function today(timeZone: string, now = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}
