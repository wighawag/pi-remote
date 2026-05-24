<script lang="ts">
	import {onMount} from 'svelte';

	let {
		text = $bindable(),
		disabled,
		onSend,
	}: {
		text: string;
		disabled: boolean;
		onSend?: () => void;
	} = $props();

	// Check for Web Speech API support
	const SpeechRecognition =
		typeof window !== 'undefined'
			? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
			: null;
	const isBrowserSupported = !!SpeechRecognition;

	// State
	let isRecording = $state(false);
	let isHolding = $state(false);
	let showSettings = $state(false);
	let directSend = $state(false);
	let locale = $state('en-US');
	let engine = $state<'browser' | 'cloud'>('browser');
	let speechError = $state<string | null>(null);

	// Gesture & API Tracking
	let pressTimer = $state<any>(null);
	let recognitionInstance: any = null;
	let mediaRecorder = $state<MediaRecorder | null>(null);
	let audioChunks: Blob[] = [];
	let baseText = '';
	let textModified = false;

	const locales = [
		{code: 'en-US', label: 'English (US)'},
		{code: 'en-GB', label: 'English (UK)'},
		{code: 'en-IN', label: 'English (India)'},
		{code: 'en-AU', label: 'English (Australia)'},
		{code: 'en-CA', label: 'English (Canada)'},
		{code: 'en-ZA', label: 'English (South Africa)'},
	];

	onMount(() => {
		// Load preferences
		const storedDirectSend = localStorage.getItem('pi-remote-speech-direct-send');
		if (storedDirectSend !== null) {
			directSend = storedDirectSend === 'true';
		}
		const storedLocale = localStorage.getItem('pi-remote-speech-locale');
		if (storedLocale !== null) {
			locale = storedLocale;
		}
		const storedEngine = localStorage.getItem('pi-remote-speech-engine');
		if (storedEngine !== null) {
			engine = storedEngine as 'browser' | 'cloud';
		} else if (!isBrowserSupported) {
			engine = 'cloud'; // Default to cloud if browser doesn't support Web Speech API
		}

		// Cleanup on destroy
		return () => {
			if (recognitionInstance) {
				try {
					recognitionInstance.abort();
				} catch (e) {}
			}
			if (mediaRecorder && mediaRecorder.state !== 'inactive') {
				try {
					mediaRecorder.stop();
				} catch (e) {}
			}
			if (pressTimer) clearTimeout(pressTimer);
		};
	});

	function savePreferences() {
		localStorage.setItem('pi-remote-speech-direct-send', String(directSend));
		localStorage.setItem('pi-remote-speech-locale', locale);
		localStorage.setItem('pi-remote-speech-engine', engine);
	}

	function getBaseUrl(): string {
		const config = localStorage.getItem('pi-remote-config');
		if (config) {
			const parsed = JSON.parse(config);
			const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
			const host = parsed.host.startsWith('http')
				? parsed.host.replace(/^wss?:\/\//, '')
				: parsed.host;
			return `${protocol}//${host}:${parsed.port}`;
		}
		return `${window.location.protocol}//${window.location.host}`;
	}

	function getToken(): string {
		try {
			const config = localStorage.getItem('pi-remote-config');
			if (config) {
				const parsed = JSON.parse(config);
				return parsed.token || '';
			}
		} catch {}
		return '';
	}

	// ==========================================
	// NATIVE BROWSER SPEECH RECOGNITION (STREAMING)
	// ==========================================
	function startBrowserRecording() {
		if (!isBrowserSupported) return;
		try {
			recognitionInstance = new SpeechRecognition();
			recognitionInstance.continuous = true;
			recognitionInstance.interimResults = true;
			recognitionInstance.lang = locale;

			recognitionInstance.onstart = () => {
				isRecording = true;
			};

			recognitionInstance.onresult = (event: any) => {
				let finalSessionText = '';
				let interimSessionText = '';

				for (let i = event.resultIndex; i < event.results.length; ++i) {
					const result = event.results[i];
					if (result.isFinal) {
						finalSessionText += result[0].transcript;
					} else {
						interimSessionText += result[0].transcript;
					}
				}

				const sessionText = (finalSessionText + interimSessionText).trim();
				if (sessionText) {
					textModified = true;
					text = baseText + (baseText ? ' ' : '') + sessionText;
				}
			};

			recognitionInstance.onerror = (event: any) => {
				console.error('Browser speech recognition error:', event.error);
				if (event.error !== 'no-speech') {
					speechError = `Error: ${event.error}`;
				}
				stopBrowserRecording();
			};

			recognitionInstance.onend = () => {
				isRecording = false;
				if (directSend && textModified && onSend) {
					setTimeout(() => {
						if (text.trim()) {
							onSend();
						}
					}, 50);
				}
			};

			recognitionInstance.start();
			if (navigator.vibrate) {
				navigator.vibrate(40);
			}
		} catch (e: any) {
			console.error('Failed to start browser speech recognition:', e);
			speechError = 'Failed to start browser recording';
			isRecording = false;
		}
	}

	function stopBrowserRecording() {
		if (recognitionInstance) {
			try {
				recognitionInstance.stop();
			} catch (e) {}
		}
		isRecording = false;
	}

	// ==========================================
	// CLOUD SERVER-ASSISTED SPEECH TRANSCRIPTION
	// ==========================================
	async function startCloudRecording() {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({audio: true});
			audioChunks = [];

			let options = {};
			if (typeof MediaRecorder !== 'undefined') {
				if (MediaRecorder.isTypeSupported('audio/webm')) {
					options = {mimeType: 'audio/webm'};
				} else if (MediaRecorder.isTypeSupported('audio/mp4')) {
					options = {mimeType: 'audio/mp4'};
				}
			}

			const recorder = new MediaRecorder(stream, options);
			mediaRecorder = recorder;

			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					audioChunks.push(event.data);
				}
			};

			recorder.onstop = async () => {
				// Stop all tracks of the stream
				stream.getTracks().forEach((track) => track.stop());

				if (audioChunks.length === 0) {
					isRecording = false;
					return;
				}

				const rawBlob = new Blob(audioChunks, {
					type: (options as any).mimeType || 'audio/webm',
				});

				try {
					speechError = null;

					// Convert client raw audio blob to downsampled WAV
					const arrayBuffer = await rawBlob.arrayBuffer();
					const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
					const audioCtx = new AudioContextClass({ sampleRate: 16000 }); // Downsample automatically to 16kHz
					const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
					const wavBuffer = audioBufferToWav(decodedBuffer);
					const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

					const baseUrl = getBaseUrl();
					const token = getToken();
					const url = `${baseUrl}/session/transcribe${token ? `?token=${encodeURIComponent(token)}` : ''}`;

					const res = await fetch(url, {
						method: 'POST',
						body: wavBlob,
						headers: {
							'Content-Type': 'application/octet-stream',
						},
					});

					const data = await res.json();
					if (!res.ok) {
						throw new Error(data.error || `HTTP ${res.status}`);
					}

					if (data.text && data.text.trim()) {
						textModified = true;
						text = baseText + (baseText ? ' ' : '') + data.text.trim();

						// Auto dispatch if enabled
						if (directSend && onSend) {
							setTimeout(() => {
								if (text.trim()) {
									onSend();
								}
							}, 50);
						}
					}
				} catch (err: any) {
					console.error('Cloud transcription request failed:', err);
					speechError = err.message || 'Cloud API failed';
				} finally {
					isRecording = false;
				}
			};

			recorder.start();
			isRecording = true;

			if (navigator.vibrate) {
				navigator.vibrate(40);
			}
		} catch (err: any) {
			console.error('Failed to start cloud audio recording:', err);
			speechError = err.message || 'Microphone access denied';
			isRecording = false;
		}
	}

	function stopCloudRecording() {
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			try {
				mediaRecorder.stop();
			} catch (e) {}
		}
	}

	// ==========================================
	// GESTURE & INTERACTION DISPATCHERS
	// ==========================================
	function startRecording() {
		if (disabled || isRecording) return;
		speechError = null;
		textModified = false;
		baseText = text;

		if (engine === 'cloud') {
			startCloudRecording();
		} else {
			startBrowserRecording();
		}
	}

	function stopRecording() {
		if (engine === 'cloud') {
			stopCloudRecording();
		} else {
			stopBrowserRecording();
		}
	}

	function handlePointerDown(e: PointerEvent) {
		if (e.button !== 0) return; // Only left click / main touch
		if (disabled) return;

		e.preventDefault();
		if (isRecording) {
			stopRecording();
			return;
		}

		isHolding = false;
		pressTimer = setTimeout(() => {
			isHolding = true;
			startRecording();
		}, 350);
	}

	function handlePointerUp(e: PointerEvent) {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}

		if (isHolding) {
			isHolding = false;
			stopRecording();
		} else if (!isRecording) {
			startRecording();
		}
	}

	function handlePointerCancel() {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
		if (isHolding) {
			isHolding = false;
			stopRecording();
		}
	}

	// ==========================================
	// CLIENT-SIDE WAV ENCODER
	// ==========================================
	function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
		const numOfChan = buffer.numberOfChannels;
		const sampleRate = buffer.sampleRate;
		const format = 1; // Raw PCM
		const bitDepth = 16;
		
		let result;
		if (numOfChan === 2) {
			result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
		} else {
			result = buffer.getChannelData(0);
		}
		
		return createWav(result, numOfChan, sampleRate, format, bitDepth);
	}

	function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
		const length = inputL.length + inputR.length;
		const result = new Float32Array(length);
		let index = 0;
		let inputIndex = 0;
		
		while (index < length) {
			result[index++] = inputL[inputIndex];
			result[index++] = inputR[inputIndex];
			inputIndex++;
		}
		return result;
	}

	function createWav(samples: Float32Array, numOfChan: number, sampleRate: number, format: number, bitDepth: number): ArrayBuffer {
		const buffer = new ArrayBuffer(44 + samples.length * 2);
		const view = new DataView(buffer);
		
		/* RIFF identifier */
		writeString(view, 0, 'RIFF');
		/* file length */
		view.setUint32(4, 36 + samples.length * 2, true);
		/* RIFF type */
		writeString(view, 8, 'WAVE');
		/* format chunk identifier */
		writeString(view, 12, 'fmt ');
		/* format chunk length */
		view.setUint32(16, 16, true);
		/* sample format (raw PCM) */
		view.setUint16(20, format, true);
		/* channel count */
		view.setUint16(22, numOfChan, true);
		/* sample rate */
		view.setUint32(24, sampleRate, true);
		/* byte rate (sample rate * block align) */
		view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
		/* block align (channel count * bytes per sample) */
		view.setUint16(32, numOfChan * (bitDepth / 8), true);
		/* bits per sample */
		view.setUint16(34, bitDepth, true);
		/* data chunk identifier */
		writeString(view, 36, 'data');
		/* data chunk length */
		view.setUint32(40, samples.length * 2, true);
		
		floatTo16BitPCM(view, 44, samples);
		
		return buffer;
	}

	function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
		for (let i = 0; i < input.length; i++, offset += 2) {
			let s = Math.max(-1, Math.min(1, input[i]));
			output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
		}
	}

	function writeString(view: DataView, offset: number, string: string) {
		for (let i = 0; i < string.length; i++) {
			view.setUint8(offset + i, string.charCodeAt(i));
		}
	}
