// Subscriber cookie jar: cookies stay on the outlet's own hosts and follow the outlet's Set-Cookie.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CookieJar } from '../src/lib/core/sessions.ts';

const jar = () => new CookieJar('hs.fi', CookieJar.parseHeader('sid=abc; token=t1=x'));

test('cookies go only to the outlet domain and its subdomains, over https', () => {
	const j = jar();
	assert.equal(j.header(new URL('https://www.hs.fi/a.html')), 'sid=abc; token=t1=x');
	assert.equal(j.header(new URL('https://hs.fi/')), 'sid=abc; token=t1=x');
	assert.equal(j.header(new URL('http://www.hs.fi/')), null);
	assert.equal(j.header(new URL('https://images.sanoma-sndp.fi/x.jpg')), null);
	assert.equal(j.header(new URL('https://evilhs.fi/')), null);
	assert.equal(j.header(new URL('https://www.hs.fi.evil.example/')), null);
});

test('Set-Cookie from the outlet updates and expires cookies; other domains are ignored', () => {
	const j = jar();
	const page = new URL('https://www.hs.fi/a.html');
	j.store(page, ['token=t2; Path=/; Secure; HttpOnly', 'sid=; Max-Age=0', 'new=1; Domain=.hs.fi']);
	assert.equal(j.header(page), 'token=t2; new=1');
	assert.equal(j.dirty, true);

	j.dirty = false;
	j.store(page, ['tracker=1; Domain=example.com', 'old=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT']);
	j.store(new URL('https://example.com/'), ['token=stolen']);
	assert.equal(j.header(page), 'token=t2; new=1');
	assert.equal(j.dirty, false);
});
