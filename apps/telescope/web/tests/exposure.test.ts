// R6: the integration estimate (src/lib/exposure.ts) on inputs with known answers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { integrationFor, meanSurfaceBrightness, objectRate, snrAfter, targetEstimate } from '../src/lib/exposure.ts';

const close = (actual: number, expected: number, tolerance: number) =>
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);

test('an object as bright as the sky gives the sky rate', () => {
	close(objectRate(21, 21, 0.08), 0.08, 1e-12);
	// 2.5 mag fainter: a tenth.
	close(objectRate(23.5, 21, 0.08), 0.008, 1e-12);
});

test('integration for an SNR, worked by hand', () => {
	// O = 0.1 e-/s, B = 0.1 e-/s, RN 2 e- in 100 s subs: T = 10² · (0.1 + 0.1 + 4/100) / 0.1² = 2400 s.
	const sky = { skyMag: 21, skyEps: 0.1, readNoiseE: 2, subS: 100 };
	close(integrationFor(10, 21, sky), 2400, 1e-9);
	// Without read noise only the object's and the sky's shot noise: 10² · 0.2 / 0.1² = 2000 s.
	close(integrationFor(10, 21, { ...sky, readNoiseE: 0 }), 2000, 1e-9);
	// Round trip: that integration gives the SNR.
	close(snrAfter(2400, 21, sky), 10, 1e-9);
	// Four times the time doubles the SNR (no fixed costs per sub besides read noise, which scales the same).
	close(snrAfter(9600, 21, sky), 20, 1e-9);
});

test('the measured night: SNR 10 at 23 mag/arcsec² under a 21.6 sky', () => {
	// 0.08 e-/s sky, 1.18 e- read noise, 180 s subs: O = 0.08 · 10^(−0.56) = 0.02204 e-/s,
	// T = 100 · (0.02204 + 0.08 + 1.3924/180) / 0.02204² = 22 600 s.
	const t = integrationFor(10, 23, { skyMag: 21.6, skyEps: 0.08, readNoiseE: 1.18, subS: 180 });
	close(t, 22_600, 60);
});

test('what a target has and still needs', () => {
	const night = { skyMag: 21, skyEps: 0.1, readNoiseE: 2, exposureS: 100, firstFrameAt: 1 };
	// 600 s gathered: SNR 10·√(600/2400) = 5; the rest of the 2400 s is still needed.
	const half = targetEstimate([{ ...night, integrationS: 600 }], 21, 10)!;
	close(half.snrNow, 5, 1e-9);
	close(half.totalS, 2400, 1e-9);
	close(half.moreS, 1800, 1e-6);
	// Done already.
	assert.equal(targetEstimate([{ ...night, integrationS: 3000 }], 21, 10)!.moreS, 0);
	// An unmeasured session adds nothing to the SNR but is counted.
	const mixed = targetEstimate([{ ...night, integrationS: 600 }, { integrationS: 900, firstFrameAt: 2, skyMag: null }], 21, 10)!;
	assert.equal(mixed.sessions, 1);
	assert.equal(mixed.unmeasuredS, 900);
	assert.equal(targetEstimate([{ integrationS: 900, firstFrameAt: 2 }], 21), null);
});

test('mean surface brightness of a catalog ellipse', () => {
	// 10 mag over a 1′ circle: area π/4 · 60² arcsec² = 2827 arcsec², +8.63 mag.
	close(meanSurfaceBrightness(10, 1, 1)!, 18.628, 0.001);
	// No minor axis: a circle of the major one.
	close(meanSurfaceBrightness(10, 1, null)!, 18.628, 0.001);
	assert.equal(meanSurfaceBrightness(null, 10, 5), null);
});
