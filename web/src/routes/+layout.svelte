<script lang="ts">
	import Notifications from '$lib/core/notifications/Notifications.svelte';
	import VersionAndInstallNotfications from '$lib/core/service-worker/VersionAndInstallNotfications.svelte';
	import '../app.css';
	let {children} = $props();
</script>

{@render children()}

<Notifications />

<VersionAndInstallNotfications src="" alt="" />
