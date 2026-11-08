// Validates the list and item forms into what lists.ts stores; messages are shown above the form.
import { canonicalService, DASHBOARD_COUNTS, OTHER_SERVICE, SORTS, type List, type ListSort, type Person } from '$lib/domain';
import type { ItemInput, ListInput } from './lists';

export class FormError extends Error {}

const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();
const optional = (form: FormData, name: string): string | null => text(form, name) || null;

export function parseList(form: FormData): ListInput {
	const name = text(form, 'name').replace(/\s+/g, ' ');
	if (!name) throw new FormError('Give the list a name.');
	if (name.length > 80) throw new FormError('The name can be at most 80 characters.');
	const description = text(form, 'description');
	if (description.length > 500) throw new FormError('The description can be at most 500 characters.');
	const useDate = form.get('useDate') === 'on';
	const dateLabel = text(form, 'dateLabel') || 'Date';
	if (dateLabel.length > 30) throw new FormError('The date label can be at most 30 characters.');
	const sort = text(form, 'sort') as ListSort;
	if (!SORTS.some((s) => s.id === sort)) throw new FormError('Choose an order.');
	const dashboardCount = Number(text(form, 'dashboardCount') || 0);
	if (!(DASHBOARD_COUNTS as readonly number[]).includes(dashboardCount)) throw new FormError('Choose how many items to show on the dashboard.');
	return {
		name,
		description,
		usePeople: form.get('usePeople') === 'on',
		useDate,
		dateLabel,
		useService: form.get('useService') === 'on',
		useLink: form.get('useLink') === 'on',
		useNote: form.get('useNote') === 'on',
		// Ordering by date in a list without dates would order by nothing.
		sort: sort === 'date' && !useDate ? 'added' : sort,
		dashboardCount
	};
}

/** An item for `list`: fields the list does not use are left empty. */
export function parseItem(form: FormData, list: List, everyone: Person[]): ItemInput {
	const title = text(form, 'title').replace(/\s+/g, ' ');
	if (!title) throw new FormError('Give the item a title.');
	if (title.length > 200) throw new FormError('The title can be at most 200 characters.');

	let day: string | null = null;
	if (list.useDate) {
		day = optional(form, 'day');
		if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new FormError('The date is not valid.');
	}
	let service: string | null = null;
	if (list.useService) {
		const chosen = optional(form, 'service');
		const typed = chosen === OTHER_SERVICE ? optional(form, 'otherService') : chosen;
		service = typed && canonicalService(typed);
		if (service && service.length > 60) throw new FormError('The service can be at most 60 characters.');
	}
	let link: string | null = null;
	if (list.useLink) {
		link = optional(form, 'link');
		if (link) {
			// Pasted addresses without a scheme ("www.netflix.com/…") still work.
			if (!/^https?:\/\//i.test(link)) link = `https://${link}`;
			try {
				new URL(link);
			} catch {
				throw new FormError('The link is not a web address.');
			}
			if (link.length > 2000) throw new FormError('The link is too long.');
		}
	}
	let note: string | null = null;
	if (list.useNote) {
		note = optional(form, 'note');
		if (note && note.length > 2000) throw new FormError('The note can be at most 2000 characters.');
	}
	const ids = new Set(everyone.map((p) => p.id));
	const people = list.usePeople
		? form
				.getAll('people')
				.map(Number)
				.filter((id) => ids.has(id))
		: [];
	return { title, day, service, link, note, people };
}
