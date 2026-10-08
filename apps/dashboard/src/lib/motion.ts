import type { ProtectData } from './types';

/** One motion event as the Cameras tab shows it: the cabin camera's uploads or a UniFi Protect event. */
export interface MotionItem {
	key: string;
	/** Start, unix ms. */
	time: number;
	/** Camera label: "Cabin", "Front door". */
	place: string;
	/** Smart detections ("person", "vehicle", …); empty for plain motion. */
	tags: string[];
	/** Clip length in seconds when known before playing it (Protect). */
	seconds: number | null;
	/** Picture and clip URLs on the dashboard. */
	image: string | null;
	video: string | null;
}

const TAG_LABELS: Record<string, string> = { person: 'Person', vehicle: 'Vehicle', animal: 'Animal', package: 'Package', licensePlate: 'Plate', face: 'Face' };
export const tagLabel = (tag: string): string => TAG_LABELS[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1);

/** "0:13", "1:05" */
export const clipLength = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** Protect's events (newest first) with their camera labels, thumbnails and clips (src/routes/cameras/events). */
export function protectItems(data: ProtectData): MotionItem[] {
	const labels = new Map(data.cameras.map((c) => [c.id, c.label]));
	return data.events.map((e) => ({
		key: e.id,
		time: e.start,
		place: labels.get(e.camera) ?? 'Camera',
		tags: e.types,
		seconds: (e.end - e.start) / 1000,
		image: `/cameras/events/${e.id}/thumbnail`,
		video: `/cameras/events/${e.id}/clip`
	}));
}