</script>

<div class="relative flex select-none items-center gap-1 shrink-0">
	<!-- Mic Button -->
	<button
		type="button"
		disabled={disabled && !isRecording}
		onpointerdown={handlePointerDown}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerCancel}
		class="flex h-[48px] w-[48px] items-center justify-center rounded-lg border transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40
			{isRecording 
				? 'bg-red-600 border-red-500 animate-pulse text-white' 
				: 'bg-gray-800 border-gray-600 text-gray-400 hover:text-white hover:bg-gray-700'}"
		title={isRecording 
			? 'Recording (release/tap to stop)...' 
			: 'Hold to speak (walkie-talkie) or Tap to toggle recording'}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="h-5 w-5"
		>
			<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
			<path d="M19 10v2a7 7 0 0 1-14 0v-2" />
			<line x1="12" x2="12" y1="19" y2="22" />
		</svg>
	</button>

	<!-- Settings Cog Button -->
	<button
		type="button"
		onclick={() => (showSettings = !showSettings)}
		disabled={disabled && !isRecording}
		class="flex h-[48px] w-[28px] items-center justify-center rounded-lg border border-gray-600 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
		title="Speech Settings"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="h-4 w-4 transition-transform duration-200 {showSettings ? 'rotate-45 text-white' : ''}"
		>
			<circle cx="12" cy="12" r="3" />
			<path
				d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
			/>
		</svg>
	</button>

	<!-- Settings Popover -->
	{#if showSettings}
		<!-- Click Outside Backdrop -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-40" onclick={() => (showSettings = false)}></div>

		<div
			class="absolute bottom-14 right-0 z-50 w-64 rounded-lg border border-gray-600 bg-gray-800 p-4 shadow-xl text-xs text-white"
		>
			<h4 class="mb-3 font-semibold text-gray-300 border-b border-gray-700 pb-1.5">
				Speech Settings
			</h4>

			<!-- Engine Selection -->
			<div class="mb-3.5">
				<span class="mb-1 block font-medium text-gray-400">
					Speech-to-Text Engine
				</span>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={() => { engine = 'browser'; savePreferences(); }}
						disabled={!isBrowserSupported}
						class="flex-1 rounded border px-2 py-1.5 text-center font-medium transition-colors disabled:opacity-40
							{engine === 'browser'
								? 'bg-blue-600 border-blue-500 text-white'
								: 'bg-gray-950 border-gray-600 text-gray-400 hover:text-white'}"
					>
						On-Device
					</button>
					<button
						type="button"
						onclick={() => { engine = 'cloud'; savePreferences(); }}
						class="flex-1 rounded border px-2 py-1.5 text-center font-medium transition-colors
							{engine === 'cloud'
								? 'bg-blue-600 border-blue-500 text-white'
								: 'bg-gray-950 border-gray-600 text-gray-400 hover:text-white'}"
					>
						Cloud AI
					</button>
				</div>
				<p class="text-[10px] text-gray-400 mt-1 leading-relaxed">
					{engine === 'browser'
						? 'Uses free built-in browser dictation. Streaming, zero-latency.'
						: 'Uses server-side Z.ai / Groq / OpenAI keys. High accent tolerance.'}
				</p>
			</div>

			<!-- Accent/Locale Selection (Only visible for Browser engine) -->
			{#if engine === 'browser'}
				<div class="mb-3.5">
					<label for="speech-locale" class="mb-1 block font-medium text-gray-400">
						Accent / Locale
					</label>
					<select
						id="speech-locale"
						bind:value={locale}
						onchange={savePreferences}
						class="w-full rounded border border-gray-600 bg-gray-950 px-2 py-1.5 text-white focus:border-blue-500 focus:outline-none"
					>
						{#each locales as loc}
							<option value={loc.code}>{loc.label}</option>
						{/each}
					</select>
				</div>
			{/if}

			<!-- Direct Send Toggle -->
			<div class="mb-2">
				<label class="flex cursor-pointer items-center gap-2 py-1">
					<input
						type="checkbox"
						bind:checked={directSend}
						onchange={savePreferences}
						class="rounded border-gray-600 bg-gray-950 text-blue-600 focus:ring-0 focus:ring-offset-0"
					/>
					<span class="font-medium text-gray-300">Direct Send (Auto-dispatch)</span>
				</label>
				<p class="text-[10px] text-gray-400 pl-6 leading-relaxed">
					When enabled, releasing or stopping the microphone immediately sends the message.
				</p>
			</div>

			{#if speechError}
				<div class="mt-2 text-red-400 bg-red-950/40 p-2 rounded border border-red-900/40 leading-normal">
					{speechError}
				</div>
			{/if}
		</div>
	{/if}
</div>
