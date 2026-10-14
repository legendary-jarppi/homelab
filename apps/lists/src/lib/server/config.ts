import { env } from '$env/dynamic/private';

export const config = {
	passcode: env.PASSCODE ?? '',
	/** "Today" (default date of new items) is taken in this zone. */
	timeZone: env.TIME_ZONE ?? 'Europe/Helsinki',
	migrationsDir: env.MIGRATIONS_DIR ?? 'migrations',
	/** Bearer token for /api/dashboard (the home dashboard); the endpoint is off when unset. */
	dashboardToken: env.DASHBOARD_TOKEN ?? ''
};
