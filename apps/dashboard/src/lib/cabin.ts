import type { CabinData } from './types';

type Snapshot = CabinData['snapshots'][number];

/** Dashboard URL of a cabin picture or clip (served by src/routes/cabin/[...path]); each path segment encoded. */
export const snapshotUrl = (path: string): string => `/cabin/${path.split('/').map(encodeURIComponent).join('/')}`;

/** One motion event: the camera sends its picture at once and the clip when recording has ended. */
export interface CabinEvent {
	time: number;
	image: Snapshot | null;
	video: Snapshot | null;
}

/** A clip belongs to the latest unpaired picture uploaded at most this long before it (4G uploads are slow). */
const PAIR_MS = 10 * 60_000;

/** Pictures and clips (newest first) grouped into events, newest first; anything unpaired stands alone. */
export function cabinEvents(snapshots: Snapshot[]): CabinEvent[] {
	const images = snapshots.filter((s) => s.kind === 'image');
	const paired = new Set<Snapshot>();
	const events: CabinEvent[] = [];
	for (const video of snapshots.filter((s) => s.kind === 'video')) {
		const image = images.find((i) => !paired.has(i) && i.time <= video.time && video.time - i.time <= PAIR_MS) ?? null;
		if (image) paired.add(image);
		events.push({ time: image?.time ?? video.time, image, video });
	}
	for (const image of images) if (!paired.has(image)) events.push({ time: image.time, image, video: null });
	return events.sort((a, b) => b.time - a.time);
}
