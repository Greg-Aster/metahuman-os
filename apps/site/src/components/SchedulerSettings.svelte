<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import BoredomControl from './BoredomControl.svelte';

  interface AgentConfig {
    id: string;
    enabled: boolean;
    type: 'interval' | 'activity' | 'time-of-day' | 'manual';
    priority: 'high' | 'normal' | 'low';
    agentPath: string;
    usesLLM: boolean;
    interval?: number;
    inactivityThreshold?: number;
    schedule?: string;
    runOnBoot: boolean;
    autoRestart: boolean;
    maxRetries: number;
    comment?: string;
  }

  interface GlobalSettings {
    pauseAll: boolean;
    quietHours: {
      enabled: boolean;
      start: string;
      end: string;
    };
    maxConcurrentAgents: number;
    maxConcurrentLLMAgents: number;
    maxConcurrentNonLLMAgents: number;
    pauseQueueOnActivity: boolean;
    activityResumeDelay: number;
  }

  let loading = true;
  let saving = false;
  let error: string | null = null;
  let feedback: { type: 'success' | 'error'; text: string } | null = null;

  let globalSettings: GlobalSettings = {
    pauseAll: false,
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
    maxConcurrentAgents: 3,
    maxConcurrentLLMAgents: 1,
    maxConcurrentNonLLMAgents: 10,
    pauseQueueOnActivity: true,
    activityResumeDelay: 240,
  };

  let agents: Record<string, AgentConfig> = {};

  // Curiosity settings
  let curiosityLevel = 1;
  let curiosityResearchMode: 'off' | 'local' | 'web' = 'local';

  const curiosityLevelDescriptions = [
    'Curiosity disabled - no questions will be asked',
    'Gentle - Questions after 60 minutes of conversation inactivity',
    'Moderate - Questions after 30 minutes of conversation inactivity',
    'Active - Questions after 15 minutes of conversation inactivity',
    'Chatty - Questions after 5 minutes of conversation inactivity',
    'Very Active - Questions after 2 minutes of conversation inactivity',
    'Intense - Questions after 1 minute of conversation inactivity'
  ];

  const curiosityIntervals = [0, 3600, 1800, 900, 300, 120, 60];

  // Agent display names and descriptions
  const agentInfo: Record<string, { name: string; description: string; icon: string }> = {
    'organizer': { name: 'Organizer', description: 'Enriches memories with LLM-extracted tags and entities', icon: '📋' },
    'curator': { name: 'Curator', description: 'LLM-based memory curation and quality assessment', icon: '🎯' },
    'reflector': { name: 'Mind Wandering', description: 'Activity-based reflections triggered after inactivity', icon: '💭' },
    'curiosity': { name: 'Curiosity', description: 'Asks user-facing questions during idle periods', icon: '❓' },
    'curiosity-researcher': { name: 'Curiosity Researcher', description: 'Researches pending curiosity questions', icon: '🔍' },
    'inner-curiosity': { name: 'Inner Curiosity', description: 'Self-directed questions answered internally', icon: '🤔' },
    'dreamer': { name: 'Dreamer', description: 'Creates surreal dreams from memory fragments', icon: '🌙' },
    'sleep-workflow': { name: 'Sleep Workflow', description: 'Queues bounded dream and persona-review work', icon: '🌃' },
    'psychoanalyzer': { name: 'Psychoanalyzer', description: 'Reviews memories with psychotherapist model', icon: '🧠' },
    'desire-generator': { name: 'Desire Generator', description: 'Synthesizes desires from persona goals and memories', icon: '🎯' },
    'desire-executor': { name: 'Desire Executor', description: 'Executes approved desires through operator', icon: '⚡' },
    'desire-planner': { name: 'Desire Planner', description: 'Generates plans for desires using cognitive graphs', icon: '📝' },
    'desire-outcome-reviewer': { name: 'Outcome Reviewer', description: 'Reviews completed/failed desires', icon: '✅' },
  };

  async function loadConfig() {
    loading = true;
    error = null;
    try {
      const res = await apiFetch('/api/scheduler-config');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load config');
      globalSettings = data.globalSettings;
      agents = data.agents;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function loadCuriositySettings() {
    try {
      const res = await apiFetch('/api/curiosity-config');
      if (res.ok) {
        const data = await res.json();
        curiosityLevel = data.maxOpenQuestions || 1;
        curiosityResearchMode = data.researchMode || 'local';
      }
    } catch (err) {
      console.error('[SchedulerSettings] Error loading curiosity config:', err);
    }
  }

  async function saveGlobalSettings() {
    saving = true;
    feedback = null;
    try {
      const res = await apiFetch('/api/scheduler-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalSettings }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save');
      feedback = { type: 'success', text: 'Settings saved successfully' };
      setTimeout(() => feedback = null, 3000);
    } catch (e) {
      feedback = { type: 'error', text: (e as Error).message };
    } finally {
      saving = false;
    }
  }

  async function toggleAgent(agentId: string) {
    const agent = agents[agentId];
    if (!agent) return;
    saving = true;
    feedback = null;
    try {
      const res = await apiFetch('/api/scheduler-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: { [agentId]: { enabled: !agent.enabled } } }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update');
      agents[agentId].enabled = !agent.enabled;
      agents = { ...agents };
      feedback = { type: 'success', text: `${agentInfo[agentId]?.name || agentId} ${agents[agentId].enabled ? 'enabled' : 'disabled'}` };
      setTimeout(() => feedback = null, 3000);
    } catch (e) {
      feedback = { type: 'error', text: (e as Error).message };
    } finally {
      saving = false;
    }
  }

  async function updateAgentInterval(agentId: string, value: number) {
    const agent = agents[agentId];
    if (!agent) return;
    saving = true;
    try {
      const updateField = agent.type === 'interval' ? 'interval' : 'inactivityThreshold';
      const res = await apiFetch('/api/scheduler-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: { [agentId]: { [updateField]: value } } }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update');
      if (agent.type === 'interval') {
        agents[agentId].interval = value;
      } else {
        agents[agentId].inactivityThreshold = value;
      }
      agents = { ...agents };
    } catch (e) {
      feedback = { type: 'error', text: (e as Error).message };
    } finally {
      saving = false;
    }
  }

  async function saveCuriositySettings() {
    try {
      const res = await apiFetch('/api/curiosity-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxOpenQuestions: curiosityLevel,
          researchMode: curiosityResearchMode,
          questionIntervalSeconds: curiosityIntervals[curiosityLevel]
        })
      });
      if (!res.ok) throw new Error('Failed to save curiosity settings');
      feedback = { type: 'success', text: 'Curiosity settings saved' };
      setTimeout(() => feedback = null, 3000);
    } catch (err) {
      feedback = { type: 'error', text: (err as Error).message };
    }
  }

  function formatInterval(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }

  function getAgentTiming(agent: AgentConfig): string {
    if (agent.type === 'interval' && agent.interval) return `Every ${formatInterval(agent.interval)}`;
    if (agent.type === 'activity' && agent.inactivityThreshold) return `After ${formatInterval(agent.inactivityThreshold)} idle`;
    if (agent.type === 'time-of-day' && agent.schedule) return `Daily at ${agent.schedule}`;
    if (agent.type === 'manual') return 'Manual only';
    return 'Unknown';
  }

  function getAgentsByCategory(): Record<string, string[]> {
    return {
      'Memory & Reflection': ['organizer', 'curator', 'reflector'],
      'Curiosity': ['curiosity', 'curiosity-researcher', 'inner-curiosity'],
      'Agency': ['desire-generator', 'desire-planner', 'desire-executor', 'desire-outcome-reviewer'],
      'Nightly': ['sleep-workflow', 'dreamer'],
      'Analysis': ['psychoanalyzer'],
    };
  }

  onMount(() => {
    loadConfig();
    loadCuriositySettings();
  });
