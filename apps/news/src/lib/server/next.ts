/** Same-origin path to return to after signing in; anything else goes to the front page. */
export function safeNext(raw: string | null, origin: string): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
	try {
		const target = new URL(raw, origin);
		return target.origin === origin ? target.pathname + target.search : '/';
	} catch {
		return '/';
	}
}
