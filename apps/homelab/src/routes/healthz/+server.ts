import type { RequestHandler } from './$types';

/** Liveness and readiness: the server answers (Prometheus being down is shown on the pages, not a restart). */
export const GET: RequestHandler = () => new Response('ok');
