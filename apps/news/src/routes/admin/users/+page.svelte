<script lang="ts">
	import { enhance } from '$app/forms';
	import { when } from '$lib/components/account/format';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Users & invites · Admin</title>
</svelte:head>

<h1>Users & invites</h1>

{#if form?.message}<p class="flash" role="status">{form.message}</p>{/if}

{#if form?.temporary}
	<div class="reveal-once" role="status">
		<p>Temporary password for <strong>{form.forUser}</strong>, shown only now. Their sessions have ended; ask them to change it under Settings.</p>
		<code>{form.temporary}</code>
	</div>
{/if}

<h2>Invite someone</h2>
{#if form?.inviteUrl}
	<div class="reveal-once" role="status">
		<p>Single-use link, valid for 14 days, shown only now:</p>
		<code>{form.inviteUrl}</code>
	</div>
{/if}
<form class="inline-form invite" method="POST" action="?/invite" use:enhance>
	<label for="invite-role">Role</label>
	<select id="invite-role" name="role">
		<option value="reader">Reader</option>
		<option value="admin">Admin</option>
	</select>
	<label for="invite-note">Note</label>
	<input id="invite-note" type="text" name="note" maxlength="200" placeholder="Who it is for" />
	<button class="button button-primary">Create invite</button>
</form>

<h2>Open invites</h2>
{#if data.invites.length === 0}
	<p class="muted">None.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr><th scope="col">Created</th><th scope="col">Expires</th><th scope="col">Role</th><th scope="col">Note</th><th scope="col">By</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr>
			</thead>
			<tbody>
				{#each data.invites as inv (inv.code_hash)}
					<tr>
						<td>{when(inv.created_at)}</td>
						<td>{when(inv.expires_at)}</td>
						<td>{inv.role}</td>
						<td>{inv.note ?? '–'}</td>
						<td>{inv.created_by ?? 'command line'}</td>
						<td>
							<form class="inline-form" method="POST" action="?/revoke" use:enhance>
								<input type="hidden" name="code" value={inv.code_hash} />
								<button class="button">Revoke</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Users</h2>
<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th scope="col">User</th>
				<th scope="col">Role</th>
				<th scope="col">Joined</th>
				<th scope="col">Invited by</th>
				<th scope="col">Last sign-in</th>
				<th scope="col"><span class="visually-hidden">Actions</span></th>
			</tr>
		</thead>
		<tbody>
			{#each data.users as u (u.id)}
				<tr>
					<th scope="row">{u.display_name}<br /><span class="muted">{u.username}</span></th>
					<td>
						<form class="inline-form" method="POST" action="?/role" use:enhance>
							<input type="hidden" name="id" value={u.id} />
							<input type="hidden" name="role" value={u.role === 'admin' ? 'reader' : 'admin'} />
							{u.role}
							<button class="button">Make {u.role === 'admin' ? 'reader' : 'admin'}</button>
						</form>
					</td>
					<td>{when(u.created_at)}</td>
					<td>{u.invited_by ?? '–'}</td>
					<td>{when(u.last_sign_in)}</td>
					<td class="row-actions">
						<form class="inline-form" method="POST" action="?/reset" use:enhance>
							<input type="hidden" name="id" value={u.id} />
							<input type="hidden" name="username" value={u.username} />
							<button class="button">Reset password</button>
						</form>
						{#if u.id !== data.me}
							<details>
								<summary>Delete…</summary>
								<form class="inline-form" method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="id" value={u.id} />
									<label class="confirm"><input type="checkbox" name="confirm" value="yes" required /> Delete {u.username} and all their settings</label>
									<button class="button">Delete</button>
								</form>
							</details>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.invite {
		margin-bottom: var(--space-4);
	}

	.reveal-once {
		margin: 0 0 var(--space-4);
	}

	.row-actions {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}

	summary {
		display: flex;
		align-items: center;
		min-height: var(--touch);
		cursor: pointer;
	}
</style>
