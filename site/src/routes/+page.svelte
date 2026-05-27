<script lang="ts">
	import '../app.css';

	const features = [
		{ title: 'CLI Mirroring', description: 'Every command you run in your terminal is mirrored to the web dashboard in real-time. Watch your agent think, edit files, and run commands from any device.', icon: 'mirror' },
		{ title: 'Headless Handover', description: 'Walk away from your terminal and pick up right where you left off on your phone. Seamless context transfer between your desktop and remote sessions.', icon: 'handover' },
		{ title: 'Voice Dictation', description: 'Speak your prompts instead of typing. Built-in Web Speech API support lets you dictate complex instructions hands-free while on the go.', icon: 'voice' },
		{ title: 'Bash Execution', description: 'Run shell commands directly from the dashboard. Execute, monitor, and kill terminal processes with a beautiful mobile-first interface.', icon: 'terminal' },
		{ title: 'File Uploads', description: 'Drag and drop files into your agent workspace. Upload context files, configs, or assets directly from your browser to the remote machine.', icon: 'upload' },
		{ title: 'Git Integration', description: 'Create a new folder and have a git repo auto-initialized and tracked — no manual `git init` needed. All version control configured remotely, ready from day one.', icon: 'git' },
		{ title: 'Session Browser', description: 'Browse your conversation history with full-text search. Jump between sessions, find specific code snippets, and resume where you left off.', icon: 'browser' },
		{ title: 'Mobile UX', description: 'Fully responsive design that works beautifully on phones and tablets. Touch-optimized controls, swipe gestures, and a collapsible sidebar.', icon: 'mobile' },
	];

	const architectureSteps = [
		{ number: '01', title: 'Web Dashboard', description: 'A beautiful, mobile-responsive interface that connects to your server via WebSocket. Control everything from any browser.' },
		{ number: '02', title: 'Standalone Server', description: 'A lightweight extension server that bridges WebSocket clients with the pi CLI. Handles sessions, auth, and event broadcasting.' },
		{ number: '03', title: 'CLI Extension', description: "The pi-remote extension plugs into pi's extension system, forwarding commands to and from the server in real-time." },
	];

	const installSteps = [
		{ number: '01', title: 'Install the Server', description: 'Install the pi-remote server package globally or locally in your project.', code: 'npm install -g pi-remote-server' },
		{ number: '02', title: 'Install the Extension', description: 'Tell pi to use the remote extension for this project.', code: 'pi install pi-remote' },
		{ number: '03', title: 'Start the Server', description: 'Launch the server with your preferred token and port.', code: 'pi --extension pi-remote --remote-port 31415 --remote-token your-secret' },
		{ number: '04', title: 'Open the Dashboard', description: 'Open the dashboard in your browser and start controlling your agent from anywhere.', code: 'open http://localhost:31415' },
	];

	function scrollTo(id) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
	}

	function getFeatureIcon(icon) {
		const icons = {
			mirror: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4',
			handover: 'M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5',
			voice: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z',
			terminal: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
			upload: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
			git: 'M10 12l4 4m0-8l-4 4m4-4V4',
			browser: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
			mobile: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
		};
		return icons[icon] || icons.mirror;
	}
</script>
<!-- Navigation -->
<nav class="fixed top-0 left-0 right-0 z-50 bg-brand-dark/80 backdrop-blur-md border-b border-brand-border">
	<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
		<div class="flex items-center justify-between h-16">
			<div class="flex items-center gap-3">
				<img src="/logo.svg" alt="pi-remote logo" class="w-8 h-8" />
				<span class="text-lg font-bold gradient-text">pi-remote</span>
			</div>
			<div class="hidden md:flex items-center gap-8">
				<button on:click={() => scrollTo('features')} class="text-brand-text-muted hover:text-brand-text transition-colors">Features</button>
				<button on:click={() => scrollTo('architecture')} class="text-brand-text-muted hover:text-brand-text transition-colors">How it Works</button>
				<button on:click={() => scrollTo('install')} class="text-brand-text-muted hover:text-brand-text transition-colors">Install</button>
				<a href="https://github.com/wighawag/pi-remote" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-surface-2 hover:bg-brand-surface-3 border border-brand-border transition-colors">
					<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
					GitHub
				</a>
			</div>
		</div>
	</div>
</nav>

