<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';

	let { data, form } = $props();

	/** loading → one of: unsupported, install (iOS outside the Home Screen app), ready. */
	let support = $state<'loading' | 'unsupported' | 'install' | 'ready'>('loading');
	let permission = $state<NotificationPermission>('default');
	let endpoint = $state<string | null>(null);
	let busy = $state(false);
	let problem = $state('');
	let registration: ServiceWorkerRegistration | null = null;

	const thisDevice = $derived(endpoint ? data.devices.find((d) => d.endpoint === endpoint) : undefined);

	const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

	/** The VAPID public key (base64url) as the bytes pushManager.subscribe wants. */
	function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
		const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
		const bin = atob(b64);
		const out = new Uint8Array(new ArrayBuffer(bin.length));
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}

	async function devices(method: 'PUT' | 'DELETE', body: unknown) {
		const r = await fetch('/devices', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		if (!r.ok) throw new Error(`saving the device failed (HTTP ${r.status})`);
	}

	onMount(async () => {
		const ios = /iPhone|iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
		if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
			support = ios && !standalone ? 'install' : 'unsupported';
			return;
		}
		permission = Notification.permission;
		try {
			registration = await navigator.serviceWorker.register('/sw.js');
			await navigator.serviceWorker.ready;
			const sub = await registration.pushManager.getSubscription();
			if (sub) {
				// Re-sent on every visit: keeps the server's copy current if the browser rotated it.
				await devices('PUT', sub.toJSON());
				endpoint = sub.endpoint;
				if (!data.devices.some((d) => d.endpoint === sub.endpoint)) await invalidateAll();
			}
		} catch (e) {
			problem = (e as Error).message;
		}
		support = 'ready';
	});

	async function turnOn() {
		problem = '';
		busy = true;
		try {
			// Asked directly from the tap: iOS allows the prompt only from a user gesture.
			permission = await Notification.requestPermission();
			if (permission !== 'granted') return;
			const reg = registration ?? (await navigator.serviceWorker.ready);
			const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data.vapidPublicKey) });
			await devices('PUT', sub.toJSON());
			endpoint = sub.endpoint;
			await invalidateAll();
		} catch (e) {
			problem = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function turnOff() {
		problem = '';
		busy = true;
		try {
			const sub = await registration?.pushManager.getSubscription();
			if (sub) {
				await sub.unsubscribe();
				await devices('DELETE', { endpoint: sub.endpoint });
			}
			endpoint = null;
			await invalidateAll();
		} catch (e) {
			problem = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Notify</title></svelte:head>

<section class="card">
	<h2>This device</h2>
	{#if support === 'loading'}
		<p class="muted">Checking…</p>
	{:else if support === 'install'}
		<p>To get notifications on this {navigator.userAgent.includes('iPad') ? 'iPad' : 'iPhone'}, add the app to the Home Screen and open it from there:</p>
		<ol>
			<li>Tap <b>Share</b> in Safari's toolbar.</li>
			<li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
			<li>Open <b>Notify</b> from the Home Screen and turn notifications on.</li>
		</ol>
	{:else if support === 'unsupported'}
		<p class="muted">This browser cannot receive web push notifications.</p>
	{:else if thisDevice}
		<p><span class="dot ok"></span> Notifications are on for this {thisDevice.label}.</p>
		<div class="row">
			<form method="POST" action="?/test" use:enhance>
				<button class="button primary">Send a test</button>
			</form>
			<button class="button" disabled={busy} onclick={turnOff}>Turn off</button>
		</div>
	{:else if permission === 'denied'}
		<p>Notifications are blocked for this app. Allow them in the device's settings (on an iPhone: <b>Settings → Notifications → Notify</b>), then reopen the app.</p>
	{:else}
		<p class="muted">Notifications are off on this device.</p>
		<div class="row">
			<button class="button primary" disabled={busy || !data.vapidPublicKey} onclick={turnOn}>Turn on notifications</button>
		</div>
		{#if !data.vapidPublicKey}<p class="error">The server has no VAPID keys yet.</p>{/if}
	{/if}
	{#if problem}<p class="error">{problem}</p>{/if}
	{#if form?.test}
		<p class="muted">Test sent to {form.test.devices} {form.test.devices === 1 ? 'device' : 'devices'}{form.test.failed > 0 ? `, ${form.test.failed} failed` : ''}.</p>
	{/if}
	{#if form?.error}<p class="error">{form.error}</p>{/if}
</section>

<section class="card">
	<h2>What to send me</h2>
	{#each data.topics as t (t.id)}
		<form method="POST" action="?/topic" use:enhance class="topic">
			<input type="hidden" name="topic" value={t.id} />
			<label class="switch">
				<input type="checkbox" name="enabled" checked={t.enabled} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
				<span>
					<b>{t.name}</b>
					{#if t.description}<span class="muted">{t.description}</span>{/if}
				</span>
			</label>
		</form>
	{/each}
</section>

{#if data.devices.length > 0}
	<section class="card">
		<h2>My devices</h2>
		<ul class="devices">
			{#each data.devices as d (d.id)}
				<li>
					<div>
						<b>{d.label}</b>{#if d.endpoint === endpoint}<span class="muted"> · this device</span>{/if}
						<div class="muted small">
							Added {when.format(d.createdAt)}{#if d.lastSentAt}{' · '}last delivered {when.format(d.lastSentAt)}{/if}
						</div>
						{#if d.lastError}<div class="error small">Last delivery failed: {d.lastError}</div>{/if}
					</div>
					{#if d.endpoint !== endpoint}
						<form method="POST" action="?/removeDevice" use:enhance>
							<input type="hidden" name="id" value={d.id} />
							<button class="button small-button">Remove</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="card">
	<h2>Recent</h2>
	{#if data.history.length === 0}
		<p class="muted">Nothing sent to you yet.</p>
	{:else}
		<ul class="history">
			{#each data.history as m (m.id)}
				<li>
					<div class="head">
						<b>{m.title}</b>
						<span class="muted small num">{when.format(m.createdAt)}</span>
					</div>
					{#if m.body}<p>{m.body}</p>{/if}
					<div class="muted small">
						{m.topicName ?? 'Test'} · from {m.sender}{#if m.url}{' · '}<a href={m.url}>open</a>{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="card">
	<h2>Me</h2>
	<form method="POST" action="?/name" use:enhance class="name">
		<label class="field">
			Name
			<input name="name" value={data.user.name} maxlength="40" required />
		</label>
		<button class="button">Save</button>
	</form>
	<p class="muted small">Signed in as {data.user.email}</p>
</section>

<style>
	.card {
		display: grid;
		gap: 12px;
	}
	h2 {
		font-size: 18px;
	}
	ol {
		margin: 0;
		padding-left: 22px;
		display: grid;
		gap: 4px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.dot {
		display: inline-block;
		width: 9px;
		height: 9px;
		margin-right: 4px;
		border-radius: 50%;
		background: var(--ok);
	}
	.small {
		font-size: 13px;
	}
	.topic + .topic {
		border-top: 1px solid var(--border);
		padding-top: 12px;
	}
	.switch {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		cursor: pointer;
	}
	.switch > span {
		display: grid;
		gap: 2px;
	}
	.switch input {
		flex: none;
		width: 22px;
		height: 22px;
		margin: 1px 0 0;
		accent-color: var(--accent);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}
	.devices li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.small-button {
		min-height: 36px;
		padding: 0 12px;
		font-size: 14px;
	}
	.history li {
		display: grid;
		gap: 3px;
	}
	.history li + li {
		border-top: 1px solid var(--border);
		padding-top: 12px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}
	.head .small {
		flex: none;
	}
	.name {
		display: flex;
		align-items: flex-end;
		gap: 10px;
	}
	.name .field {
		flex: 1;
	}
</style>
