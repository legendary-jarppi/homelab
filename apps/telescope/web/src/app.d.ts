declare global {
	namespace App {
		interface Locals {
			/** The request came for the public gallery host (PUBLIC_HOST): read-only, published items only. */
			public: boolean;
		}
	}
}

export {};
