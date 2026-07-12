<script lang="ts">
	import '../app.css';
	import {url} from '$lib/core/utils/web/path';

	const features = [
		{
			title: 'Session Mirroring',
			description:
				'Your live sessions and chat conversations are synchronized to the web dashboard in real-time. Follow along, write prompts, and watch edits happen from any device.',
			icon: 'mirror',
		},
		{
			title: 'Headless Handover',
			description:
				'Walk away from your desktop and pick up right where you left off on your phone. Seamless conversation and context transfer between devices.',
			icon: 'handover',
		},
		{
			title: 'Voice Dictation',
			description:
				'Speak your prompts instead of typing. Built-in Web Speech API support lets you dictate complex instructions hands-free while on the go.',
			icon: 'voice',
		},
		{
			title: 'Natural Language Execution',
			description:
				'Write or speak prompts in English or your native language. The AI agent executes bash commands, edits files, and manages tools on your remote machine behind the scenes.',
			icon: 'terminal',
		},
		{
			title: 'File Uploads',
			description:
				'Drag and drop files into your conversations. Upload context, config files, or assets directly from your browser to give the AI agent the exact information it needs.',
			icon: 'upload',
		},
		{
			title: 'Git Integration',
			description:
				'Create a new folder and have a git repo auto-initialized and tracked — no manual `git init` needed. All version control configured remotely, ready from day one.',
			icon: 'git',
		},
		{
			title: 'Session Browser',
			description:
				'Browse your conversation history with full-text search. Jump between sessions, find specific code snippets, and resume where you left off.',
			icon: 'browser',
		},
		{
			title: 'Mobile UX',
			description:
				'Fully responsive design that works beautifully on phones and tablets. Touch-optimized controls, swipe gestures, and a collapsible sidebar.',
			icon: 'mobile',
		},
	];

	const installSteps = [
		{
			number: '01',
			title: 'Install the Server',
			description:
				'Install the wherever-dev server package globally or locally in your project.',
			code: 'npm install -g wherever-dev',
		},
		{
			number: '02',
			title: 'Start the Server',
			description: 'Launch the server with your preferred token and port.',
			code: 'wherever start',
		},
		{
			number: '03',
			title: 'Run it as a Service',
			description:
				'Optional: install a background service (systemd on Linux, launchd on macOS) that starts on boot and wires the pi extension in automatically.',
			code: 'wherever install',
		},
		{
			number: '04',
			title: 'Open the Dashboard',
			description:
				'Open the dashboard in your browser and start creating and maintaining your apps.',
			code: 'open http://localhost:31415',
		},
	];

	function scrollTo(id: string) {
		document.getElementById(id)?.scrollIntoView({behavior: 'smooth'});
	}

	function getFeatureIcon(icon: string) {
		const icons: {[key: string]: string} = {
			mirror: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4',
			handover:
				'M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5',
			voice:
				'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z',
			terminal:
				'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
			upload: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
			git: 'M10 12l4 4m0-8l-4 4m4-4V4',
			browser:
				'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
			mobile:
				'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
		};
		return icons[icon] || icons.mirror;
	}
</script>

<!-- Navigation -->
<nav
	class="fixed top-0 right-0 left-0 z-50 border-b border-brand-border bg-brand-dark/80 backdrop-blur-md"
>
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="flex h-16 items-center justify-between">
			<div class="flex items-center gap-3">
				<img src={url('/logo.svg')} alt="wherever logo" class="h-8 w-8" />
				<span class="gradient-text text-lg font-bold">wherever</span>
			</div>
			<div class="hidden items-center gap-8 md:flex">
				<button
					on:click={() => scrollTo('features')}
					class="text-brand-text-muted transition-colors hover:text-brand-text"
					>Features</button
				>
				<button
					on:click={() => scrollTo('install')}
					class="text-brand-text-muted transition-colors hover:text-brand-text"
					>Install</button
				>
				<a
					href="https://github.com/wighawag/wherever"
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-surface-2 px-4 py-2 transition-colors hover:bg-brand-surface-3"
				>
					<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"
						><path
							d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
						/></svg
					>
					GitHub
				</a>
			</div>
		</div>
	</div>
</nav>