<!-- Hero Section -->
<section class="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
	<div class="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-cyan/10 rounded-full blur-3xl"></div>
	<div class="absolute bottom-1/4 right-1/4 w-96 h-96 bg-brand-purple/10 rounded-full blur-3xl"></div>
	<div class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
		<div class="text-center">
			<div class="flex justify-center mb-8">
				<img src="/logo.svg" alt="pi-remote" class="w-24 h-24 sm:w-32 sm:h-32" />
			</div>
			<h1 class="text-4xl sm:text-5xl md:text-7xl font-bold mb-6">
				<span class="gradient-text">Control your pi</span><br />
				<span class="text-brand-text">coding agent from anywhere</span>
			</h1>
			<p class="text-lg sm:text-xl text-brand-text-muted max-w-2xl mx-auto mb-10">
				A beautiful remote dashboard for your pi coding agent. Mirror your terminal, control sessions from your phone, and pick up wherever you left off.
			</p>
			<div class="flex flex-col sm:flex-row gap-4 justify-center mb-16">
				<button on:click={() => scrollTo('install')} class="px-8 py-4 rounded-xl bg-gradient-to-r from-brand-cyan via-brand-blue to-brand-purple text-white font-semibold text-lg hover:opacity-90 transition-opacity shadow-lg shadow-brand-blue/25">Get Started</button>
				<a href="https://github.com/wighawag/pi-remote" target="_blank" rel="noopener noreferrer" class="px-8 py-4 rounded-xl bg-brand-surface-2 hover:bg-brand-surface-3 border border-brand-border text-brand-text font-semibold text-lg transition-colors flex items-center justify-center gap-2">
					<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
					View on GitHub
				</a>
			</div>

			<!-- Architecture Mini Diagram -->
			<div class="max-w-2xl mx-auto">
				<div class="bg-brand-surface rounded-2xl border border-brand-border p-6 sm:p-8">
					<p class="text-sm text-brand-text-muted mb-6 font-medium uppercase tracking-wider">Architecture Overview</p>
					<div class="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6">
						<!-- Browser -->
						<div class="flex flex-col items-center gap-2">
							<div class="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-brand-surface-2 border border-brand-border flex items-center justify-center">
								<svg class="w-7 h-7 sm:w-8 sm:h-8 text-brand-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
							</div>
							<span class="text-xs text-brand-text-muted">Browser</span>
						</div>
						<!-- Connector: Browser → Server -->
						<div class="flex items-center gap-1">
							<div class="w-8 sm:w-12 h-px bg-gradient-to-r from-brand-cyan/50 to-brand-blue/50"></div>
							<span class="text-[10px] text-brand-text-muted px-1">WS</span>
							<div class="w-2 h-2 rounded-full bg-brand-cyan/50"></div>
						</div>
						<!-- Server -->
						<div class="flex flex-col items-center gap-2">
							<div class="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-brand-surface-2 border border-brand-border flex items-center justify-center">
								<svg class="w-7 h-7 sm:w-8 sm:h-8 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
							</div>
							<span class="text-xs text-brand-text-muted">Server</span>
						</div>
						<!-- Connector: Server → CLI -->
						<div class="flex items-center gap-1">
							<div class="w-8 sm:w-12 h-px bg-gradient-to-r from-brand-blue/50 to-brand-purple/50"></div>
							<span class="text-[10px] text-brand-text-muted px-1">Ext</span>
							<div class="w-2 h-2 rounded-full bg-brand-blue/50"></div>
						</div>
						<!-- pi CLI -->
						<div class="flex flex-col items-center gap-2">
							<div class="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-brand-surface-2 border border-brand-border flex items-center justify-center">
								<svg class="w-7 h-7 sm:w-8 sm:h-8 text-brand-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
							</div>
							<span class="text-xs text-brand-text-muted">pi CLI</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>