</script>

<div class="p-6 max-w-[900px] mx-auto">
  <div class="flex justify-between items-center mb-6">
    <div>
      <h2 class="m-0 mb-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">Scheduler Settings</h2>
      <p class="m-0 text-sm text-gray-500 dark:text-gray-400">Configure autonomous agent scheduling and timing</p>
    </div>
    <button class="btn-primary" on:click={loadConfig} disabled={loading}>
      {loading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if feedback}
    <div class="banner {feedback.type === 'success' ? 'banner-success' : 'banner-error'} mb-4">
      {feedback.text}
    </div>
  {/if}

  {#if error}
    <div class="banner banner-error mb-6">
      <strong>Error:</strong> {error}
    </div>
  {:else if loading}
    <div class="text-center py-8 text-gray-500 dark:text-gray-400">Loading scheduler configuration...</div>
  {:else}
    <!-- Global Settings -->
    <section class="panel mb-4">
      <header class="mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
        <h3 class="m-0 mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Global Settings</h3>
        <p class="m-0 text-xs text-gray-500 dark:text-gray-400">System-wide scheduler controls</p>
      </header>

      <div class="flex flex-col gap-3">
        <label class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-md cursor-pointer">
          <div class="flex flex-col gap-0.5">
            <span class="font-medium text-sm text-gray-900 dark:text-gray-100">Pause All Agents</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">Temporarily stop all scheduled agents</span>
          </div>
          <input type="checkbox" bind:checked={globalSettings.pauseAll} on:change={saveGlobalSettings} class="w-5 h-5 cursor-pointer accent-violet-600" />
        </label>

        <label class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-md cursor-pointer">
          <div class="flex flex-col gap-0.5">
            <span class="font-medium text-sm text-gray-900 dark:text-gray-100">Pause on User Activity</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">Suspend agents during active chat sessions</span>
          </div>
          <input type="checkbox" bind:checked={globalSettings.pauseQueueOnActivity} on:change={saveGlobalSettings} class="w-5 h-5 cursor-pointer accent-violet-600" />
        </label>

        <label class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-md cursor-pointer">
          <div class="flex flex-col gap-0.5">
            <span class="font-medium text-sm text-gray-900 dark:text-gray-100">Quiet Hours</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">Disable agents during specified hours</span>
          </div>
          <input type="checkbox" bind:checked={globalSettings.quietHours.enabled} on:change={saveGlobalSettings} class="w-5 h-5 cursor-pointer accent-violet-600" />
        </label>

        {#if globalSettings.quietHours.enabled}
          <div class="flex items-center gap-3 p-3 bg-gray-100 dark:bg-gray-950 rounded-md ml-4">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-gray-500 dark:text-gray-400">Start</span>
              <input type="time" bind:value={globalSettings.quietHours.start} on:change={saveGlobalSettings} class="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            </label>
            <span class="text-sm text-gray-500">to</span>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-gray-500 dark:text-gray-400">End</span>
              <input type="time" bind:value={globalSettings.quietHours.end} on:change={saveGlobalSettings} class="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            </label>
          </div>
        {/if}
      </div>

      <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <h4 class="m-0 mb-3 text-sm font-semibold text-gray-600 dark:text-gray-400">Concurrency Limits</h4>
        <div class="grid grid-cols-3 gap-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-gray-600 dark:text-gray-400">Max Concurrent Agents</span>
            <input type="number" min="1" max="10" bind:value={globalSettings.maxConcurrentAgents} on:change={saveGlobalSettings} class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 w-full" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-gray-600 dark:text-gray-400">Max LLM Agents</span>
            <input type="number" min="1" max="5" bind:value={globalSettings.maxConcurrentLLMAgents} on:change={saveGlobalSettings} class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 w-full" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-gray-600 dark:text-gray-400">Activity Resume Delay (s)</span>
            <input type="number" min="60" max="600" step="30" bind:value={globalSettings.activityResumeDelay} on:change={saveGlobalSettings} class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 w-full" />
          </label>
        </div>
      </div>
    </section>

    <!-- Mind Wandering (Boredom) -->
    <section class="panel mb-4">
      <header class="mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
        <h3 class="m-0 mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Mind Wandering</h3>
        <p class="m-0 text-xs text-gray-500 dark:text-gray-400">Internal reflection frequency during idle periods</p>
      </header>
      <BoredomControl />
    </section>

    <!-- Curiosity Settings -->
    <section class="panel mb-4">
      <header class="mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
        <h3 class="m-0 mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Curiosity</h3>
        <p class="m-0 text-xs text-gray-500 dark:text-gray-400">User-facing questions during conversation gaps</p>
      </header>

      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium text-gray-600 dark:text-gray-400">Curiosity Level</label>
          <input type="range" min="0" max="6" bind:value={curiosityLevel} on:change={saveCuriositySettings} class="w-full accent-violet-600 cursor-pointer" />
          <div class="grid grid-cols-7 text-[0.65rem] text-gray-500 dark:text-gray-400 text-center">
            <span>Off</span><span>Gentle</span><span>Moderate</span><span>Active</span><span>Chatty</span><span>Very</span><span>Intense</span>
          </div>
        </div>
        <p class="m-0 p-3 text-xs text-gray-600 dark:text-gray-400 bg-violet-500/5 dark:bg-violet-400/10 rounded-md border-l-[3px] border-violet-600 dark:border-violet-400">
          {curiosityLevelDescriptions[curiosityLevel]}
        </p>

        {#if curiosityLevel > 0}
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-gray-600 dark:text-gray-400">Research Mode</label>
            <select bind:value={curiosityResearchMode} on:change={saveCuriositySettings} class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
              <option value="off">Off - Questions only</option>
              <option value="local">Local - Use existing memories</option>
              <option value="web">Web - Allow web searches</option>
            </select>
          </div>
        {/if}
      </div>
    </section>

    <!-- Agent Categories -->
    {#each Object.entries(getAgentsByCategory()) as [category, agentIds]}
      {@const categoryAgents = agentIds.filter(id => agents[id])}
      {#if categoryAgents.length > 0}
        <section class="panel mb-4">
          <header class="mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
            <h3 class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">{category}</h3>
          </header>

          <div class="flex flex-col gap-2">
            {#each categoryAgents as agentId}
              {@const agent = agents[agentId]}
              {@const info = agentInfo[agentId] || { name: agentId, description: '', icon: '🤖' }}
              <div class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-md transition-opacity {!agent.enabled ? 'opacity-60' : ''}">
                <div class="flex items-center gap-3">
                  <span class="text-xl w-8 text-center">{info.icon}</span>
                  <div class="flex flex-col gap-0.5">
                    <span class="font-medium text-sm text-gray-900 dark:text-gray-100">{info.name}</span>
                    <span class="text-[0.7rem] text-gray-500 dark:text-gray-400">{info.description}</span>
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 {!agent.enabled ? 'line-through opacity-60' : ''}">
                    {#if agent.usesLLM}
                      <span class="text-[0.6rem] font-semibold px-1.5 py-0.5 bg-violet-500/15 dark:bg-violet-400/20 text-violet-600 dark:text-violet-400 rounded uppercase">LLM</span>
                    {/if}
                    {getAgentTiming(agent)}
                  </span>
                  {#if agent.type !== 'manual' && (agent.interval || agent.inactivityThreshold)}
                    <input
                      type="number"
                      min="60"
                      max="86400"
                      step="60"
                      value={agent.interval || agent.inactivityThreshold}
                      on:change={(e) => updateAgentInterval(agentId, parseInt(e.currentTarget.value))}
                      disabled={!agent.enabled || saving}
                      class="w-[70px] px-1.5 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Interval in seconds"
                    />
                  {/if}
                  <input
                    type="checkbox"
                    checked={agent.enabled}
                    on:change={() => toggleAgent(agentId)}
                    disabled={saving}
                    class="toggle-switch"
                  />
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  {/if}
</div>
