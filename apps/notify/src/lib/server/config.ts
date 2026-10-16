import { env } from '$env/dynamic/private';

export const config = {
	migrationsDir: env.MIGRATIONS_DIR ?? 'migrations',
	/** Cloudflare Access team domain, e.g. https://homelab.cloudflareaccess.com (issuer and certificate host). */
	accessTeamDomain: (env.ACCESS_TEAM_DOMAIN ?? '').replace(/\/+$/, ''),
	/** The Access application's audience (AUD) tag. */
	accessAud: env.ACCESS_AUD ?? '',
	/** VAPID key pair (base64url, as `web-push generate-vapid-keys` prints) and contact (mailto: or https:). */
	vapidPublicKey: env.VAPID_PUBLIC_KEY ?? '',
	vapidPrivateKey: env.VAPID_PRIVATE_KEY ?? '',
	vapidSubject: env.VAPID_SUBJECT ?? '',
	/** Topics people can choose (JSON array, deploy/topics.json). */
	topicsFile: env.TOPICS_FILE ?? 'deploy/topics.json',
	/** One file per sending app: file name = sender name, content = its bearer token (secret notify-senders). */
	sendersDir: env.SENDERS_DIR ?? '.senders',
	/** Sent messages are kept this many days. */
	historyDays: Number(env.HISTORY_DAYS ?? 90)
};
