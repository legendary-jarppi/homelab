/** Dashboard URL of a cabin snapshot (served by src/routes/cabin/[...path]); each path segment encoded. */
export const snapshotUrl = (path: string): string => `/cabin/${path.split('/').map(encodeURIComponent).join('/')}`;
