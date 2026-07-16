<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import {
    agentCatalogConnection,
    agentCatalogError,
    agentCatalogSnapshot,
    refreshAgentCatalog,
    registerCatalogAgent,
    unregisterCatalogAgent,
    useAgentCatalog,
    type AgentCatalogItem,
  } from '../lib/stores/agent-catalog';
  import { patchTriggerConfig } from '../lib/stores/trigger-manager';
  import { openTriggerManagerSettings } from '../stores/navigation';
  import MoodAgentSettings from './MoodAgentSettings.svelte';

  type Filter = 'all' | 'registered' | 'available' | 'services' | 'workflow' | 'problems';

  let release: (() => void) | undefined;
  let filter: Filter = 'all';
  let search = '';
  let busy = '';
  let feedback = '';
  let localError = '';

  onMount(() => release = useAgentCatalog());
  onDestroy(() => release?.());

  $: normalizedSearch = search.trim().toLowerCase();
  $: agents = ($agentCatalogSnapshot?.agents || []).filter(agent => {
    if (filter === 'registered' && !agent.triggerRegistered) return false;
    if (filter === 'available' && !agent.canRegister) return false;
    if (filter === 'services' && !agent.serviceRegistered) return false;
    if (filter === 'workflow' && agent.lifecycle !== 'workflow' && agent.parentIds.length === 0) return false;
    if (filter === 'problems' && agent.health !== 'missing-source') return false;
    return !normalizedSearch || [agent.id, agent.displayName, agent.description, ...agent.tags]
      .some(value => value.toLowerCase().includes(normalizedSearch));
  });

  function ownerLabel(agent: AgentCatalogItem): string {
    if (agent.serviceRegistered) return 'Agent Monitor service';
    if (agent.triggerRegistered) return agent.triggerType === 'manual' ? 'Trigger Manager · manual' : `Trigger Manager · ${agent.triggerType}`;
    if (agent.parentIds.length > 0) return `Workflow child · ${agent.parentIds.join(', ')}`;
    return 'Installed · not scheduled';
  }

  function healthClass(agent: AgentCatalogItem): string {
    if (agent.health === 'missing-source') return 'bg-red-500/10 text-red-700 dark:text-red-300';
    if (agent.health === 'disabled') return 'bg-gray-500/10 text-gray-700 dark:text-gray-300';
    if (agent.health === 'available') return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
    return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }

  async function register(agent: AgentCatalogItem) {
    const warning = agent.risk === 'destructive'
      ? `${agent.displayName} can alter or remove active data. Register it with a manual trigger?`
      : agent.risk === 'privileged'
        ? `${agent.displayName} has privileged system capabilities. Register it with a manual trigger?`
        : `Register ${agent.displayName} with Trigger Manager using its safe default?`;
    if (!window.confirm(warning)) return;
    busy = agent.id;
    localError = '';
    feedback = '';
    try {
      await registerCatalogAgent(agent.id);
      feedback = `${agent.displayName} is now registered with Trigger Manager.`;
    } catch (error) {
      localError = error instanceof Error ? error.message : String(error);
    } finally {
      busy = '';
    }
  }

  async function unregister(agent: AgentCatalogItem) {
    if (!window.confirm(`Unregister ${agent.displayName} from Trigger Manager? Installed source, logs, history, and already queued work will be preserved.`)) return;
    busy = agent.id;
    localError = '';
    feedback = '';
    try {
      await unregisterCatalogAgent(agent.id);
      feedback = `${agent.displayName} was removed from Trigger Manager scheduling. Its installed source remains available.`;
    } catch (error) {
      localError = error instanceof Error ? error.message : String(error);
    } finally {
      busy = '';
    }
  }

  async function toggleEnabled(agent: AgentCatalogItem, enabled: boolean) {
    busy = agent.id;
    localError = '';
    try {
      await patchTriggerConfig({ agents: { [agent.id]: { enabled } } });
      await refreshAgentCatalog();
      feedback = `${agent.displayName} ${enabled ? 'enabled' : 'disabled'}.`;
    } catch (error) {
      localError = error instanceof Error ? error.message : String(error);
    } finally {
      busy = '';
    }
  }

  async function runNow(agent: AgentCatalogItem) {
    busy = agent.id;
    localError = '';
    try {
      const response = await apiFetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || data.message || 'Agent run failed');
      feedback = data.taskId
        ? `${agent.displayName} queued as ${data.taskId}.`
        : `${agent.displayName} start requested${data.pid ? ` as PID ${data.pid}` : ''}.`;
    } catch (error) {
      localError = error instanceof Error ? error.message : String(error);
    } finally {
      busy = '';
    }
  }
</script>

