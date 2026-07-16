<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  type PersonaCore = {
    $schema?: string;
    version?: string;
    lastUpdated?: string;
    identity: {
      name: string;
      role: string;
      purpose: string;
      humanName: string;
      email: string;
      icon: string;
      aliases: string[];
    };
    personality: {
      communicationStyle: {
        tone: string[];
        humor: string;
        formality: string;
        verbosity: string;
        vocabularyLevel: string;
        preferredPronouns: string;
      };
      cadence?: {
        modes: string[];
        energyPeaks: string[];
        loopSignals: string[];
      };
      traits?: {
        openness: number;
        conscientiousness: number;
        extraversion: number;
        agreeableness: number;
        neuroticism: number;
        notes: string;
      };
      archetypes?: string[];
      aesthetic?: string[];
      narrativeStyle: string;
      interests?: string[];
    };
    values: {
      core?: Array<{ value: string; description: string; priority: number }>;
      boundaries: string[];
    };
    decisionHeuristics?: Array<{ signal: string; response: string; evidence?: string }>;
    writingStyle?: {
      structure: string;
      motifs: string[];
      defaultMantra: string;
    };
    goals?: {
      shortTerm: Array<{ goal: string; status: string; notes?: string }>;
      midTerm: Array<{ goal: string; status: string; notes?: string }>;
      longTerm: Array<{ goal: string; status: string; notes?: string }>;
    };
    context?: {
      domains: string[];
      projects: Array<{ name: string; status: string; summary?: string }>;
      currentFocus: string[];
    };
    notes?: string;
    background?: string;
  };

  type Facet = {
    name: string;
    description: string;
    personaFile: string | null;
    enabled: boolean;
    color: string;
    usageHints: string[];
  };

  type FacetsConfig = {
    $schema?: string;
    version?: string;
    lastUpdated?: string;
    activeFacet: string;
    description: string;
    facets: Record<string, Facet>;
  };

  let editorTab: 'core' | 'facets' | 'insights' | 'archives' = 'core';
  let coreTab: 'identity' | 'personality' | 'values' | 'goals' | 'context' | 'advanced' = 'identity';

  let personaCore: PersonaCore | null = null;
  let facetsConfig: FacetsConfig | null = null;

  let loading = false;
  let saving = false;
  let error: string | null = null;
  let success: string | null = null;

  // Archive management state
  type Archive = {
    filename: string;
    timestamp: string;
    createdAt: string;
    version: string;
    lastUpdated: string | null;
    identity: { name: string; role: string };
    size: number;
  };
  let archives: Archive[] = [];
  let loadingArchives = false;
  let archivesLoaded = false;
  let selectedArchive: any = null;
  let viewingArchive = false;

  // Insights state
  type InsightEntry = {
    timestamp: string;
    type: 'addition' | 'removal' | 'update';
    category: string;
    section?: string;
    items: string[];
    memoriesAnalyzed: number;
    confidence: number;
    reasoning?: string;
    archiveCompared?: string;
    sessionId?: string;
  };
  type InsightsData = {
    version: string;
    lastUpdated: string | null;
    entries: InsightEntry[];
  };
  let insights: InsightsData | null = null;
  let loadingInsights = false;
  let insightsLoaded = false;

  onMount(() => {
    loadPersonaData();
  });

  async function loadPersonaData() {
    loading = true;
    error = null;
    facetsConfig = null;
    try {
      const coreRes = await apiFetch('/api/persona-core-manage');
      const coreData = await coreRes.json();
      if (!coreRes.ok || !coreData.success) throw new Error(coreData.error || 'Failed to load persona core');
      personaCore = coreData.persona;

      const facetsRes = await apiFetch('/api/persona-facets-manage');
      const facetsData = await facetsRes.json();
      if (!facetsRes.ok || !facetsData.success) throw new Error(facetsData.error || 'Failed to load facets');
      facetsConfig = facetsData.facets;
    } catch (e) {
      console.error('Failed to load persona data:', e);
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function savePersonaCore() {
    if (!personaCore) return;
    saving = true;
    error = null;
    success = null;
    try {
      const res = await apiFetch('/api/persona-core-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: personaCore }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to save persona core');
      success = 'Persona core saved successfully!';
      setTimeout(() => { success = null; }, 3000);
    } catch (e) {
      console.error('Failed to save persona core:', e);
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  async function reloadFacets() {
    loading = true;
    error = null;
    facetsConfig = null;
    try {
      const facetsRes = await apiFetch('/api/persona-facets-manage');
      const facetsData = await facetsRes.json();
      if (!facetsRes.ok || !facetsData.success) throw new Error(facetsData.error || 'Failed to load facets');
      facetsConfig = facetsData.facets;
    } catch (e) {
      console.error('Failed to reload persona facets:', e);
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function saveFacets() {
    if (!facetsConfig) return;
    saving = true;
    error = null;
    success = null;
    try {
      const res = await apiFetch('/api/persona-facets-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facets: facetsConfig }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to save facets');
      success = 'Facets saved successfully!';
      setTimeout(() => { success = null; }, 3000);
    } catch (e) {
      console.error('Failed to save facets:', e);
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  function addCoreValue() {
    if (!personaCore) return;
    if (!personaCore.values.core) personaCore.values.core = [];
    personaCore.values.core.push({ value: '', description: '', priority: personaCore.values.core.length + 1 });
    personaCore = personaCore;
  }

  function removeCoreValue(index: number) {
    if (!personaCore || !personaCore.values.core) return;
    personaCore.values.core.splice(index, 1);
    personaCore = personaCore;
  }

  function addDecisionHeuristic() {
    if (!personaCore) return;
    if (!personaCore.decisionHeuristics) personaCore.decisionHeuristics = [];
    personaCore.decisionHeuristics.push({ signal: '', response: '', evidence: '' });
    personaCore = personaCore;
  }

  function removeDecisionHeuristic(index: number) {
    if (!personaCore || !personaCore.decisionHeuristics) return;
    personaCore.decisionHeuristics.splice(index, 1);
    personaCore = personaCore;
  }

  function addGoal(type: 'shortTerm' | 'midTerm' | 'longTerm') {
    if (!personaCore) return;
    if (!personaCore.goals) {
      personaCore.goals = { shortTerm: [], midTerm: [], longTerm: [] };
    }
    personaCore.goals[type].push({ goal: '', status: 'pending', notes: '' });
    personaCore = personaCore;
  }

  function removeGoal(type: 'shortTerm' | 'midTerm' | 'longTerm', index: number) {
    if (!personaCore || !personaCore.goals) return;
    personaCore.goals[type].splice(index, 1);
    personaCore = personaCore;
  }

  function addProject() {
    if (!personaCore) return;
    if (!personaCore.context) personaCore.context = { domains: [], projects: [], currentFocus: [] };
    personaCore.context.projects.push({ name: '', status: 'active', summary: '' });
    personaCore = personaCore;
  }

  function removeProject(index: number) {
    if (!personaCore || !personaCore.context) return;
    personaCore.context.projects.splice(index, 1);
    personaCore = personaCore;
  }

  function addFacet() {
    if (!facetsConfig) return;
    const facetId = `facet_${Date.now()}`;
    facetsConfig.facets[facetId] = {
      name: 'New Facet',
      description: '',
      personaFile: 'core.json',
      enabled: true,
      color: 'blue',
      usageHints: []
    };
    facetsConfig = facetsConfig;
  }

  function removeFacet(facetId: string) {
    if (!facetsConfig) return;
    if (facetId === 'default') {
      alert('Cannot remove the default facet');
      return;
    }
    delete facetsConfig.facets[facetId];
    if (facetsConfig.activeFacet === facetId) {
      facetsConfig.activeFacet = 'default';
    }
    facetsConfig = facetsConfig;
  }

  async function loadInsights() {
    loadingInsights = true;
    error = null;
    try {
      const res = await apiFetch('/api/persona-insights');
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data = await res.json();
      insights = data;
      insightsLoaded = true;
    } catch (e) {
      console.error('[PersonaEditor] Failed to load insights:', e);
      error = (e as Error).message;
      insightsLoaded = true;
    } finally {
      loadingInsights = false;
    }
  }

  function formatInsightDate(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getInsightIcon(type: 'addition' | 'removal' | 'update'): string {
    switch (type) {
      case 'addition': return '+';
      case 'removal': return '−';
      case 'update': return '↻';
      default: return '•';
    }
  }

  function getInsightColor(type: 'addition' | 'removal' | 'update'): string {
    switch (type) {
      case 'addition': return 'bg-emerald-500';
      case 'removal': return 'bg-red-500';
      case 'update': return 'bg-amber-500';
      default: return 'bg-gray-500';
    }
  }

  function getInsightTextColor(type: 'addition' | 'removal' | 'update'): string {
    switch (type) {
      case 'addition': return 'text-emerald-500';
      case 'removal': return 'text-red-500';
      case 'update': return 'text-amber-500';
      default: return 'text-gray-500';
    }
  }

  async function loadArchives() {
    loadingArchives = true;
    error = null;
    try {
      const res = await apiFetch('/api/persona-archives');
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load archives');
      archives = data.archives;
      archivesLoaded = true;
    } catch (e) {
      console.error('[PersonaEditor] Failed to load archives:', e);
      error = (e as Error).message;
      archivesLoaded = true;
    } finally {
      loadingArchives = false;
    }
  }

  async function viewArchive(filename: string) {
    loading = true;
    error = null;
    try {
      const res = await apiFetch('/api/persona-archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'view', filename }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to view archive');
      selectedArchive = data.persona;
      viewingArchive = true;
    } catch (e) {
      console.error('Failed to view archive:', e);
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function restoreArchive(filename: string) {
    if (!confirm(`Are you sure you want to restore this archive? Your current persona will be backed up first.`)) {
      return;
    }

    saving = true;
    error = null;
    success = null;
    try {
      const res = await apiFetch('/api/persona-archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', filename }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to restore archive');
      success = `Persona restored successfully! Current version backed up as ${data.backupFile}`;
      await loadPersonaData();
      await loadArchives();
      setTimeout(() => { success = null; }, 5000);
    } catch (e) {
      console.error('Failed to restore archive:', e);
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  async function deleteArchive(filename: string) {
    if (!confirm(`Are you sure you want to delete this archive? This cannot be undone.`)) {
      return;
    }

    saving = true;
    error = null;
    success = null;
    try {
      const res = await apiFetch('/api/persona-archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', filename }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to delete archive');
      success = 'Archive deleted successfully!';
      await loadArchives();
      setTimeout(() => { success = null; }, 3000);
    } catch (e) {
      console.error('Failed to delete archive:', e);
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  function closeArchiveViewer() {
    viewingArchive = false;
    selectedArchive = null;
  }

  function formatTimestamp(timestamp: string): string {
    const match = timestamp.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
    if (match) {
      const [_, year, month, day, hour, min, sec] = match;
      return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
    }
    return timestamp;
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  $: if (editorTab === 'insights' && !insightsLoaded && !loadingInsights) {
    loadInsights();
  }

  $: if (editorTab === 'archives' && !archivesLoaded && !loadingArchives) {
    loadArchives();
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  {#if loading && !personaCore}
    <div class="flex flex-col items-center justify-center p-12 gap-4">Loading persona data...</div>
  {:else if error && !personaCore}
    <div class="flex flex-col items-center justify-center p-12 gap-4">
      <div class="text-xl font-semibold text-red-600">Failed to load persona data</div>
      <div class="text-red-800 dark:text-red-400">{error}</div>
      <button class="btn-danger" on:click={loadPersonaData}>Retry</button>
    </div>
  {:else if personaCore}
    <div class="border-b border-gray-200 dark:border-gray-700 p-4">
      <div class="flex gap-2 mb-3 flex-wrap">
        <button
          class="px-4 py-2 rounded-lg font-medium border transition-all
                 {editorTab === 'core' ? 'bg-purple-600 text-white border-purple-600' : 'bg-transparent border-gray-300 dark:border-gray-600 dark:text-gray-300'}"
          on:click={() => editorTab = 'core'}
        >
          Core Identity
        </button>
        <button
          class="px-4 py-2 rounded-lg font-medium border transition-all
                 {editorTab === 'facets' ? 'bg-purple-600 text-white border-purple-600' : 'bg-transparent border-gray-300 dark:border-gray-600 dark:text-gray-300'}"
          on:click={() => { editorTab = 'facets'; void reloadFacets(); }}
        >
          Facets
        </button>
        <button
          class="px-4 py-2 rounded-lg font-medium border transition-all
                 {editorTab === 'insights' ? 'bg-purple-600 text-white border-purple-600' : 'bg-transparent border-gray-300 dark:border-gray-600 dark:text-gray-300'}"
          on:click={() => editorTab = 'insights'}
        >
          Insights
        </button>
        <button
          class="px-4 py-2 rounded-lg font-medium border transition-all
                 {editorTab === 'archives' ? 'bg-purple-600 text-white border-purple-600' : 'bg-transparent border-gray-300 dark:border-gray-600 dark:text-gray-300'}"
          on:click={() => editorTab = 'archives'}
        >
          Archives
        </button>
      </div>

      {#if success}
        <div class="p-3 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300 rounded-lg font-medium">{success}</div>
      {/if}
      {#if error}
        <div class="p-3 bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300 rounded-lg font-medium">{error}</div>
      {/if}
    </div>

    {#if editorTab === 'core'}
      <div class="flex-1 overflow-y-auto p-4">
        <div class="flex gap-2 flex-wrap mb-6">
          {#each ['identity', 'personality', 'values', 'goals', 'context', 'advanced'] as tab}
            <button
              class="px-3 py-1.5 rounded-md text-sm font-medium transition-all
                     {coreTab === tab ? 'bg-indigo-500 text-white' : 'bg-gray-100 dark:bg-gray-700 dark:text-gray-300'}"
              on:click={() => coreTab = tab}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          {/each}
        </div>

        <div class="max-w-4xl">
          {#if coreTab === 'identity'}
            <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="m-0 mb-4 text-lg font-semibold">Identity</h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">AI Name</span>
                  <input type="text" bind:value={personaCore.identity.name} class="input-field" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Human Name</span>
                  <input type="text" bind:value={personaCore.identity.humanName} class="input-field" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Email</span>
                  <input type="email" bind:value={personaCore.identity.email} class="input-field" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Icon Path</span>
                  <input type="text" bind:value={personaCore.identity.icon} class="input-field" />
                </label>
              </div>
              <label class="flex flex-col gap-1.5 mt-4">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Role</span>
                <input type="text" bind:value={personaCore.identity.role} class="input-field" />
              </label>
              <label class="flex flex-col gap-1.5 mt-4">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Purpose</span>
                <textarea rows="3" bind:value={personaCore.identity.purpose} class="input-field"></textarea>
              </label>
              <label class="flex flex-col gap-1.5 mt-4">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Aliases (one per line)</span>
                <textarea rows="3" value={personaCore.identity.aliases.join('\n')} on:input={(e) => {
                  personaCore.identity.aliases = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }} class="input-field"></textarea>
              </label>
            </section>

          {:else if coreTab === 'personality'}
            <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="m-0 mb-4 text-lg font-semibold">Communication Style</h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Tone (one per line)</span>
                  <textarea rows="3" value={personaCore.personality.communicationStyle.tone.join('\n')} on:input={(e) => {
                    personaCore.personality.communicationStyle.tone = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                  }} class="input-field"></textarea>
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Humor</span>
                  <input type="text" bind:value={personaCore.personality.communicationStyle.humor} class="input-field" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Formality</span>
                  <input type="text" bind:value={personaCore.personality.communicationStyle.formality} class="input-field" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Verbosity</span>
                  <input type="text" bind:value={personaCore.personality.communicationStyle.verbosity} class="input-field" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Vocabulary Level</span>
                  <input type="text" bind:value={personaCore.personality.communicationStyle.vocabularyLevel} class="input-field" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Preferred Pronouns</span>
                  <input type="text" bind:value={personaCore.personality.communicationStyle.preferredPronouns} class="input-field" />
                </label>
              </div>
              <label class="flex flex-col gap-1.5 mt-4">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Narrative Style</span>
                <textarea rows="3" bind:value={personaCore.personality.narrativeStyle} class="input-field"></textarea>
              </label>
            </section>

            {#if personaCore.personality.traits}
              <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <h3 class="m-0 mb-4 text-lg font-semibold">Personality Traits (Big Five)</h3>
                <div class="flex flex-col gap-4">
                  {#each [
                    { key: 'openness', label: 'Openness' },
                    { key: 'conscientiousness', label: 'Conscientiousness' },
                    { key: 'extraversion', label: 'Extraversion' },
                    { key: 'agreeableness', label: 'Agreeableness' },
                    { key: 'neuroticism', label: 'Neuroticism' }
                  ] as trait}
                    <label class="flex flex-col gap-1.5">
                      <span class="font-medium text-sm text-gray-700 dark:text-gray-300">{trait.label} ({personaCore.personality.traits[trait.key]})</span>
                      <input type="range" min="0" max="1" step="0.05" bind:value={personaCore.personality.traits[trait.key]} class="w-full" />
                    </label>
                  {/each}
                </div>
                <label class="flex flex-col gap-1.5 mt-4">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Traits Notes</span>
                  <textarea rows="2" bind:value={personaCore.personality.traits.notes} class="input-field"></textarea>
                </label>
              </section>
            {/if}

            <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="m-0 mb-4 text-lg font-semibold">Other Personality Traits</h3>
              <label class="flex flex-col gap-1.5">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Archetypes (one per line)</span>
                <textarea rows="3" value={personaCore.personality.archetypes?.join('\n') || ''} on:input={(e) => {
                  personaCore.personality.archetypes = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }} class="input-field"></textarea>
              </label>
              <label class="flex flex-col gap-1.5 mt-4">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Aesthetic (one per line)</span>
                <textarea rows="3" value={personaCore.personality.aesthetic?.join('\n') || ''} on:input={(e) => {
                  personaCore.personality.aesthetic = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }} class="input-field"></textarea>
              </label>
              <label class="flex flex-col gap-1.5 mt-4">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Interests (one per line)</span>
                <textarea rows="3" value={personaCore.personality.interests?.join('\n') || ''} on:input={(e) => {
                  personaCore.personality.interests = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }} class="input-field"></textarea>
              </label>
            </section>

          {:else if coreTab === 'values'}
            <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="m-0 mb-4 text-lg font-semibold">Core Values</h3>
              {#if personaCore.values.core}
                {#each personaCore.values.core as coreValue, i}
                  <div class="p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
                    <div class="flex justify-between items-center mb-3">
                      <span class="font-semibold text-purple-600">#{coreValue.priority}</span>
                      <button class="btn-danger btn-sm" on:click={() => removeCoreValue(i)}>Remove</button>
                    </div>
                    <label class="flex flex-col gap-1.5">
                      <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Value</span>
                      <input type="text" bind:value={coreValue.value} class="input-field" />
                    </label>
                    <label class="flex flex-col gap-1.5 mt-3">
                      <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Description</span>
                      <textarea rows="2" bind:value={coreValue.description} class="input-field"></textarea>
                    </label>
                    <label class="flex flex-col gap-1.5 mt-3">
                      <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Priority</span>
                      <input type="number" min="1" bind:value={coreValue.priority} class="input-field" />
                    </label>
                  </div>
                {/each}
              {/if}
              <button class="btn-primary" on:click={addCoreValue}>+ Add Core Value</button>
            </section>

            <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="m-0 mb-4 text-lg font-semibold">Boundaries</h3>
              <label class="flex flex-col gap-1.5">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Boundaries (one per line)</span>
                <textarea rows="5" value={personaCore.values.boundaries.join('\n')} on:input={(e) => {
                  personaCore.values.boundaries = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }} class="input-field"></textarea>
              </label>
            </section>

          {:else if coreTab === 'goals'}
            {#each [
              { key: 'shortTerm', label: 'Short-Term Goals', statuses: ['pending', 'active', 'completed', 'paused'] },
              { key: 'midTerm', label: 'Mid-Term Goals', statuses: ['pending', 'active', 'design', 'planning', 'completed'] },
              { key: 'longTerm', label: 'Long-Term Goals', statuses: ['aspirational', 'ongoing', 'active', 'completed'] }
            ] as goalType}
              <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <h3 class="m-0 mb-4 text-lg font-semibold">{goalType.label}</h3>
                {#if personaCore.goals?.[goalType.key]}
                  {#each personaCore.goals[goalType.key] as goal, i}
                    <div class="p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
                      <button class="btn-danger btn-sm float-right" on:click={() => removeGoal(goalType.key, i)}>Remove</button>
                      <label class="flex flex-col gap-1.5">
                        <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Goal</span>
                        <input type="text" bind:value={goal.goal} class="input-field" />
                      </label>
                      <label class="flex flex-col gap-1.5 mt-3">
                        <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Status</span>
                        <select bind:value={goal.status} class="select-field">
                          {#each goalType.statuses as status}
                            <option value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>
                          {/each}
                        </select>
                      </label>
                      <label class="flex flex-col gap-1.5 mt-3">
                        <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Notes</span>
                        <textarea rows="2" bind:value={goal.notes} class="input-field"></textarea>
                      </label>
                    </div>
                  {/each}
                {/if}
                <button class="btn-primary" on:click={() => addGoal(goalType.key)}>+ Add {goalType.label.replace(' Goals', '')} Goal</button>
              </section>
            {/each}

          {:else if coreTab === 'context'}
            <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="m-0 mb-4 text-lg font-semibold">Domains</h3>
              <label class="flex flex-col gap-1.5">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Domains of Expertise (one per line)</span>
                <textarea rows="4" value={personaCore.context?.domains?.join('\n') || ''} on:input={(e) => {
                  if (!personaCore.context) personaCore.context = { domains: [], projects: [], currentFocus: [] };
                  personaCore.context.domains = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }} class="input-field"></textarea>
              </label>
            </section>

            <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="m-0 mb-4 text-lg font-semibold">Projects</h3>
              {#if personaCore.context?.projects}
                {#each personaCore.context.projects as project, i}
                  <div class="p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
                    <button class="btn-danger btn-sm float-right" on:click={() => removeProject(i)}>Remove</button>
                    <label class="flex flex-col gap-1.5">
                      <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Project Name</span>
                      <input type="text" bind:value={project.name} class="input-field" />
                    </label>
                    <label class="flex flex-col gap-1.5 mt-3">
                      <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Status</span>
                      <select bind:value={project.status} class="select-field">
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                        <option value="completed">Completed</option>
                        <option value="planning">Planning</option>
                      </select>
                    </label>
                    <label class="flex flex-col gap-1.5 mt-3">
                      <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Summary</span>
                      <textarea rows="2" bind:value={project.summary} class="input-field"></textarea>
                    </label>
                  </div>
                {/each}
              {/if}
              <button class="btn-primary" on:click={addProject}>+ Add Project</button>
            </section>

            <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="m-0 mb-4 text-lg font-semibold">Current Focus</h3>
              <label class="flex flex-col gap-1.5">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Current Focus Areas (one per line)</span>
                <textarea rows="4" value={personaCore.context?.currentFocus?.join('\n') || ''} on:input={(e) => {
                  if (!personaCore.context) personaCore.context = { domains: [], projects: [], currentFocus: [] };
                  personaCore.context.currentFocus = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }} class="input-field"></textarea>
              </label>
            </section>

          {:else if coreTab === 'advanced'}
            <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="m-0 mb-4 text-lg font-semibold">Decision Heuristics</h3>
              {#if personaCore.decisionHeuristics}
                {#each personaCore.decisionHeuristics as heuristic, i}
                  <div class="p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
                    <button class="btn-danger btn-sm float-right" on:click={() => removeDecisionHeuristic(i)}>Remove</button>
                    <label class="flex flex-col gap-1.5">
                      <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Signal</span>
                      <input type="text" bind:value={heuristic.signal} class="input-field" />
                    </label>
                    <label class="flex flex-col gap-1.5 mt-3">
                      <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Response</span>
                      <textarea rows="2" bind:value={heuristic.response} class="input-field"></textarea>
                    </label>
                    <label class="flex flex-col gap-1.5 mt-3">
                      <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Evidence (optional)</span>
                      <input type="text" bind:value={heuristic.evidence} class="input-field" />
                    </label>
                  </div>
                {/each}
              {/if}
              <button class="btn-primary" on:click={addDecisionHeuristic}>+ Add Decision Heuristic</button>
            </section>

            <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="m-0 mb-4 text-lg font-semibold">Writing Style</h3>
              {#if personaCore.writingStyle}
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Structure</span>
                  <textarea rows="2" bind:value={personaCore.writingStyle.structure} class="input-field"></textarea>
                </label>
                <label class="flex flex-col gap-1.5 mt-4">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Motifs (one per line)</span>
                  <textarea rows="3" value={personaCore.writingStyle.motifs?.join('\n') || ''} on:input={(e) => {
                    if (!personaCore.writingStyle) personaCore.writingStyle = { structure: '', motifs: [], defaultMantra: '' };
                    personaCore.writingStyle.motifs = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                  }} class="input-field"></textarea>
                </label>
                <label class="flex flex-col gap-1.5 mt-4">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Default Mantra</span>
                  <input type="text" bind:value={personaCore.writingStyle.defaultMantra} class="input-field" />
                </label>
              {/if}
            </section>

            <section class="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="m-0 mb-4 text-lg font-semibold">Background & Notes</h3>
              <label class="flex flex-col gap-1.5">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Background</span>
                <textarea rows="4" bind:value={personaCore.background} class="input-field"></textarea>
              </label>
              <label class="flex flex-col gap-1.5 mt-4">
                <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Notes</span>
                <textarea rows="4" bind:value={personaCore.notes} class="input-field"></textarea>
              </label>
            </section>
          {/if}

          <div class="mt-8 flex justify-end">
            <button class="btn-primary px-6 py-3" on:click={savePersonaCore} disabled={saving}>
              {saving ? 'Saving...' : 'Save Core Identity'}
            </button>
          </div>
        </div>
      </div>

    {:else if editorTab === 'facets' && facetsConfig}
      <div class="flex-1 overflow-y-auto p-4">
        <div class="flex justify-between items-center mb-6">
          <h3 class="m-0 text-xl font-semibold">Persona Facets</h3>
          <div class="flex gap-2">
            <button class="btn-secondary" on:click={reloadFacets} disabled={loading}>Refresh</button>
            <button class="btn-primary" on:click={addFacet}>+ Add Facet</button>
          </div>
        </div>

        {#if Object.keys(facetsConfig.facets).length === 0}
          <div class="p-6 mb-8 rounded-lg border border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
            No persona facets were returned. Persona loading is blocked until the configuration is repaired.
          </div>
        {:else}
          <div class="flex flex-col gap-4 mb-8">
            {#each Object.entries(facetsConfig.facets) as [facetId, facet]}
            <div class="p-6 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              <div class="flex justify-between items-center mb-4">
                <h4 class="m-0 text-lg font-semibold">{facet.name}</h4>
                {#if facetId !== 'default'}
                  <button class="btn-danger btn-sm" on:click={() => removeFacet(facetId)}>Remove</button>
                {/if}
              </div>
              <div class="flex flex-col gap-4">
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Name</span>
                  <input type="text" bind:value={facet.name} class="input-field" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Description</span>
                  <textarea rows="2" bind:value={facet.description} class="input-field"></textarea>
                </label>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <label class="flex flex-col gap-1.5">
                    <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Persona File</span>
                    <input type="text" bind:value={facet.personaFile} class="input-field" />
                  </label>
                  <label class="flex flex-col gap-1.5">
                    <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Color</span>
                    <input type="text" bind:value={facet.color} class="input-field" />
                  </label>
                  <label class="flex items-center gap-2">
                    <input type="checkbox" bind:checked={facet.enabled} />
                    <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Enabled</span>
                  </label>
                </div>
                <label class="flex flex-col gap-1.5">
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Usage Hints (one per line)</span>
                  <textarea rows="2" value={facet.usageHints?.join('\n') || ''} on:input={(e) => {
                    facet.usageHints = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                  }} class="input-field"></textarea>
                </label>
              </div>
            </div>
            {/each}
          </div>
        {/if}

        <div class="flex justify-end">
          <button class="btn-primary px-6 py-3" on:click={saveFacets} disabled={saving}>
            {saving ? 'Saving...' : 'Save Facets'}
          </button>
        </div>
      </div>

    {:else if editorTab === 'facets'}
      <div class="flex-1 overflow-y-auto p-6">
        <div class="p-6 rounded-lg border border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
          <h3 class="m-0 mb-2 text-lg font-semibold">Persona facets unavailable</h3>
          <p class="m-0 mb-4">{loading ? 'Loading persona facets...' : (error || 'No persona facet configuration was returned.')}</p>
          <button class="btn-danger" on:click={reloadFacets} disabled={loading}>
            {loading ? 'Loading...' : 'Retry'}
          </button>
        </div>
      </div>

    {:else if editorTab === 'insights'}
      <div class="flex-1 overflow-y-auto p-4">
        <div class="flex justify-between items-start mb-6">
          <div>
            <h3 class="m-0 mb-2 text-xl font-semibold">Persona Insights</h3>
            <p class="m-0 text-sm text-gray-500 dark:text-gray-400 max-w-xl">
              Track how your persona evolves over time. The psychoanalyzer agent analyzes your conversations and updates your persona based on patterns it discovers.
            </p>
          </div>
          <button class="btn-secondary" on:click={loadInsights} disabled={loadingInsights}>
            {loadingInsights ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {#if loadingInsights && !insights}
          <div class="text-center py-12">Loading insights...</div>
        {:else if insights && insights.entries.length === 0}
          <div class="text-center py-12 text-gray-500 dark:text-gray-400">
            <p>No insights yet. Run the psychoanalyzer agent to analyze your conversations and discover personality patterns.</p>
            <p class="text-sm mt-2 text-gray-400">Go to Memory → Run Psychoanalyzer to get started.</p>
          </div>
        {:else if insights && insights.entries.length > 0}
          <div class="flex flex-col gap-4">
            {#each insights.entries as entry}
              <div class="flex gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 {getInsightColor(entry.type)}">
                  <span class="text-white font-bold">{getInsightIcon(entry.type)}</span>
                </div>
                <div class="flex-1">
                  <div class="flex items-center gap-3 mb-2">
                    <span class="font-semibold capitalize">{entry.category}</span>
                    <span class="text-xs uppercase font-medium {getInsightTextColor(entry.type)}">{entry.type}</span>
                  </div>
                  <div class="flex flex-wrap gap-2 mb-3">
                    {#each entry.items as item}
                      <span class="inline-block px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded-full text-sm text-gray-700 dark:text-gray-300">{item}</span>
                    {/each}
                  </div>
                  {#if entry.reasoning}
                    <div class="my-3 p-3 bg-gray-100 dark:bg-gray-900 rounded border-l-3 border-purple-500">
                      <span class="block text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-1">Reasoning:</span>
                      <span class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{entry.reasoning}</span>
                    </div>
                  {/if}
                  <div class="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                    <span>{formatInsightDate(entry.timestamp)}</span>
                    <span>{entry.memoriesAnalyzed} memories · {Math.round(entry.confidence * 100)}% confidence
                      {#if entry.sessionId}
                        · Session: {entry.sessionId.slice(-8)}
                      {/if}
                    </span>
                  </div>
                </div>
              </div>
            {/each}
          </div>
          {#if insights.lastUpdated}
            <div class="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 text-center">
              Last updated: {formatInsightDate(insights.lastUpdated)}
            </div>
          {/if}
        {/if}
      </div>

    {:else if editorTab === 'archives'}
      <div class="flex-1 overflow-y-auto p-4">
        <div class="flex justify-between items-start mb-6">
          <div>
            <h3 class="m-0 mb-2 text-xl font-semibold">Persona Archives</h3>
            <p class="m-0 text-sm text-gray-500 dark:text-gray-400 max-w-xl">
              View and restore previous versions of your persona profile. Archives are automatically created by the psychoanalyzer agent before updates.
            </p>
          </div>
          <button class="btn-secondary" on:click={loadArchives} disabled={loadingArchives}>
            {loadingArchives ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {#if error}
          <div class="flex flex-col items-center justify-center p-12 gap-4">
            <div class="text-xl font-semibold text-red-600">Failed to load archives</div>
            <div class="text-red-800 dark:text-red-400">{error}</div>
            <button class="btn-danger" on:click={loadArchives}>Retry</button>
          </div>
        {:else if loadingArchives && archives.length === 0}
          <div class="text-center py-12">Loading archives...</div>
        {:else if archives.length === 0}
          <div class="text-center py-12 text-gray-500 dark:text-gray-400">
            <p>No archives found. Archives are created automatically when the psychoanalyzer agent updates your persona.</p>
          </div>
        {:else}
          <div class="flex flex-col gap-4">
            {#each archives as archive}
              <div class="p-5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-all hover:border-purple-500 dark:hover:border-purple-400">
                <div class="flex justify-between items-start mb-3">
                  <div>
                    <h4 class="m-0 mb-1 text-lg font-semibold">{archive.identity.name}</h4>
                    <span class="text-sm text-gray-500 dark:text-gray-400 font-mono">{formatTimestamp(archive.timestamp)}</span>
                  </div>
                  <div class="flex gap-2">
                    <button class="btn-secondary btn-sm" on:click={() => viewArchive(archive.filename)}>View</button>
                    <button class="btn-primary btn-sm" on:click={() => restoreArchive(archive.filename)} disabled={saving}>Restore</button>
                    <button class="btn-danger btn-sm" on:click={() => deleteArchive(archive.filename)} disabled={saving}>Delete</button>
                  </div>
                </div>
                <div class="flex gap-6 text-sm text-gray-500 dark:text-gray-400">
                  <span>Role: {archive.identity.role}</span>
                  <span>Version: {archive.version}</span>
                  <span>Size: {formatFileSize(archive.size)}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if viewingArchive && selectedArchive}
          <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000]" on:click={closeArchiveViewer} on:keydown={(e) => e.key === 'Escape' && closeArchiveViewer()} role="button" tabindex="-1">
            <div class="bg-white dark:bg-gray-800 rounded-lg w-[90%] max-w-4xl max-h-[85vh] flex flex-col shadow-2xl" on:click|stopPropagation role="dialog" aria-modal="true">
              <div class="flex justify-between items-center p-5 border-b border-gray-200 dark:border-gray-700">
                <h3 class="m-0 text-xl font-semibold">Archive Viewer</h3>
                <button class="w-8 h-8 flex items-center justify-center rounded text-2xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all" on:click={closeArchiveViewer}>×</button>
              </div>
              <div class="flex-1 overflow-y-auto p-6">
                <pre class="m-0 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-sm overflow-x-auto">{JSON.stringify(selectedArchive, null, 2)}</pre>
              </div>
              <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                <button class="btn-secondary" on:click={closeArchiveViewer}>Close</button>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .border-l-3 {
    border-left-width: 3px;
  }
</style>
