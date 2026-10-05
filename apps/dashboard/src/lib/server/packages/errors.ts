/** The carrier does not know the code (yet): normal for a few hours after a label is created. */
export class NotFoundError extends Error {
	constructor() {
		super('Not found at the carrier yet');
	}
}

/** The carrier's credentials are missing. */
export class NotConfiguredError extends Error {}