<!-- Hero Section -->
<section class="relative flex overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
	<div
		class="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-brand-cyan/10 blur-3xl"
	></div>
	<div
		class="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-brand-purple/10 blur-3xl"
	></div>
	<div class="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="text-center">
			<div class="mb-8 flex justify-center">
				<img
					src={url('/logo.svg')}
					alt="wherever"
					class="h-24 w-24 sm:h-32 sm:w-32"
				/>
			</div>
			<h1 class="mb-6 text-4xl font-bold sm:text-5xl md:text-7xl">
				<span class="gradient-text">Create & maintain apps</span><br />
				<span class="text-brand-text">from wherever</span>
			</h1>
			<p
				class="mx-auto mb-10 max-w-2xl text-lg text-brand-text-muted sm:text-xl"
			>
				A beautiful remote workspace that puts your development environment in
				your pocket. Sync your live conversations, manage sessions from any
				device, and pick up wherever you left off.
			</p>
			<div class="flex flex-col justify-center gap-4 sm:flex-row">
				<button
					on:click={() => scrollTo('install')}
					class="rounded-xl bg-gradient-to-r from-brand-cyan via-brand-blue to-brand-purple px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-brand-blue/25 transition-opacity hover:opacity-90"
					>Get Started</button
				>
				<a
					href="https://github.com/wighawag/wherever"
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center justify-center gap-2 rounded-xl border border-brand-border bg-brand-surface-2 px-8 py-4 text-lg font-semibold text-brand-text transition-colors hover:bg-brand-surface-3"
				>
					<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"
						><path
							d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
						/></svg
					>
					View on GitHub
				</a>
			</div>
		</div>
	</div>
</section>

<!-- Features Section -->
<section id="features" class="py-24 sm:py-32">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="mb-16 text-center">
			<h2 class="mb-4 text-3xl font-bold sm:text-4xl">
				<span class="gradient-text">Everything you need</span>
			</h2>
			<p class="mx-auto max-w-xl text-lg text-brand-text-muted">
				A complete remote development experience, designed for both desktop and
				mobile.
			</p>
		</div>
		<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
			{#each features as feature}
				<div
					class="group rounded-2xl border border-brand-border bg-brand-surface p-6 transition-all duration-300 hover:border-brand-blue/50 hover:shadow-lg hover:shadow-brand-blue/5"
				>
					<div
						class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-cyan/20 to-brand-purple/20 transition-transform group-hover:scale-110"
					>
						<svg
							class="h-6 w-6 text-brand-cyan"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d={getFeatureIcon(feature.icon)}
							/></svg
						>
					</div>
					<h3 class="mb-2 text-lg font-semibold text-brand-text">
						{feature.title}
					</h3>
					<p class="text-sm leading-relaxed text-brand-text-muted">
						{feature.description}
					</p>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- Install Guide Section -->
<section id="install" class="py-24 sm:py-32">
	<div class="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
		<div class="mb-16 text-center">
			<h2 class="mb-4 text-3xl font-bold sm:text-4xl">
				<span class="gradient-text">Get started in seconds</span>
			</h2>
			<p class="mx-auto max-w-xl text-lg text-brand-text-muted">
				Three steps to start creating and maintaining apps from any device.
			</p>
		</div>
		<div class="space-y-6">
			{#each installSteps as step}
				<div
					class="overflow-hidden rounded-2xl border border-brand-border bg-brand-surface"
				>
					<div class="p-6 sm:p-8">
						<div class="flex items-start gap-4">
							<div
								class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-cyan/20 to-brand-purple/20 text-sm font-bold text-brand-cyan"
							>
								{step.number.replace('0', '')}
							</div>
							<div class="flex-1">
								<h3 class="mb-2 text-lg font-semibold text-brand-text">
									{step.title}
								</h3>
								<p class="mb-4 text-brand-text-muted">{step.description}</p>
								{#if step.code}
									<div
										class="rounded-xl border border-brand-border bg-brand-dark p-4"
									>
										<code class="font-mono text-sm text-brand-cyan"
											>{step.code}</code
										>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
		<div class="mt-12 text-center">
			<a
				href="https://github.com/wighawag/wherever"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-cyan via-brand-blue to-brand-purple px-8 py-4 font-semibold text-white shadow-lg shadow-brand-blue/25 transition-opacity hover:opacity-90"
			>
				<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"
					><path
						d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
					/></svg
				>
				View on GitHub
			</a>
		</div>
	</div>
</section>

<!-- Footer -->
<footer class="border-t border-brand-border py-12">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="flex flex-col items-center justify-between gap-6 md:flex-row">
			<div class="flex items-center gap-3">
				<img src={url('/logo.svg')} alt="wherever logo" class="h-6 w-6" />
				<span class="text-sm text-brand-text-muted">
					Copyright &copy; 2026 Ronan Sandford. Released under the
					<a
						href="https://opensource.org/licenses/MIT"
						target="_blank"
						rel="noopener noreferrer"
						class="text-brand-cyan hover:underline">MIT License</a
					>.
				</span>
			</div>
			<div class="flex items-center gap-6">
				<a
					href="https://github.com/wighawag/wherever"
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-2 text-brand-text-muted transition-colors hover:text-brand-text"
				>
					<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"
						><path
							d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
						/></svg
					>
					GitHub
				</a>
			</div>
		</div>
	</div>
</footer>
