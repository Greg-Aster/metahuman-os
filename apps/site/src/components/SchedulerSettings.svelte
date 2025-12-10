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

  const curiosityIntervals = [
    0,     // Level 0: Off
    3600,  // Level 1: 60 minutes
    1800,  // Level 2: 30 minutes
    900,   // Level 3: 15 minutes
    300,   // Level 4: 5 minutes
    120,   // Level 5: 2 minutes
    60     // Level 6: 1 minute
  ];

  // Agent display names and descriptions
  const agentInfo: Record<string, { name: string; description: string; icon: string }> = {
    'organizer': { name: 'Organizer', description: 'Enriches memories with LLM-extracted tags and entities', icon: '📋' },
    'curator': { name: 'Curator', description: 'LLM-based memory curation and quality assessment', icon: '🎯' },
    'reflector': { name: 'Mind Wandering', description: 'Activity-based reflections triggered after inactivity', icon: '💭' },
    'curiosity': { name: 'Curiosity', description: 'Asks user-facing questions during idle periods', icon: '❓' },
    'curiosity-researcher': { name: 'Curiosity Researcher', description: 'Researches pending curiosity questions', icon: '🔍' },
    'inner-curiosity': { name: 'Inner Curiosity', description: 'Self-directed questions answered internally', icon: '🤔' },
    'dreamer': { name: 'Dreamer', description: 'Creates surreal dreams from memory fragments', icon: '🌙' },
    'night-pipeline': { name: 'Night Pipeline', description: 'Nightly processing: dreams, audio, LoRA training', icon: '🌃' },
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
        body: JSON.stringify({
          agents: {
            [agentId]: { enabled: !agent.enabled }
          }
        }),
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
        body: JSON.stringify({
          agents: {
            [agentId]: { [updateField]: value }
          }
        }),
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
    if (agent.type === 'interval' && agent.interval) {
      return `Every ${formatInterval(agent.interval)}`;
    }
    if (agent.type === 'activity' && agent.inactivityThreshold) {
      return `After ${formatInterval(agent.inactivityThreshold)} idle`;
    }
    if (agent.type === 'time-of-day' && agent.schedule) {
      return `Daily at ${agent.schedule}`;
    }
    if (agent.type === 'manual') {
      return 'Manual only';
    }
    return 'Unknown';
  }

  // Group agents by category
  function getAgentsByCategory(): Record<string, string[]> {
    return {
      'Memory & Reflection': ['organizer', 'curator', 'reflector'],
      'Curiosity': ['curiosity', 'curiosity-researcher', 'inner-curiosity'],
      'Agency': ['desire-generator', 'desire-planner', 'desire-executor', 'desire-outcome-reviewer'],
      'Nightly': ['night-pipeline', 'dreamer'],
      'Analysis': ['psychoanalyzer'],
    };
  }

  onMount(() => {
    loadConfig();
    loadCuriositySettings();
  });
</script>

