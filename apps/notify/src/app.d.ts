import type { User } from '$lib/server/notify';

declare global {
	namespace App {
		interface Locals {
			/** Set on every page and /devices request (hooks.server.ts); never on /api or /healthz. */
			user: User;
		}
	}
}

export {};
