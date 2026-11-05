<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { shortDay } from '$lib/dates';
	import type { CalendarEvent, CalendarEventChange, EventTiming, NewCalendarEvent } from '$lib/types';

	/** 'add' = new event form; an event = its details, with Edit and Delete when the calendar is writable. */
	let {
		view,
		zone,
		showCalendar,
		writable,
		onclose,
		onsaved
	}: {
		view: 'add' | CalendarEvent;
		/** The calendar's time zone: dates and times are shown and entered in it. */
		zone: string;
		/** Name the calendar in the details (events come from several). */
		showCalendar: boolean;
		/** Events can be edited (Google Calendar API). */
		writable: boolean;
		onclose: () => void;
		/** An event was added or changed: the card reloads. */
		onsaved: () => void;
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

	/** An event's timing as the form enters it. */
	function timingOf(e: CalendarEvent): EventTiming {
		if (e.allDay) return { date: e.start, allDay: true, time: null, minutes: null, days: Math.max(1, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 86_400_000)) };
		return { date: keyOf(e.start), allDay: false, time: time(e.start), minutes: Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60_000), days: null };
	}

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
	/** Showing the edit form of `event`. */
	let editing = $state(false);
	/** Asking whether to delete `event`. */
	let confirmingDelete = $state(false);

	// An edited event may last longer than any preset (75 min, 20 days): its own length is offered too.
	const durations = $derived([...new Set([...DURATIONS, minutes])].sort((a, b) => a - b));
	const dayChoices = $derived(Array.from({ length: Math.max(14, days) }, (_, i) => i + 1));

	const timing = (): EventTiming => (allDay ? { date, allDay, time: null, minutes: null, days } : { date, allDay, time: startTime, minutes, days: null });

	function startEdit(e: CalendarEvent) {
		const t = timingOf(e);
		title = e.title;
		date = t.date;
		allDay = t.allDay;
		startTime = t.time ?? start.time;
		minutes = t.minutes ?? 60;
		days = t.days ?? 1;
		location = e.location ?? '';
		description = e.description ?? '';
		message = null;
		editing = true;
	}

	/** Only what was changed goes to Google, so a formatted description survives a new start time. */
	function changes(e: CalendarEvent): CalendarEventChange {
		const change: CalendarEventChange = {};
		if (title.trim() !== e.title) change.title = title.trim();
		const after = timing();
		if (JSON.stringify(after) !== JSON.stringify(timingOf(e))) change.timing = after;
		if ((location.trim() || null) !== e.location) change.location = location.trim() || null;
		if ((description.trim() || null) !== e.description) change.description = description.trim() || null;
		return change;
	}

	async function send(url: string, method: 'POST' | 'PATCH', body: NewCalendarEvent | CalendarEventChange, verb: string) {
		busy = true;
		message = null;
		try {
			const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			if (!response.ok) {
				message = ((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? `Could not ${verb} (${response.status}).`;
				return;
			}
			onsaved();
		} catch {
			message = `Could not ${verb}: no connection.`;
		} finally {
			busy = false;
		}
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (event) {
			const change = changes(event);
			if (Object.keys(change).length === 0) editing = false;
			else void send(`/api/calendar/${encodeURIComponent(event.id)}`, 'PATCH', change, 'save');
			return;
		}
		void send('/api/calendar', 'POST', { ...timing(), title: title.trim(), location: location.trim() || null, description: description.trim() || null }, 'add');
	}

	async function remove(e: CalendarEvent) {
		busy = true;
		message = null;
		try {
			const response = await fetch(`/api/calendar/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
			if (!response.ok) {
				message = ((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? `Could not delete (${response.status}).`;
				return;
			}
			onsaved();
		} catch {
			message = 'Could not delete: no connection.';
		} finally {
			busy = false;
		}
	}

	function onescape() {
		if (busy) return;
		if (confirmingDelete) confirmingDelete = false;
		else if (editing) editing = false;
		else onclose();
	}
</script>

<Sheet label={event ? event.title : 'New event'} {onclose} {onescape}>
	{#snippet header()}
		<h2 class="title" style:--c={event?.color}>
			{#if event}<i></i>{/if}{event ? (editing ? 'Edit event' : event.title) : 'New event'}
		</h2>
	{/snippet}

	{#if event && !editing}
		{@const w = when(event)}
		<dl class="facts">
			<div><dt>Date</dt><dd>{w.date}</dd></div>
			<div><dt>Time</dt><dd class="num">{w.time}</dd></div>
			<div><dt>Duration</dt><dd>{w.duration}</dd></div>
			{#if showCalendar}<div><dt>Calendar</dt><dd>{event.calendar}</dd></div>{/if}
			{#if event.location}<div class="wide"><dt>Location</dt><dd>{event.location}</dd></div>{/if}
			{#if event.description}<div class="wide"><dt>Description</dt><dd class="description">{event.description}</dd></div>{/if}
		</dl>
		{#if writable}
			{#if confirmingDelete}
				<p class="confirm">
					{event.recurring ? 'Delete this occurrence from the calendar? The rest of the repeating event stays.' : 'Delete this event from the calendar?'}
				</p>
				{#if message}<p class="error">{message}</p>{/if}
				<div class="actions">
					<button class="button" onclick={() => (confirmingDelete = false)} disabled={busy}>Keep</button>
					<button class="button danger" onclick={() => remove(event)} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>
				</div>
			{:else}
				<div class="actions">
					<button class="button" onclick={() => startEdit(event)}>Edit</button>
					<button class="button danger" onclick={() => ((message = null), (confirmingDelete = true))}>Delete</button>
				</div>
			{/if}
		{/if}
	{:else}
		<form onsubmit={submit}>
			<label>
				<span>Name</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input bind:value={title} required maxlength="200" autocomplete="off" autofocus={!event} placeholder="e.g. Dentist" />
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
							{#each dayChoices as n (n)}<option value={n}>{n === 1 ? '1 day' : `${n} days`}</option>{/each}
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
							{#each durations as m (m)}<option value={m}>{length(m)}</option>{/each}
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
			{#if event?.recurring}<p class="hint muted">This changes only this occurrence; the rest of the repeating event stays as it is.</p>{/if}
			{#if message}<p class="error">{message}</p>{/if}
			{#if event}
				<div class="actions">
					<button type="button" class="button" onclick={() => (editing = false)} disabled={busy}>Cancel</button>
					<button class="button primary" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Save'}</button>
				</div>
			{:else}
				<button class="button primary" disabled={busy || !title.trim()}>{busy ? 'Adding…' : 'Add to the calendar'}</button>
			{/if}
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
	.confirm {
		margin: 0;
		font-size: 15px;
		font-weight: 550;
	}
	.row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 10px;
	}
</style>
