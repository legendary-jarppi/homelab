import type { SubmitFunction } from '@sveltejs/kit';

/** use:enhance callback that keeps the reader's selections in place after saving. */
export const keepValues: SubmitFunction = () => async ({ update }) => update({ reset: false });

/**
 * Svelte action: saves as soon as a control changes. The explicit submit buttons exist for
 * readers without JavaScript and are removed once the page is interactive.
 */
export function autosubmit(form: HTMLFormElement) {
	const submit = (event: Event) => {
		if ((event.target as HTMLElement).closest('[data-no-autosubmit]')) return;
		form.requestSubmit();
	};
	form.addEventListener('change', submit);
	return { destroy: () => form.removeEventListener('change', submit) };
}
