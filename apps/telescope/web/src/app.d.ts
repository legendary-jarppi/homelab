declare global {
	namespace App {
		interface Locals {
			/** The request came for the share link host (PUBLIC_HOST): read-only, published items only. */
			public: boolean;
		}
	}
}

export {};
