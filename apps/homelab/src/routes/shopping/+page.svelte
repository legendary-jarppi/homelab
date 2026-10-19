<script lang="ts">
	import DocPage from '$lib/components/DocPage.svelte';

	let { data } = $props();
</script>

<DocPage path={data.path} html={data.html} title="Shopping list" />
