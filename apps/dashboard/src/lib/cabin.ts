import type { MotionItem } from './motion';
import type { CabinData } from './types';

type Snapshot = CabinData['snapshots'][number];

/** Dashboard URL of a cabin picture or clip (served by src/routes/cabin/[...path]); each path segment encoded. */
const snapshotUrl = (path: string): string => `/cabin/${path.split('/').map(encodeURIComponent).join('/')}`;

/** A clip belongs to the latest unpaired picture uploaded at most this long before it (4G uploads are slow). */
const PAIR_MS = 10 * 60_000;

/**
 * Pictures and clips (newest first) grouped into motion events, newest first: the camera sends its
 * picture at once and the clip when recording has ended. Anything unpaired stands alone.
 */
export function cabinEvents(snapshots: Snapshot[]): MotionItem[] {
	const images = snapshots.filter((s) => s.kind === 'image');
	const paired = new Set<Snapshot>();
	const events: MotionItem[] = [];
	const item = (image: Snapshot | null, video: Snapshot | null): MotionItem => ({
		key: (image ?? video)!.path,
		time: (image ?? video)!.time,
		place: 'Cabin',
		tags: [],
		seconds: null,
		image: image && snapshotUrl(image.path),
		video: video && snapshotUrl(video.path)
	});
	for (const video of snapshots.filter((s) => s.kind === 'video')) {
		const image = images.find((i) => !paired.has(i) && i.time <= video.time && video.time - i.time <= PAIR_MS) ?? null;
		if (image) paired.add(image);
		events.push(item(image, video));
	}
	for (const image of images) if (!paired.has(image)) events.push(item(image, null));
	return events.sort((a, b) => b.time - a.time);
}
