<script lang="ts">
	import AreaChart from './AreaChart.svelte';
	import Card from './Card.svelte';
	import Meter from './Meter.svelte';
	import { backupProblem } from '$lib/backup';
	import { formatAgo, formatBytes, formatDuration } from '$lib/format';
	import { night } from '$lib/night.svelte';
	import type { SlowData } from '$lib/types';

	let { homelab }: { homelab: SlowData['homelab'] } = $props();

	const backupIssue = $derived(backupProblem(homelab.backup, night.now.getTime()));

	const problems = $derived(
		[
			homelab.pods.problem > 0 && `${homelab.pods.problem} pod${homelab.pods.problem === 1 ? '' : 's'} not ready`,
			homelab.targetsDown > 0 && `${homelab.targetsDown} metric source${homelab.targetsDown === 1 ? '' : 's'} down`,
			backupIssue
		].filter(Boolean) as string[]
	);
</script>

<Card title="Homelab">
	{#snippet accessory()}
		<span class="state" class:bad={problems.length > 0}><i></i>{problems.length > 0 ? problems.join(' · ') : 'All normal'}</span>
	{/snippet}
	<div class="layout">
		<div class="cpu">
			<div class="row">
				<span class="muted">CPU · 1 h</span>
				<span class="num strong">{homelab.cpu === null ? '–' : `${Math.round(homelab.cpu * 100)}%`}</span>
			</div>
			<AreaChart height={48} fixedMax={1} series={[{ id: 'cpu', points: homelab.cpuHistory, color: '#34d399' }]} />
		</div>
		<div class="meters">
			<Meter label="Memory" value={homelab.memory} />
			{#each homelab.disks as disk (disk.mount)}
				<Meter label="Disk {disk.mount}" value={disk.used} detail="of {formatBytes(disk.sizeBytes)}" />
			{/each}
		</div>
	</div>
	<div class="facts num">
		<div><span class="big">{homelab.pods.running}</span><span class="muted">pods running</span></div>
		<div><span class="big">{homelab.pods.restarts1h}</span><span class="muted">restarts 1 h</span></div>
		<div><span class="big">{formatDuration(homelab.uptimeS)}</span><span class="muted">uptime</span></div>
		<div>
			<span class="big" class:warn={backupIssue !== null}>
				{homelab.backup.running ? 'running' : homelab.backup.lastSuccess === null ? '–' : formatAgo(homelab.backup.lastSuccess, night.now.getTime())}
			</span>
			<span class="muted">last backup</span>
		</div>
	</div>
</Card>

<style>
	.state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ok);
		text-align: right;
	}
	.state.bad {
		color: var(--warn);
	}
	.state i {
		width: 7px;
		height: 7px;
		flex: none;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 8px currentColor;
	}
	.layout {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 18px;
	}
	.cpu {
		display: grid;
		gap: 6px;
		align-content: start;
	}
	.row {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
	}
	.strong {
		font-weight: 600;
	}
	.meters {
		display: grid;
		gap: 9px;
		align-content: start;
	}
	.facts {
		margin-top: auto;
		display: grid;
		grid-template-columns: repeat(4, auto);
		justify-content: space-between;
		gap: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--border);
	}
	.facts div {
		display: grid;
	}
	.big {
		font-size: 19px;
		font-weight: 650;
		white-space: nowrap;
	}
	.big.warn {
		color: var(--warn);
	}
	.facts .muted {
		font-size: 11px;
	}
	@media (max-width: 520px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}
</style>
