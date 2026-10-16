<script lang="ts">
  import { onMount } from 'svelte';
  import { getApiBaseUrl, isHostedUi, setBackendUrl } from '../lib/client/api-config';
  import { healthStatus } from '../lib/client/server-health';

  let current = '';
  let address = '';
  let choosing = false;
  let error = '';

  onMount(() => {
    if (!isHostedUi()) return;
    current = getApiBaseUrl();
    address = current;
    choosing = !current;
  });

  function connect(event: SubmitEvent): void {
    event.preventDefault();
    try {
      setBackendUrl(address);
      // Dispose the current machine's views and subscriptions together. Work
      // already admitted on that machine remains owned by its Coordinator.
      window.location.reload();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

{#if isHostedUi()}
  {#if choosing}
    <div class="fixed inset-0 z-[10020] flex items-center justify-center bg-slate-950/95 p-5">
      <form on:submit={connect} class="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-7 text-slate-100 shadow-xl">
        <h1 class="mb-3 text-2xl font-semibold">Connect to MetaHuman OS</h1>
        <p class="mb-6 text-sm leading-relaxed text-slate-300">Choose the machine you want to use. Your accounts, memories, models, and services stay on that machine.</p>
        <label for="backend-address" class="mb-2 block text-sm font-medium">Machine address</label>
        <input id="backend-address" bind:value={address} type="url" required placeholder="https://desktop.ainek.io" autocomplete="url"
          class="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-3 text-slate-100" />
        <p class="mt-3 text-xs leading-relaxed text-slate-400">Use the machine's HTTPS tunnel address under ainek.io. The machine and its tunnel must be running to connect.</p>
        {#if error}<p role="alert" class="mt-4 text-sm text-red-300">{error}</p>{/if}
        <div class="mt-6 flex justify-end gap-3">
          {#if current}<button type="button" on:click={() => choosing = false} class="rounded-lg border border-slate-600 px-4 py-2">Cancel</button>{/if}
          <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500">Connect</button>
        </div>
      </form>
    </div>
  {:else if current}
    <button type="button" on:click={() => { address = current; error = ''; choosing = true; }}
      class="fixed bottom-3 left-3 z-[10010] max-w-[75vw] truncate rounded-full border border-slate-500 bg-slate-900 px-4 py-2 text-xs text-slate-100 shadow-lg"
      title={$healthStatus.error || 'Change backend machine'}>Machine: {current} · {$healthStatus.connected ? 'Reachable' : $healthStatus.error ? 'Unavailable' : 'Connecting'} · Change</button>
  {/if}
{/if}
