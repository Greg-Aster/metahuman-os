<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { openTriggerManagerDashboard, rightSidebarOpen } from '../stores/navigation';
  import { AUTONOMY_MODES, type AutonomyMode } from '../lib/client/active-operator-modes';
  import {
    patchTriggerConfig,
    runTriggerNow,
    triggerManagerConnection,
    triggerManagerError,
    triggerManagerSnapshot,
    useTriggerManager,
    type TriggerView,
  } from '../lib/stores/trigger-manager';

  let release: (() => void) | undefined;
  let saving = '';
  let feedback = '';
  let errors: Record<string, string> = {};

  onMount(() => release = useTriggerManager());
  onDestroy(() => release?.());

  function setError(key: string, message = '') {
    errors = { ...errors, [key]: message };
  }

  async function save(key: string, patch: Record<string, unknown>, success = 'Applied live') {
    if (saving) return;
    saving = key;
    feedback = '';
    setError(key);
    try {
      await patchTriggerConfig(patch);
      feedback = success;
    } catch (error) {
      setError(key, (error as Error).message);
    } finally {
      saving = '';
    }
  }

  function saveGlobal(field: string, value: unknown) {
    return save(`global.${field}`, { globalSettings: { [field]: value } });
  }

  function quietHours(next: Partial<{ enabled: boolean; start: string; end: string }>) {
    const current = $triggerManagerSnapshot?.globalSettings.quietHours || { enabled: false, start: '22:00', end: '08:00' };
    return saveGlobal('quietHours', { ...current, ...next });
  }

  function saveAgent(trigger: TriggerView, field: string, value: unknown) {
    return save(`${trigger.id}.${field}`, { agents: { [trigger.id]: { [field]: value } } }, `${trigger.displayName} applied live`);
  }

  function saveAgentType(trigger: TriggerView, type: TriggerView['type']) {
    const next: Record<string, unknown> = {
      type,
      interval: null,
      inactivityThreshold: null,
      schedule: null,
      eventPattern: null,
      eventCountThreshold: null,
      eventCountField: null,
      idleResetSeconds: null,
    };
    if (type === 'interval') next.interval = 3600;
    if (type === 'activity') next.inactivityThreshold = 900;
    if (type === 'time-of-day') next.schedule = '00:00';
    if (type === 'event') next.eventPattern = `${trigger.id}.*`;
    return save(`${trigger.id}.type`, { agents: { [trigger.id]: next } }, `${trigger.displayName} trigger type applied live`);
  }

  function toggleMode(trigger: TriggerView, mode: AutonomyMode, enabled: boolean) {
    const next = enabled
      ? [...new Set([...trigger.allowedModes, mode])]
      : trigger.allowedModes.filter(candidate => candidate !== mode);
    if (next.length === 0) {
      setError(`${trigger.id}.allowedModes`, 'At least one autonomy mode is required.');
      return;
    }
    void saveAgent(trigger, 'allowedModes', next);
  }

  async function runNow(trigger: TriggerView) {
    const key = `${trigger.id}.run`;
    saving = key;
    setError(key);
    try {
      const taskId = await runTriggerNow(trigger.id);
      feedback = `${trigger.displayName} queued as ${taskId}`;
    } catch (error) {
      setError(key, (error as Error).message);
    } finally {
      saving = '';
    }
  }

  function numberValue(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value);
  }
</script>

