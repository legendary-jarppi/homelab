import type { SessionUser } from '$lib/core/auth';
import type { Settings } from '$lib/core/prefs';
import type { Locale } from '$lib/i18n/types';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
			settings: Settings;
			/** Interface language (settings, else the browser's Accept-Language). */
			locale: Locale;
		}
	}
}

export {};
