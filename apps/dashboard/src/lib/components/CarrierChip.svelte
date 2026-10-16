<script lang="ts">
	import { carrierName, carrierShort } from '$lib/packages';
	import type { Carrier } from '$lib/types';

	let { carrier }: { carrier: Carrier } = $props();
</script>

<span class="carrier {carrier}" title={carrierName(carrier)}>{carrierShort(carrier)}</span>

<style>
	.carrier {
		margin-top: 1px;
		padding: 3px 0;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.02em;
		text-align: center;
		border-radius: 7px;
	}
	.posti {
		color: #fff;
		background: #ff6b00;
	}
	.matkahuolto {
		color: #fff;
		background: #0b3c96;
	}
	.dhl {
		color: #d40511;
		background: #ffcc00;
	}
	.ups {
		color: #ffb500;
		background: #351c15;
	}
	.dsv {
		color: #fff;
		background: #002664;
	}
</style>