<div class="mx-auto max-w-[1150px] p-6">
  <header class="mb-6 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 class="text-2xl font-semibold text-gray-900 dark:text-gray-100">Agent Catalog</h2>
      <p class="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">Authoritative inventory of installed finite agents, workflow children, and persistent services. Registration controls Trigger Manager membership; it never deletes agent source or history.</p>
    </div>
    <button class="rounded border px-3 py-2 text-sm dark:border-gray-700" on:click={openTriggerManagerSettings}>Trigger scheduling</button>
  </header>

  {#if feedback}<div class="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{feedback}</div>{/if}
  {#if localError || $agentCatalogError}<div class="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{localError || $agentCatalogError}</div>{/if}

  <MoodAgentSettings />

  {#if !$agentCatalogSnapshot}
    <div class="py-12 text-center text-gray-500">Loading Agent Catalog…</div>
  {:else}
    <section class="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div class="rounded border p-3 dark:border-gray-800"><div class="text-xs text-gray-500">Catalog</div><div class="text-xl font-semibold">{$agentCatalogSnapshot.counts.total}</div></div>
      <div class="rounded border p-3 dark:border-gray-800"><div class="text-xs text-gray-500">Installed</div><div class="text-xl font-semibold">{$agentCatalogSnapshot.counts.installed}</div></div>
      <div class="rounded border p-3 dark:border-gray-800"><div class="text-xs text-gray-500">Triggers</div><div class="text-xl font-semibold">{$agentCatalogSnapshot.counts.triggerRegistered}</div></div>
      <div class="rounded border p-3 dark:border-gray-800"><div class="text-xs text-gray-500">Services</div><div class="text-xl font-semibold">{$agentCatalogSnapshot.counts.services}</div></div>
      <div class="rounded border p-3 dark:border-gray-800"><div class="text-xs text-gray-500">Available</div><div class="text-xl font-semibold">{$agentCatalogSnapshot.counts.available}</div></div>
      <div class="rounded border p-3 dark:border-gray-800"><div class="text-xs text-gray-500">Problems</div><div class="text-xl font-semibold">{$agentCatalogSnapshot.counts.missingSource}</div></div>
    </section>

    <section class="mb-4 rounded border border-gray-200 p-3 dark:border-gray-800">
      <div class="flex flex-wrap gap-2">
        <input class="form-input min-w-[14rem] flex-1" placeholder="Search agents, capabilities, or tags" bind:value={search} />
        {#each ['all', 'registered', 'available', 'services', 'workflow', 'problems'] as option}
          <button class="rounded border px-3 py-2 text-xs capitalize dark:border-gray-700" class:border-violet-500={filter === option} class:text-violet-700={filter === option} on:click={() => filter = option as Filter}>{option}</button>
        {/each}
      </div>
      <div class="mt-2 text-xs text-gray-500">{$agentCatalogConnection} · system catalog r{$agentCatalogSnapshot.revision} · showing {agents.length} of {$agentCatalogSnapshot.counts.total}</div>
    </section>

    <div class="space-y-3">
      {#each agents as agent}
        <article class="rounded border border-gray-200 p-4 dark:border-gray-800">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-semibold">{agent.displayName}</h3>
                <span class="rounded px-2 py-0.5 text-[0.68rem] {healthClass(agent)}">{agent.health}</span>
                {#if agent.risk !== 'standard'}<span class="rounded bg-amber-500/10 px-2 py-0.5 text-[0.68rem] text-amber-700 dark:text-amber-300">{agent.risk}</span>{/if}
                {#if agent.usesLLM}<span class="rounded bg-violet-500/10 px-2 py-0.5 text-[0.68rem] text-violet-700 dark:text-violet-300">LLM</span>{/if}
              </div>
              <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">{agent.description}</p>
              <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>{ownerLabel(agent)}</span><span>ID: {agent.id}</span><span>Handler: {agent.handler}</span>
                {#if agent.sourcePath}<span>Source: {agent.sourcePath}</span>{/if}
                {#if agent.sourceAgentId !== agent.id}<span>Source ID: {agent.sourceAgentId}</span>{/if}
              </div>
              <div class="mt-1 text-xs text-gray-500">{agent.statusReason}</div>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              {#if agent.triggerRegistered}
                <label class="flex items-center gap-2 rounded border px-3 py-2 text-xs dark:border-gray-700"><input type="checkbox" checked={agent.enabled} disabled={!!busy} on:change={event => toggleEnabled(agent, event.currentTarget.checked)} /> Enabled</label>
              {/if}
              {#if agent.canRun}<button class="rounded border px-3 py-2 text-xs disabled:opacity-50 dark:border-gray-700" disabled={!!busy || agent.triggerRegistered && !agent.enabled} on:click={() => runNow(agent)}>Run now</button>{/if}
              {#if agent.canRegister}<button class="rounded border border-violet-500 px-3 py-2 text-xs text-violet-700 disabled:opacity-50 dark:text-violet-300" disabled={!!busy} on:click={() => register(agent)}>Register</button>{/if}
              {#if agent.canUnregister}<button class="rounded border border-red-500/50 px-3 py-2 text-xs text-red-700 disabled:opacity-50 dark:text-red-300" disabled={!!busy} on:click={() => unregister(agent)}>Unregister</button>{/if}
            </div>
          </div>
        </article>
      {/each}
      {#if agents.length === 0}<div class="rounded border p-8 text-center text-gray-500 dark:border-gray-800">No agents match this view.</div>{/if}
    </div>
  {/if}
</div>
