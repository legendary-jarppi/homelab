<script lang="ts">
	import { useI18n } from '$lib/i18n';

	interface Props {
		/** When the newest story came in. */
		updatedAt?: Date | null;
		user?: { displayName: string; admin: boolean } | null;
		query?: string;
		minimal?: boolean;
	}

	let { updatedAt = null, user = null, query = '', minimal = false }: Props = $props();
	const i = useI18n();
</script>

<header class="masthead" class:minimal>
	{#if user}
		<div class="strip page no-print">
			<form class="search" role="search" method="get" action="/search">
				<label class="visually-hidden" for="masthead-search">{i.t('masthead.searchLabel')}</label>
				<input id="masthead-search" name="q" type="search" placeholder={i.t('masthead.search')} value={query} autocomplete="off" enterkeyhint="search" />
				<button class="go" type="submit">{i.t('masthead.search')}</button>
			</form>
			<nav class="account" aria-label={i.t('masthead.account')}>
				<a href="/saved">{i.t('masthead.saved')}</a>
				<a href="/settings">{i.t('masthead.settings')}</a>
				{#if user.admin}<a href="/admin">Admin</a>{/if}
				<form method="post" action="/logout">
					<button type="submit">{i.t('masthead.signOut')}</button>
				</form>
			</nav>
		</div>
	{/if}

	<div class="page">
		<div class="nameplate">
			<a href="/" class="title" aria-label={i.t('masthead.home')}>Shilly Shally News</a>
		</div>
		{#if !minimal}
			<p class="dateline">
				<span class="date">{i.dateline(new Date())}</span>
				<span>Espoo</span>
				{#if updatedAt}
					<span>{i.t('masthead.updated')} <time datetime={updatedAt.toISOString()}>{i.when(updatedAt)}</time></span>
				{/if}
			</p>
		{/if}
	</div>
</header>

<style>
	.masthead {
		padding-top: var(--space-2);
	}

	.strip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		font-family: var(--font-ui);
		font-size: var(--step--1);
	}

	.search {
		display: flex;
		align-items: stretch;
		min-width: 0;
		flex: 0 1 18rem;
	}

	.search input {
		flex: 1;
		min-width: 0;
		min-height: var(--touch);
		padding: 0 var(--space-2);
		border: 0;
		border-bottom: 1px solid var(--ink-3);
		border-radius: 0;
		background: transparent;
		font-family: var(--font-ui);
		font-size: max(16px, var(--step--1));
	}

	.search input:focus-visible {
		outline-offset: 0;
	}

	.search .go {
		min-height: var(--touch);
		padding: 0 var(--space-3);
		border: 0;
		border-bottom: 1px solid var(--ink-3);
		background: transparent;
		font-family: var(--font-ui);
		font-size: var(--step--2);
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
	}

	.account {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.account a,
	.account button {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch);
		padding: 0 var(--space-3);
		border: 0;
		background: none;
		color: var(--ink-2);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		text-decoration: none;
		cursor: pointer;
	}

	.account a:hover,
	.account button:hover {
		color: var(--ink);
		text-decoration: underline;
	}

	.account form {
		display: contents;
	}

	.nameplate {
		margin-top: var(--space-3);
		padding: var(--space-3) 0 var(--space-2);
		border-top: var(--hairline);
		border-bottom: 3px double var(--ink);
		text-align: center;
	}

	.title {
		display: inline-block;
		font-family: var(--font-masthead);
		font-size: clamp(2.3rem, 1.2rem + 5.4vw, 5.4rem);
		font-weight: 400;
		line-height: 1.05;
		letter-spacing: 0.005em;
		color: var(--ink);
		text-decoration: none;
		white-space: nowrap;
	}

	.minimal .nameplate {
		margin-top: var(--space-6);
	}

	.minimal .title {
		font-size: clamp(2rem, 1.4rem + 3vw, 3.2rem);
	}

	.dateline {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-1) var(--space-5);
		padding: var(--space-2) 0;
		border-bottom: var(--hairline);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		font-variant-caps: all-small-caps;
		font-variant-numeric: lining-nums;
		letter-spacing: 0.1em;
		color: var(--ink-2);
		text-wrap: balance;
	}

	.dateline .date {
		color: var(--ink);
		font-weight: 600;
	}

	@media (max-width: 40rem) {
		.strip {
			flex-wrap: wrap;
			gap: 0;
		}

		.search {
			flex: 1 1 100%;
			order: 2;
		}

		.account {
			flex: 1 1 100%;
			justify-content: flex-start;
			margin-left: calc(-1 * var(--space-3));
		}

		.dateline {
			gap: 0 var(--space-3);
		}
	}
</style>
