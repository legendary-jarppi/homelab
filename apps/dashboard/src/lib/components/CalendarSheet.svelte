<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { shortDay } from '$lib/dates';
	import type { CalendarEvent, NewCalendarEvent } from '$lib/types';

	/** 'add' = new event form; an event = its details. */
	let {
		view,
		zone,
		showCalendar,
		onclose,
		onadded
	}: {
		view: 'add' | CalendarEvent;
		/** The calendar's time zone: dates and times are shown and entered in it. */
		zone: string;
		/** Name the calendar in the details (events come from several). */
		showCalendar: boolean;
		onclose: () => void;
		onadded: () => void;
	} = $props();

	const event = $derived(view === 'add' ? null : view);

	const keyOf = (instant: Date | string | number) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(instant));
	const time = (instant: Date | string | number) =>
		new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
	const addDays = (key: string, days: number) => {
		const d = new Date(`${key}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().slice(0, 10);
	};
	function length(minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
	}

	/** "pe 16.10. 14:00–15:30", "pe 16.10.–su 18.10.", or across midnight with both days. */
	function when(e: CalendarEvent): { date: string; time: string; duration: string } {
		if (e.allDay) {
			const last = addDays(e.end, -1);
			const days = Math.round((Date.parse(e.end) - Date.parse(e.start)) / 86_400_000);
			return {
				date: last > e.start ? `${shortDay(e.start)}–${shortDay(last)}` : shortDay(e.start),
				time: 'All day',
				duration: days > 1 ? `${days} days` : '1 day'
			};
		}
		const startKey = keyOf(e.start);
		const endKey = keyOf(Date.parse(e.end) - 1);
		const minutes = Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60_000);
		return {
			date: endKey > startKey ? `${shortDay(startKey)}–${shortDay(endKey)}` : shortDay(startKey),
			time: `${time(e.start)}–${time(e.end)}`,
			duration: length(minutes)
		};
	}

	const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];

	/** The next full hour today, or 9:00 tomorrow when that would be past 22:00. */
	function defaultStart(): { date: string; time: string } {
		const next = new Date(Math.ceil((Date.now() + 1) / 3_600_000) * 3_600_000);
		const hour = Number(time(next).slice(0, 2));
		if (hour >= 22 || hour < 7) return { date: addDays(keyOf(next), hour < 7 ? 0 : 1), time: '09:00' };
		return { date: keyOf(next), time: time(next) };
	}
	const start = defaultStart();

	let title = $state('');
	let date = $state(start.date);
	let allDay = $state(false);
	let startTime = $state(start.time);
	let minutes = $state(60);
	let days = $state(1);
	let location = $state('');
	let description = $state('');
	let busy = $state(false);
	let message = $state<string | null>(null);

	async function add(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		message = null;
		const body: NewCalendarEvent = {
			title: title.trim(),
			date,
			allDay,
			time: allDay ? null : startTime,
			minutes: allDay ? null : minutes,
			days: allDay ? days : null,
			location: location.trim() || null,
			description: description.trim() || null
		};
		try {
			const response = await fetch('/api/calendar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			if (!response.ok) {
				message = ((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? `Could not add (${response.status}).`;
				return;
			}
			onadded();
		} finally {
			busy = false;
		}
	}
</script>

<Sheet label={event ? event.title : 'New event'} {onclose}>
	{#snippet header()}
		<h2 class="title" style:--c={event?.color}>
			{#if event}<i></i>{/if}{event ? event.title : 'New event'}
		</h2>
	{/snippet}

	{#if event}
		{@const w = when(event)}
		<dl class="facts">
			<div><dt>Date</dt><dd>{w.date}</dd></div>
			<div><dt>Time</dt><dd class="num">{w.time}</dd></div>
			<div><dt>Duration</dt><dd>{w.duration}</dd></div>
			{#if showCalendar}<div><dt>Calendar</dt><dd>{event.calendar}</dd></div>{/if}
			{#if event.location}<div class="wide"><dt>Location</dt><dd>{event.location}</dd></div>{/if}
			{#if event.description}<div class="wide"><dt>Description</dt><dd class="description">{event.description}</dd></div>{/if}
		</dl>
	{:else}
		<form onsubmit={add}>
			<label>
				<span>Name</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input bind:value={title} required maxlength="200" autocomplete="off" autofocus placeholder="e.g. Dentist" />
			</label>
			<div class="row">
				<label>
					<span>Date</span>
					<input type="date" bind:value={date} required />
				</label>
				{#if allDay}
					<label>
						<span>Days</span>
						<select bind:value={days}>
							{#each Array.from({ length: 14 }, (_, i) => i + 1) as n (n)}<option value={n}>{n === 1 ? '1 day' : `${n} days`}</option>{/each}
						</select>
					</label>
				{:else}
					<label>
						<span>Start</span>
						<input type="time" bind:value={startTime} required step="300" />
					</label>
					<label>
						<span>Duration</span>
						<select bind:value={minutes}>
							{#each DURATIONS as m (m)}<option value={m}>{length(m)}</option>{/each}
						</select>
					</label>
				{/if}
			</div>
			<label class="check">
				<input type="checkbox" bind:checked={allDay} />
				<span>All day</span>
			</label>
			<label>
				<span>Location <small class="muted">(optional)</small></span>
				<input bind:value={location} maxlength="200" autocomplete="off" />
			</label>
			<label>
				<span>Description <small class="muted">(optional)</small></span>
				<textarea bind:value={description} maxlength="2000" rows="3"></textarea>
			</label>
			{#if message}<p class="error">{message}</p>{/if}
			<button class="button primary" disabled={busy || !title.trim()}>{busy ? 'Adding…' : 'Add to the calendar'}</button>
		</form>
	{/if}
</Sheet>

<style>
	.title {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.title i {
		flex: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--c);
	}
	.description {
		font-weight: 450;
		white-space: pre-wrap;
	}
	.row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 10px;
	}
</style>
