// D4: the gallery's shape, shared by its server loads ($lib/server/gallery.ts) and pages. A target's pictures are
// the app's final stacks (the processor) and the owner's own processed images (uploads to the service),
// grouped like the goals: by catalog object, else by the ASIAIR target name.
import type { Upload } from './types';

export interface GalleryEntry {
	kind: 'final' | 'upload';
	id: string;
	/** As given: a final's ASIAIR target name, an upload's chosen target. */
	target: string;
	title: string | null;
	note: string | null;
	published: boolean;
	/** When it was made, unix s: a final's finish, an upload's arrival. */
	at: number;
	/** An upload's own date of the data, when given. */
	takenAt: number | null;
	/** Full-resolution picture and thumbnail. */
	url: string;
	smallUrl: string;
	/** Finals: frames, integration and nights stacked, and its version (1 = the target's first final). */
	frames: number | null;
	integrationS: number | null;
	nights: string[];
	version: number | null;
	/** Uploads, lab only: the original file. */
	original: Upload['original'] | null;
}

export interface GalleryTarget {
	/** The goal key: catalog id, else the target name; `/gallery/<key>`. */
	key: string;
	/** "M 45 · Pleiades" or the target name. */
	label: string;
	/** Catalog type ("Open cluster"), constellation and size, when it is a catalog object. */
	kind: string | null;
	constellation: string | null;
	size: string | null;
	/** Newest first. */
	entries: GalleryEntry[];
	/** Accepted integration and nights over every session of the target. */
	integrationS: number;
	nights: string[];
	sessions: number;
	lastAt: number;
}

/** A target's page with its sessions' equipment (and in the lab, links to the session reports). */
export interface GalleryTargetPage extends GalleryTarget {
	equipment: string[];
	exposures: string[];
	sessionLinks: { id: string; night: string; integrationS: number }[] | null;
}

/** `/gallery/<key>`. */
export const galleryHref = (key: string) => `/gallery/${encodeURIComponent(key)}`;

/** What to call an entry: its title, else "Final stack v3" or "Own processing". */
export const entryTitle = (e: GalleryEntry) => e.title ?? (e.kind === 'final' ? `Final stack${e.version ? ` v${e.version}` : ''}` : 'Own processing');
