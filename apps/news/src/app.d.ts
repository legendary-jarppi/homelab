import type { SessionUser } from '$lib/core/auth';
import type { Settings } from '$lib/core/prefs';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
			settings: Settings;
		}
	}
}

export {};
