<script lang="ts" generics="T extends string">
	/** A tab's sub-views (Cameras: Live | Detections; Homelab: Status | Components | Network), styled like the top bar's tabs. */
	let {
		options,
		value = $bindable(),
		label
	}: {
		/** `count`: shown as a badge when above 0. */
		options: { id: T; label: string; count?: number }[];
		value: T;
		label: string;
	} = $props();
</script>

<div class="views" role="tablist" aria-label={label}>
	{#each options as o (o.id)}
		<button role="tab" aria-selected={value === o.id} class:active={value === o.id} onclick={() => (value = o.id)}>
			{o.label}{#if o.count}<span class="count num" aria-label="{o.count} today">{o.count}</span>{/if}
		</button>
	{/each}
</div>

<style>
	.views {
		align-self: flex-start;
		display: flex;
		padding: 3px;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 7px 16px;
		font-size: 14px;
		font-weight: 600;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	button.active {
		background: rgba(255, 255, 255, 0.14);
		color: var(--text);
	}
	.count {
		min-width: 20px;
		padding: 1px 7px;
		font-size: 12px;
		border-radius: 999px;
		background: rgba(251, 191, 36, 0.18);
		color: var(--warn);
	}
</style>
