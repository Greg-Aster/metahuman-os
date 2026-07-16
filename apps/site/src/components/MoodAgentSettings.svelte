<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import { nodeEditorMode } from '../stores/navigation';

  type BufferSource = 'conversation' | 'inner' | 'both';
  type MoodData = {
    settings: {
      bufferSource: BufferSource;
      maxMessagesPerBuffer: number;
      maxContextChars: number;
      baselineFacet: string;
      overridePersonaDisabled: boolean;
      minimumConfidence: number;
    };
    state: Record<string, any>;
    trigger: { enabled: boolean; eventCountThreshold: number; idleResetSeconds: number; eventPattern: string } | null;
    facets: Record<string, { name: string; description?: string; enabled: boolean; personaFile: string | null }>;
    activeFacet: string;
  };

  let data: MoodData | null = null;
  let loading = true;
  let saving = false;
  let feedback = '';
  let error = '';

  async function load() {
    loading = true;
    error = '';
    try {
      const response = await apiFetch('/api/mood-settings', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) throw new Error(body.error || 'Failed to load Mood settings');
      data = body as MoodData;
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      loading = false;
    }
  }

  async function save() {
    if (!data || saving) return;
    saving = true;
    feedback = '';
    error = '';
    try {
      const response = await apiFetch('/api/mood-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: data.settings,
          trigger: data.trigger ? {
            enabled: data.trigger.enabled,
            eventCountThreshold: Number(data.trigger.eventCountThreshold),
            idleResetSeconds: Number(data.trigger.idleResetSeconds),
          } : undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) throw new Error(body.error || 'Failed to save Mood settings');
      data = body as MoodData;
      feedback = 'Mood settings and trigger admission were applied live.';
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      saving = false;
    }
  }

  function openGraphEditor() {
    nodeEditorMode.set(true);
  }

  onMount(load);
</script>

<section class="mb-6 rounded border border-violet-500/30 bg-violet-500/5 p-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h3 class="font-semibold text-gray-900 dark:text-gray-100">Mood persona routing</h3>
      <p class="mt-1 max-w-3xl text-xs text-gray-500">Mood queues the editable <strong>Mood Persona Review</strong> graph after a message threshold, then returns to the baseline facet after the idle cooldown.</p>
    </div>
    <button class="rounded border px-3 py-2 text-xs dark:border-gray-700" on:click={openGraphEditor}>Open Graph Editor</button>
  </div>

  {#if feedback}<div class="mt-3 rounded bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300">{feedback}</div>{/if}
  {#if error}<div class="mt-3 rounded bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300">{error}</div>{/if}
  {#if loading}
    <div class="py-6 text-center text-sm text-gray-500">Loading Mood configuration…</div>
  {:else if data}
    {#if data.trigger}
      <label class="mt-4 flex items-start gap-3 rounded border border-violet-500/30 bg-violet-500/5 p-3 text-sm">
        <input class="mt-1" type="checkbox" bind:checked={data.trigger.enabled} />
        <span><span class="block font-medium">Enable automatic Mood reviews</span><span class="text-xs text-gray-500">Off by default. Trigger Manager will ignore message-count and idle-reset events until this is enabled and saved.</span></span>
      </label>
    {/if}
    <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label class="text-xs text-gray-500">Buffers to review
        <select class="form-input mt-1 w-full" bind:value={data.settings.bufferSource}>
          <option value="conversation">Conversation</option>
          <option value="inner">Inner dialogue</option>
          <option value="both">Both buffers</option>
        </select>
      </label>
      <label class="text-xs text-gray-500">Messages per buffer
        <input class="form-input mt-1 w-full" type="number" min="1" max="50" bind:value={data.settings.maxMessagesPerBuffer} />
      </label>
      <label class="text-xs text-gray-500">Minimum confidence
        <input class="form-input mt-1 w-full" type="number" min="0" max="1" step="0.05" bind:value={data.settings.minimumConfidence} />
      </label>
      {#if data.trigger}
        <label class="text-xs text-gray-500">Review every N user messages
          <input class="form-input mt-1 w-full" type="number" min="1" max="10000" bind:value={data.trigger.eventCountThreshold} />
        </label>
        <label class="text-xs text-gray-500">Return to baseline after idle seconds
          <input class="form-input mt-1 w-full" type="number" min="60" max="31536000" bind:value={data.trigger.idleResetSeconds} />
        </label>
      {:else}
        <div class="rounded border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">Mood is not registered with Trigger Manager. Register it in the Agent Catalog before configuring admission.</div>
      {/if}
      <label class="text-xs text-gray-500">Baseline persona
        <select class="form-input mt-1 w-full" bind:value={data.settings.baselineFacet}>
          {#each Object.entries(data.facets).filter(([id, facet]) => id !== 'inactive' && facet.enabled && facet.personaFile) as [id, facet]}
            <option value={id}>{facet.name}</option>
          {/each}
        </select>
      </label>
    </div>
    <label class="mt-4 flex items-start gap-3 rounded border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
      <input class="mt-1" type="checkbox" bind:checked={data.settings.overridePersonaDisabled} />
      <span><span class="block font-medium">Allow Mood to override Persona Off</span><span class="text-xs text-gray-500">Off by default. When enabled, Mood may move this user out of the inactive facet and may supply persona context even when the global persona-summary switch is disabled.</span></span>
    </label>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
      <span>Active: {data.activeFacet} · last review: {data.state.lastReviewedAt || 'never'} · last result: {data.state.reason || 'none'}</span>
      <button class="rounded border border-violet-500 px-4 py-2 text-sm text-violet-700 disabled:opacity-50 dark:text-violet-300" disabled={saving || !data.trigger} on:click={save}>{saving ? 'Saving…' : 'Save Mood settings'}</button>
    </div>
  {/if}
</section>
