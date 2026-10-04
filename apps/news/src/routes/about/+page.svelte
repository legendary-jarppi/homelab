<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
</script>

<svelte:head>
	<title>About · Shilly Shally News</title>
</svelte:head>

<PageTitle title="About this paper" />

<div class="about">
	<p>
		Shilly Shally News gathers the day’s reporting from Finnish and international outlets into one calm paper. Every
		reader decides what they would rather not read about, and the paper is set for them alone.
	</p>
	<p>
		The front page comes out three times a day, in the morning, at midday and in the evening. Between editions,
		<em>Latest</em> lists everything as it arrives.
	</p>
	<p>
		It is a private reading room for family and friends, by invitation only. The articles belong to the outlets that
		published them, and every article links to its original.
	</p>
</div>

<style>
	.about {
		display: grid;
		gap: var(--space-4);
		max-width: var(--measure);
	}
</style>