<!-- Features Section -->
<section id="features" class="py-24 sm:py-32">
	<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
		<div class="text-center mb-16">
			<h2 class="text-3xl sm:text-4xl font-bold mb-4"><span class="gradient-text">Everything you need</span></h2>
			<p class="text-lg text-brand-text-muted max-w-xl mx-auto">A complete remote control experience for your pi coding agent, designed for both desktop and mobile.</p>
		</div>
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
			{#each features as feature}
				<div class="group bg-brand-surface rounded-2xl border border-brand-border p-6 hover:border-brand-blue/50 transition-all duration-300 hover:shadow-lg hover:shadow-brand-blue/5">
					<div class="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-cyan/20 to-brand-purple/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
						<svg class="w-6 h-6 text-brand-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="{getFeatureIcon(feature.icon)}" /></svg>
					</div>
					<h3 class="text-lg font-semibold mb-2 text-brand-text">{feature.title}</h3>
					<p class="text-sm text-brand-text-muted leading-relaxed">{feature.description}</p>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- How it Works Section -->
<section id="architecture" class="py-24 sm:py-32 bg-brand-surface">
	<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
		<div class="text-center mb-16">
			<h2 class="text-3xl sm:text-4xl font-bold mb-4"><span class="gradient-text">How it works</span></h2>
			<p class="text-lg text-brand-text-muted max-w-xl mx-auto">Three simple components that work together to give you complete remote control.</p>
		</div>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-8">
			{#each architectureSteps as step}
				<div class="relative">
					<div class="bg-brand-dark rounded-2xl border border-brand-border p-8 h-full">
						<div class="text-4xl font-bold gradient-text mb-4">{step.number}</div>
						<h3 class="text-xl font-semibold mb-3 text-brand-text">{step.title}</h3>
						<p class="text-brand-text-muted leading-relaxed">{step.description}</p>
					</div>
				</div>
			{/each}
		</div>
		<div class="mt-16 bg-brand-dark rounded-2xl border border-brand-border p-4 sm:p-8">
			<div class="overflow-x-auto">
				<pre class="text-xs sm:text-sm text-brand-text-muted leading-relaxed font-mono whitespace-pre min-w-[320px]">
┌──────────────────┐         ┌─────────────────────────────┐         ┌──────────────────┐
│                  │  WS     │                             │  Ext    │                  │
│  Web Browser     │────────►│    pi-remote Server         │────────►│  pi CLI          │
│  (any device)    │◄────────│    (Extension + REST API)   │◄────────│  (Agent + Tools) │
│                  │  WS     │                             │  Ext    │                  │
└──────────────────┘         └─────────────────────────────┘         └──────────────────┘
			</pre>
			</div>
		</div>
	</div>
</section>

<!-- Install Guide Section -->
<section id="install" class="py-24 sm:py-32">
	<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
		<div class="text-center mb-16">
			<h2 class="text-3xl sm:text-4xl font-bold mb-4"><span class="gradient-text">Get started in minutes</span></h2>
			<p class="text-lg text-brand-text-muted max-w-xl mx-auto">Four steps to remote control your pi coding agent from any device.</p>
		</div>
		<div class="space-y-6">
			{#each installSteps as step}
				<div class="bg-brand-surface rounded-2xl border border-brand-border overflow-hidden">
					<div class="p-6 sm:p-8">
						<div class="flex items-start gap-4">
							<div class="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-brand-cyan/20 to-brand-purple/20 flex items-center justify-center text-brand-cyan font-bold text-sm">
								{step.number.replace('0', '')}
							</div>
							<div class="flex-1">
								<h3 class="text-lg font-semibold mb-2 text-brand-text">{step.title}</h3>
								<p class="text-brand-text-muted mb-4">{step.description}</p>
								{#if step.code}
									<div class="bg-brand-dark rounded-xl border border-brand-border p-4">
										<code class="text-brand-cyan text-sm font-mono">{step.code}</code>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
		<div class="mt-12 text-center">
			<a href="https://github.com/wighawag/pi-remote" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-brand-cyan via-brand-blue to-brand-purple text-white font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-brand-blue/25">
				<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
				View on GitHub
			</a>
		</div>
	</div>
</section>

<!-- Footer -->
<footer class="border-t border-brand-border py-12">
	<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
		<div class="flex flex-col md:flex-row items-center justify-between gap-6">
			<div class="flex items-center gap-3">
				<img src="/logo.svg" alt="pi-remote logo" class="w-6 h-6" />
				<span class="text-sm text-brand-text-muted">
					Copyright &copy; 2024 pi-remote. Released under the
					<a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener noreferrer" class="text-brand-cyan hover:underline">MIT License</a>.
				</span>
			</div>
			<div class="flex items-center gap-6">
				<a href="https://github.com/wighawag/pi-remote" target="_blank" rel="noopener noreferrer" class="text-brand-text-muted hover:text-brand-text transition-colors flex items-center gap-2">
					<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
					GitHub
				</a>
			</div>
		</div>
	</div>
</footer>
