import { env } from '$env/dynamic/private';

export const config = {
	passcode: env.PASSCODE ?? '',
	/** "Today" (default entry date, current week) is taken in this zone. */
	timeZone: env.TIME_ZONE ?? 'Europe/Helsinki',
	migrationsDir: env.MIGRATIONS_DIR ?? 'migrations',
	/** Bearer token for /api/summary (the home dashboard); the endpoint is off when unset. */
	summaryToken: env.SUMMARY_TOKEN ?? ''
};
