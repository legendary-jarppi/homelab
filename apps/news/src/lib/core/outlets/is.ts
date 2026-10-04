// Ilta-Sanomat (Sanoma platform, see sanoma.ts).
import { discoverSanoma, extractSanoma } from './sanoma.ts';
import type { OutletDef } from './types.ts';

export const is: OutletDef = {
	slug: 'is',
	name: 'Ilta-Sanomat',
	language: 'fi',
	homepage: 'https://www.is.fi/',
	priority: 60,
	enabledByDefault: true,
	discoveryIntervalMin: 15,
	discover: () => discoverSanoma('www.is.fi'),
	extract: (url) => extractSanoma(url, 'fi', 'is')
};
