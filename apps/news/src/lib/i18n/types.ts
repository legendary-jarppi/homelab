export const LOCALES = ['fi', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** A message: plain text, or a function of named parameters (counts, names, times). */
export type Message = string | ((params: never) => string);

/** The Finnish side of a message file: same keys, same parameters as English. */
export type Translation<T extends Record<string, Message>> = {
	[K in keyof T]: T[K] extends (params: infer P) => string ? (params: P) => string : string;
};
