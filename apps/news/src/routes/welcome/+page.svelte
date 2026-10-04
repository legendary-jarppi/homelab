<script lang="ts">
	import { enhance } from '$app/forms';
	import DisplayFields from '$lib/components/account/DisplayFields.svelte';
	import { keepValues } from '$lib/components/account/forms';
	import PresetCards from '$lib/components/account/PresetCards.svelte';
	import SensitivityEditor from '$lib/components/account/SensitivityEditor.svelte';

	let { data, form } = $props();

	const TITLES = ['Before your first edition', 'How much would you like to see?', 'Fine-tune, if you like', 'Photos and headlines', 'Your paper is ready'];
</script>

<svelte:head>
	<title>Welcome · Shilly Shally News</title>
</svelte:head>

<article class="welcome">
	<header>
		<p class="kicker">Welcome · Step {data.step} of {data.steps}</p>
		<h1 class="hed hed-5">{TITLES[data.step - 1]}</h1>
	</header>

	{#if form?.message}
		<p class="message" role="alert">{form.message}</p>
	{/if}

	{#if data.step === 1}
		<p class="lede">
			Shilly Shally News gathers the day’s reporting from Finnish and international papers, and you read every article in full, here.
			Each article is read and described before it reaches you, and anything you have chosen not to see is simply left out of your paper.
		</p>
		<nav class="steps-nav">
			<a class="button button-primary" href="?step=2">Begin</a>
		</nav>
	{:else if data.step === 2}
		<p class="lede">Choose a starting point. You can fine-tune it on the next page, or at any time in Settings.</p>
		<form method="POST" action="?/preset" use:enhance>
			<PresetCards selected={data.preset} />
			<nav class="steps-nav">
				<a class="button" href="?step=1">Back</a>
				<button class="button button-primary">Continue</button>
			</nav>
		</form>
	{:else if data.step === 3}
		<p class="lede">
			Optional. Each group has one setting for all of its subjects; open “Single subjects” to choose for each one. Changes are saved as you
			make them.
		</p>
		<SensitivityEditor thresholds={data.thresholds} saved={form?.saved ?? null} />
		<nav class="steps-nav">
			<a class="button" href="?step=2">Back</a>
			<a class="button button-primary" href="?step=4">Continue</a>
		</nav>
	{:else if data.step === 4}
		<form method="POST" action="?/display" use:enhance={keepValues}>
			<DisplayFields images={data.images} calmHeadlines={data.calmHeadlines} />
			<nav class="steps-nav">
				<a class="button" href="?step=3">Back</a>
				<button class="button button-primary">Continue</button>
			</nav>
		</form>
	{:else}
		<p class="lede">Your choices are saved. You can change any of them later under Settings.</p>
		<form method="POST" action="?/finish" use:enhance>
			<nav class="steps-nav">
				<a class="button" href="?step=4">Back</a>
				<button class="button button-primary">Read today’s paper</button>
			</nav>
		</form>
	{/if}
</article>

<style>
	.welcome {
		max-width: 52rem;
		margin: 0 auto;
		padding: var(--space-6) 0 var(--space-8);
	}

	header {
		margin-bottom: var(--space-5);
		padding-bottom: var(--space-3);
		border-bottom: var(--hairline);
	}

	h1 {
		margin: var(--space-2) 0 0;
	}

	.lede {
		max-width: var(--measure);
		margin: 0 0 var(--space-5);
		font-size: var(--step-1);
		line-height: 1.5;
	}

	.message {
		font-family: var(--font-ui);
		font-size: var(--step--1);
		color: var(--accent);
	}

	.steps-nav {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-6);
		padding-top: var(--space-4);
		border-top: var(--hairline);
	}

	.steps-nav :only-child {
		margin-left: auto;
	}
</style>
