<script lang="ts">
	import { enhance } from '$app/forms';
	import { when } from '$lib/components/account/format';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Reports · Admin</title>
</svelte:head>

<h1>Reports</h1>
<p class="muted">“This upset me” from readers. The article is already hidden for the reader who reported it; correct its tags so it is hidden for everyone whose settings cover it.</p>

{#if form?.message}<p class="flash" role="status">{form.message}</p>{/if}

<h2>Open</h2>
{#if data.open.length === 0}
	<p class="muted">No open reports.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">Reported</th>
					<th scope="col">Article</th>
					<th scope="col">Outlet</th>
					<th scope="col">Reader</th>
					<th scope="col">Note</th>
					<th scope="col"><span class="visually-hidden">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.open as r (r.id)}
					<tr>
						<td>{when(r.created_at)}</td>
						<td>
							<a href="/admin/article/{r.article_id}?report={r.id}">{r.calm_title ?? r.title}</a>
							{#if r.calm_title}<br /><span class="muted">{r.title}</span>{/if}
						</td>
						<td>{r.outlet}</td>
						<td>{r.reporter ?? 'deleted user'}</td>
						<td>{r.note ?? '–'}</td>
						<td>
							<form class="inline-form" method="POST" action="?/resolve" use:enhance>
								<input type="hidden" name="id" value={r.id} />
								<button class="button">Resolve</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Recently resolved</h2>
{#if data.resolved.length === 0}
	<p class="muted">None yet.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr><th scope="col">Resolved</th><th scope="col">Article</th><th scope="col">Outlet</th><th scope="col">Reader</th><th scope="col">By</th></tr>
			</thead>
			<tbody>
				{#each data.resolved as r (r.id)}
					<tr>
						<td>{when(r.resolved_at)}</td>
						<td><a href="/admin/article/{r.article_id}">{r.calm_title ?? r.title}</a></td>
						<td>{r.outlet}</td>
						<td>{r.reporter ?? 'deleted user'}</td>
						<td>{r.resolver ?? '–'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
