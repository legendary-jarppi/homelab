// Who is signed in: Cloudflare Access puts a signed JWT (Cf-Access-Jwt-Assertion) on every request it
// lets through the tunnel. Verified against the team's public keys, the issuer and the application's
// audience tag, so a request that bypassed Access (or came from another Access app) gets no identity.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from './config';

export const accessConfigured = () => config.accessTeamDomain !== '' && config.accessAud !== '';

let keys: ReturnType<typeof createRemoteJWKSet> | null = null;

/** The verified, lower-cased email, or null when the token is missing or invalid. */
export async function accessEmail(request: Request): Promise<string | null> {
	const token = request.headers.get('cf-access-jwt-assertion');
	if (!token || !accessConfigured()) return null;
	keys ??= createRemoteJWKSet(new URL(`${config.accessTeamDomain}/cdn-cgi/access/certs`));
	try {
		const { payload } = await jwtVerify(token, keys, { issuer: config.accessTeamDomain, audience: config.accessAud });
		return typeof payload.email === 'string' && payload.email.includes('@') ? payload.email.toLowerCase() : null;
	} catch (e) {
		console.warn(`rejected Access token: ${(e as Error).message}`);
		return null;
	}
}
