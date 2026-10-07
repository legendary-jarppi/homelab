import { today } from '$lib/domain';
import { config } from '$lib/server/config';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => ({ today: today(config.timeZone) });
