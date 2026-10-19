/**
 * Svelte action: move a full-screen overlay to <body>. The cards' backdrop-filter makes them the containing
 * block of `position: fixed` descendants, so an overlay left inside a card would cover only the card.
 */
export function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return { destroy: () => node.remove() };
}
