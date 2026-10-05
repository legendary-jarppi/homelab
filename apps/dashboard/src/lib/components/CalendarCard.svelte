<script lang="ts">
	import Card from './Card.svelte';
	import { shortDay, weekdayShort } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type { CalendarData, CalendarEvent } from '$lib/types';

	let { calendar }: { calendar: CalendarData | null } = $props();

	const zone = $derived(calendar?.timeZone ?? 'Europe/Helsinki');
	const keyOf = (instant: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(instant));
	const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
	const addDays = (key: string, days: number) => {
		const d = new Date(`${key}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().slice(0, 10);
	};
	/** Sunday ending the week (Monday to Sunday) that contains `key`. */
	const sundayOf = (key: string) => addDays(key, (7 - new Date(`${key}T12:00:00Z`).getUTCDay()) % 7);
	const dayLabel = (key: string, today: string) => (key === addDays(today, 1) ? 'Huomenna' : shortDay(key));

	/** Day keys an event covers: all-day `end` is exclusive; timed events count on the days they touch. */
	function covers(e: CalendarEvent, key: string): boolean {
		if (e.allDay) return e.start <= key && key < e.end;
		return keyOf(e.start) <= key && key <= keyOf(new Date(Date.parse(e.end) - 1));
	}
	const lastDay = (e: CalendarEvent) => addDays(e.end, -1);
	const multiDay = (e: CalendarEvent) => e.allDay && lastDay(e) > e.start;
	/** Multi-day events as weekday ranges: "ke–pe" from the start, "–pe" once under way. */
	function range(e: CalendarEvent, from: string): string {
		const end = Date.parse(lastDay(e)) - Date.parse(from) < 7 * 86_400_000 ? weekdayShort(lastDay(e)) : shortDay(lastDay(e));
		return e.start === from ? `${weekdayShort(e.start)}–${end}` : `–${end}`;
	}
	/** Coming up lists a multi-day event once, on the first day it appears there. */
	function upcomingLabel(e: CalendarEvent, key: string, first: string): string | null {
		if (!e.allDay) return time(e.start);
		if (!multiDay(e)) return 'all day';
		return key === (e.start > first ? e.start : first) ? range(e, key) : null;
	}

	const today = $derived(keyOf(night.now));
	const events = $derived(calendar?.events ?? []);
	const todayAllDay = $derived(events.filter((e) => e.allDay && covers(e, today)));
	const todayTimed = $derived(events.filter((e) => !e.allDay && covers(e, today)));
	const nowMs = $derived(night.now.getTime());
	const nextId = $derived(todayTimed.find((e) => Date.parse(e.start) > nowMs)?.id ?? null);
	const remaining = $derived(todayTimed.filter((e) => Date.parse(e.end) > nowMs).length);
	/** The rest of this week and all of next week, by week, days without events left out. */
	const weeks = $derived.by(() => {
		const first = addDays(today, 1);
		const thisSunday = sundayOf(today);
		const nextSunday = addDays(thisSunday, 7);
		const daysOf = (from: string, to: string) => {
			const out: { key: string; events: { e: CalendarEvent; when: string }[] }[] = [];
			for (let key = from; key <= to; key = addDays(key, 1)) {
				const list = events.flatMap((e) => {
					const when = covers(e, key) ? upcomingLabel(e, key, first) : null;
					return when ? [{ e, when }] : [];
				});
				if (list.length > 0) out.push({ key, events: list });
			}
			return out;
		};
		return [
			{ label: 'This week', days: daysOf(first, thisSunday) },
			{ label: 'Next week', days: daysOf(addDays(thisSunday, 1), nextSunday) }
		].filter((w) => w.days.length > 0);
	});

	function status(e: CalendarEvent): 'past' | 'now' | 'next' | 'later' {
		if (Date.parse(e.end) <= nowMs) return 'past';
		if (Date.parse(e.start) <= nowMs) return 'now';
		return e.id === nextId ? 'next' : 'later';
	}
	function until(iso: string): string {
		const min = Math.max(1, Math.round((Date.parse(iso) - nowMs) / 60_000));
		if (min < 60) return `in ${min} min`;
		const h = Math.floor(min / 60);
		return min % 60 === 0 || h >= 3 ? `in ${h} h` : `in ${h} h ${min % 60} min`;
	}
	function progress(e: CalendarEvent): number {
		const start = Date.parse(e.start);
		return Math.min(100, Math.max(0, ((nowMs - start) / (Date.parse(e.end) - start)) * 100));
	}
</script>

<Card title="Calendar">
	{#snippet accessory()}
		{#if calendar}<span>{remaining === 0 ? 'Nothing more today' : `${remaining} more today`}</span>{/if}
	{/snippet}
	{#if calendar}
		<div class="body">
			<section class="today" aria-label="Today">
				{#if todayAllDay.length > 0}
					<ul class="chips">
						{#each todayAllDay as e (e.id)}
							<li style:--c={e.color}><i></i>{e.title}{#if multiDay(e)}<span class="muted"> · {range(e, today)}</span>{/if}</li>
						{/each}
					</ul>
				{/if}
				{#if todayTimed.length > 0}
					<ol class="events">
						{#each todayTimed as e (e.id)}
							{@const s = status(e)}
							<li class={s} style:--c={e.color}>
								<span class="time num">{time(e.start)}<small>{time(e.end)}</small></span>
								<span class="bar" aria-hidden="true">{#if s === 'now'}<span class="fill" style:height="{progress(e)}%"></span>{/if}</span>
								<span class="what">
									<span class="title">{e.title}</span>
									<span class="meta">{[e.location, e.calendar].filter(Boolean).join(' · ')}</span>
								</span>
								{#if s === 'now'}
									<span class="badge now">Now</span>
								{:else if s === 'next'}
									<span class="badge num">{until(e.start)}</span>
								{/if}
							</li>
						{/each}
					</ol>
				{:else if todayAllDay.length === 0}
					<p class="muted empty">Nothing on the calendar today.</p>
				{/if}
			</section>

			{#each weeks as week (week.label)}
				<section class="upcoming" aria-label={week.label}>
					<h3>{week.label}</h3>
					<ol>
						{#each week.days as d (d.key)}
							<li class="day">
								<span class="label">{dayLabel(d.key, today)}</span>
								<ul>
									{#each d.events as { e, when } (e.id)}
										<li style:--c={e.color}>
											<i></i>
											<span class="when num">{when}</span>
											<span class="title">{e.title}</span>
										</li>
									{/each}
								</ul>
							</li>
						{/each}
					</ol>
				</section>
			{/each}
		</div>
	{:else}
		<p class="muted">Calendar unavailable.</p>
	{/if}
</Card>

<style>
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
		overflow: hidden;
	}
	ul,
	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	p {
		margin: 0;
		font-size: 14px;
	}
	i {
		display: inline-block;
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.chips li {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 13px;
		font-weight: 550;
		background: color-mix(in srgb, var(--c) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
	}

	.events {
		display: grid;
		gap: 4px;
	}
	.events li {
		display: grid;
		grid-template-columns: 46px 4px minmax(0, 1fr) auto;
		align-items: center;
		gap: 10px;
		padding: 6px 8px 6px 0;
		border-radius: 12px;
	}
	.events li.now {
		background: color-mix(in srgb, var(--c) 10%, transparent);
		padding-left: 8px;
		margin-left: -8px;
	}
	.events li.past {
		opacity: 0.38;
	}
	.time {
		display: grid;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.15;
		text-align: right;
	}
	.time small {
		font-size: 11px;
		font-weight: 450;
		color: var(--faint);
	}
	.bar {
		align-self: stretch;
		position: relative;
		border-radius: 2px;
		background: var(--c);
		overflow: hidden;
	}
	.now .bar {
		background: color-mix(in srgb, var(--c) 30%, transparent);
	}
	.fill {
		position: absolute;
		inset: 0 0 auto 0;
		background: var(--c);
	}
	.what {
		display: grid;
		min-width: 0;
	}
	.title {
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		padding: 3px 8px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text);
		background: var(--surface-strong);
		white-space: nowrap;
	}
	.badge.now {
		color: #04121c;
		background: var(--c);
	}
	.empty {
		padding: 6px 0;
	}

	.upcoming {
		border-top: 1px solid var(--border);
		padding-top: 10px;
		min-height: 0;
	}
	h3 {
		margin: 0 0 8px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.upcoming > ol {
		display: grid;
		gap: 8px;
	}
	.day {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr);
		gap: 10px;
		font-size: 13px;
	}
	.label {
		font-weight: 600;
		color: var(--muted);
		line-height: 20px;
	}
	.day ul {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.day li {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		line-height: 20px;
	}
	.day i {
		width: 6px;
		height: 6px;
	}
	.when {
		flex: none;
		min-width: 44px;
		color: var(--muted);
	}
	.day .title {
		font-size: 13px;
		font-weight: 500;
	}

	/* A fixed grid slot (iPad landscape; container set in +page.svelte): drop what does not fit. */
	@container calendar (max-height: 380px) {
		.meta {
			display: none;
		}
		.events li {
			padding-top: 3px;
			padding-bottom: 3px;
		}
	}
	@container calendar (max-height: 300px) {
		.upcoming {
			display: none;
		}
	}
</style>
