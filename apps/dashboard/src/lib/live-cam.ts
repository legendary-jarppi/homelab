// Registers <live-cam>: go2rtc's VideoRTC player (vendored, MIT) restricted to MSE over our
// authenticated WebSocket relay, without the default controls. Import from the browser only.
import { VideoRTC } from './vendor/go2rtc/video-rtc.js';

class LiveCam extends VideoRTC {
	constructor() {
		super();
		// go2rtc exposes only /api/ws (MSE); WebRTC/HLS endpoints are disabled there.
		this.mode = 'mse';
		// Close the stream when the page is hidden.
		this.background = false;
	}

	oninit() {
		super.oninit();
		this.video.controls = false;
		this.video.muted = true;
		this.video.style.objectFit = 'contain';
	}
}

if (!customElements.get('live-cam')) customElements.define('live-cam', LiveCam);
