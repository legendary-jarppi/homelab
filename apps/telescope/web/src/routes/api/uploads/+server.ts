import { error } from '@sveltejs/kit';
import { proxyJson, proxyUpload } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** D4: the owner's own processed images, newest first. */
export const GET: RequestHandler = () => proxyJson('/api/uploads');

/** The service's limit for the file, and room for the form's other fields and boundaries. */
const MAX_BYTES = 300 * 1024 * 1024 + 1024 * 1024;

/**
 * Upload an own processed image: multipart `file`, `target`, `title`, `note`, `takenAt?` (JPEG, PNG, TIFF or
 * FITS, at most 300 MB), streamed through to the service as it comes (no buffering here), which converts it.
 * A cross-site form cannot post here: SvelteKit refuses form posts from another origin.
 */
export const POST: RequestHandler = ({ request }) => {
	if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) error(415, 'multipart/form-data expected');
	const length = Number(request.headers.get('content-length'));
	if (!request.headers.has('content-length') || !Number.isFinite(length)) error(411, 'Content-Length required');
	if (length > MAX_BYTES) error(413, 'At most 300 MB');
	return proxyUpload('/api/uploads', request, length);
};
