import { db } from '$lib/core/db';
import { pipelineStats } from '$lib/server/admin';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => pipelineStats(db());
