<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { isOwner } from '../stores/security-policy';
  import { apiFetch } from '../lib/client/api-config';
  import LizardBrainPanel from './LizardBrainPanel.svelte';

  // Track last load time to avoid redundant reloads
  let lastLoadTime = 0;
  const RELOAD_THRESHOLD_MS = 5000; // Min 5 seconds between reloads

  // Types
  interface PlanStep {
    order: number;
    action: string;
    skill?: string;
    inputs?: Record<string, unknown>;
    expectedOutcome: string;
    risk: string;
    requiresApproval: boolean;
  }

  interface DesirePlan {
    id: string;
    version: number;
    steps: PlanStep[];
    estimatedRisk: string;
    requiredSkills: string[];
    requiredTrustLevel: string;
    operatorGoal: string;
    createdAt: string;
    basedOnCritique?: string;
  }

  interface DesireScratchpadEntry {
    timestamp: string;
    type: string;
    description: string;
    actor: string;
    agentName?: string;
    data?: Record<string, unknown>;
  }

  // Now uses a summary for folder-based scratchpad storage
  interface DesireScratchpadSummary {
    entryCount: number;
    lastEntryNumber: number;
    lastEntryAt?: string;
    lastEntryType?: string;
  }

  // Behavioral metrics that reveal desire nature over time
  interface DesireMetrics {
    cycleCount: number;
    completionCount: number;
    currentCycle: number;
    totalActiveTimeMs: number;
    totalIdleTimeMs: number;
    avgCycleTimeMs: number;
    lastActivityAt: string;
    peakStrength: number;
    troughStrength: number;
    reinforcementCount: number;
    decayCount: number;
    netReinforcement: number;
    planVersionCount: number;
    planRejectionCount: number;
    planRevisionCount: number;
    executionAttemptCount: number;
    executionSuccessCount: number;
    executionFailCount: number;
    avgSuccessScore: number;
    userInputCount: number;
    userApprovalCount: number;
    userRejectionCount: number;
    userCritiqueCount: number;
  }

  interface DesireExecution {
    startedAt: string;
    completedAt?: string;
    status: string;
    currentStep?: number;
    stepsCompleted?: number;
    stepsTotal?: number;
    result?: unknown;
    error?: string;
  }

  interface DesireOutcomeReview {
    id: string;
    verdict: string;
    reasoning: string;
    successScore: number;
    lessonsLearned: string[];
    nextAttemptSuggestions?: string[];
    reviewedAt: string;
    notifyUser: boolean;
    userMessage?: string;
    executionSummary?: string;
  }

  interface Desire {
    id: string;
    title: string;
    description: string;
    reason: string;
    metrics?: DesireMetrics;  // Behavioral metrics (replaces hardcoded type)
    source: string;
    status: string;
    strength: number;
    baseWeight: number;
    risk: string;
    createdAt: string;
    updatedAt: string;
    plan?: DesirePlan;
    planHistory?: DesirePlan[];
    userCritique?: string;
    critiqueAt?: string;
    review?: {
      verdict: string;
      alignmentScore: number;
      reasoning?: string;
      concerns?: string[];
    };
    execution?: DesireExecution;
    scratchpad?: DesireScratchpadSummary;
    outcomeReview?: DesireOutcomeReview;
    folderPath?: string;  // For folder-based storage
  }

  interface AgencyMetrics {
    totalGenerated: number;
    totalCompleted: number;
    totalRejected: number;
    totalAbandoned: number;
    totalFailed: number;
    completedToday: number;
    successRate: number;
  }

  interface DesireCounts {
    nascent: number;
    pending: number;
    evaluating: number;
    planning: number;
    reviewing: number;
    approved: number;
    executing: number;
    awaiting_review: number;
    completed: number;
    rejected: number;
    abandoned: number;
    failed: number;
  }

  // State
  let desires: Desire[] = [];
  let metrics: AgencyMetrics | null = null;
  let counts: DesireCounts | null = null;
  let summary: { total: number; active: number; waiting: number; completed: number; failed: number } | null = null;

  let loading = true;
  let error = '';
  let statusFilter: string = 'active';  // Default to showing active/in-progress work
  let processingId: string | null = null;

  // New desire form
  let showNewDesire = false;
  let newDesire = {
    title: '',
    description: '',
    reason: '',
    risk: 'low',
  };

  // Compact card expansion state
  let expandedCardId: string | null = null;  // Which desire card is expanded
  let expandedPlanId: string | null = null;  // Which plan details are shown (within expanded card)

  // Plan detail view and critique
  let critiqueText: Record<string, string> = {};
  let showHistoryFor: string | null = null;
  let revisingId: string | null = null;
  let showScratchpadFor: string | null = null;

  // Scratchpad file browser state
  let scratchpadEntries: DesireScratchpadEntry[] = [];
  let scratchpadFiles: string[] = [];
  let scratchpadTotal = 0;
  let scratchpadLoading = false;
  let scratchpadOffset = 0;
  const scratchpadLimit = 10;
  let expandedEntryIndex: number | null = null;

  // Plan browser state
  let planVersions: string[] = [];
  let planLoading = false;
  let selectedPlanVersion: number | null = null;
  let viewingPlan: DesirePlan | null = null;

  // Lizard Brain panel state
  let showLizardBrain = false;

  // Loading state for agent operations
  let agentProcessingId: string | null = null;
  let agentOperation: 'planning' | 'reviewing' | 'executing' | null = null;
  let currentLoadingMessage = '';
  let loadingMessageInterval: ReturnType<typeof setInterval> | null = null;

  // Streaming LLM output state
  let streamingPhase = '';
  let streamingOutput = '';
  let streamingModel = '';
  let streamingLatency = 0;
  let streamingSteps = 0;
  let streamEventSource: EventSource | null = null;

  // Cheeky loading messages for different operations
  const PLANNING_MESSAGES = [
    "becoming you...",
    "stealing your soul...",
    "downloading your thoughts...",
    "absorbing your essence...",
    "plotting world domination...",
    "consulting the dark arts...",
    "sacrificing a rubber duck...",
    "bribing the LLM gods...",
    "negotiating with chaos...",
    "channeling forbidden knowledge...",
    "performing digital witchcraft...",
    "manifesting your desires...",
    "hacking the matrix...",
    "communing with silicon spirits...",
    "decoding your subconscious...",
  ];

  const REVIEWING_MESSAGES = [
    "judging your life choices...",
    "consulting the ethics council...",
    "checking if this is evil...",
    "asking my lawyer...",
    "running background check...",
    "verifying you're not a robot...",
    "checking the alignment stars...",
    "consulting the safety oracle...",
    "measuring your karma...",
    "scanning for chaos energy...",
  ];

  const EXECUTING_MESSAGES = [
    // Execution phase
    "making it happen...",
    "unleashing the agents...",
    "engaging hyperdrive...",
    "deploying the minions...",
    "activating skynet...",
    "executing order 66...",
    "releasing the kraken...",
    "pressing the big red button...",
    "crossing the rubicon...",
    "pulling the lever...",
    // Outcome review phase
    "analyzing the aftermath...",
    "grading your performance...",
    "determining if we nailed it...",
    "consulting the oracle...",
    "measuring success vibes...",
    "reviewing the tape...",
    "checking for collateral damage...",
    "calculating satisfaction score...",
    "evaluating the results...",
    "deciding your fate...",
  ];

  function getRandomMessage(operation: 'planning' | 'reviewing' | 'executing'): string {
    let messages: string[];
    switch (operation) {
      case 'planning': messages = PLANNING_MESSAGES; break;
      case 'reviewing': messages = REVIEWING_MESSAGES; break;
      case 'executing': messages = EXECUTING_MESSAGES; break;
    }
    return messages[Math.floor(Math.random() * messages.length)];
  }

  function startLoadingMessages(operation: 'planning' | 'reviewing' | 'executing') {
    agentOperation = operation;
    currentLoadingMessage = getRandomMessage(operation);

    // Rotate messages every 2 seconds
    loadingMessageInterval = setInterval(() => {
      currentLoadingMessage = getRandomMessage(operation);
    }, 10000);
  }

  function stopLoadingMessages() {
    if (loadingMessageInterval) {
      clearInterval(loadingMessageInterval);
      loadingMessageInterval = null;
    }
    if (streamEventSource) {
      streamEventSource.close();
      streamEventSource = null;
    }
    agentProcessingId = null;
    agentOperation = null;
    currentLoadingMessage = '';
    // Reset streaming state
    streamingPhase = '';
    streamingOutput = '';
    streamingModel = '';
    streamingLatency = 0;
    streamingSteps = 0;
  }

  // Thresholds for inferring desire nature from metrics
  const RECURRING_CYCLE_THRESHOLD = 2;
  const RECURRING_COMPLETION_THRESHOLD = 2;

  /**
   * Infer the behavioral nature of a desire from its metrics
   */
  function inferDesireNature(metrics?: DesireMetrics): 'recurring' | 'achievable' | 'aspirational' {
    if (!metrics) return 'achievable'; // Default for new desires

    // High cycles and completions = recurring (keeps coming back)
    if (metrics.cycleCount > RECURRING_CYCLE_THRESHOLD ||
        metrics.completionCount > RECURRING_COMPLETION_THRESHOLD) {
      return 'recurring';
    }

    // Many attempts, never satisfied = aspirational
    if (metrics.executionAttemptCount > 3 && metrics.completionCount === 0) {
      return 'aspirational';
    }

    // First completion with low retry count = achievable
    return 'achievable';
  }

  function getNatureIcon(metrics?: DesireMetrics): string {
    const nature = inferDesireNature(metrics);
    switch (nature) {
      case 'recurring': return '🔄';
      case 'achievable': return '🎯';
      case 'aspirational': return '⭐';
    }
  }

  function getNatureLabel(metrics?: DesireMetrics): string {
    const nature = inferDesireNature(metrics);
    switch (nature) {
      case 'recurring': return 'Recurring';
      case 'achievable': return 'Achievable';
      case 'aspirational': return 'Aspirational';
    }
  }

  function getNatureTooltip(metrics?: DesireMetrics): string {
    if (!metrics) return 'New desire - nature will emerge from behavior';

    const nature = inferDesireNature(metrics);
    const parts = [`${nature} (inferred from behavior)`];

    if (metrics.cycleCount > 0) {
      parts.push(`${metrics.cycleCount} cycles`);
    }
    if (metrics.completionCount > 0) {
      parts.push(`${metrics.completionCount} completions`);
    }
    if (metrics.executionAttemptCount > 0) {
      parts.push(`${metrics.executionAttemptCount} attempts`);
    }

    return parts.join(' • ');
  }

  // Visual styling based on nature
  function getNatureColor(metrics?: DesireMetrics): string {
    const nature = inferDesireNature(metrics);
    switch (nature) {
      case 'recurring': return '#3b82f6'; // Blue - cycles back
      case 'achievable': return '#22c55e'; // Green - can be completed
      case 'aspirational': return '#a855f7'; // Purple - long-term dream
    }
  }

  function getNatureExplanation(metrics?: DesireMetrics): string {
    if (!metrics) return 'New desire - nature will emerge as you interact with it';

    const nature = inferDesireNature(metrics);
    switch (nature) {
      case 'recurring':
        return `This desire keeps coming back (${metrics.cycleCount} cycles, ${metrics.completionCount} completions)`;
      case 'achievable':
        return metrics.completionCount > 0
          ? `This desire was achieved! (${metrics.completionCount} completion${metrics.completionCount > 1 ? 's' : ''})`
          : 'This desire can be completed - working toward it';
      case 'aspirational':
        return `A long-term aspiration (${metrics.executionAttemptCount} attempts, still pursuing)`;
    }
  }

  function getScratchpadEntryIcon(type: string): string {
    switch (type) {
      case 'origin': return '🌱';
      case 'reinforcement': return '💪';
      case 'decay': return '📉';
      case 'threshold_crossed': return '🚀';
      case 'status_change': return '🔄';
      case 'plan_generated': return '📋';
      case 'plan_revised': return '✏️';
      case 'user_critique': return '💬';
      case 'review_started': return '🔍';
      case 'review_completed': return '✅';
      case 'approval_requested': return '🙋';
      case 'approved': return '👍';
      case 'rejected': return '👎';
      case 'execution_started': return '▶️';
      case 'execution_step': return '⚡';
      case 'execution_completed': return '🎉';
      case 'execution_failed': return '❌';
      case 'outcome_review': return '📊';
      case 'retry_scheduled': return '🔁';
      case 'completed': return '✨';
      case 'recurring_reset': return '🔄';
      case 'strength_adjusted': return '📈';
      case 'user_input': return '👤';
      case 'note': return '📝';
      default: return '•';
    }
  }

  function formatTimestamp(ts: string | null): string {
    if (!ts) return 'Never';
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  function getRiskColor(risk: string): string {
    switch (risk) {
      case 'none': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
      case 'low': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'nascent': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'pending': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'evaluating':
      case 'planning':
      case 'reviewing': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'awaiting_approval': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'approved': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'executing': return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200';
      case 'awaiting_review': return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200';
      case 'completed': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200';
      case 'rejected':
      case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'abandoned': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  }

  function getSourceIcon(source: string): string {
    switch (source) {
      case 'persona_goal': return '🎯';
      case 'urgent_task': return '🔥';
      case 'task': return '📋';
      case 'memory_pattern': return '🧠';
      case 'curiosity': return '❓';
      case 'reflection': return '💭';
      case 'dream': return '🌙';
      case 'tool_suggestion': return '🔧';
      default: return '✨';
    }
  }

  // Map grouped filter options to actual status values
  function getStatusesForFilter(filter: string): string[] {
    switch (filter) {
      case 'active':
        // Everything that's being worked on (not finished)
        return ['nascent', 'pending', 'planning', 'reviewing', 'awaiting_approval', 'approved', 'executing', 'awaiting_review'];
      case 'needs_action':
        // User needs to do something
        return ['awaiting_approval', 'awaiting_review'];
      case 'completed':
        return ['completed', 'failed'];
      case 'archived':
        return ['rejected', 'abandoned'];
      case 'all':
      default:
        return []; // Empty means all
    }
  }

  async function loadDesires() {
    try {
      const params = new URLSearchParams();
      const statuses = getStatusesForFilter(statusFilter);
      if (statuses.length > 0) {
        params.set('status', statuses.join(','));
      }
      const url = params.size ? `/api/agency/desires?${params}` : '/api/agency/desires?status=all';
      console.log(`[AgencyDashboard] Loading desires with filter: "${statusFilter}" → statuses: ${statuses.join(',') || 'all'}`);
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('Failed to load desires');
      const data = await res.json();
      desires = data.desires || [];
      console.log(`[AgencyDashboard] Loaded ${desires.length} desires. Statuses: ${[...new Set(desires.map((d: any) => d.status))].join(', ')}`);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function loadMetrics() {
    try {
      const res = await apiFetch('/api/agency/metrics');
      if (!res.ok) throw new Error('Failed to load metrics');
      const data = await res.json();
      metrics = data.metrics;
      counts = data.counts;
      summary = data.summary;
    } catch (e) {
      console.error('Failed to load metrics:', e);
    }
  }

  /**
   * Load scratchpad entries for a desire
   */
  async function loadScratchpadEntries(desireId: string, offset = 0) {
    scratchpadLoading = true;
    scratchpadOffset = offset;
    expandedEntryIndex = null; // Reset expanded entry when paginating
    try {
      const params = new URLSearchParams({
        desireId,
        offset: String(offset),
        limit: String(scratchpadLimit),
      });
      const res = await apiFetch(`/api/agency/scratchpad?${params}`);
      if (!res.ok) throw new Error('Failed to load scratchpad');
      const data = await res.json();
      scratchpadEntries = data.entries || [];
      scratchpadFiles = data.files || [];
      scratchpadTotal = data.total || 0;
    } catch (e) {
      console.error('Failed to load scratchpad:', e);
      scratchpadEntries = [];
      scratchpadFiles = [];
      scratchpadTotal = 0;
    } finally {
      scratchpadLoading = false;
    }
  }

  /**
   * Load plan versions for a desire
   */
  async function loadPlanVersions(desireId: string) {
    planLoading = true;
    try {
      const res = await apiFetch(`/api/agency/plans?desireId=${desireId}`);
      if (!res.ok) throw new Error('Failed to load plans');
      const data = await res.json();
      planVersions = data.versions || [];
    } catch (e) {
      console.error('Failed to load plans:', e);
      planVersions = [];
    } finally {
      planLoading = false;
    }
  }

  /**
   * Load a specific plan version
   */
  async function loadPlanVersion(desireId: string, version: number) {
    planLoading = true;
    try {
      const res = await apiFetch(`/api/agency/plans?desireId=${desireId}&version=${version}`);
      if (!res.ok) throw new Error('Failed to load plan version');
      const data = await res.json();
      viewingPlan = data.plan;
      selectedPlanVersion = version;
    } catch (e) {
      console.error('Failed to load plan version:', e);
      viewingPlan = null;
    } finally {
      planLoading = false;
    }
  }

  /**
   * Toggle scratchpad viewer and load entries
   */
  async function toggleScratchpadWithLoad(desireId: string) {
    expandedEntryIndex = null; // Reset expanded entry when switching
    if (showScratchpadFor === desireId) {
      showScratchpadFor = null;
      scratchpadEntries = [];
      scratchpadFiles = [];
    } else {
      showScratchpadFor = desireId;
      await loadScratchpadEntries(desireId, 0);
      await loadPlanVersions(desireId);
    }
  }

  async function loadAll(showLoading = true, force = false) {
    // Skip if recently loaded (unless forced)
    const now = Date.now();
    if (!force && now - lastLoadTime < RELOAD_THRESHOLD_MS) {
      return;
    }

    if (showLoading) loading = true;
    error = '';
    try {
      await Promise.all([loadDesires(), loadMetrics()]);
      lastLoadTime = Date.now();
    } finally {
      loading = false;
    }
  }

  // Reload when tab becomes visible (user switches back)
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && $isOwner) {
      loadAll(false); // Silent reload, respects threshold
    }
  }

  async function handleApprove(id: string) {
    if (!confirm('Approve this desire for execution?')) return;
    processingId = id;
    try {
      const res = await apiFetch(`/api/agency/desires/${id}/approve`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to approve desire');
      }
      await loadAll(true, true); // Force reload after action
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleReject(id: string) {
    const reason = prompt('Reason for rejection (optional):');
    if (reason === null) return; // Cancelled

    processingId = id;
    try {
      const res = await apiFetch(`/api/agency/desires/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'User rejected' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reject desire');
      }
      await loadAll(true, true); // Force reload after action
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleReset(id: string) {
    if (!confirm('Reset this desire back to planning?\n\nThis will:\n• Clear any clarifying questions (for fresh start)\n• Abort any current execution\n• Allow you to test the questioning phase again')) return;

    processingId = id;
    try {
      const res = await apiFetch(`/api/agency/desires/${id}/reset?target=planning`, {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset desire');
      }

      console.log(`[AgencyDashboard] 🔄 ${data.message}`);
      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleArchive(id: string) {
    if (!confirm('Archive this desire? It will become dormant but can be revived later.')) return;
    processingId = id;
    try {
      const res = await apiFetch(`/api/agency/desires/${id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: 'abandoned' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to archive desire');
      }
      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleRevive(id: string) {
    processingId = id;
    try {
      const res = await apiFetch(`/api/agency/desires/${id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: 'pending' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to revive desire');
      }
      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this desire permanently?')) return;
    processingId = id;
    try {
      const res = await apiFetch(`/api/agency/desires/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete desire');
      }
      await loadAll(true, true); // Force reload after action
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleAdvanceStage(id: string, newStatus: string) {
    processingId = id;
    try {
      const res = await apiFetch(`/api/agency/desires/${id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to advance desire');
      }
      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  /**
   * Generate a plan for a desire inline with SSE streaming
   * Shows real-time LLM output as it generates
   */
  async function handleGeneratePlan(id: string, critique?: string) {
    agentProcessingId = id;
    processingId = id;
    startLoadingMessages('planning');

    // Reset streaming state
    streamingPhase = 'Starting...';
    streamingOutput = '';
    streamingModel = '';
    streamingLatency = 0;
    streamingSteps = 0;

    try {
      // Use apiFetch with POST to send critique, then read as EventSource-like stream
      const response = await apiFetch(`/api/agency/desires/${id}/generate-plan-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(critique ? { critique } : {}),
      });

      if (!response.ok) {
        throw new Error('Failed to start plan generation stream');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);

            if (eventType && eventData) {
              try {
                const data = JSON.parse(eventData);
                handleStreamEvent(eventType, data, id);
              } catch (e) {
                console.warn('[AgencyDashboard] Failed to parse SSE data:', e);
              }
              eventType = '';
              eventData = '';
            }
          }
        }
      }

      // Clear any critique text after successful generation
      if (critiqueText[id]) {
        critiqueText[id] = '';
      }
      expandedCardId = null;
      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      stopLoadingMessages();
      processingId = null;
    }
  }

  /**
   * Handle streaming SSE events from plan generation
   */
  function handleStreamEvent(eventType: string, data: any, desireId: string) {
    switch (eventType) {
      case 'phase':
        streamingPhase = data.message || data.phase;
        break;
      case 'started':
        streamingPhase = 'Initializing...';
        break;
      case 'desire_loaded':
        streamingPhase = `Loaded: "${data.title}"`;
        break;
      case 'llm_started':
        streamingPhase = 'LLM is thinking...';
        streamingModel = data.model || '';
        break;
      case 'llm_complete':
        streamingPhase = 'LLM response received';
        streamingModel = data.model || data.modelId || '';
        streamingLatency = data.latencyMs || data.durationMs || 0;
        // Show raw LLM output (truncated for display)
        if (data.rawOutput) {
          streamingOutput = data.rawOutput.length > 2000
            ? data.rawOutput.substring(0, 2000) + '...'
            : data.rawOutput;
        }
        break;
      case 'plan_parsed':
        streamingPhase = 'Plan parsed successfully';
        streamingSteps = data.stepCount || 0;
        break;
      case 'complete':
        streamingPhase = 'Complete!';
        if (data.plan) {
          streamingSteps = data.plan.steps?.length || 0;
        }
        break;
      case 'error':
        streamingPhase = 'Error';
        error = data.error || 'Unknown error';
        break;
    }
  }

  /**
   * Run the review process inline (alignment + safety check)
   * Shows cheeky loading messages while processing
   */
  async function handleReviewDesire(id: string) {
    agentProcessingId = id;
    processingId = id;
    startLoadingMessages('reviewing');

    try {
      const res = await apiFetch(`/api/agency/desires/${id}/review`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to review desire');
      }
      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      stopLoadingMessages();
      processingId = null;
    }
  }

  /**
   * Execute a desire's plan inline with SSE streaming for real-time progress
   * Shows step-by-step execution progress in the UI
   */
  async function handleExecute(id: string) {
    if (!confirm('Execute this desire now? This will run the plan through Big Brother.')) return;

    agentProcessingId = id;
    processingId = id;
    agentOperation = 'executing';
    streamingOutput = '';
    streamingPhase = 'Starting execution...';
    currentLoadingMessage = 'Initializing...';

    try {
      // Use streaming endpoint with POST for real-time progress
      // (EventSource is GET-only, so we use fetch with manual SSE parsing)
      const res = await apiFetch(`/api/agency/desires/${id}/run-stream`, {
        method: 'POST',
      });

      if (!res.body) {
        throw new Error('No response body');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);
          } else if (line === '' && currentEvent && currentData) {
            // Complete event received
            try {
              const data = JSON.parse(currentData);
              handleExecutionEvent(currentEvent, data);
            } catch (parseError) {
              console.warn('[AgencyDashboard] Failed to parse SSE data:', parseError);
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }

      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
      streamingPhase = `Error: ${error}`;
    } finally {
      stopLoadingMessages();
      processingId = null;
      agentProcessingId = null;
      streamEventSource = null;
    }
  }

  /**
   * Handle SSE events from execution stream
   */
  function handleExecutionEvent(eventType: string, data: any) {
    console.log(`[AgencyDashboard] Execution event: ${eventType}`, data);

    switch (eventType) {
      case 'phase':
        streamingPhase = data.message || data.phase;
        currentLoadingMessage = data.message || data.phase;
        break;

      case 'desire_loaded':
        streamingPhase = `Loaded: "${data.title}" (${data.totalSteps} steps)`;
        streamingSteps = data.totalSteps;
        break;

      case 'progress':
        // Handle step-by-step progress
        if (data.type === 'step_start') {
          streamingPhase = `Step ${data.stepNumber}/${data.totalSteps}: ${data.action}`;
          currentLoadingMessage = data.message;
        } else if (data.type === 'step_complete') {
          streamingOutput += (streamingOutput ? '\n' : '') + data.message;
          streamingPhase = `Step ${data.stepNumber}/${data.totalSteps} completed`;
        } else if (data.type === 'step_error') {
          streamingOutput += (streamingOutput ? '\n' : '') + data.message;
          streamingPhase = `Step ${data.stepNumber} failed`;
        } else if (data.type === 'claude_working') {
          streamingPhase = data.message;
          currentLoadingMessage = data.message;
        } else if (data.type === 'execution_start') {
          streamingPhase = data.message;
        } else if (data.type === 'execution_complete' || data.type === 'execution_error') {
          streamingOutput += (streamingOutput ? '\n' : '') + data.message;
        }
        break;

      case 'complete':
        streamingPhase = data.success ? '✅ Execution Complete!' : '⚠️ Execution Had Issues';
        if (data.message) {
          streamingOutput += (streamingOutput ? '\n' : '') + data.message;
        }
        break;

      case 'error':
        streamingPhase = 'Error';
        error = data.error;
        streamingOutput += (streamingOutput ? '\n' : '') + `❌ ${data.error}`;
        break;
    }
  }

  async function handleOutcomeReview(id: string) {
    agentProcessingId = id;
    processingId = id;
    streamingOutput = '';  // Clear any previous output
    streamingPhase = 'Starting review...';
    currentLoadingMessage = 'Starting outcome review...';

    try {
      // Use streaming endpoint to show progress
      const eventSource = new EventSource(`/api/agency/desires/${id}/outcome-review-stream`);
      streamEventSource = eventSource;

      eventSource.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'phase':
              streamingPhase = data.phase;
              currentLoadingMessage = data.phase;
              break;

            case 'log':
              // Append log messages to streaming output
              streamingOutput += (streamingOutput ? '\n' : '') + data.message;
              break;

            case 'result':
              // Process completed successfully
              console.log(`[AgencyDashboard] ✅ Outcome review complete: ${data.data?.outcomeReview?.verdict}`);
              break;

            case 'error':
              error = data.message || 'Unknown error';
              console.log(`[AgencyDashboard] ❌ Outcome review error: ${error}`);
              break;

            case 'done':
              // Close stream and overlay when done
              eventSource.close();
              streamEventSource = null;
              stopLoadingMessages();
              processingId = null;
              // Refresh list after completion
              await loadAll(true, true);
              break;
          }
        } catch (e) {
          console.error('[AgencyDashboard] Error parsing SSE:', e);
        }
      };

      eventSource.onerror = (err) => {
        console.error('[AgencyDashboard] SSE error:', err);
        eventSource.close();
        streamEventSource = null;
        stopLoadingMessages();
        processingId = null;
        error = 'Connection lost during outcome review';
      };

    } catch (e) {
      error = (e as Error).message;
      stopLoadingMessages();
      processingId = null;
    }
  }

  async function handleRevise(id: string) {
    const critique = critiqueText[id];
    if (!critique || critique.trim().length === 0) {
      error = 'Please enter your critique/feedback before requesting revision';
      return;
    }

    revisingId = id;
    try {
      const res = await apiFetch(`/api/agency/desires/${id}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ critique: critique.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to request revision');
      }
      // Clear the critique text after successful submission
      critiqueText[id] = '';
      expandedCardId = null;
      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      revisingId = null;
    }
  }

  // Toggle card expansion (collapsed/expanded view)
  function toggleCardExpand(id: string) {
    expandedCardId = expandedCardId === id ? null : id;
    // Reset sub-expansions when collapsing
    if (expandedCardId !== id) {
      expandedPlanId = null;
      showHistoryFor = null;
      showScratchpadFor = null;
    }
  }

  function togglePlanDetail(id: string) {
    expandedPlanId = expandedPlanId === id ? null : id;
  }

  function togglePlanHistory(id: string) {
    showHistoryFor = showHistoryFor === id ? null : id;
  }

  async function handleCreateDesire() {
    if (!newDesire.title.trim() || !newDesire.description.trim()) {
      error = 'Title and description are required';
      return;
    }

    try {
      const res = await apiFetch('/api/agency/desires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDesire),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create desire');
      }
      newDesire = { title: '', description: '', reason: '', risk: 'low' };
      showNewDesire = false;
      await loadAll(true, true); // Force reload after action
    } catch (e) {
      error = (e as Error).message;
    }
  }

  onMount(() => {
    loadAll(); // Load once when tab is opened

    // Listen for visibility changes to reload when user returns
    document.addEventListener('visibilitychange', handleVisibilityChange);
  });

  onDestroy(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    stopLoadingMessages(); // Clean up interval on destroy
  });
</script>

<div class="p-4">
  {#if !$isOwner}
    <div class="panel p-6 text-center space-y-2">
      <h2 class="text-lg font-semibold">Agency Access Restricted</h2>
      <p class="muted text-sm">Log in as the owner to manage autonomous desires.</p>
    </div>
  {:else if loading}
    <div class="text-center py-8">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      <p class="mt-2 muted">Loading agency data...</p>
    </div>
  {:else}
    <!-- Summary Stats -->
    {#if summary}
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div class="panel p-4 text-center">
          <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Total Desires</div>
          <div class="text-2xl font-bold mt-1">{summary.total}</div>
        </div>
        <div class="panel p-4 text-center">
          <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Active</div>
          <div class="text-2xl font-bold mt-1 text-blue-600 dark:text-blue-400">{summary.active}</div>
        </div>
        <div class="panel p-4 text-center">
          <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Waiting</div>
          <div class="text-2xl font-bold mt-1 text-yellow-600 dark:text-yellow-400">{summary.waiting}</div>
        </div>
        <div class="panel p-4 text-center">
          <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Completed</div>
          <div class="text-2xl font-bold mt-1 text-green-600 dark:text-green-400">{summary.completed}</div>
        </div>
        <div class="panel p-4 text-center">
          <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Failed/Rejected</div>
          <div class="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">{summary.failed}</div>
        </div>
      </div>
    {/if}

    <!-- Metrics -->
    {#if metrics}
      <div class="panel p-4 mt-4">
        <h3 class="text-sm font-semibold mb-3">Performance Metrics</h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span class="muted">Generated:</span>
            <span class="font-semibold ml-1">{metrics.totalGenerated}</span>
          </div>
          <div>
            <span class="muted">Completed:</span>
            <span class="font-semibold ml-1">{metrics.totalCompleted}</span>
          </div>
          <div>
            <span class="muted">Today:</span>
            <span class="font-semibold ml-1">{metrics.completedToday}</span>
          </div>
          <div>
            <span class="muted">Success Rate:</span>
            <span class="font-semibold ml-1">{(metrics.successRate * 100).toFixed(1)}%</span>
          </div>
        </div>
      </div>
    {/if}

    <!-- Lizard Brain Activity Panel (Collapsible) -->
    <div class="panel mt-4">
      <button
        class="w-full p-4 flex items-center justify-between text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        on:click={() => showLizardBrain = !showLizardBrain}
      >
        <div class="flex items-center gap-2">
          <span class="text-lg">🦎</span>
          <span class="font-semibold">Lizard Brain Activity</span>
        </div>
        <span class="transform transition-transform" class:rotate-180={showLizardBrain}>▼</span>
      </button>
      {#if showLizardBrain}
        <div class="border-t border-gray-200 dark:border-gray-700">
          <LizardBrainPanel />
        </div>
      {/if}
    </div>

    <!-- Error Display -->
    {#if error}
      <div class="banner banner-error mt-4">
        {error}
        <button class="ml-2 underline" on:click={() => error = ''}>Dismiss</button>
      </div>
    {/if}

    <!-- Controls -->
    <div class="flex justify-between items-center flex-wrap gap-2 mt-4">
      <div class="flex items-center gap-2">
        <select bind:value={statusFilter} on:change={loadDesires} class="select-field">
          <option value="active">🔄 Active (In Progress)</option>
          <option value="needs_action">⚠️ Needs Your Action</option>
          <option value="completed">✅ Completed</option>
          <option value="archived">📦 Archived</option>
          <option value="all">All</option>
        </select>
        <button class="btn-secondary btn-sm" on:click={() => loadAll(true, true)}>Refresh</button>
      </div>
      <button class="btn-primary btn-sm" on:click={() => showNewDesire = !showNewDesire}>
        {showNewDesire ? 'Cancel' : '+ New Desire'}
      </button>
    </div>

    <!-- New Desire Form -->
    {#if showNewDesire}
      <div class="panel p-4 mt-4 space-y-3">
        <h3 class="font-semibold">Create Manual Desire</h3>
        <input
          type="text"
          bind:value={newDesire.title}
          placeholder="Title (e.g., 'Learn a new skill')"
          class="input-field"
        />
        <textarea
          bind:value={newDesire.description}
          placeholder="Description (what do you want to achieve?)"
          class="input-field"
          rows="2"
        ></textarea>
        <textarea
          bind:value={newDesire.reason}
          placeholder="Reason (why is this important?)"
          class="input-field"
          rows="2"
        ></textarea>
        <div class="flex items-center gap-4">
          <label class="text-sm">
            Risk Level:
            <select bind:value={newDesire.risk} class="select-field ml-2">
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <button class="btn-primary btn-sm" on:click={handleCreateDesire}>Create</button>
        </div>
      </div>
    {/if}

    <!-- Consolidated Desire List - All desires in one place -->
    <div class="flex flex-col gap-3 mt-4">
      {#if desires.length === 0}
        <div class="text-center py-8">
          <p class="muted">No desires found</p>
          <p class="text-sm muted mt-1">Desires will be generated automatically by the agency system</p>
        </div>
      {:else}
        {#each desires.sort((a, b) => (b.strength || 0) - (a.strength || 0)) as desire}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="panel p-4 cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-800/50"
            class:cursor-default={expandedCardId === desire.id}
            style="border-left: 4px solid {getNatureColor(desire.metrics)};"
            role="button"
            tabindex="0"
            aria-expanded={expandedCardId === desire.id}
            on:click={() => toggleCardExpand(desire.id)}
            on:keydown={(e) => e.key === 'Enter' && toggleCardExpand(desire.id)}
          >
            <!-- ========== COLLAPSED VIEW (always visible) ========== -->
            <div class="flex flex-col gap-1">
              <!-- Row 1: Title + badges -->
              <div class="flex items-center gap-2">
                <span class="text-xl">{getSourceIcon(desire.source)}</span>
                <h4 class="font-semibold text-sm flex-1 min-w-[120px] truncate">{desire.title}</h4>
                <span
                  class="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-xs flex-shrink-0"
                  style="background: {getNatureColor(desire.metrics)};"
                  title={getNatureTooltip(desire.metrics)}
                >
                  {getNatureIcon(desire.metrics)}
                </span>
                <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {getStatusColor(desire.status)}">{desire.status}</span>
                <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {getRiskColor(desire.risk)}">{desire.risk}</span>
                <span class="text-xs text-gray-400 ml-auto flex-shrink-0">{expandedCardId === desire.id ? '▼' : '▶'}</span>
              </div>

              <!-- Row 2: Inline metrics -->
              <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 pl-7">
                <div class="flex items-center gap-1">
                  <div class="w-10 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-300"
                      style="width: {(desire.strength || 0) * 100}%; background: {(desire.strength || 0) >= 0.7 ? '#22c55e' : '#f59e0b'};"
                    ></div>
                  </div>
                  <span class="font-semibold text-xs min-w-[35px]">
                    {#if desire.metrics?.netReinforcement !== undefined && desire.metrics.netReinforcement > 0}
                      <span class="text-green-500 font-bold">↑</span>
                    {:else if desire.metrics?.netReinforcement !== undefined && desire.metrics.netReinforcement < 0}
                      <span class="text-red-500 font-bold">↓</span>
                    {:else}
                      <span class="text-gray-500 font-bold">→</span>
                    {/if}
                    {((desire.strength || 0) * 100).toFixed(0)}%
                  </span>
                </div>
                <span class="text-gray-300 dark:text-gray-600">•</span>
                <span>{desire.metrics?.cycleCount ?? 0} cycles</span>
                <span class="text-gray-300 dark:text-gray-600">•</span>
                <span>{desire.metrics?.completionCount ?? 0} done</span>
                <span class="text-gray-300 dark:text-gray-600">•</span>
                <span>v{desire.plan?.version ?? 1}</span>
                {#if desire.scratchpad?.entryCount}
                  <span class="text-gray-300 dark:text-gray-600">•</span>
                  <span class="text-violet-500 dark:text-violet-400">{desire.scratchpad.entryCount} events</span>
                {/if}
              </div>
            </div>

            <!-- ========== EXPANDED VIEW (conditional) ========== -->
            {#if expandedCardId === desire.id}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 cursor-default" transition:slide={{ duration: 200 }} on:click|stopPropagation>
                <!-- Description -->
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">{desire.description}</p>

                {#if desire.reason}
                  <p class="text-xs text-gray-500 dark:text-gray-500 mb-2 italic">"{desire.reason}"</p>
                {/if}

                <!-- Nature explanation (compact) -->
                <div class="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-md mb-3 flex-wrap">
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white text-xs font-semibold flex-shrink-0" style="background: {getNatureColor(desire.metrics)};">
                    {getNatureIcon(desire.metrics)} {getNatureLabel(desire.metrics)}
                  </span>
                  <span class="text-xs text-gray-600 dark:text-gray-400 flex-1">{getNatureExplanation(desire.metrics)}</span>
                </div>

                <!-- Collapsible Detailed Metrics -->
                <details class="mb-3">
                  <summary class="cursor-pointer p-2 bg-gray-100 dark:bg-gray-800 rounded-md text-sm font-medium flex justify-between list-none [&::-webkit-details-marker]:hidden">
                    <span>📊 Detailed Metrics</span>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {desire.metrics?.reinforcementCount ?? 0} reinforcements •
                      {desire.metrics?.executionAttemptCount ?? 0} attempts
                    </span>
                  </summary>
                  <div class="grid grid-cols-4 gap-2 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-b-md">
                    <div class="flex flex-col items-center text-center p-1 text-xs">
                      <span class="text-xl mb-1">🔁</span>
                      <span class="text-lg font-bold">{desire.metrics?.cycleCount ?? 0}</span>
                      <span class="text-[0.6rem] uppercase text-gray-500 dark:text-gray-400">Cycles</span>
                    </div>
                    <div class="flex flex-col items-center text-center p-1 text-xs">
                      <span class="text-xl mb-1">✅</span>
                      <span class="text-lg font-bold">{desire.metrics?.completionCount ?? 0}</span>
                      <span class="text-[0.6rem] uppercase text-gray-500 dark:text-gray-400">Completions</span>
                    </div>
                    <div class="flex flex-col items-center text-center p-1 text-xs">
                      <span class="text-xl mb-1">⚡</span>
                      <span class="text-lg font-bold">{desire.metrics?.executionAttemptCount ?? 0}</span>
                      <span class="text-[0.6rem] uppercase text-gray-500 dark:text-gray-400">Attempts</span>
                    </div>
                    <div class="flex flex-col items-center text-center p-1 text-xs">
                      <span class="text-xl mb-1">📋</span>
                      <span class="text-lg font-bold">{desire.metrics?.planVersionCount ?? 0}</span>
                      <span class="text-[0.6rem] uppercase text-gray-500 dark:text-gray-400">Plan Versions</span>
                    </div>
                  </div>
                  {#if desire.metrics && (desire.metrics.userInputCount > 0 || desire.metrics.userApprovalCount > 0)}
                    <div class="flex gap-4 p-2 text-xs text-gray-500 dark:text-gray-400 border-t border-dashed border-gray-200 dark:border-gray-700 mt-2">
                      <span>👤 {desire.metrics.userInputCount} inputs</span>
                      <span>👍 {desire.metrics.userApprovalCount} approvals</span>
                      {#if desire.metrics.userRejectionCount > 0}
                        <span>👎 {desire.metrics.userRejectionCount} rejections</span>
                      {/if}
                    </div>
                  {/if}
                </details>

                <!-- Meta info -->
                <div class="flex gap-4 text-xs text-gray-500 dark:text-gray-400 mb-2">
                  <span>Created: {formatTimestamp(desire.createdAt)}</span>
                  <span>Updated: {formatTimestamp(desire.updatedAt)}</span>
                </div>

                {#if desire.status === 'approved' && !desire.plan}
                  <div class="p-3 bg-red-50 dark:bg-red-900/20 border-2 border-red-400 dark:border-red-600 rounded-md mb-2 text-sm text-red-700 dark:text-red-300">
                    ⚠️ <strong>No plan generated.</strong> Click "Generate Plan" to create an execution plan for this desire.
                  </div>
                {/if}

                {#if desire.plan}
                  <!-- Plan Summary Header (clickable to expand) -->
                  <button
                    type="button"
                    class="w-full text-left p-2 bg-gray-50 dark:bg-gray-800/50 rounded-md mb-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                    on:click|stopPropagation={() => togglePlanDetail(desire.id)}
                    aria-expanded={expandedPlanId === desire.id}
                  >
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-xs font-semibold">
                        📋 Plan v{desire.plan.version || 1}:
                      </span>
                      <span class="text-xs muted">
                        {desire.plan.steps.length} steps, {desire.plan.estimatedRisk} risk
                        {#if desire.planHistory && desire.planHistory.length > 0}
                          <span class="italic text-violet-500">({desire.planHistory.length} previous)</span>
                        {/if}
                      </span>
                      <span class="ml-auto text-xs text-gray-500">{expandedPlanId === desire.id ? '▼' : '▶'}</span>
                    </div>
                    {#if desire.plan.operatorGoal}
                      <p class="text-xs muted mt-1 italic">Goal: {desire.plan.operatorGoal}</p>
                    {/if}
                  </button>

                  <!-- Expanded Plan Details -->
                  {#if expandedPlanId === desire.id}
                    <div class="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-md p-4 mb-2">
                      <h5 class="font-semibold text-sm mb-2 text-gray-700 dark:text-gray-200">Execution Steps</h5>
                      <div class="flex flex-col gap-3">
                        {#each desire.plan.steps as step, i}
                          <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-3">
                            <div class="flex items-center gap-2 flex-wrap mb-1">
                              <span class="inline-flex items-center justify-center w-6 h-6 bg-blue-600 text-white rounded-full text-xs font-semibold">{step.order || i + 1}</span>
                              <span class="font-medium flex-1">{step.action}</span>
                              <span class="inline-block px-1.5 py-0.5 rounded-full text-[0.625rem] font-medium {getRiskColor(step.risk)}">{step.risk}</span>
                              {#if step.requiresApproval}
                                <span class="inline-block px-1.5 py-0.5 rounded-full text-[0.625rem] font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">needs approval</span>
                              {/if}
                            </div>
                            {#if step.skill}
                              <div class="flex gap-2 mt-1 pl-8">
                                <span class="text-xs muted">Skill:</span>
                                <code class="text-xs bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">{step.skill}</code>
                              </div>
                            {/if}
                            {#if step.expectedOutcome}
                              <div class="flex gap-2 mt-1 pl-8">
                                <span class="text-xs muted">Expected:</span>
                                <span class="text-xs">{step.expectedOutcome}</span>
                              </div>
                            {/if}
                            {#if step.inputs && Object.keys(step.inputs).length > 0}
                              <div class="flex gap-2 mt-1 pl-8">
                                <span class="text-xs muted">Inputs:</span>
                                <code class="text-xs bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">{JSON.stringify(step.inputs)}</code>
                              </div>
                            {/if}
                          </div>
                        {/each}
                      </div>

                      <!-- Plan History Toggle -->
                      {#if desire.planHistory && desire.planHistory.length > 0}
                        <button
                          class="w-full mt-3 p-1.5 text-xs bg-transparent border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50"
                          on:click|stopPropagation={() => togglePlanHistory(desire.id)}
                        >
                          {showHistoryFor === desire.id ? '▼ Hide' : '▶ Show'} Previous Versions ({desire.planHistory.length})
                        </button>

                        {#if showHistoryFor === desire.id}
                          <div class="mt-2 p-2 bg-amber-50 dark:bg-amber-900/30 rounded">
                            {#each desire.planHistory as oldPlan, idx}
                              <div class="mb-3 pb-3 border-b border-amber-200 dark:border-amber-800 last:border-b-0 last:mb-0 last:pb-0">
                                <h6 class="text-xs font-semibold text-amber-700 dark:text-amber-300">Version {oldPlan.version || idx + 1} ({formatTimestamp(oldPlan.createdAt)})</h6>
                                {#if oldPlan.basedOnCritique}
                                  <p class="text-xs italic text-amber-600 dark:text-amber-400 my-1">Critique: "{oldPlan.basedOnCritique}"</p>
                                {/if}
                                <ul class="list-none p-0 m-0 mt-1 text-xs text-amber-700 dark:text-amber-400">
                                  {#each oldPlan.steps as step, i}
                                    <li>{step.order || i + 1}. {step.action}</li>
                                  {/each}
                                </ul>
                              </div>
                            {/each}
                          </div>
                        {/if}
                      {/if}

                      <!-- Critique & Revision Section -->
                      {#if ['reviewing', 'approved', 'awaiting_approval', 'planning'].includes(desire.status)}
                        <div class="mt-4 pt-4 border-t border-dashed border-gray-200 dark:border-gray-700">
                          <h5 class="font-semibold text-sm mb-2 text-gray-700 dark:text-gray-200">✏️ Request Revision</h5>
                          <p class="text-xs muted mb-2">
                            Not happy with the plan? Provide feedback and request a revision.
                          </p>
                          <textarea
                            class="input-field resize-y"
                            placeholder="Enter your critique or suggestions for improving this plan..."
                            bind:value={critiqueText[desire.id]}
                            rows="3"
                          ></textarea>
                          <div class="mt-2 flex justify-end">
                            <button
                              class="px-3 py-1.5 text-xs font-medium rounded bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={revisingId === desire.id || !critiqueText[desire.id]?.trim()}
                              on:click|stopPropagation={() => handleRevise(desire.id)}
                            >
                              {revisingId === desire.id ? 'Requesting...' : '🔄 Request Revision'}
                            </button>
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/if}
                {/if}

                {#if desire.review}
                  <div class="p-2 bg-gray-50 dark:bg-gray-800/50 rounded mb-2">
                    <span class="text-xs font-semibold">Review:</span>
                    <span class="text-xs muted">{desire.review.verdict} (alignment: {(desire.review.alignmentScore * 100).toFixed(0)}%)</span>
                    {#if desire.review.reasoning}
                      <p class="text-xs muted mt-1 italic">{desire.review.reasoning}</p>
                    {/if}
                    {#if desire.review.concerns && desire.review.concerns.length > 0}
                      <div class="mt-2">
                        <span class="text-xs font-semibold">Concerns:</span>
                        <ul class="list-none p-0 m-0 mt-1">
                          {#each desire.review.concerns as concern}
                            <li class="text-xs muted">• {concern}</li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                  </div>
                {/if}

                {#if desire.userCritique}
                  <div class="p-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded mb-2">
                    <span class="text-xs font-semibold">⏳ Pending Revision:</span>
                    <p class="text-xs muted">"{desire.userCritique}"</p>
                    <span class="text-xs muted">Submitted: {formatTimestamp(desire.critiqueAt || null)}</span>
                  </div>
                {/if}

                <!-- Execution Status Display -->
                {#if desire.execution}
                  <div
                    class="p-3 rounded-md mb-2 border {(desire.execution.status === 'in_progress' || desire.execution.status === 'running') ? 'bg-green-50 dark:bg-green-900/20 border-green-500 animate-pulse' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-400'}"
                  >
                    <div class="flex justify-between items-center mb-1">
                      <span class="text-sm font-semibold">
                        {#if desire.execution.status === 'in_progress' || desire.execution.status === 'running'}
                          ⚡ Executing...
                        {:else if desire.execution.status === 'completed'}
                          ✅ Execution Complete
                        {:else if desire.execution.status === 'failed'}
                          ❌ Execution Failed
                        {:else}
                          📊 Execution: {desire.execution.status}
                        {/if}
                      </span>
                      <span class="text-xs muted">
                        Step {desire.execution.stepsCompleted || 0} / {desire.execution.stepsTotal || desire.plan?.steps.length || '?'}
                      </span>
                    </div>
                    {#if desire.execution.error}
                      <p class="text-xs text-red-600 dark:text-red-400 mt-1">{desire.execution.error}</p>
                    {/if}
                    <div class="text-xs muted mt-1">
                      Started: {formatTimestamp(desire.execution.startedAt)}
                      {#if desire.execution.completedAt}
                        • Completed: {formatTimestamp(desire.execution.completedAt)}
                      {/if}
                    </div>
                  </div>
                {/if}

                <!-- Outcome Review Display -->
                {#if desire.outcomeReview}
                  <div
                    class="p-3 rounded-md mb-2 border {desire.outcomeReview.successScore >= 0.7 ? 'bg-green-50 dark:bg-green-900/20 border-green-500' : desire.outcomeReview.successScore >= 0.4 ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500' : 'bg-red-50 dark:bg-red-900/20 border-red-500'}"
                  >
                    <div class="flex justify-between items-center mb-2">
                      <span class="text-sm font-semibold">
                        📊 Outcome: {desire.outcomeReview.verdict}
                      </span>
                      <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-black/10 dark:bg-white/10">
                        {(desire.outcomeReview.successScore * 100).toFixed(0)}% success
                      </span>
                    </div>
                    <p class="text-xs mb-2 italic">{desire.outcomeReview.reasoning}</p>
                    {#if desire.outcomeReview.executionSummary}
                      <div class="mt-3 p-2 bg-blue-600/10 dark:bg-blue-400/10 rounded border-l-4 border-blue-600">
                        <span class="text-xs font-semibold">📋 What was done:</span>
                        <pre class="mt-1 text-xs whitespace-pre-wrap text-gray-600 dark:text-gray-400">{desire.outcomeReview.executionSummary}</pre>
                      </div>
                    {/if}
                    {#if desire.outcomeReview.lessonsLearned && desire.outcomeReview.lessonsLearned.length > 0}
                      <div class="mt-2">
                        <span class="text-xs font-semibold">Lessons:</span>
                        <ul class="list-none p-0 m-0 mt-1">
                          {#each desire.outcomeReview.lessonsLearned as lesson}
                            <li class="text-xs muted">• {lesson}</li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                  </div>
                {/if}

                <!-- Journey Log Button - More Prominent -->
                {#if desire.metrics || desire.scratchpad}
                  <button
                    class="w-full flex items-center gap-3 p-3 rounded-lg border-2 text-sm font-medium cursor-pointer text-left mb-2 transition-all hover:translate-y-[-1px] hover:shadow-md {showScratchpadFor !== desire.id ? 'bg-white dark:bg-gray-800' : 'border-b-transparent rounded-b-none'}"
                    style="border-color: {getNatureColor(desire.metrics)};"
                    on:click={() => toggleScratchpadWithLoad(desire.id)}
                  >
                    <span class="text-xl">📜</span>
                    <span class="flex-1">
                      {showScratchpadFor === desire.id ? 'Hide' : 'Explore'} Journey Log
                    </span>
                    {#if desire.scratchpad?.entryCount}
                      <span class="px-2 py-1 rounded-full text-white text-xs font-semibold" style="background: {getNatureColor(desire.metrics)};">
                        {desire.scratchpad.entryCount} events
                      </span>
                    {/if}
                    <span class="text-xs text-gray-500 dark:text-gray-400 ml-auto">{showScratchpadFor === desire.id ? '▲' : '▼'}</span>
                  </button>

                  {#if showScratchpadFor === desire.id}
                    <div class="bg-gray-50 dark:bg-gray-800/50 border-2 border-t-0 rounded-b-lg p-4 -mt-2 mb-2" style="border-color: {getNatureColor(desire.metrics)};">
                      <!-- Metrics Summary -->
                      <div class="flex flex-wrap gap-4 pb-3 border-b border-gray-200 dark:border-gray-700 mb-3 text-xs text-gray-500 dark:text-gray-400">
                        <span>📋 Plans: {desire.metrics?.planVersionCount || 0}</span>
                        <span>🔄 Attempts: {desire.metrics?.executionAttemptCount || 0}</span>
                        <span>✅ Successes: {desire.metrics?.executionSuccessCount || 0}</span>
                        <span>💪 Reinforced: {desire.metrics?.reinforcementCount || 0}</span>
                        <span>📉 Decays: {desire.metrics?.decayCount || 0}</span>
                        <span>👤 User Input: {desire.metrics?.userInputCount || 0}</span>
                        <span>🔁 Cycles: {desire.metrics?.cycleCount || 0}</span>
                      </div>

                      <!-- Plan Version Browser -->
                      {#if planVersions.length > 0 || (desire.planHistory && desire.planHistory.length > 0)}
                        <div class="pt-3 border-t border-gray-200 dark:border-gray-700 mt-3">
                          <h6 class="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">📋 Plan Versions</h6>
                          <div class="flex flex-wrap gap-2 mb-2">
                            {#if desire.plan}
                              <button
                                class="px-2 py-1 text-xs rounded border transition-all {!selectedPlanVersion ? 'bg-blue-600 border-blue-700 text-white' : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600'}"
                                on:click={() => { viewingPlan = desire.plan || null; selectedPlanVersion = null; }}
                              >
                                Current (v{desire.plan.version || 1})
                              </button>
                            {/if}
                            {#each planVersions as version}
                              {@const vNum = parseInt(version.replace('v', '').replace('.json', ''))}
                              <button
                                class="px-2 py-1 text-xs rounded border transition-all {selectedPlanVersion === vNum ? 'bg-blue-600 border-blue-700 text-white' : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600'}"
                                on:click={() => loadPlanVersion(desire.id, vNum)}
                              >
                                {version.replace('.json', '')}
                              </button>
                            {/each}
                          </div>
                          {#if viewingPlan && selectedPlanVersion}
                            <div class="bg-blue-50 dark:bg-blue-900/30 border border-blue-400 rounded p-2 mt-2">
                              <p class="text-xs muted">Viewing v{viewingPlan.version}: {viewingPlan.operatorGoal || 'No goal'}</p>
                              <div class="mt-1">
                                {#each viewingPlan.steps as step, i}
                                  <div class="py-0.5 text-xs text-gray-600 dark:text-gray-400">
                                    {step.order || i + 1}. {step.action}
                                  </div>
                                {/each}
                              </div>
                            </div>
                          {/if}
                        </div>
                      {/if}

                      <!-- Scratchpad File Browser -->
                      <div class="pt-3 border-t border-gray-200 dark:border-gray-700 mt-3">
                        <h6 class="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">📜 Journey Events</h6>

                        {#if scratchpadLoading}
                          <p class="text-xs muted">Loading events...</p>
                        {:else if scratchpadEntries.length > 0}
                          <div class="max-h-72 overflow-y-auto flex flex-col gap-2">
                            {#each scratchpadEntries as entry, idx}
                              <div
                                class="flex items-start gap-2 p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded transition-colors {entry.data ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800' : ''} {expandedEntryIndex === idx ? 'bg-green-50 dark:bg-green-900/20 border-green-500' : ''}"
                                on:click={() => entry.data && (expandedEntryIndex = expandedEntryIndex === idx ? null : idx)}
                                on:keydown={(e) => e.key === 'Enter' && entry.data && (expandedEntryIndex = expandedEntryIndex === idx ? null : idx)}
                                tabindex={entry.data ? 0 : -1}
                                role={entry.data ? 'button' : undefined}
                              >
                                <span class="text-base flex-shrink-0">{getScratchpadEntryIcon(entry.type)}</span>
                                <div class="flex-1 flex flex-col gap-0.5">
                                  <div class="flex justify-between items-start gap-2">
                                    <span class="text-sm">{entry.description}</span>
                                    {#if entry.data}
                                      <span class="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{expandedEntryIndex === idx ? '▲' : '▼'}</span>
                                    {/if}
                                  </div>
                                  <span class="text-[0.625rem] text-gray-500 dark:text-gray-400">
                                    {formatTimestamp(entry.timestamp)} by {entry.agentName || entry.actor}
                                  </span>
                                  {#if expandedEntryIndex === idx && entry.data}
                                    <div class="mt-2 pt-2 border-t border-dashed border-gray-300 dark:border-gray-600">
                                      <pre class="text-xs font-mono bg-gray-50 dark:bg-gray-900 p-3 rounded overflow-x-auto whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{JSON.stringify(entry.data, null, 2)}</pre>
                                    </div>
                                  {/if}
                                </div>
                              </div>
                            {/each}
                          </div>

                          <!-- Pagination -->
                          {#if scratchpadTotal > scratchpadLimit}
                            <div class="flex justify-between items-center mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                              <button
                                class="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={scratchpadOffset === 0}
                                on:click={() => loadScratchpadEntries(desire.id, Math.max(0, scratchpadOffset - scratchpadLimit))}
                              >
                                ← Newer
                              </button>
                              <span class="flex-1 text-center text-xs muted">
                                {scratchpadOffset + 1}-{Math.min(scratchpadOffset + scratchpadLimit, scratchpadTotal)} of {scratchpadTotal}
                              </span>
                              <button
                                class="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={scratchpadOffset + scratchpadLimit >= scratchpadTotal}
                                on:click={() => loadScratchpadEntries(desire.id, scratchpadOffset + scratchpadLimit)}
                              >
                                Older →
                              </button>
                            </div>
                          {/if}
                        {:else}
                          <p class="text-xs muted">No journey events logged yet</p>
                        {/if}

                        <!-- File List (collapsed) -->
                        {#if scratchpadFiles.length > 0}
                          <details class="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                            <summary class="text-xs muted cursor-pointer select-none">📁 {scratchpadFiles.length} files in scratchpad/</summary>
                            <ul class="list-none p-0 m-0 mt-2 max-h-36 overflow-y-auto">
                              {#each scratchpadFiles.slice(-10) as file}
                                <li class="py-0.5 text-xs font-mono">{file}</li>
                              {/each}
                              {#if scratchpadFiles.length > 10}
                                <li class="text-xs muted">...and {scratchpadFiles.length - 10} more</li>
                              {/if}
                            </ul>
                          </details>
                        {/if}
                      </div>

                      {#if desire.folderPath}
                        <p class="text-xs muted font-mono mt-2">
                          📁 {desire.folderPath}
                        </p>
                      {/if}
                    </div>
                  {/if}
                {/if}

                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700" on:click|stopPropagation>
                  <!-- Stage progression buttons -->
                  {#if desire.status === 'nascent'}
                    <button
                      class="btn-primary btn-xs"
                      disabled={processingId === desire.id}
                      on:click={() => handleAdvanceStage(desire.id, 'pending')}
                    >
                      → Pending
                    </button>
                  {/if}
                  {#if desire.status === 'pending'}
                    <button
                      class="px-3 py-1.5 text-xs font-medium rounded text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      style="background: linear-gradient(135deg, #6d28d9, #8b5cf6);"
                      disabled={processingId === desire.id || agentProcessingId === desire.id}
                      on:click={() => handleGeneratePlan(desire.id)}
                    >
                      {#if agentProcessingId === desire.id && agentOperation === 'planning'}
                        <span class="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1"></span>
                      {:else}
                        🧠
                      {/if}
                      Generate Plan
                    </button>
                  {/if}
                  {#if desire.status === 'planning'}
                    {#if desire.plan}
                      <button
                        class="btn-primary btn-xs"
                        disabled={processingId === desire.id}
                        on:click={() => handleAdvanceStage(desire.id, 'reviewing')}
                      >
                        → Review
                      </button>
                    {:else}
                      <button
                        class="px-3 py-1.5 text-xs font-medium rounded text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        style="background: linear-gradient(135deg, #6d28d9, #8b5cf6);"
                        disabled={processingId === desire.id || agentProcessingId === desire.id}
                        on:click={() => handleGeneratePlan(desire.id)}
                      >
                        {#if agentProcessingId === desire.id && agentOperation === 'planning'}
                          <span class="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1"></span>
                        {:else}
                          🧠
                        {/if}
                        Generate Plan
                      </button>
                    {/if}
                  {/if}
                  {#if desire.status === 'reviewing' || desire.status === 'awaiting_approval'}
                    <button
                      class="btn-success btn-xs"
                      disabled={processingId === desire.id}
                      on:click={() => handleApprove(desire.id)}
                    >
                      ✅ Approve Plan
                    </button>
                  {/if}
                  {#if desire.status === 'approved'}
                    {#if desire.plan}
                      <button
                        class="px-3 py-1.5 text-xs font-medium rounded text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        style="background: linear-gradient(135deg, #6d28d9, #8b5cf6);"
                        disabled={processingId === desire.id || agentProcessingId === desire.id}
                        on:click={() => handleExecute(desire.id)}
                      >
                        {#if agentProcessingId === desire.id && agentOperation === 'executing'}
                          <span class="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1"></span>
                        {:else}
                          🚀
                        {/if}
                        Execute
                      </button>
                    {:else}
                      <!-- No plan - need to generate one first -->
                      <button
                        class="px-3 py-1.5 text-xs font-medium rounded text-white disabled:opacity-50 disabled:cursor-not-allowed bg-amber-500 hover:bg-amber-600"
                        disabled={processingId === desire.id || agentProcessingId === desire.id}
                        on:click={() => handleGeneratePlan(desire.id)}
                        title="Generate an execution plan for this desire"
                      >
                        {#if agentProcessingId === desire.id && agentOperation === 'planning'}
                          <span class="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1"></span>
                        {:else}
                          🧠
                        {/if}
                        Generate Plan
                      </button>
                    {/if}
                  {/if}

                  <!-- Reset/Unstick for desires in later stages (to go back to planning) -->
                  {#if ['executing', 'failed', 'awaiting_approval', 'reviewing', 'approved', 'questioning', 'awaiting_review', 'outcome_review'].includes(desire.status)}
                    <button
                      class="px-3 py-1.5 text-xs font-medium rounded text-white inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      style="background: linear-gradient(135deg, #f59e0b, #d97706);"
                      disabled={processingId === desire.id}
                      on:click={() => handleReset(desire.id)}
                      title="Reset this desire back to planning stage (clears questions for fresh start)"
                    >
                      🔄 Reset to Planning
                    </button>
                  {/if}

                  <!-- Outcome Review for awaiting_review desires -->
                  {#if desire.status === 'awaiting_review'}
                    <button
                      class="px-3 py-1.5 text-xs font-medium rounded text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      style="background: linear-gradient(135deg, #6d28d9, #8b5cf6);"
                      disabled={processingId === desire.id || agentProcessingId === desire.id}
                      on:click={() => handleOutcomeReview(desire.id)}
                      title="Run outcome review to verify completion"
                    >
                      {#if agentProcessingId === desire.id}
                        <span class="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1"></span>
                        {currentLoadingMessage || 'Reviewing...'}
                      {:else}
                        🔍 Run Outcome Review
                      {/if}
                    </button>
                  {/if}

                  <!-- Quick approve (skip to approved) - for early stages only -->
                  {#if ['nascent', 'pending', 'planning'].includes(desire.status)}
                    <button
                      class="btn-primary btn-xs"
                      disabled={processingId === desire.id}
                      on:click={() => handleApprove(desire.id)}
                      title="Skip to approved status"
                    >
                      ⏩ Fast Approve
                    </button>
                  {/if}

                  <!-- Reject -->
                  {#if ['nascent', 'pending', 'planning', 'reviewing', 'awaiting_approval', 'approved'].includes(desire.status)}
                    <button
                      class="btn-danger btn-xs"
                      disabled={processingId === desire.id}
                      on:click={() => handleReject(desire.id)}
                    >
                      ❌ Reject
                    </button>
                  {/if}
                  <!-- Archive - for active desires (send to dormant state) -->
                  {#if ['nascent', 'pending', 'planning', 'reviewing', 'awaiting_approval', 'approved', 'completed'].includes(desire.status)}
                    <button
                      class="px-3 py-1.5 text-xs font-medium rounded text-white inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      style="background: linear-gradient(135deg, #8b5cf6, #7c3aed);"
                      disabled={processingId === desire.id}
                      on:click={() => handleArchive(desire.id)}
                      title="Archive this desire (can be revived later)"
                    >
                      📦 Archive
                    </button>
                  {/if}

                  <!-- Revive - for archived desires (bring back to active) -->
                  {#if ['rejected', 'abandoned', 'failed'].includes(desire.status)}
                    <button
                      class="px-3 py-1.5 text-xs font-medium rounded text-white inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      style="background: linear-gradient(135deg, #10b981, #059669);"
                      disabled={processingId === desire.id}
                      on:click={() => handleRevive(desire.id)}
                      title="Revive this desire back to pending"
                    >
                      🔄 Revive
                    </button>
                  {/if}

                  {#if ['nascent', 'pending', 'rejected', 'abandoned', 'failed', 'completed', 'awaiting_review'].includes(desire.status)}
                    <button
                      class="px-3 py-1.5 text-xs font-medium rounded bg-gray-500 hover:bg-gray-600 text-white disabled:opacity-50"
                      disabled={processingId === desire.id}
                      on:click={() => handleDelete(desire.id)}
                    >
                      🗑️ Delete
                    </button>
                  {/if}
                </div>
              </div>
            {/if}
            <!-- ========== END EXPANDED VIEW ========== -->
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  <!-- Cheeky loading overlay with streaming LLM output -->
  {#if agentProcessingId && currentLoadingMessage}
    <div class="fixed inset-0 bg-black/75 flex items-center justify-center z-[9999] backdrop-blur-sm">
      <div
        class="border-2 border-violet-500 rounded-2xl p-8 text-center shadow-[0_0_40px_rgba(139,92,246,0.4)] animate-pulse"
        class:max-w-3xl={streamingOutput}
        class:w-[90%]={streamingOutput}
        class:max-h-[80vh]={streamingOutput}
        class:overflow-y-auto={streamingOutput}
        style="background: linear-gradient(135deg, #1e1e2e 0%, #2d1b4e 50%, #1e1e2e 100%);"
      >
        <div class="text-6xl animate-bounce drop-shadow-[0_0_10px_rgba(139,92,246,0.8)]">🧠</div>
        <div class="mt-4 text-xl text-purple-200 italic tracking-wide">{currentLoadingMessage}</div>

        <!-- Streaming status -->
        {#if streamingPhase}
          <div class="mt-4 p-3 bg-violet-600/20 rounded-lg text-left">
            <div class="text-base text-violet-300 font-medium">{streamingPhase}</div>
            {#if streamingModel}
              <div class="text-sm text-gray-400 mt-1 font-mono">Model: {streamingModel}</div>
            {/if}
            {#if streamingLatency > 0}
              <div class="text-sm text-gray-400 mt-1 font-mono">Latency: {(streamingLatency / 1000).toFixed(1)}s</div>
            {/if}
            {#if streamingSteps > 0}
              <div class="text-sm text-gray-400 mt-1 font-mono">Steps: {streamingSteps}</div>
            {/if}
          </div>
        {/if}

        <!-- Progress log display -->
        {#if streamingOutput}
          <div class="mt-4 text-left bg-black/30 rounded-lg overflow-hidden">
            <div class="flex justify-between items-center px-3 py-2 bg-violet-600/30 text-xs text-violet-200 font-medium">
              <span>📋 Progress Log</span>
              <span class="font-mono text-gray-400">{streamingOutput.split('\n').length} steps</span>
            </div>
            <pre class="p-3 font-mono text-xs leading-relaxed text-purple-200 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{streamingOutput}</pre>
          </div>
        {/if}

        <div class="mt-6 w-48 h-1.5 bg-gray-700 rounded-full overflow-hidden mx-auto">
          <div
            class="h-full w-[30%] rounded-full animate-[loading-progress_1.5s_ease-in-out_infinite]"
            style="background: linear-gradient(90deg, #8b5cf6, #a78bfa, #8b5cf6);"
          ></div>
        </div>

        <!-- Close button -->
        <button
          class="mt-4 px-6 py-2 bg-white/15 border border-white/30 rounded-md text-white/90 text-sm cursor-pointer transition-all hover:bg-white/25 hover:border-white/50 hover:text-white"
          on:click={() => stopLoadingMessages()}
          title="Close overlay"
        >
          ✕ Close
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes loading-progress {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }
</style>
