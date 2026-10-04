<script lang="ts">
	import { page } from '$app/state';
	import '$lib/components/account/admin.css';

	let { children } = $props();

	const TABS = [
		['/admin/outlets', 'Outlets'],
		['/admin/pipeline', 'Pipeline'],
		['/admin/reports', 'Reports'],
		['/admin/users', 'Users & invites']
	] as const;
</script>

<div class="admin">
	<header class="admin-head">
		<p class="kicker">Administration</p>
		<nav aria-label="Administration">
			<ul>
				{#each TABS as [href, label] (href)}
					<li><a {href} aria-current={page.url.pathname.startsWith(href) ? 'page' : undefined}>{label}</a></li>
				{/each}
			</ul>
		</nav>
	</header>
	{@render children()}
</div>
