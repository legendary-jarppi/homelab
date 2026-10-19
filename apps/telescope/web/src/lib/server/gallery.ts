// D4: the gallery assembled on the server from the processor's finals, the service's uploads and sessions. In
// public mode only published pictures (and targets that have one) leave the server, without the uploads'
// original files or links to the session reports.
import { error } from '@sveltejs/kit';
import { findDso, formatSize, typeLabel } from '$lib/catalog';
import type { GalleryEntry, GalleryTarget, GalleryTargetPage } from '$lib/gallery';
import { sessionKey, targetKey } from '$lib/goals';
import type { Final, SessionDetail, SessionSummary, Upload } from '$lib/types';
import { TARGET, upstreamJson } from './telescope';

/** Checked fields of a gallery change (`PUT /api/finals/<id>`, `/api/uploads/<id>`): the given ones only. */
export function galleryPatch(body: Record<string, unknown>, upload: boolean): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	for (const [field, value] of Object.entries(body)) {
		if (field === 'published') {
			if (typeof value !== 'boolean') error(400, 'published must be true or false');
		} else if (field === 'title') {
			if (value !== null && (typeof value !== 'string' || value.length > 200)) error(400, 'title must be text (at most 200 characters) or null');
		} else if (field === 'note') {
			if (value !== null && (typeof value !== 'string' || value.length > 2000)) error(400, 'note must be text (at most 2000 characters) or null');
		} else if (upload && field === 'target') {
			if (typeof value !== 'string' || !TARGET.test(value)) error(400, 'target must be a target name');
		} else if (upload && field === 'takenAt') {
			if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 4e9)) error(400, 'takenAt must be unix seconds or null');
		} else error(400, `Unknown field ${field}`);
		patch[field] = value;
	}
	return patch;
}

interface Sources {
	finals: Final[] | null;
	uploads: Upload[] | null;
	sessions: SessionSummary[];
}

async function sources(): Promise<Sources> {
	const [finals, uploads, sessions] = await Promise.all([
		upstreamJson<Final[]>('/api/finals', 'processor'),
		upstreamJson<Upload[]>('/api/uploads', 'telescope'),
		upstreamJson<SessionSummary[]>('/api/sessions', 'telescope')
	]);
	return { finals, uploads, sessions: sessions ?? [] };
}

/** Group key of a target name: the key its sessions have (catalog object by name or position), else by name alone. */
function keyer(sessions: SessionSummary[]): (name: string) => string {
	const byName = new Map(sessions.map((s) => [s.target, sessionKey(s)]));
	return (name) => byName.get(name) ?? targetKey(findDso(name)?.id ?? name);
}

