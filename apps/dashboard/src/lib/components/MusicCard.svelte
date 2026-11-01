<script lang="ts">
	import Card from './Card.svelte';
	import type { MusicData, MusicPlayer, MusicSite } from '$lib/types';

	/** One site's BluOS players; `music` null until the first answer. `onchange` takes the server's answer to a command. */
	let { music, site, onchange }: { music: MusicData | null; site: MusicSite; onchange: (next: MusicData) => void } = $props();

	const players = $derived(music?.players.filter((p) => p.site === site) ?? []);
	/** Players playing together are one unit: the leader first, then its followers here. */
	const units = $derived.by(() => {
		const ids = new Set(players.map((p) => p.id));
		return players
			.filter((p) => !(p.leader && ids.has(p.leader)))
			.map((leader) => [leader, ...players.filter((f) => f.leader === leader.id)]);
	});
	const grouped = $derived(units.find((u) => u.length > 1) ?? null);
	const online = $derived(players.filter((p) => p.online));
	/** Grouping makes the playing player the leader (the others join its music), else the first. */
	const groupLeader = $derived(online.find((p) => p.playing) ?? online[0] ?? null);

	/** The player (or unit leader) a command is running for. */
	let busy = $state<string | null>(null);
	let problem = $state<{ id: string; text: string } | null>(null);
	/** Units with their sources and sleep timer shown, by leader id. */
	let open = $state<Record<string, boolean>>({});

	async function send(player: MusicPlayer, body: Record<string, unknown>, unit = player.id) {
		if (busy) return;
		busy = unit;
		problem = null;
		try {
			const response = await fetch(`/api/music/${encodeURIComponent(player.id)}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const answer = (await response.json().catch(() => null)) as (MusicData & { message?: string }) | null;
			if (response.ok && answer) onchange(answer);
			else problem = { id: unit, text: answer?.message ?? `Failed (${response.status}).` };
		} catch (e) {
			problem = { id: unit, text: (e as Error).message };
		} finally {
			busy = null;
		}
	}

	const atMax = (p: MusicPlayer) => !!music && p.volume >= music.maxVolume;
	function subtitle(p: MusicPlayer): string {
		if (p.state === 'connecting') return p.service ? `Connecting to ${p.service}…` : 'Connecting…';
		const detail = [p.artist, p.album].filter(Boolean).join(' · ');
		return detail || (p.title && p.service && p.service !== p.title ? p.service : '');
	}
</script>

{#snippet volume(p: MusicPlayer, unit: string, label: boolean)}
	<div class="volume" class:muted-state={p.mute}>
		{#if label}<span class="member">{p.name}</span>{/if}
		<button class="icon" aria-label={p.mute ? `Unmute ${p.name}` : `Mute ${p.name}`} aria-pressed={p.mute} disabled={busy !== null} onclick={() => send(p, { action: 'mute', mute: !p.mute }, unit)}>
			<svg viewBox="0 0 24 24">
				<path class="fill" d="M4 9h4l5-4v14l-5-4H4z" />
				{#if p.mute}<path d="M16 9l5 6M21 9l-5 6" />{:else}<path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />{/if}
			</svg>
		</button>
		<div class="stepper">
			<button aria-label={`Quieter, ${p.name}`} disabled={busy !== null || p.volume <= 0} onclick={() => send(p, { action: 'volume', step: -1 }, unit)}>−</button>
			<span class="num value" class:over={music && p.volume > music.maxVolume} title={music ? `The dashboard goes up to ${music.maxVolume}` : undefined}>{p.mute ? '–' : p.volume}</span>
			<button aria-label={`Louder, ${p.name}`} disabled={busy !== null || atMax(p)} onclick={() => send(p, { action: 'volume', step: 1 }, unit)}>+</button>
		</div>
	</div>
{/snippet}

<Card title={site === 'cabin' ? 'Cabin music' : 'Music'}>
	{#snippet accessory()}
		{#if grouped}
			<button class="pill" disabled={busy !== null} onclick={() => send(grouped[0], { action: 'ungroup' }, grouped[0].id)}>Separate</button>
		{:else if online.length > 1 && groupLeader}
			<button class="pill" disabled={busy !== null} onclick={() => send(groupLeader, { action: 'group' }, groupLeader.id)}>Play together</button>
		{/if}
	{/snippet}
	{#if !music}
		<p class="muted">Music unavailable.</p>
	{:else}
		<div class="units">
			{#each units as unit (unit[0].id)}
				{@const p = unit[0]}
				<section class="unit" class:offline={!p.online} class:busy={busy === p.id} aria-label={unit.map((m) => m.name).join(' and ')}>
					<div class="now">
						{#if p.online && p.image}
							<img src={p.image} alt="" loading="lazy" />
						{:else}
							<div class="art-empty" aria-hidden="true">
								<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12" /><circle class="fill" cx="6.5" cy="18" r="2.5" /><circle class="fill" cx="16.5" cy="16" r="2.5" /></svg>
							</div>
						{/if}
						<div class="what">
							<span class="names">{unit.map((m) => m.name).join(' + ')}</span>
							{#if !p.online}
								<span class="title muted">Off the network</span>
							{:else if p.title || p.service}
								<span class="title" class:paused={!p.playing}>{p.title || p.service}</span>
								<span class="sub">{p.playing ? subtitle(p) : ['Paused', subtitle(p)].filter(Boolean).join(' · ')}</span>
							{:else}
								<span class="title muted">Nothing playing</span>
							{/if}
						</div>
						{#if p.online}
							<button class="icon more" aria-label="Sources and sleep timer" aria-expanded={!!open[p.id]} onclick={() => (open[p.id] = !open[p.id])}>
								<svg viewBox="0 0 24 24"><circle class="fill" cx="5" cy="12" r="1.8" /><circle class="fill" cx="12" cy="12" r="1.8" /><circle class="fill" cx="19" cy="12" r="1.8" /></svg>
							</button>
						{/if}
					</div>
					{#if p.online}
						<div class="controls">
							<div class="transport">
								<button class="icon" aria-label="Back" disabled={busy !== null || !p.canBack} onclick={() => send(p, { action: 'back' })}>
									<svg viewBox="0 0 24 24"><path class="fill" d="M18 6v12l-9-6zM6 6h2v12H6z" /></svg>
								</button>
								<button class="icon play" aria-label={p.playing ? 'Pause' : 'Play'} disabled={busy !== null} onclick={() => send(p, { action: p.playing ? 'pause' : 'play' })}>
									{#if p.playing}
										<svg viewBox="0 0 24 24"><path class="fill" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
									{:else}
										<svg viewBox="0 0 24 24"><path class="fill" d="M8 5v14l11-7z" /></svg>
									{/if}
								</button>
								<button class="icon" aria-label="Skip" disabled={busy !== null || !p.canSkip} onclick={() => send(p, { action: 'skip' })}>
									<svg viewBox="0 0 24 24"><path class="fill" d="M6 6v12l9-6zM16 6h2v12h-2z" /></svg>
								</button>
							</div>
							{#if unit.length === 1}{@render volume(p, p.id, false)}{/if}
						</div>
						{#if unit.length > 1}
							{#each unit as m (m.id)}{@render volume(m, p.id, true)}{/each}
						{/if}
						{#if open[p.id]}
							<div class="extras">
								<div class="sources" role="group" aria-label="Sources">
									{#each p.sources as s (s.id)}
										<button class="chip" class:active={s.active} aria-pressed={s.active} disabled={busy !== null} onclick={() => send(p, { action: 'source', source: s.id })}>{s.label}</button>
									{/each}
								</div>
								<button class="chip" class:active={p.sleep > 0} disabled={busy !== null} onclick={() => send(p, { action: 'sleep' })}>
									{p.sleep > 0 ? `Sleep ${p.sleep} min` : 'Sleep off'}
								</button>
							</div>
						{/if}
					{/if}
					{#if problem && unit.some((m) => m.id === problem?.id)}<p class="error small">{problem.text}</p>{/if}
				</section>
			{/each}
		</div>
	{/if}
</Card>

<style>
	p {
		margin: 0;
		font-size: 14px;
	}
	.small {
		font-size: 13px;
	}
	.error {
		color: var(--bad);
	}
	.units {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 14px 24px;
	}
	.unit {
		display: grid;
		align-content: start;
		gap: 8px;
		min-width: 0;
	}
	.unit.busy {
		opacity: 0.75;
	}
	.now {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		/* Units side by side line up whether or not they have a subtitle line. */
		min-height: 58px;
	}
	img,
	.art-empty {
		flex: none;
		width: 52px;
		height: 52px;
		border-radius: 10px;
		object-fit: cover;
		background: var(--surface-strong);
	}
	.art-empty {
		display: grid;
		place-items: center;
		color: var(--faint);
	}
	.art-empty svg {
		width: 26px;
		height: 26px;
	}
	.what {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 1px;
	}
	.what span {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.names {
		font-size: 12px;
		color: var(--muted);
	}
	.title {
		font-size: 16px;
		font-weight: 650;
	}
	.title.paused,
	.offline .title {
		color: var(--muted);
	}
	.sub {
		font-size: 13px;
		color: var(--muted);
	}
	.controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
	}
	.transport,
	.volume {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.volume.muted-state .value {
		color: var(--muted);
	}
	.member {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		color: var(--muted);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	svg {
		width: 22px;
		height: 22px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	svg .fill {
		fill: currentColor;
		stroke: none;
	}
	button {
		color: var(--text);
		cursor: pointer;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		padding: 0;
		border: 0;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.08);
	}
	.icon.play {
		width: 48px;
		background: rgba(255, 255, 255, 0.16);
	}
	.icon.more {
		flex: none;
		background: transparent;
		color: var(--muted);
	}
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px;
		border-radius: 13px;
		background: rgba(255, 255, 255, 0.06);
	}
	.stepper button {
		width: 40px;
		height: 36px;
		font-size: 20px;
		font-weight: 600;
		border: 0;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.08);
	}
	.stepper .value {
		min-width: 34px;
		text-align: center;
		font-size: 16px;
		font-weight: 650;
	}
	.stepper .value.over {
		color: var(--warn);
	}
	.extras {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.sources {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip,
	.pill {
		padding: 7px 12px;
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-strong);
	}
	.chip.active {
		color: #04121c;
		background: var(--ok);
		border-color: transparent;
	}
	.pill {
		padding: 5px 12px;
		color: var(--text);
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
