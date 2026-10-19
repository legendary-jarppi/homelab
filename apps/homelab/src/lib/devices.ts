import { COMPONENTS, NODES, SITES, type ArchitectureData, type Device, type DiagramGroup, type DiagramNode, type EdgeKind, type NetworkClient, type SiteId, type Tone } from './architecture';
import { formatDuration } from './format';

export interface DeviceRow {
	node: DiagramNode;
	group: DiagramGroup;
	device: Device;
	/** The Components diagram's edges to and from it: who talks to it, and how. */
	connections: { id: string; label: string; group: string; via: string; kind: EdgeKind; outgoing: boolean }[];
}

/** Every device of the model (components with `device`), home first, planned ones last within a site. */
export const DEVICES: DeviceRow[] = COMPONENTS.groups
	.flatMap((group) =>
		group.nodes.flatMap((node) => {
			if (!node.device) return [];
			const connections = COMPONENTS.edges
				.filter((e) => e.from === node.id || e.to === node.id)
				.map((e) => {
					const outgoing = e.from === node.id;
					const other = NODES.get(outgoing ? e.to : e.from);
					return { id: other?.node.id ?? '', label: other?.node.label ?? '', group: other?.group.label ?? '', via: e.label, kind: e.kind, outgoing };
				});
			return [{ node, group, device: node.device, connections }];
		})
	)
	.sort((a, b) => Object.keys(SITES).indexOf(a.device.site) - Object.keys(SITES).indexOf(b.device.site) || Number(!!a.device.planned) - Number(!!b.device.planned));

export type CheckTone = Tone | 'unknown';

export interface CheckResult {
	label: string;
	tone: CheckTone;
	text: string;
}

/** The UniFi client a device is known by, if it is connected now. */
export function clientOf(device: Device, data: ArchitectureData | null): NetworkClient | undefined {
	const c = device.client;
	if (!c || !data) return undefined;
	return data.clients.find((x) => x.site === device.site && ('mac' in c ? x.mac.toLowerCase() === c.mac.toLowerCase() : x.ip === c.ip));
}

/** A device's live checks: network presence (UniFi, when the model knows its MAC or IP) and its service checks. */
export function deviceChecks(device: Device, data: ArchitectureData | null): CheckResult[] {
	if (device.planned || !data) return [];
	const results: CheckResult[] = [];
	if (device.client) {
		const client = clientOf(device, data);
		const site = SITES[device.site].label.toLowerCase();
		if (client) {
			results.push({ label: 'On the network', tone: 'ok', text: `${client.wired ? 'wired' : 'Wi-Fi'}, ${client.via} · connected ${formatDuration(client.uptimeS)}` });
		} else if (data.consoles[device.site]) {
			results.push({ label: 'On the network', tone: 'bad', text: `not connected to the ${site} network` });
		} else {
			results.push({ label: 'On the network', tone: 'unknown', text: `no data from the ${site} UniFi console` });
		}
	}
	for (const check of device.checks ?? []) {
		const value = data.checks[check.expr];
		results.push({ label: check.label, tone: value === undefined ? 'unknown' : value === 1 ? 'ok' : 'bad', text: value === undefined ? 'no data' : value === 1 ? 'yes' : 'no' });
	}
	return results;
}

/** One word for a device: planned, or how its checks look together. */
export function deviceTone(device: Device, checks: CheckResult[]): { tone: CheckTone | 'planned'; text: string } {
	if (device.planned) return { tone: 'planned', text: 'Planned' };
	const known = checks.filter((c) => c.tone !== 'unknown');
	if (checks.length === 0) return { tone: 'unknown', text: 'No status source' };
	if (known.length === 0) return { tone: 'unknown', text: 'Unknown' };
	if (known.every((c) => c.tone === 'ok')) return { tone: 'ok', text: known.length < checks.length ? 'OK (partly unknown)' : 'OK' };
	if (known.every((c) => c.tone === 'bad')) return { tone: 'bad', text: 'Down' };
	return { tone: 'warn', text: 'Partly down' };
}

/** Clients on the networks that no device of the model claims, per site, by name. */
export function otherClients(data: ArchitectureData | null): Record<SiteId, NetworkClient[]> {
	const claimed = new Set(DEVICES.flatMap(({ device: { site, client } }) => (client ? [`${site}/${'mac' in client ? client.mac.toLowerCase() : client.ip}`] : [])));
	const others = (data?.clients ?? [])
		.filter((c) => !claimed.has(`${c.site}/${c.mac.toLowerCase()}`) && !claimed.has(`${c.site}/${c.ip}`))
		.sort((a, b) => a.name.localeCompare(b.name));
	return { home: others.filter((c) => c.site === 'home'), cabin: others.filter((c) => c.site === 'cabin') };
}
