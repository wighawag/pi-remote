export function handleAutomaticUpdate(
	registration: ServiceWorkerRegistration,
	intervals: {idle: number; checks: number},
): NodeJS.Timeout {
	let lastFocusTime = performance.now();
	function wakeup(evt?: Event) {
		const timePassed = performance.now();
		if (timePassed - lastFocusTime > intervals.idle) {
			registration.update();
		}
		// we reset the time each time we wake up
		// the idea here is that we do not want to bother users while they are actively using the app
		lastFocusTime = timePassed;
	}
	['focus', 'pointerdown'].forEach((evt) =>
		window.addEventListener(evt, wakeup),
	);

	// Installed-PWA update trigger.
	// An installed PWA is a SPA (hash/client-side routing) and almost never
	// issues a `mode: 'navigate'` request, so the service worker's
	// "skipWaiting on navigate" trick (see src/service-worker/index.ts) never
	// fires and a waiting worker is never surfaced. The idle-gated `wakeup`
	// above also rarely passes right after a relaunch, so the update banner
	// never appears. Force an explicit update check on launch and every time
	// the app becomes visible (relaunch / tab re-show) so the manual update
	// popup can actually be shown.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			registration.update();
		}
	});
	// also check immediately on registration
	registration.update();

	// but we still do not an update every so often
	// TODO improve upon this
	return setInterval(() => registration.update(), intervals.checks);
}

// taken from: https://stackoverflow.com/a/50535316
export function listenForWaitingServiceWorker(
	registration: ServiceWorkerRegistration,
	callback: (reg: ServiceWorkerRegistration) => void,
) {
	function awaitStateChange() {
		if (registration.installing) {
			registration.installing.addEventListener('statechange', function () {
				if (this.state === 'installed') callback(registration);
			});
		}
	}
	if (!registration) {
		return;
	}
	if (registration.waiting) {
		return callback(registration);
	}
	if (registration.installing) {
		awaitStateChange();
	} else {
		registration.addEventListener('updatefound', awaitStateChange);
	}
}
