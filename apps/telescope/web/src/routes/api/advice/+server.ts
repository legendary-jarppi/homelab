import { json } from '@sveltejs/kit';
import { adviceReport } from '$lib/server/advice';
import type { RequestHandler } from './$types';

/** R6: focus advice and calibration reminders (built here, at most 10 min old). */
export const GET: RequestHandler = async () => json(await adviceReport());
