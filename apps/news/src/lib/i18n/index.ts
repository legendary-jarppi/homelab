// Interface language. Only the interface is translated (navigation, labels, settings, taxonomy
// names, dates); articles, headlines and summaries stay in the language they were written in.
//
// Components: `const i = useI18n();` then `i.t('key')`, `i.when(date)`, `i.section(key)`.
// Server code: `i18n(locals.locale)`.
import { getContext, setContext } from 'svelte';
import { PRESETS, SECTIONS, SENSITIVITY_FAMILIES, SENSITIVITY_TAGS, THRESHOLDS, TOPIC_FAMILIES, TOPICS, type Threshold } from '../core/taxonomy';
import { dateFormat, type DateFormat } from './format';
import account from './messages/account';
import reader from './messages/reader';
import { PRESETS_FI, SECTIONS_FI, SENSITIVITY_FAMILIES_FI, TAGS_FI, THRESHOLDS_FI, TOPIC_FAMILIES_FI, TOPICS_FI } from './taxonomy';
import { LOCALES, type Locale } from './types';

export { LOCALES, type Locale };

const MESSAGES = {
	en: { ...reader.en, ...account.en },
	fi: { ...reader.fi, ...account.fi }
};

type Messages = (typeof MESSAGES)['en'];
export type MessageKey = keyof Messages;
type Args<K extends MessageKey> = Messages[K] extends (params: infer P) => string ? [params: P] : [];

interface Labelled {
	label: string;
	description: string;
}

export interface I18n extends DateFormat {
	locale: Locale;
	t<K extends MessageKey>(key: K, ...args: Args<K>): string;
	section(key: string): string;
	topic(key: string): Labelled;
	topicFamily(key: string): string;
	sensitivityFamily(key: string): Labelled;
	tag(key: string): Labelled;
	threshold(value: Threshold): { label: string; hint: string };
	preset(key: string): Labelled;
}

const byKey = <T extends { key: string }>(list: T[]) => new Map(list.map((x) => [x.key, x]));
const SECTION_EN = byKey(SECTIONS);
const TOPIC_EN = byKey(TOPICS);
const TOPIC_FAMILY_EN = byKey(TOPIC_FAMILIES);
const FAMILY_EN = byKey(SENSITIVITY_FAMILIES);
const TAG_EN = byKey(SENSITIVITY_TAGS);
const PRESET_EN = byKey(PRESETS);
const THRESHOLD_EN = new Map(THRESHOLDS.map((t) => [t.value, t]));
const pick = (x: Labelled | undefined, key: string): Labelled => ({ label: x?.label ?? key, description: x?.description ?? '' });

function build(locale: Locale): I18n {
	const messages = MESSAGES[locale] as Record<string, string | ((p: unknown) => string)>;
	const fi = locale === 'fi';
	return {
		locale,
		...dateFormat(locale),
		t(key, ...args) {
			const m = messages[key];
			return typeof m === 'function' ? m(args[0]) : m;
		},
		section: (key) => (fi ? SECTIONS_FI[key] : undefined) ?? SECTION_EN.get(key)?.label ?? key,
		topic: (key) => pick((fi ? TOPICS_FI[key] : undefined) ?? TOPIC_EN.get(key), key),
		topicFamily: (key) => (fi ? TOPIC_FAMILIES_FI[key] : undefined) ?? TOPIC_FAMILY_EN.get(key)?.label ?? key,
		sensitivityFamily: (key) => pick((fi ? SENSITIVITY_FAMILIES_FI[key] : undefined) ?? FAMILY_EN.get(key), key),
		tag: (key) => pick((fi ? TAGS_FI[key] : undefined) ?? TAG_EN.get(key), key),
		threshold(value) {
			const t = (fi ? (THRESHOLDS_FI as Record<string, { label: string; hint: string }>)[value] : undefined) ?? THRESHOLD_EN.get(value);
			return { label: t?.label ?? value, hint: t?.hint ?? '' };
		},
		preset: (key) => pick((fi ? PRESETS_FI[key] : undefined) ?? PRESET_EN.get(key), key)
	};
}

const INSTANCES: Record<Locale, I18n> = { fi: build('fi'), en: build('en') };

export function i18n(locale: Locale): I18n {
	return INSTANCES[locale];
}

/**
 * The reader's choice (Settings → Language), else the browser's: English when the browser lists
 * English before Finnish, otherwise Finnish (the paper is mostly Finnish).
 */
export function resolveLocale(setting: Locale | null | undefined, acceptLanguage: string | null): Locale {
	if (setting) return setting;
	const wanted = (acceptLanguage ?? '')
		.split(',')
		.map((part, index) => {
			const [tag, ...params] = part.trim().toLowerCase().split(';');
			const q = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? 1);
			return { lang: tag.split('-')[0], q: Number.isFinite(q) ? q : 0, index };
		})
		.filter((x) => x.lang === 'fi' || x.lang === 'en')
		.sort((a, b) => b.q - a.q || a.index - b.index);
	return wanted[0]?.lang === 'en' ? 'en' : 'fi';
}

const KEY = Symbol('i18n');

/** Root layout: makes the current interface language available to every component. */
export function setI18n(locale: () => Locale): void {
	setContext(KEY, locale);
}

/** Reads the language at use, so a change in Settings re-renders without a reload. */
export function useI18n(): I18n {
	const locale = getContext<(() => Locale) | undefined>(KEY) ?? (() => 'fi' as const);
	return new Proxy({} as I18n, { get: (_, prop) => INSTANCES[locale()][prop as keyof I18n] });
}