/** The targets with pictures (in public mode published ones); `imaged`, a key, is included without pictures when it has sessions (lab). */
function build({ finals, uploads, sessions }: Sources, publicMode: boolean, imaged?: string): GalleryTarget[] {
	const keyOf = keyer(sessions);
	const targets = new Map<string, GalleryTarget>();
	const target = (key: string, name: string): GalleryTarget => {
		let t = targets.get(key);
		if (!t) {
			const dso = findDso(key) ?? findDso(name);
			t = {
				key,
				label: dso ? [dso.id, ...dso.names.slice(0, 1)].join(' · ') : name,
				kind: dso ? typeLabel(dso.type) : null,
				constellation: dso?.con || null,
				size: dso?.maj ? `${formatSize(dso.maj)}${dso.min ? ` × ${formatSize(dso.min)}` : ''}` : null,
				entries: [],
				integrationS: 0,
				nights: [],
				sessions: 0,
				lastAt: 0
			};
			targets.set(key, t);
		}
		return t;
	};

	// Finals that produced a picture, numbered per target oldest first (versions as the integration grows).
	const done = (finals ?? []).filter((f) => f.status === 'done' && (f.outputs.fullJpg || f.outputs.previewJpg)).sort((a, b) => (a.finishedAt ?? a.createdAt) - (b.finishedAt ?? b.createdAt));
	const versions = new Map<string, number>();
	for (const f of done) {
		const key = keyOf(f.target);
		const version = (versions.get(key) ?? 0) + 1;
		versions.set(key, version);
		if (publicMode && f.published !== true) continue;
		target(key, f.target).entries.push({
			kind: 'final',
			id: f.id,
			target: f.target,
			title: f.title ?? null,
			note: f.note ?? null,
			published: f.published === true,
			at: f.finishedAt ?? f.createdAt,
			takenAt: null,
			url: f.outputs.fullJpg ?? f.outputs.previewJpg!,
			smallUrl: f.outputs.previewSmallJpg ?? f.outputs.previewJpg!,
			frames: f.frames,
			integrationS: f.integrationS,
			nights: f.nights,
			version,
			original: null
		});
	}
	for (const u of uploads ?? []) {
		if (publicMode && u.published !== true) continue;
		target(keyOf(u.target), u.target).entries.push({
			kind: 'upload',
			id: u.id,
			target: u.target,
			title: u.title,
			note: u.note,
			published: u.published === true,
			at: u.createdAt,
			takenAt: u.takenAt,
			url: u.url,
			smallUrl: u.smallUrl,
			frames: null,
			integrationS: null,
			nights: [],
			version: null,
			original: publicMode ? null : u.original
		});
	}
	if (imaged) {
		const imagedSession = sessions.find((s) => sessionKey(s) === imaged);
		if (imagedSession) target(imaged, imagedSession.target);
	}
	// Integration and nights of every session of a target in the gallery.
	for (const s of sessions) {
		const t = targets.get(sessionKey(s));
		if (!t) continue;
		t.integrationS += s.integrationS;
		t.sessions++;
		if (!t.nights.includes(s.night)) t.nights.push(s.night);
	}
	for (const t of targets.values()) {
		t.entries.sort((a, b) => (b.takenAt ?? b.at) - (a.takenAt ?? a.at));
		t.nights.sort();
		t.lastAt = Math.max(0, ...t.entries.map((e) => e.takenAt ?? e.at));
	}
	return [...targets.values()].sort((a, b) => b.lastAt - a.lastAt);
}

/** In the lab: what could not be asked, and the session target names for the upload form. */
function context(s: Sources, publicMode: boolean): { problems: string[]; targetNames: string[] } {
	if (publicMode) return { problems: [], targetNames: [] };
	return {
		problems: [...(s.finals ? [] : ['Final stacks unavailable (processor).']), ...(s.uploads ? [] : ['Own images unavailable (telescope service).'])],
		targetNames: [...new Set(s.sessions.map((x) => x.target))]
	};
}

/** Every target with a picture, the most recent first. */
export async function loadGallery(publicMode: boolean): Promise<{ targets: GalleryTarget[]; problems: string[]; targetNames: string[] }> {
	const s = await sources();
	return { targets: build(s, publicMode), ...context(s, publicMode) };
}

/**
 * One target by its key (or by a target name, which is turned into its key), with its sessions' equipment;
 * 404 when it has no pictures (public mode: no published ones) and, in the lab, no sessions either (a target
 * imaged but without pictures yet still has a page, to take uploads).
 */
export async function loadGalleryTarget(param: string, publicMode: boolean): Promise<{ target: GalleryTargetPage; problems: string[]; targetNames: string[] }> {
	const s = await sources();
	const byKey = build(s, publicMode).some((t) => t.key === param);
	const key = byKey ? param : keyer(s.sessions)(param);
	const t = build(s, publicMode, publicMode ? undefined : key).find((x) => x.key === key);
	if (!t) error(404, 'No pictures of this target');
	const sessions = s.sessions.filter((x) => sessionKey(x) === key);
	// Equipment from the newest sessions' reports (camera and focal length are not in the list).
	const details = (await Promise.all(sessions.slice(0, 20).map((x) => upstreamJson<SessionDetail>(`/api/sessions/${encodeURIComponent(x.id)}`, 'telescope')))).filter((d): d is SessionDetail => d !== null);
	const equipment = [...new Set(details.map((d) => [d.camera, d.focalLengthMm ? `${Math.round(d.focalLengthMm)} mm` : null].filter(Boolean).join(' · ')).filter(Boolean))];
	const exposures = [...new Set(sessions.filter((x) => x.exposureS).map((x) => `${x.exposureS} s${x.gain !== null && x.gain !== undefined ? ` at gain ${x.gain}` : ''}`))];
	return {
		target: { ...t, equipment, exposures, sessionLinks: publicMode ? null : sessions.map((x) => ({ id: x.id, night: x.night, integrationS: x.integrationS })) },
		...context(s, publicMode)
	};
}