<div class="mx-auto max-w-[1050px] p-6">
  <header class="mb-6 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 class="text-2xl font-semibold text-gray-900 dark:text-gray-100">Trigger Manager Settings</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">One canonical configuration for finite scheduled work. Changes are validated, persisted atomically, and applied live.</p>
    </div>
    <div class="flex gap-2">
      <button class="rounded border px-3 py-2 text-sm dark:border-gray-700" on:click={() => rightSidebarOpen.set(true)}>Open Queue</button>
      <button class="rounded border border-violet-500 px-3 py-2 text-sm text-violet-700 dark:text-violet-300" on:click={openTriggerManagerDashboard}>Runtime dashboard</button>
    </div>
  </header>

  {#if feedback}<div class="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{feedback}</div>{/if}
  {#if $triggerManagerError}<div class="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{$triggerManagerError}</div>{/if}

  {#if !$triggerManagerSnapshot}
    <div class="py-12 text-center text-gray-500">Loading authoritative Trigger Manager configuration…</div>
  {:else}
    <section class="mb-5 rounded border border-gray-200 p-4 dark:border-gray-800">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div><h3 class="font-semibold">Global admission policy</h3><p class="text-xs text-gray-500">This pause affects new trigger admissions, not execution of work already in the coordinator.</p></div>
        <div class="text-xs text-gray-500">{$triggerManagerConnection} · {$triggerManagerSnapshot.config.scope} · persisted r{$triggerManagerSnapshot.config.persistedRevision ?? '—'} / runtime r{$triggerManagerSnapshot.config.runtimeRevision ?? '—'}</div>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <label class="flex items-center justify-between gap-3 rounded bg-gray-50 p-3 dark:bg-gray-900">
          <span><span class="block font-medium">Pause trigger admissions</span><span class="text-xs text-gray-500">Configured timers stay visible while new admissions stop.</span></span>
          <input type="checkbox" checked={$triggerManagerSnapshot.admissionPaused} disabled={!!saving} on:change={event => saveGlobal('pauseAll', event.currentTarget.checked)} />
        </label>
        <label class="rounded bg-gray-50 p-3 dark:bg-gray-900">
          <span class="block font-medium">Timezone</span>
          <input class="form-input mt-2 w-full" value={$triggerManagerSnapshot.timezone} disabled={!!saving} on:change={event => saveGlobal('timezone', event.currentTarget.value)} />
          {#if errors['global.timezone']}<span class="mt-1 block text-xs text-red-600">{errors['global.timezone']}</span>{/if}
        </label>
        <div class="rounded bg-gray-50 p-3 dark:bg-gray-900 md:col-span-2">
          <label class="flex items-center gap-2 font-medium"><input type="checkbox" checked={$triggerManagerSnapshot.globalSettings.quietHours?.enabled || false} disabled={!!saving} on:change={event => quietHours({ enabled: event.currentTarget.checked })} /> Quiet hours</label>
          <div class="mt-3 grid grid-cols-2 gap-3">
            <label class="text-xs text-gray-500">Start<input class="form-input mt-1 w-full" type="time" value={$triggerManagerSnapshot.globalSettings.quietHours?.start || '22:00'} disabled={!!saving} on:change={event => quietHours({ start: event.currentTarget.value })} /></label>
            <label class="text-xs text-gray-500">End<input class="form-input mt-1 w-full" type="time" value={$triggerManagerSnapshot.globalSettings.quietHours?.end || '08:00'} disabled={!!saving} on:change={event => quietHours({ end: event.currentTarget.value })} /></label>
          </div>
          {#if errors['global.quietHours']}<span class="mt-1 block text-xs text-red-600">{errors['global.quietHours']}</span>{/if}
        </div>
      </div>
    </section>

    <div class="space-y-4">
      {#each $triggerManagerSnapshot.triggers.filter(trigger => trigger.lifecycle !== 'service') as trigger}
        <section class="rounded border border-gray-200 p-4 dark:border-gray-800">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><h3 class="font-semibold">{trigger.displayName}</h3><p class="mt-1 max-w-2xl text-xs text-gray-500">{trigger.description || trigger.handler}</p></div>
            <div class="flex items-center gap-3">
              <button class="rounded border px-3 py-1.5 text-xs disabled:opacity-50 dark:border-gray-700" disabled={!trigger.enabled || !!saving || !trigger.handlerRegistered || !trigger.sourceResolvable} on:click={() => runNow(trigger)}>Run now</button>
              <label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={trigger.enabled} disabled={!!saving} on:change={event => saveAgent(trigger, 'enabled', event.currentTarget.checked)} /> Enabled</label>
            </div>
          </div>

          <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label class="text-xs text-gray-500">Trigger type
              <select class="form-input mt-1 w-full" value={trigger.type} disabled={!!saving} on:change={event => saveAgentType(trigger, event.currentTarget.value as TriggerView['type'])}>
                <option value="interval">Interval</option><option value="activity">Inactivity</option><option value="time-of-day">Time of day</option><option value="event">Event</option><option value="manual">Manual</option>
              </select>
            </label>
            {#if trigger.type === 'interval'}
              <label class="text-xs text-gray-500">Interval (seconds)<input class="form-input mt-1 w-full" type="number" min="1" max="31536000" value={trigger.interval || 60} disabled={!!saving} on:change={event => saveAgent(trigger, 'interval', numberValue(event))} /></label>
            {:else if trigger.type === 'activity'}
              <label class="text-xs text-gray-500">Inactivity (seconds)<input class="form-input mt-1 w-full" type="number" min="1" max="31536000" value={trigger.inactivityThreshold || 60} disabled={!!saving} on:change={event => saveAgent(trigger, 'inactivityThreshold', numberValue(event))} /></label>
            {:else if trigger.type === 'time-of-day'}
              <label class="text-xs text-gray-500">Local time ({$triggerManagerSnapshot.timezone})<input class="form-input mt-1 w-full" type="time" value={trigger.schedule || '00:00'} disabled={!!saving} on:change={event => saveAgent(trigger, 'schedule', event.currentTarget.value)} /></label>
            {:else if trigger.type === 'event'}
              <label class="text-xs text-gray-500">Event pattern<input class="form-input mt-1 w-full" value={trigger.eventPattern || ''} disabled={!!saving} on:change={event => saveAgent(trigger, 'eventPattern', event.currentTarget.value)} /></label>
              <label class="text-xs text-gray-500">Admit every N matching events<input class="form-input mt-1 w-full" type="number" min="1" max="10000" value={trigger.eventCountThreshold || 1} disabled={!!saving} on:change={event => saveAgent(trigger, 'eventCountThreshold', numberValue(event))} /></label>
              <label class="text-xs text-gray-500">Monotonic event count field<input class="form-input mt-1 w-full" value={trigger.eventCountField || ''} placeholder="count" disabled={!!saving} on:change={event => saveAgent(trigger, 'eventCountField', event.currentTarget.value || null)} /></label>
              <label class="text-xs text-gray-500">Idle baseline/reset seconds<input class="form-input mt-1 w-full" type="number" min="0" max="31536000" value={trigger.idleResetSeconds || 0} disabled={!!saving} on:change={event => saveAgent(trigger, 'idleResetSeconds', numberValue(event) || null)} /></label>
            {:else}
              <div class="rounded bg-gray-50 p-2 text-xs text-gray-500 dark:bg-gray-900">Manual triggers run only from an explicit user or API action.</div>
            {/if}
            <label class="text-xs text-gray-500">Priority
              <select class="form-input mt-1 w-full" value={trigger.priority} disabled={!!saving} on:change={event => saveAgent(trigger, 'priority', event.currentTarget.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select>
            </label>
            <label class="text-xs text-gray-500">Startup policy
              <select class="form-input mt-1 w-full" value={trigger.startupPolicy} disabled={!!saving} on:change={event => saveAgent(trigger, 'startupPolicy', event.currentTarget.value)}><option value="skip">Skip</option><option value="run-once">Run once</option><option value="recover-missed">Recover missed</option></select>
            </label>
          </div>

          <fieldset class="mt-4"><legend class="text-xs font-medium text-gray-500">Allowed Active Operator modes</legend><div class="mt-2 flex flex-wrap gap-3">{#each AUTONOMY_MODES as mode}<label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={trigger.allowedModes.includes(mode.id)} disabled={!!saving} on:change={event => toggleMode(trigger, mode.id, event.currentTarget.checked)} /> {mode.label}</label>{/each}</div></fieldset>

          <details class="mt-4 rounded bg-gray-50 p-3 dark:bg-gray-900">
            <summary class="cursor-pointer text-sm font-medium">Advanced admission and retry controls</summary>
            <div class="mt-3 grid gap-3 sm:grid-cols-3">
              <label class="text-xs text-gray-500">Maximum retries<input class="form-input mt-1 w-full" type="number" min="0" max="20" value={trigger.maxRetries} disabled={!!saving} on:change={event => saveAgent(trigger, 'maxRetries', numberValue(event))} /></label>
              <label class="text-xs text-gray-500">Jitter (milliseconds)<input class="form-input mt-1 w-full" type="number" min="0" max="86400000" value={trigger.jitterMs || 0} disabled={!!saving} on:change={event => saveAgent(trigger, 'jitterMs', numberValue(event))} /></label>
              <label class="text-xs text-gray-500">Admission probability (0–1)<input class="form-input mt-1 w-full" type="number" min="0" max="1" step="0.05" value={trigger.probability ?? 1} disabled={!!saving} on:change={event => saveAgent(trigger, 'probability', numberValue(event))} /></label>
            </div>
          </details>

          {#each Object.entries(errors).filter(([key, value]) => key.startsWith(`${trigger.id}.`) && value) as [, message]}
            <div class="mt-2 text-xs text-red-600 dark:text-red-300">{message}</div>
          {/each}
          <div class="mt-3 flex flex-wrap gap-3 text-[0.7rem] text-gray-500"><span>Handler: {trigger.handler}</span><span class:text-red-600={!trigger.handlerRegistered}>registered: {trigger.handlerRegistered ? 'yes' : 'no'}</span><span class:text-red-600={!trigger.sourceResolvable}>source: {trigger.sourceResolvable ? 'resolved' : 'missing'}</span></div>
        </section>
      {/each}
    </div>
  {/if}
</div>
