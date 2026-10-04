// Helsingin Sanomat (Sanoma platform, see sanoma.ts): free and metered articles, and paid ones
// with a subscriber session (COOKIES_HS).
import { discoverSanoma, extractSanoma } from './sanoma.ts';
import type { OutletDef } from './types.ts';

export const hs: OutletDef = {
	slug: 'hs',
	name: 'Helsingin Sanomat',
	language: 'fi',
	homepage: 'https://www.hs.fi/',
	priority: 70,
	enabledByDefault: true,
	discoveryIntervalMin: 15,
	discover: () => discoverSanoma('www.hs.fi'),
	extract: (url) => extractSanoma(url, 'fi', 'hs')
};
