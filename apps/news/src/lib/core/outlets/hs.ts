// Helsingin Sanomat: free and metered articles only (Sanoma platform, see sanoma.ts).
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
	extract: (url) => extractSanoma(url, 'fi')
};
