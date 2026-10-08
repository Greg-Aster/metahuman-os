<script lang="ts">
  interface ConnectionAgent {
    id: string;
    variables: { key: string; value: string | number | boolean | string[] | null }[];
  }
  export let agents: ConnectionAgent[] = [];
  export let activeAgentId = '';
  export let busy = false;
  export let onConnect: (agent: string, settings: Record<string, string | number>) => Promise<void>;

  let route = 'local';
  let initialized = false;
  let localUrl = '';
  let remoteUrl = '';
  let sshTarget = '';
  let sshGatewayPort = 8790;
  let cloudflareHostname = '';
  let accessEnvFile = '';

  function value(id: string, key: string) {
    return agents.find(agent => agent.id === id)?.variables.find(variable => variable.key === key)?.value;
  }

  $: if (!initialized && agents.some(agent => agent.id === 'environment-bridge-local')) {
    localUrl = String(value('environment-bridge-local', 'adapterUrl') || 'ws://127.0.0.1:8790/environment');
    remoteUrl = String(value('environment-bridge-remote', 'adapterUrl') || 'ws://127.0.0.1:18790/environment');
    sshTarget = String(value('environment-bridge-remote', 'sshTarget') || '');
    sshGatewayPort = Number(value('environment-bridge-remote', 'sshGatewayPort') ?? 8790);
    cloudflareHostname = String(value('environment-bridge-remote', 'cloudflareHostname') || '');
    accessEnvFile = String(value('environment-bridge-remote', 'accessEnvFile') || '');
    const selected = activeAgentId || (value('environment-bridge-remote', 'startOnSystemBoot') ? 'environment-bridge-remote' : 'environment-bridge-local');
    route = selected === 'environment-bridge-remote' ? String(value(selected, 'transport') || 'cloudflare') : 'local';
    initialized = true;
  }

  async function connect() {
    if (route === 'local') {
      await onConnect('environment-bridge-local', { adapterUrl: localUrl });
    } else {
      await onConnect('environment-bridge-remote', {
        adapterUrl: remoteUrl, transport: route,
        ...(route === 'ssh' ? { sshTarget, sshGatewayPort } : { cloudflareHostname, accessEnvFile }),
      });
    }
  }
</script>

{#if initialized}
  <form id="body-connection" class="mt-3 space-y-2 rounded border border-gray-300 p-2 dark:border-gray-700" on:submit|preventDefault={connect}>
    <fieldset disabled={busy} class="space-y-2 disabled:opacity-50">
      <legend class="text-xs font-semibold">Body connection</legend>
      <label class="block text-xs">
        Connect to Body Control
        <select bind:value={route} class="mt-1 w-full rounded border bg-white p-2 text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100">
          <option value="local">This computer</option>
          <option value="ssh">LAN / Wi-Fi via SSH</option>
          <option value="cloudflare">Remote via Cloudflare</option>
        </select>
      </label>
      <p class="text-xs text-gray-500 dark:text-gray-400">“This computer” means the machine running MetaHuman. Body Control must already be running on the selected machine. Wi-Fi network selection stays in the operating system.</p>
      {#if route === 'local'}
        <label class="block text-xs">Local adapter URL
          <input required type="url" bind:value={localUrl} class="mt-1 w-full rounded border bg-transparent p-2" />
        </label>
      {:else}
        {#if route === 'ssh'}
          <label class="block text-xs">SSH destination
            <input required bind:value={sshTarget} placeholder="user@hostname or SSH host alias" class="mt-1 w-full rounded border bg-transparent p-2" />
          </label>
          <label class="block text-xs">Gateway port on remote machine
            <input required type="number" min="1" max="65535" bind:value={sshGatewayPort} class="mt-1 w-full rounded border bg-transparent p-2" />
          </label>
          <p class="text-xs text-gray-500 dark:text-gray-400">Set up trusted, noninteractive SSH access from the MetaHuman machine first. SSH host aliases can specify a user, key and SSH port. This forwards the gateway, not the dashboard.</p>
        {:else}
          <label class="block text-xs">Cloudflare hostname
            <input required bind:value={cloudflareHostname} placeholder="Your configured Access TCP hostname" class="mt-1 w-full rounded border bg-transparent p-2" />
          </label>
          <label class="block text-xs">Service token file on MetaHuman machine
            <input bind:value={accessEnvFile} placeholder="Empty uses existing browser login" class="mt-1 w-full rounded border bg-transparent p-2" />
          </label>
        {/if}
        <label class="block text-xs">Forwarded adapter URL on MetaHuman machine
          <input required type="url" bind:value={remoteUrl} class="mt-1 w-full rounded border bg-transparent p-2" />
        </label>
      {/if}
      <p class="text-xs text-gray-500 dark:text-gray-400">Save and connect restarts an already selected bridge or switches from the other bridge. It saves the startup choice. Switching interrupts the connection; it does not transfer a running task to another body.</p>
      <button type="submit" class="rounded bg-gray-900 px-3 py-2 text-xs font-semibold text-white dark:bg-gray-100 dark:text-gray-950">{busy ? 'Connecting…' : 'Save and connect'}</button>
    </fieldset>
  </form>
{/if}