<div class="scheduler-settings">
  <div class="header">
    <div>
      <h2>Scheduler Settings</h2>
      <p>Configure autonomous agent scheduling and timing</p>
    </div>
    <button class="refresh-btn" on:click={loadConfig} disabled={loading}>
      {loading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if feedback}
    <div class="feedback" class:success={feedback.type === 'success'} class:error={feedback.type === 'error'}>
      {feedback.text}
    </div>
  {/if}

  {#if error}
    <div class="error-banner">
      <strong>Error:</strong> {error}
    </div>
  {:else if loading}
    <div class="loading">Loading scheduler configuration...</div>
  {:else}
    <!-- Global Settings -->
    <section class="card">
      <header>
        <h3>Global Settings</h3>
        <p>System-wide scheduler controls</p>
      </header>

      <div class="settings-grid">
        <label class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-label">Pause All Agents</span>
            <span class="toggle-desc">Temporarily stop all scheduled agents</span>
          </div>
          <input type="checkbox" bind:checked={globalSettings.pauseAll} on:change={saveGlobalSettings} />
        </label>

        <label class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-label">Pause on User Activity</span>
            <span class="toggle-desc">Suspend agents during active chat sessions</span>
          </div>
          <input type="checkbox" bind:checked={globalSettings.pauseQueueOnActivity} on:change={saveGlobalSettings} />
        </label>

        <label class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-label">Quiet Hours</span>
            <span class="toggle-desc">Disable agents during specified hours</span>
          </div>
          <input type="checkbox" bind:checked={globalSettings.quietHours.enabled} on:change={saveGlobalSettings} />
        </label>

        {#if globalSettings.quietHours.enabled}
          <div class="time-range">
            <label class="time-input">
              <span>Start</span>
              <input type="time" bind:value={globalSettings.quietHours.start} on:change={saveGlobalSettings} />
            </label>
            <span class="time-separator">to</span>
            <label class="time-input">
              <span>End</span>
              <input type="time" bind:value={globalSettings.quietHours.end} on:change={saveGlobalSettings} />
            </label>
          </div>
        {/if}
      </div>

      <div class="concurrency-settings">
        <h4>Concurrency Limits</h4>
        <div class="concurrency-grid">
          <label class="number-input">
            <span>Max Concurrent Agents</span>
            <input type="number" min="1" max="10" bind:value={globalSettings.maxConcurrentAgents} on:change={saveGlobalSettings} />
          </label>
          <label class="number-input">
            <span>Max LLM Agents</span>
            <input type="number" min="1" max="5" bind:value={globalSettings.maxConcurrentLLMAgents} on:change={saveGlobalSettings} />
          </label>
          <label class="number-input">
            <span>Activity Resume Delay (s)</span>
            <input type="number" min="60" max="600" step="30" bind:value={globalSettings.activityResumeDelay} on:change={saveGlobalSettings} />
          </label>
        </div>
      </div>
    </section>

    <!-- Mind Wandering (Boredom) -->
    <section class="card">
      <header>
        <h3>Mind Wandering</h3>
        <p>Internal reflection frequency during idle periods</p>
      </header>
      <BoredomControl />
    </section>

    <!-- Curiosity Settings -->
    <section class="card">
      <header>
        <h3>Curiosity</h3>
        <p>User-facing questions during conversation gaps</p>
      </header>

      <div class="curiosity-control">
        <div class="curiosity-slider-wrapper">
          <label class="slider-label">Curiosity Level</label>
          <input
            type="range"
            min="0"
            max="6"
            bind:value={curiosityLevel}
            on:change={saveCuriositySettings}
            class="curiosity-slider"
          />
          <div class="curiosity-labels">
            <span>Off</span>
            <span>Gentle</span>
            <span>Moderate</span>
            <span>Active</span>
            <span>Chatty</span>
            <span>Very</span>
            <span>Intense</span>
          </div>
        </div>
        <p class="curiosity-description">
          {curiosityLevelDescriptions[curiosityLevel]}
        </p>

        {#if curiosityLevel > 0}
          <div class="research-mode">
            <label class="field-label">Research Mode</label>
            <select bind:value={curiosityResearchMode} on:change={saveCuriositySettings}>
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
        <section class="card">
          <header>
            <h3>{category}</h3>
          </header>

          <div class="agents-list">
            {#each categoryAgents as agentId}
              {@const agent = agents[agentId]}
              {@const info = agentInfo[agentId] || { name: agentId, description: '', icon: '🤖' }}
              <div class="agent-row" class:disabled={!agent.enabled}>
                <div class="agent-info">
                  <span class="agent-icon">{info.icon}</span>
                  <div class="agent-details">
                    <span class="agent-name">{info.name}</span>
                    <span class="agent-desc">{info.description}</span>
                  </div>
                </div>
                <div class="agent-controls">
                  <span class="agent-timing" class:disabled={!agent.enabled}>
                    {#if agent.usesLLM}
                      <span class="llm-badge" title="Uses LLM">LLM</span>
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
                      class="interval-input"
                      title="Interval in seconds"
                    />
                  {/if}
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      checked={agent.enabled}
                      on:change={() => toggleAgent(agentId)}
                      disabled={saving}
                    />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .scheduler-settings {
    padding: 1.5rem;
    max-width: 900px;
    margin: 0 auto;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .header h2 {
    margin: 0 0 0.25rem 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: #111827;
  }

  :global(.dark) .header h2 {
    color: #f3f4f6;
  }

  .header p {
    margin: 0;
    color: #6b7280;
    font-size: 0.875rem;
  }

  :global(.dark) .header p {
    color: #9ca3af;
  }

  .refresh-btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.2s;
  }

  .refresh-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .feedback {
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .feedback.success {
    background: rgba(34, 197, 94, 0.15);
    color: #15803d;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  :global(.dark) .feedback.success {
    background: rgba(34, 197, 94, 0.2);
    color: #86efac;
  }

  .feedback.error {
    background: rgba(239, 68, 68, 0.15);
    color: #b91c1c;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  :global(.dark) .feedback.error {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }

  .error-banner {
    background: #fee;
    border: 1px solid #fcc;
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    color: #c00;
  }

  :global(.dark) .error-banner {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #fca5a5;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: #6b7280;
  }

  :global(.dark) .loading {
    color: #9ca3af;
  }

  .card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .card {
    background: #1f2937;
    border-color: #374151;
  }

  .card header {
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .card header {
    border-bottom-color: #374151;
  }

  .card h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: #111827;
  }

  :global(.dark) .card h3 {
    color: #f3f4f6;
  }

  .card h4 {
    margin: 1rem 0 0.75rem 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: #4b5563;
  }

  :global(.dark) .card h4 {
    color: #9ca3af;
  }

  .card header p {
    margin: 0;
    color: #6b7280;
    font-size: 0.8rem;
  }

  :global(.dark) .card header p {
    color: #9ca3af;
  }

  .settings-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .toggle-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    background: #f9fafb;
    border-radius: 6px;
    cursor: pointer;
  }

  :global(.dark) .toggle-row {
    background: #111827;
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .toggle-label {
    font-weight: 500;
    font-size: 0.875rem;
    color: #111827;
  }

  :global(.dark) .toggle-label {
    color: #f3f4f6;
  }

  .toggle-desc {
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .toggle-desc {
    color: #9ca3af;
  }

  .toggle-row input[type="checkbox"] {
    width: 1.25rem;
    height: 1.25rem;
    cursor: pointer;
    accent-color: #7c3aed;
  }

  .time-range {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: #f3f4f6;
    border-radius: 6px;
    margin-left: 1rem;
  }

  :global(.dark) .time-range {
    background: #0f172a;
  }

  .time-input {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .time-input span {
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .time-input span {
    color: #9ca3af;
  }

  .time-input input {
    padding: 0.375rem 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-size: 0.875rem;
    background: white;
  }

  :global(.dark) .time-input input {
    background: #1f2937;
    border-color: #374151;
    color: #f3f4f6;
  }

  .time-separator {
    color: #6b7280;
    font-size: 0.875rem;
  }

  .concurrency-settings {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .concurrency-settings {
    border-top-color: #374151;
  }

  .concurrency-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
  }

  .number-input {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .number-input span {
    font-size: 0.75rem;
    font-weight: 500;
    color: #4b5563;
  }

  :global(.dark) .number-input span {
    color: #9ca3af;
  }

  .number-input input {
    padding: 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.875rem;
    background: white;
    width: 100%;
  }

  :global(.dark) .number-input input {
    background: #111827;
    border-color: #374151;
    color: #f3f4f6;
  }

  /* Curiosity Controls */
  .curiosity-control {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .curiosity-slider-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .slider-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #4b5563;
  }

  :global(.dark) .slider-label {
    color: #9ca3af;
  }

  .curiosity-slider {
    width: 100%;
    accent-color: #7c3aed;
    cursor: pointer;
  }

  .curiosity-labels {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    font-size: 0.65rem;
    color: #6b7280;
    text-align: center;
  }

  :global(.dark) .curiosity-labels {
    color: #9ca3af;
  }

  .curiosity-description {
    font-size: 0.8rem;
    color: #4b5563;
    margin: 0;
    padding: 0.75rem;
    background: rgba(124, 58, 237, 0.05);
    border-radius: 0.375rem;
    border-left: 3px solid #7c3aed;
  }

  :global(.dark) .curiosity-description {
    color: #9ca3af;
    background: rgba(167, 139, 250, 0.08);
    border-left-color: #a78bfa;
  }

  .research-mode {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .field-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #4b5563;
  }

  :global(.dark) .field-label {
    color: #9ca3af;
  }

  .research-mode select {
    padding: 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: white;
    color: #1f2937;
  }

  :global(.dark) .research-mode select {
    background: #1f2937;
    border-color: #374151;
    color: #f3f4f6;
  }

  /* Agents List */
  .agents-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .agent-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    background: #f9fafb;
    border-radius: 6px;
    transition: opacity 0.2s, background 0.2s;
  }

  :global(.dark) .agent-row {
    background: #111827;
  }

  .agent-row.disabled {
    opacity: 0.6;
  }

  .agent-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .agent-icon {
    font-size: 1.25rem;
    width: 2rem;
    text-align: center;
  }

  .agent-details {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .agent-name {
    font-weight: 500;
    font-size: 0.875rem;
    color: #111827;
  }

  :global(.dark) .agent-name {
    color: #f3f4f6;
  }

  .agent-desc {
    font-size: 0.7rem;
    color: #6b7280;
  }

  :global(.dark) .agent-desc {
    color: #9ca3af;
  }

  .agent-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .agent-timing {
    font-size: 0.75rem;
    color: #6b7280;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  :global(.dark) .agent-timing {
    color: #9ca3af;
  }

  .agent-timing.disabled {
    text-decoration: line-through;
    opacity: 0.6;
  }

  .llm-badge {
    font-size: 0.6rem;
    font-weight: 600;
    padding: 0.125rem 0.375rem;
    background: rgba(124, 58, 237, 0.15);
    color: #7c3aed;
    border-radius: 4px;
    text-transform: uppercase;
  }

  :global(.dark) .llm-badge {
    background: rgba(167, 139, 250, 0.2);
    color: #a78bfa;
  }

  .interval-input {
    width: 70px;
    padding: 0.25rem 0.375rem;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-size: 0.75rem;
    text-align: center;
    background: white;
  }

  :global(.dark) .interval-input {
    background: #1f2937;
    border-color: #374151;
    color: #f3f4f6;
  }

  .interval-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Toggle Switch */
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #cbd5e1;
    transition: 0.3s;
    border-radius: 22px;
  }

  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 16px;
    width: 16px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
  }

  .toggle-switch input:checked + .toggle-slider {
    background-color: #7c3aed;
  }

  .toggle-switch input:checked + .toggle-slider:before {
    transform: translateX(18px);
  }

  .toggle-switch input:disabled + .toggle-slider {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.dark) .toggle-slider {
    background-color: #374151;
  }

  :global(.dark) .toggle-slider:before {
    background-color: #9ca3af;
  }

  :global(.dark) .toggle-switch input:checked + .toggle-slider {
    background-color: #a78bfa;
  }

  :global(.dark) .toggle-switch input:checked + .toggle-slider:before {
    background-color: white;
  }
</style>
