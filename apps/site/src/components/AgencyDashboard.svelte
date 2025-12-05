<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { isOwner } from '../stores/security-policy';
  import { apiFetch } from '../lib/client/api-config';

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
  let statusFilter: string = 'all';
  let processingId: string | null = null;

  // New desire form
  let showNewDesire = false;
  let newDesire = {
    title: '',
    description: '',
    reason: '',
    risk: 'low',
  };

  // Plan detail view and critique
  let expandedDesireId: string | null = null;
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

  // Plan browser state
  let planVersions: string[] = [];
  let planLoading = false;
  let selectedPlanVersion: number | null = null;
  let viewingPlan: DesirePlan | null = null;

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

  function getNatureBgColor(metrics?: DesireMetrics): string {
    const nature = inferDesireNature(metrics);
    switch (nature) {
      case 'recurring': return '#dbeafe';
      case 'achievable': return '#dcfce7';
      case 'aspirational': return '#f3e8ff';
    }
  }

  function getNatureDarkBgColor(metrics?: DesireMetrics): string {
    const nature = inferDesireNature(metrics);
    switch (nature) {
      case 'recurring': return '#1e3a5f';
      case 'achievable': return '#14532d';
      case 'aspirational': return '#3b0764';
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

  // Calculate success rate percentage
  function getSuccessRate(metrics?: DesireMetrics): number {
    if (!metrics || metrics.executionAttemptCount === 0) return 0;
    return Math.round((metrics.executionSuccessCount / metrics.executionAttemptCount) * 100);
  }

  // Calculate reinforcement health (positive = being reinforced, negative = decaying)
  function getReinforcementHealth(metrics?: DesireMetrics): { value: number; label: string } {
    if (!metrics) return { value: 0, label: 'No data' };
    const net = metrics.netReinforcement;
    if (net > 5) return { value: 100, label: 'Strongly reinforced' };
    if (net > 0) return { value: 70, label: 'Growing' };
    if (net === 0) return { value: 50, label: 'Stable' };
    if (net > -5) return { value: 30, label: 'Weakening' };
    return { value: 10, label: 'Fading' };
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

  function toggleScratchpad(id: string) {
    showScratchpadFor = showScratchpadFor === id ? null : id;
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

  async function loadDesires() {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      const url = params.size ? `/api/agency/desires?${params}` : '/api/agency/desires?status=all';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load desires');
      const data = await res.json();
      desires = data.desires || [];
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
      const res = await fetch(`/api/agency/desires/${id}/approve`, { method: 'POST' });
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
      const res = await fetch(`/api/agency/desires/${id}/reject`, {
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
    if (!confirm('Reset this desire back to planning? This will abort the current execution.')) return;

    processingId = id;
    try {
      const res = await fetch(`/api/agency/desires/${id}/reset?target=planning`, {
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

  async function handleDelete(id: string) {
    if (!confirm('Delete this desire permanently?')) return;
    processingId = id;
    try {
      const res = await fetch(`/api/agency/desires/${id}`, { method: 'DELETE' });
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
      const res = await fetch(`/api/agency/desires/${id}/advance`, {
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
      // Use fetch with POST to send critique, then read as EventSource-like stream
      const response = await fetch(`/api/agency/desires/${id}/generate-plan-stream`, {
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
      expandedDesireId = null;
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
      const res = await fetch(`/api/agency/desires/${id}/review`, {
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
   * Execute a desire's plan inline (calls the agent directly)
   * Shows cheeky loading messages while processing
   */
  async function handleExecute(id: string) {
    if (!confirm('Execute this desire now? This will run the plan through the operator.')) return;

    agentProcessingId = id;
    processingId = id;
    startLoadingMessages('executing');

    try {
      // Use the /run endpoint for inline execution (not just status change)
      const res = await fetch(`/api/agency/desires/${id}/run`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to execute desire');
      }

      // Show result message
      if (data.success) {
        console.log(`[AgencyDashboard] ✅ Execution succeeded: ${data.message}`);
      } else {
        console.log(`[AgencyDashboard] ⚠️ Execution failed: ${data.message}`);
      }

      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      stopLoadingMessages();
      processingId = null;
    }
  }

  async function handleOutcomeReview(id: string) {
    agentProcessingId = id;
    processingId = id;
    startLoadingMessages('executing');  // Reuse executing messages for review phase

    try {
      const res = await fetch(`/api/agency/desires/${id}/outcome-review`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to review outcome');
      }

      // Show result message
      if (data.success) {
        console.log(`[AgencyDashboard] ✅ Outcome review complete: ${data.outcomeReview?.verdict}`);
      } else {
        console.log(`[AgencyDashboard] ⚠️ Outcome review failed: ${data.error}`);
      }

      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
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
      const res = await fetch(`/api/agency/desires/${id}/revise`, {
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
      expandedDesireId = null;
      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      revisingId = null;
    }
  }

  function togglePlanDetail(id: string) {
    expandedDesireId = expandedDesireId === id ? null : id;
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

<div class="agency-dashboard">
  {#if !$isOwner}
    <div class="card p-6 text-center space-y-2">
      <h2 class="text-lg font-semibold">Agency Access Restricted</h2>
      <p class="muted text-sm">Log in as the owner to manage autonomous desires.</p>
    </div>
  {:else if loading}
    <div class="text-center py-8">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      <p class="mt-2 muted">Loading agency data...</p>
    </div>
  {:else}
    <!-- Summary Stats -->
    {#if summary}
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Desires</div>
          <div class="stat-value">{summary.total}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active</div>
          <div class="stat-value text-blue-600 dark:text-blue-400">{summary.active}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Waiting</div>
          <div class="stat-value text-yellow-600 dark:text-yellow-400">{summary.waiting}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Completed</div>
          <div class="stat-value text-green-600 dark:text-green-400">{summary.completed}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Failed/Rejected</div>
          <div class="stat-value text-red-600 dark:text-red-400">{summary.failed}</div>
        </div>
      </div>
    {/if}

    <!-- Metrics -->
    {#if metrics}
      <div class="card p-4 mt-4">
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

    <!-- Error Display -->
    {#if error}
      <div class="error-banner mt-4">
        {error}
        <button class="ml-2 underline" on:click={() => error = ''}>Dismiss</button>
      </div>
    {/if}

    <!-- Controls -->
    <div class="controls mt-4">
      <div class="flex items-center gap-2">
        <select bind:value={statusFilter} on:change={loadDesires} class="select-input">
          <option value="all">All Status</option>
          <option value="nascent">Nascent (Growing)</option>
          <option value="pending">Pending</option>
          <option value="planning">Planning</option>
          <option value="reviewing">Reviewing</option>
          <option value="awaiting_approval">⭐ Awaiting Approval</option>
          <option value="approved">Approved</option>
          <option value="executing">Executing</option>
          <option value="awaiting_review">🔍 Awaiting Review</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
          <option value="abandoned">Abandoned</option>
        </select>
        <button class="btn-secondary" on:click={() => loadAll(true, true)}>Refresh</button>
      </div>
      <button class="btn-primary" on:click={() => showNewDesire = !showNewDesire}>
        {showNewDesire ? 'Cancel' : '+ New Desire'}
      </button>
    </div>

    <!-- New Desire Form -->
    {#if showNewDesire}
      <div class="card p-4 mt-4 space-y-3">
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
            <select bind:value={newDesire.risk} class="select-input ml-2">
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <button class="btn-primary" on:click={handleCreateDesire}>Create</button>
        </div>
      </div>
    {/if}

    <!-- PLANS AWAITING YOUR REVIEW - Prominent Section -->
    {#if desires.filter(d => ['awaiting_approval', 'reviewing'].includes(d.status) && d.plan).length > 0}
      <div class="pending-review-section mt-4">
        <div class="pending-review-header">
          <h2 class="pending-review-title">⭐ Plans Awaiting Your Review</h2>
          <span class="pending-review-count">{desires.filter(d => ['awaiting_approval', 'reviewing'].includes(d.status) && d.plan).length} plan(s)</span>
        </div>

        {#each desires.filter(d => ['awaiting_approval', 'reviewing'].includes(d.status) && d.plan) as desire}
          <div class="review-card" style="border-left: 4px solid {getNatureColor(desire.metrics)};">
            <div class="review-card-header">
              <div class="flex items-center gap-2">
                <span class="source-icon text-2xl">{getSourceIcon(desire.source)}</span>
                <div>
                  <h3 class="review-card-title">{desire.title}</h3>
                  <p class="text-xs muted">{desire.description}</p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <div class="review-nature-badge" style="background: {getNatureColor(desire.metrics)};">
                  {getNatureIcon(desire.metrics)} {getNatureLabel(desire.metrics)}
                </div>
                <span class={`badge ${getStatusColor(desire.status)}`}>{desire.status}</span>
                <span class={`badge ${getRiskColor(desire.plan?.estimatedRisk || desire.risk)}`}>{desire.plan?.estimatedRisk || desire.risk} risk</span>
              </div>
            </div>

            <!-- Mini Metrics for Review -->
            <div class="review-metrics-row">
              <span class="review-metric">🔁 {desire.metrics?.cycleCount ?? 0} cycles</span>
              <span class="review-metric">✅ {desire.metrics?.completionCount ?? 0} completions</span>
              <span class="review-metric">⚡ {desire.metrics?.executionAttemptCount ?? 0} attempts</span>
              <span class="review-metric">📋 v{desire.metrics?.planVersionCount ?? 1} plan</span>
              <span class="review-metric">💪 {(desire.strength * 100).toFixed(0)}% strength</span>
            </div>

            <!-- Plan Details ALWAYS VISIBLE -->
            {#if desire.plan}
              <div class="review-plan-details">
                <div class="plan-header-row">
                  <span class="text-sm font-bold">📋 Plan v{desire.plan.version || 1}</span>
                  <span class="text-xs muted">{desire.plan.steps.length} steps</span>
                </div>

                {#if desire.plan.operatorGoal}
                  <p class="plan-goal-text">🎯 Goal: {desire.plan.operatorGoal}</p>
                {/if}

                <div class="review-plan-steps">
                  {#each desire.plan.steps as step, i}
                    <div class="review-step">
                      <span class="review-step-number">{step.order || i + 1}</span>
                      <div class="review-step-content">
                        <span class="review-step-action">{step.action}</span>
                        {#if step.skill}
                          <span class="review-step-skill">→ {step.skill}</span>
                        {/if}
                        <span class={`badge tiny ${getRiskColor(step.risk)}`}>{step.risk}</span>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Review Info if present -->
            {#if desire.review}
              <div class="review-verdict-box">
                <span class="text-xs font-semibold">Alignment Score: {(desire.review.alignmentScore * 100).toFixed(0)}%</span>
                {#if desire.review.reasoning}
                  <p class="text-xs muted">{desire.review.reasoning}</p>
                {/if}
              </div>
            {/if}

            <!-- CRITIQUE SECTION - Always visible for review -->
            <div class="review-critique-section">
              <h4 class="critique-section-title">✏️ Your Feedback</h4>
              <p class="text-xs muted mb-2">Not satisfied? Tell us what to change and we'll revise the plan.</p>
              <textarea
                class="review-critique-input"
                placeholder="What would you like changed? (e.g., 'Use a different approach', 'Add more steps for X', 'Skip step 3')"
                bind:value={critiqueText[desire.id]}
                rows="3"
              ></textarea>
              <div class="review-action-buttons">
                <button
                  class="btn-revise-large"
                  disabled={revisingId === desire.id || !critiqueText[desire.id]?.trim()}
                  on:click={() => handleRevise(desire.id)}
                >
                  {revisingId === desire.id ? '⏳ Sending...' : '🔄 Request Revision'}
                </button>
                <button
                  class="btn-approve-large"
                  disabled={processingId === desire.id}
                  on:click={() => handleApprove(desire.id)}
                >
                  ✅ Approve Plan
                </button>
                <button
                  class="btn-reject-large"
                  disabled={processingId === desire.id}
                  on:click={() => handleReject(desire.id)}
                >
                  ❌ Reject
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- AWAITING OUTCOME REVIEW - Post-Execution Review Section -->
    {#if desires.filter(d => d.status === 'awaiting_review').length > 0}
      <div class="pending-review-section mt-4" style="border-left-color: #6366f1;">
        <div class="pending-review-header">
          <h2 class="pending-review-title">🔍 Awaiting Outcome Review</h2>
          <span class="pending-review-count">{desires.filter(d => d.status === 'awaiting_review').length} task(s) completed</span>
        </div>

        {#each desires.filter(d => d.status === 'awaiting_review') as desire}
          <div class="review-card" style="border-left: 4px solid #6366f1;">
            <div class="review-card-header">
              <div class="flex items-center gap-2">
                <span class="source-icon text-2xl">{getSourceIcon(desire.source)}</span>
                <div>
                  <h3 class="review-card-title">{desire.title}</h3>
                  <p class="text-xs muted">{desire.description}</p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="badge bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">awaiting_review</span>
              </div>
            </div>

            <!-- Execution Summary -->
            {#if desire.execution}
              <div class="execution-summary-box">
                <div class="execution-summary-header">
                  <span class="text-sm font-semibold">⚡ Execution Complete</span>
                  <span class="text-xs muted">
                    {desire.execution.stepsCompleted || 0}/{desire.execution.stepsTotal || 0} steps
                  </span>
                </div>
                {#if desire.execution.completedAt}
                  <p class="text-xs muted">Completed: {formatTimestamp(desire.execution.completedAt)}</p>
                {/if}
              </div>
            {/if}

            <!-- Action Buttons -->
            <div class="review-action-buttons">
              <button
                class="btn-approve-large"
                disabled={processingId === desire.id || agentProcessingId === desire.id}
                on:click={() => handleOutcomeReview(desire.id)}
              >
                {#if agentProcessingId === desire.id}
                  <span class="loading-spinner"></span>
                  {currentLoadingMessage || 'Reviewing outcome...'}
                {:else}
                  🔍 Run Outcome Review
                {/if}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Desire List -->
    <div class="desire-list mt-4">
      {#if desires.length === 0}
        <div class="empty-state">
          <p class="muted">No desires found</p>
          <p class="text-sm muted mt-1">Desires will be generated automatically by the agency system</p>
        </div>
      {:else}
        {#each desires as desire}
          <div class="desire-card" style="border-left: 4px solid {getNatureColor(desire.metrics)};">
            <!-- Header with title and status badges -->
            <div class="desire-header">
              <div class="flex items-center gap-2">
                <span class="source-icon">{getSourceIcon(desire.source)}</span>
                <h4 class="desire-title">{desire.title}</h4>
              </div>
              <div class="flex items-center gap-2">
                <span class={`badge ${getStatusColor(desire.status)}`}>{desire.status}</span>
                <span class={`badge ${getRiskColor(desire.risk)}`}>{desire.risk}</span>
              </div>
            </div>

            <p class="desire-description">{desire.description}</p>

            {#if desire.reason}
              <p class="desire-reason"><em>"{desire.reason}"</em></p>
            {/if}

            <!-- ========== NEW: Desire Insights Panel ========== -->
            <div class="desire-insights" style="background: {getNatureBgColor(desire.metrics)}; --dark-bg: {getNatureDarkBgColor(desire.metrics)};">
              <!-- Nature Badge - Large and Prominent -->
              <div class="nature-section">
                <div class="nature-badge-large" style="background: {getNatureColor(desire.metrics)};">
                  <span class="nature-icon-large">{getNatureIcon(desire.metrics)}</span>
                  <span class="nature-label-large">{getNatureLabel(desire.metrics)}</span>
                </div>
                <p class="nature-explanation">{getNatureExplanation(desire.metrics)}</p>
              </div>

              <!-- Key Metrics Grid - Always Visible -->
              <div class="metrics-grid">
                <div class="metric-item">
                  <span class="metric-icon">🔁</span>
                  <span class="metric-value">{desire.metrics?.cycleCount ?? 0}</span>
                  <span class="metric-label">Cycles</span>
                </div>
                <div class="metric-item">
                  <span class="metric-icon">✅</span>
                  <span class="metric-value">{desire.metrics?.completionCount ?? 0}</span>
                  <span class="metric-label">Completions</span>
                </div>
                <div class="metric-item">
                  <span class="metric-icon">⚡</span>
                  <span class="metric-value">{desire.metrics?.executionAttemptCount ?? 0}</span>
                  <span class="metric-label">Attempts</span>
                </div>
                <div class="metric-item">
                  <span class="metric-icon">📋</span>
                  <span class="metric-value">{desire.metrics?.planVersionCount ?? 0}</span>
                  <span class="metric-label">Plan Versions</span>
                </div>
              </div>

              <!-- Strength Bar -->
              <div class="strength-section">
                <div class="strength-header">
                  <span class="strength-label">Strength</span>
                  <span class="strength-value">{(desire.strength * 100).toFixed(0)}%</span>
                </div>
                <div class="strength-bar-container">
                  <div class="strength-bar" style="width: {desire.strength * 100}%; background: {getNatureColor(desire.metrics)};"></div>
                </div>
                {#if desire.metrics}
                  <div class="reinforcement-indicator">
                    {#if desire.metrics.netReinforcement > 0}
                      <span class="reinforcement-positive">💪 +{desire.metrics.netReinforcement} net reinforcement</span>
                    {:else if desire.metrics.netReinforcement < 0}
                      <span class="reinforcement-negative">📉 {desire.metrics.netReinforcement} (decaying)</span>
                    {:else}
                      <span class="reinforcement-neutral">⚖️ Stable</span>
                    {/if}
                  </div>
                {/if}
              </div>

              <!-- User Interaction Stats -->
              {#if desire.metrics && (desire.metrics.userInputCount > 0 || desire.metrics.userApprovalCount > 0)}
                <div class="user-interaction-stats">
                  <span class="user-stat">👤 {desire.metrics.userInputCount} inputs</span>
                  <span class="user-stat">👍 {desire.metrics.userApprovalCount} approvals</span>
                  {#if desire.metrics.userRejectionCount > 0}
                    <span class="user-stat">👎 {desire.metrics.userRejectionCount} rejections</span>
                  {/if}
                </div>
              {/if}
            </div>
            <!-- ========== END: Desire Insights Panel ========== -->

            <div class="desire-meta">
              <span class="muted text-xs">Created: {formatTimestamp(desire.createdAt)}</span>
              <span class="muted text-xs">Updated: {formatTimestamp(desire.updatedAt)}</span>
              {#if desire.scratchpad?.entryCount}
                <span class="muted text-xs">📜 {desire.scratchpad.entryCount} journal entries</span>
              {/if}
            </div>

            {#if desire.status === 'approved' && !desire.plan}
              <!-- Missing plan warning -->
              <div class="missing-plan-warning">
                ⚠️ <strong>No plan generated.</strong> Click "Generate Plan" to create an execution plan for this desire.
              </div>
            {/if}

            {#if desire.plan}
              <!-- Plan Summary Header (clickable to expand) -->
              <button type="button" class="plan-summary clickable" on:click={() => togglePlanDetail(desire.id)} aria-expanded={expandedDesireId === desire.id}>
                <div class="plan-summary-header">
                  <span class="text-xs font-semibold">
                    📋 Plan v{desire.plan.version || 1}:
                  </span>
                  <span class="text-xs muted">
                    {desire.plan.steps.length} steps, {desire.plan.estimatedRisk} risk
                    {#if desire.planHistory && desire.planHistory.length > 0}
                      <span class="history-badge">({desire.planHistory.length} previous)</span>
                    {/if}
                  </span>
                  <span class="expand-icon">{expandedDesireId === desire.id ? '▼' : '▶'}</span>
                </div>
                {#if desire.plan.operatorGoal}
                  <p class="plan-goal text-xs muted">Goal: {desire.plan.operatorGoal}</p>
                {/if}
              </button>

              <!-- Expanded Plan Details -->
              {#if expandedDesireId === desire.id}
                <div class="plan-details">
                  <h5 class="plan-section-title">Execution Steps</h5>
                  <div class="plan-steps">
                    {#each desire.plan.steps as step, i}
                      <div class="plan-step">
                        <div class="step-header">
                          <span class="step-number">{step.order || i + 1}</span>
                          <span class="step-action">{step.action}</span>
                          <span class={`badge small ${getRiskColor(step.risk)}`}>{step.risk}</span>
                          {#if step.requiresApproval}
                            <span class="badge small bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">needs approval</span>
                          {/if}
                        </div>
                        {#if step.skill}
                          <div class="step-skill">
                            <span class="text-xs muted">Skill:</span>
                            <code class="text-xs">{step.skill}</code>
                          </div>
                        {/if}
                        {#if step.expectedOutcome}
                          <div class="step-outcome">
                            <span class="text-xs muted">Expected:</span>
                            <span class="text-xs">{step.expectedOutcome}</span>
                          </div>
                        {/if}
                        {#if step.inputs && Object.keys(step.inputs).length > 0}
                          <div class="step-inputs">
                            <span class="text-xs muted">Inputs:</span>
                            <code class="text-xs">{JSON.stringify(step.inputs)}</code>
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>

                  <!-- Plan History Toggle -->
                  {#if desire.planHistory && desire.planHistory.length > 0}
                    <button class="btn-history" on:click|stopPropagation={() => togglePlanHistory(desire.id)}>
                      {showHistoryFor === desire.id ? '▼ Hide' : '▶ Show'} Previous Versions ({desire.planHistory.length})
                    </button>

                    {#if showHistoryFor === desire.id}
                      <div class="plan-history">
                        {#each desire.planHistory as oldPlan, idx}
                          <div class="old-plan">
                            <h6 class="old-plan-title">Version {oldPlan.version || idx + 1} ({formatTimestamp(oldPlan.createdAt)})</h6>
                            {#if oldPlan.basedOnCritique}
                              <p class="critique-note text-xs">Critique: "{oldPlan.basedOnCritique}"</p>
                            {/if}
                            <ul class="old-plan-steps">
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
                    <div class="critique-section">
                      <h5 class="plan-section-title">✏️ Request Revision</h5>
                      <p class="critique-hint text-xs muted">
                        Not happy with the plan? Provide feedback and request a revision.
                      </p>
                      <textarea
                        class="critique-input"
                        placeholder="Enter your critique or suggestions for improving this plan..."
                        bind:value={critiqueText[desire.id]}
                        rows="3"
                      ></textarea>
                      <div class="critique-actions">
                        <button
                          class="btn-revise"
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
              <div class="review-summary">
                <span class="text-xs font-semibold">Review:</span>
                <span class="text-xs muted">{desire.review.verdict} (alignment: {(desire.review.alignmentScore * 100).toFixed(0)}%)</span>
                {#if desire.review.reasoning}
                  <p class="review-reasoning text-xs muted">{desire.review.reasoning}</p>
                {/if}
                {#if desire.review.concerns && desire.review.concerns.length > 0}
                  <div class="review-concerns">
                    <span class="text-xs font-semibold">Concerns:</span>
                    <ul class="concerns-list">
                      {#each desire.review.concerns as concern}
                        <li class="text-xs muted">• {concern}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              </div>
            {/if}

            {#if desire.userCritique}
              <div class="pending-critique">
                <span class="text-xs font-semibold">⏳ Pending Revision:</span>
                <p class="text-xs muted">"{desire.userCritique}"</p>
                <span class="text-xs muted">Submitted: {formatTimestamp(desire.critiqueAt || null)}</span>
              </div>
            {/if}

            <!-- Execution Status Display -->
            {#if desire.execution}
              <div class="execution-status" class:executing={desire.execution.status === 'in_progress' || desire.execution.status === 'running'}>
                <div class="execution-header">
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
                  <p class="execution-error text-xs">{desire.execution.error}</p>
                {/if}
                <div class="execution-meta text-xs muted">
                  Started: {formatTimestamp(desire.execution.startedAt)}
                  {#if desire.execution.completedAt}
                    • Completed: {formatTimestamp(desire.execution.completedAt)}
                  {/if}
                </div>
              </div>
            {/if}

            <!-- Outcome Review Display -->
            {#if desire.outcomeReview}
              <div class="outcome-review" class:success={desire.outcomeReview.successScore >= 0.7} class:warning={desire.outcomeReview.successScore >= 0.4 && desire.outcomeReview.successScore < 0.7} class:failure={desire.outcomeReview.successScore < 0.4}>
                <div class="outcome-header">
                  <span class="text-sm font-semibold">
                    📊 Outcome: {desire.outcomeReview.verdict}
                  </span>
                  <span class="outcome-score">
                    {(desire.outcomeReview.successScore * 100).toFixed(0)}% success
                  </span>
                </div>
                <p class="outcome-reasoning text-xs">{desire.outcomeReview.reasoning}</p>
                {#if desire.outcomeReview.lessonsLearned && desire.outcomeReview.lessonsLearned.length > 0}
                  <div class="outcome-lessons">
                    <span class="text-xs font-semibold">Lessons:</span>
                    <ul class="lessons-list">
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
                class="btn-journey-log"
                class:expanded={showScratchpadFor === desire.id}
                style="border-color: {getNatureColor(desire.metrics)};"
                on:click={() => toggleScratchpadWithLoad(desire.id)}
              >
                <span class="journey-log-icon">📜</span>
                <span class="journey-log-text">
                  {showScratchpadFor === desire.id ? 'Hide' : 'Explore'} Journey Log
                </span>
                {#if desire.scratchpad?.entryCount}
                  <span class="journey-log-count" style="background: {getNatureColor(desire.metrics)};">
                    {desire.scratchpad.entryCount} events
                  </span>
                {/if}
                <span class="journey-log-arrow">{showScratchpadFor === desire.id ? '▲' : '▼'}</span>
              </button>

              {#if showScratchpadFor === desire.id}
                <div class="scratchpad-viewer">
                  <!-- Metrics Summary -->
                  <div class="scratchpad-stats">
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
                    <div class="plan-browser">
                      <h6 class="browser-title">📋 Plan Versions</h6>
                      <div class="plan-version-list">
                        {#if desire.plan}
                          <button
                            class="plan-version-btn"
                            class:active={!selectedPlanVersion}
                            on:click={() => { viewingPlan = desire.plan || null; selectedPlanVersion = null; }}
                          >
                            Current (v{desire.plan.version || 1})
                          </button>
                        {/if}
                        {#each planVersions as version}
                          <button
                            class="plan-version-btn"
                            class:active={selectedPlanVersion === parseInt(version.replace('v', '').replace('.json', ''))}
                            on:click={() => loadPlanVersion(desire.id, parseInt(version.replace('v', '').replace('.json', '')))}
                          >
                            {version.replace('.json', '')}
                          </button>
                        {/each}
                      </div>
                      {#if viewingPlan && selectedPlanVersion}
                        <div class="viewing-plan">
                          <p class="text-xs muted">Viewing v{viewingPlan.version}: {viewingPlan.operatorGoal || 'No goal'}</p>
                          <div class="plan-steps-preview">
                            {#each viewingPlan.steps as step, i}
                              <div class="step-preview text-xs">
                                {step.order || i + 1}. {step.action}
                              </div>
                            {/each}
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/if}

                  <!-- Scratchpad File Browser -->
                  <div class="scratchpad-browser">
                    <h6 class="browser-title">📜 Journey Events</h6>

                    {#if scratchpadLoading}
                      <p class="text-xs muted">Loading events...</p>
                    {:else if scratchpadEntries.length > 0}
                      <div class="scratchpad-entries">
                        {#each scratchpadEntries as entry}
                          <div class="scratchpad-entry">
                            <span class="entry-icon">{getScratchpadEntryIcon(entry.type)}</span>
                            <div class="entry-content">
                              <span class="entry-description">{entry.description}</span>
                              <span class="entry-meta text-xs muted">
                                {formatTimestamp(entry.timestamp)} by {entry.agentName || entry.actor}
                              </span>
                            </div>
                          </div>
                        {/each}
                      </div>

                      <!-- Pagination -->
                      {#if scratchpadTotal > scratchpadLimit}
                        <div class="scratchpad-pagination">
                          <button
                            class="pagination-btn"
                            disabled={scratchpadOffset === 0}
                            on:click={() => loadScratchpadEntries(desire.id, Math.max(0, scratchpadOffset - scratchpadLimit))}
                          >
                            ← Newer
                          </button>
                          <span class="pagination-info text-xs muted">
                            {scratchpadOffset + 1}-{Math.min(scratchpadOffset + scratchpadLimit, scratchpadTotal)} of {scratchpadTotal}
                          </span>
                          <button
                            class="pagination-btn"
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
                      <details class="file-list-details">
                        <summary class="text-xs muted">📁 {scratchpadFiles.length} files in scratchpad/</summary>
                        <ul class="file-list">
                          {#each scratchpadFiles.slice(-10) as file}
                            <li class="text-xs">{file}</li>
                          {/each}
                          {#if scratchpadFiles.length > 10}
                            <li class="text-xs muted">...and {scratchpadFiles.length - 10} more</li>
                          {/if}
                        </ul>
                      </details>
                    {/if}
                  </div>

                  {#if desire.folderPath}
                    <p class="text-xs muted folder-path">
                      📁 {desire.folderPath}
                    </p>
                  {/if}
                </div>
              {/if}
            {/if}

            <div class="desire-actions">
              <!-- Stage progression buttons -->
              {#if desire.status === 'nascent'}
                <button
                  class="btn-stage"
                  disabled={processingId === desire.id}
                  on:click={() => handleAdvanceStage(desire.id, 'pending')}
                >
                  → Pending
                </button>
              {/if}
              {#if desire.status === 'pending'}
                <button
                  class="btn-stage btn-agent"
                  disabled={processingId === desire.id || agentProcessingId === desire.id}
                  on:click={() => handleGeneratePlan(desire.id)}
                >
                  {#if agentProcessingId === desire.id && agentOperation === 'planning'}
                    <span class="loading-spinner"></span>
                  {:else}
                    🧠
                  {/if}
                  Generate Plan
                </button>
              {/if}
              {#if desire.status === 'planning'}
                {#if desire.plan}
                  <button
                    class="btn-stage"
                    disabled={processingId === desire.id}
                    on:click={() => handleAdvanceStage(desire.id, 'reviewing')}
                  >
                    → Review
                  </button>
                {:else}
                  <button
                    class="btn-stage btn-agent"
                    disabled={processingId === desire.id || agentProcessingId === desire.id}
                    on:click={() => handleGeneratePlan(desire.id)}
                  >
                    {#if agentProcessingId === desire.id && agentOperation === 'planning'}
                      <span class="loading-spinner"></span>
                    {:else}
                      🧠
                    {/if}
                    Generate Plan
                  </button>
                {/if}
              {/if}
              {#if desire.status === 'reviewing'}
                <button
                  class="btn-stage"
                  disabled={processingId === desire.id}
                  on:click={() => handleAdvanceStage(desire.id, 'approved')}
                >
                  → Approve
                </button>
              {/if}
              {#if desire.status === 'approved'}
                {#if desire.plan}
                  <button
                    class="btn-execute btn-agent"
                    disabled={processingId === desire.id || agentProcessingId === desire.id}
                    on:click={() => handleExecute(desire.id)}
                  >
                    {#if agentProcessingId === desire.id && agentOperation === 'executing'}
                      <span class="loading-spinner"></span>
                    {:else}
                      🚀
                    {/if}
                    Execute
                  </button>
                {:else}
                  <!-- No plan - need to generate one first -->
                  <button
                    class="btn-plan btn-agent"
                    disabled={processingId === desire.id || agentProcessingId === desire.id}
                    on:click={() => handleGeneratePlan(desire.id)}
                    title="Generate an execution plan for this desire"
                  >
                    {#if agentProcessingId === desire.id && agentOperation === 'planning'}
                      <span class="loading-spinner"></span>
                    {:else}
                      🧠
                    {/if}
                    Generate Plan
                  </button>
                {/if}
              {/if}

              <!-- Reset/Unstick for executing or failed desires -->
              {#if desire.status === 'executing' || desire.status === 'failed'}
                <button
                  class="btn-reset"
                  disabled={processingId === desire.id}
                  on:click={() => handleReset(desire.id)}
                  title="Reset this desire back to planning stage"
                >
                  🔄 Reset
                </button>
              {/if}

              <!-- Outcome Review for awaiting_review desires -->
              {#if desire.status === 'awaiting_review'}
                <button
                  class="btn-execute btn-agent"
                  disabled={processingId === desire.id || agentProcessingId === desire.id}
                  on:click={() => handleOutcomeReview(desire.id)}
                  title="Run outcome review to verify completion"
                >
                  {#if agentProcessingId === desire.id}
                    <span class="loading-spinner"></span>
                    {currentLoadingMessage || 'Reviewing...'}
                  {:else}
                    🔍 Run Outcome Review
                  {/if}
                </button>
              {/if}

              <!-- Quick approve (skip to approved) -->
              {#if ['nascent', 'pending', 'planning', 'reviewing'].includes(desire.status)}
                <button
                  class="btn-approve"
                  disabled={processingId === desire.id}
                  on:click={() => handleApprove(desire.id)}
                  title="Skip to approved status"
                >
                  Fast Approve
                </button>
              {/if}

              <!-- Reject -->
              {#if ['nascent', 'pending', 'planning', 'reviewing', 'approved'].includes(desire.status)}
                <button
                  class="btn-reject"
                  disabled={processingId === desire.id}
                  on:click={() => handleReject(desire.id)}
                >
                  Reject
                </button>
              {/if}
              {#if ['nascent', 'pending', 'rejected', 'abandoned', 'failed', 'completed', 'awaiting_review'].includes(desire.status)}
                <button
                  class="btn-delete"
                  disabled={processingId === desire.id}
                  on:click={() => handleDelete(desire.id)}
                >
                  Delete
                </button>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  <!-- Cheeky loading overlay with streaming LLM output -->
  {#if agentProcessingId && currentLoadingMessage}
    <div class="agent-loading-overlay">
      <div class="agent-loading-content" class:expanded={streamingOutput}>
        <div class="agent-loading-brain">🧠</div>
        <div class="agent-loading-message">{currentLoadingMessage}</div>

        <!-- Streaming status -->
        {#if streamingPhase}
          <div class="streaming-status">
            <div class="streaming-phase">{streamingPhase}</div>
            {#if streamingModel}
              <div class="streaming-model">Model: {streamingModel}</div>
            {/if}
            {#if streamingLatency > 0}
              <div class="streaming-latency">Latency: {(streamingLatency / 1000).toFixed(1)}s</div>
            {/if}
            {#if streamingSteps > 0}
              <div class="streaming-steps">Steps: {streamingSteps}</div>
            {/if}
          </div>
        {/if}

        <!-- LLM Output display -->
        {#if streamingOutput}
          <div class="streaming-output-container">
            <div class="streaming-output-header">
              <span>LLM Output</span>
              <span class="streaming-output-length">{streamingOutput.length} chars</span>
            </div>
            <pre class="streaming-output">{streamingOutput}</pre>
          </div>
        {/if}

        <div class="agent-loading-bar">
          <div class="agent-loading-progress"></div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .agency-dashboard {
    padding: 1rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.75rem;
  }

  .stat-card {
    background: var(--card-bg, white);
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 8px;
    padding: 1rem;
    text-align: center;
  }

  :global(.dark) .stat-card {
    background: #1f2937;
    border-color: #374151;
  }

  .stat-label {
    font-size: 0.75rem;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    margin-top: 0.25rem;
  }

  .card {
    background: var(--card-bg, white);
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 8px;
  }

  :global(.dark) .card {
    background: #1f2937;
    border-color: #374151;
  }

  .controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .select-input {
    padding: 0.5rem;
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 6px;
    background: white;
    font-size: 0.875rem;
  }

  :global(.dark) .select-input {
    background: #374151;
    border-color: #4b5563;
    color: white;
  }

  .input-field {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 6px;
    background: white;
    font-size: 0.875rem;
  }

  :global(.dark) .input-field {
    background: #374151;
    border-color: #4b5563;
    color: white;
  }

  .btn-primary {
    background: #3b82f6;
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-weight: 500;
    font-size: 0.875rem;
    border: none;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-primary:hover {
    background: #2563eb;
  }

  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-weight: 500;
    font-size: 0.875rem;
    border: none;
    cursor: pointer;
    transition: background 0.2s;
  }

  :global(.dark) .btn-secondary {
    background: #374151;
    color: #e5e7eb;
  }

  .btn-secondary:hover {
    background: #e5e7eb;
  }

  :global(.dark) .btn-secondary:hover {
    background: #4b5563;
  }

  .error-banner {
    background: #fee2e2;
    border: 1px solid #f87171;
    color: #b91c1c;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
  }

  :global(.dark) .error-banner {
    background: #7f1d1d;
    border-color: #991b1b;
    color: #fecaca;
  }

  .desire-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .desire-card {
    background: var(--card-bg, white);
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 8px;
    padding: 1rem;
  }

  :global(.dark) .desire-card {
    background: #1f2937;
    border-color: #374151;
  }

  .desire-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .source-icon {
    font-size: 1.25rem;
  }

  .desire-title {
    font-weight: 600;
    font-size: 1rem;
  }

  .badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .desire-description {
    font-size: 0.875rem;
    color: #4b5563;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .desire-description {
    color: #9ca3af;
  }

  .desire-reason {
    font-size: 0.75rem;
    color: #6b7280;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .desire-reason {
    color: #9ca3af;
  }

  .desire-meta {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }

  .plan-summary,
  .review-summary {
    padding: 0.5rem;
    background: #f9fafb;
    border-radius: 4px;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .plan-summary,
  :global(.dark) .review-summary {
    background: #111827;
  }

  button.plan-summary.clickable {
    cursor: pointer;
    transition: background 0.2s;
    width: 100%;
    text-align: left;
    border: none;
    font-family: inherit;
    font-size: inherit;
  }

  .plan-summary.clickable:hover {
    background: #f3f4f6;
  }

  :global(.dark) .plan-summary.clickable:hover {
    background: #1f2937;
  }

  .plan-summary-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .expand-icon {
    margin-left: auto;
    font-size: 0.75rem;
    color: #6b7280;
  }

  .history-badge {
    font-style: italic;
    color: #8b5cf6;
  }

  .plan-goal {
    margin-top: 0.25rem;
    font-style: italic;
  }

  .plan-details {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .plan-details {
    background: #1f2937;
    border-color: #374151;
  }

  .plan-section-title {
    font-weight: 600;
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
    color: #374151;
  }

  :global(.dark) .plan-section-title {
    color: #e5e7eb;
  }

  .plan-steps {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .plan-step {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 0.75rem;
  }

  :global(.dark) .plan-step {
    background: #111827;
    border-color: #374151;
  }

  .step-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.25rem;
  }

  .step-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    background: #3b82f6;
    color: white;
    border-radius: 50%;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .step-action {
    font-weight: 500;
    flex: 1;
  }

  .step-skill,
  .step-outcome,
  .step-inputs {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
    padding-left: 2rem;
  }

  .step-inputs code,
  .step-skill code {
    background: #e5e7eb;
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    font-family: monospace;
  }

  :global(.dark) .step-inputs code,
  :global(.dark) .step-skill code {
    background: #374151;
  }

  .badge.small {
    padding: 0.0625rem 0.375rem;
    font-size: 0.625rem;
  }

  .btn-history {
    background: transparent;
    border: 1px solid #e5e7eb;
    color: #6b7280;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
    margin-top: 0.75rem;
    width: 100%;
  }

  .btn-history:hover {
    background: #f3f4f6;
  }

  :global(.dark) .btn-history {
    border-color: #374151;
    color: #9ca3af;
  }

  :global(.dark) .btn-history:hover {
    background: #374151;
  }

  .plan-history {
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: #fef3c7;
    border-radius: 4px;
  }

  :global(.dark) .plan-history {
    background: #78350f;
  }

  .old-plan {
    margin-bottom: 0.75rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .old-plan {
    border-bottom-color: #92400e;
  }

  .old-plan:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .old-plan-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: #92400e;
  }

  :global(.dark) .old-plan-title {
    color: #fef3c7;
  }

  .critique-note {
    font-style: italic;
    color: #78350f;
    margin: 0.25rem 0;
  }

  :global(.dark) .critique-note {
    color: #fde68a;
  }

  .old-plan-steps {
    list-style: none;
    padding: 0;
    margin: 0.25rem 0 0 0;
    font-size: 0.75rem;
  }

  .old-plan-steps li {
    color: #92400e;
  }

  :global(.dark) .old-plan-steps li {
    color: #fde68a;
  }

  .critique-section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px dashed #e5e7eb;
  }

  :global(.dark) .critique-section {
    border-top-color: #374151;
  }

  .critique-hint {
    margin-bottom: 0.5rem;
  }

  .critique-input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    background: white;
    font-size: 0.875rem;
    resize: vertical;
  }

  :global(.dark) .critique-input {
    background: #111827;
    border-color: #374151;
    color: white;
  }

  .critique-actions {
    margin-top: 0.5rem;
    display: flex;
    justify-content: flex-end;
  }

  .btn-revise {
    background: #8b5cf6;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-revise:hover:not(:disabled) {
    background: #7c3aed;
  }

  .btn-revise:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .review-reasoning {
    margin-top: 0.25rem;
    font-style: italic;
  }

  .review-concerns {
    margin-top: 0.5rem;
  }

  .concerns-list {
    list-style: none;
    padding: 0;
    margin: 0.25rem 0 0 0;
  }

  .pending-critique {
    padding: 0.5rem;
    background: #fef3c7;
    border: 1px solid #fcd34d;
    border-radius: 4px;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .pending-critique {
    background: #78350f;
    border-color: #92400e;
  }

  .missing-plan-warning {
    padding: 0.75rem;
    background: #fee2e2;
    border: 2px solid #f87171;
    border-radius: 6px;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
    color: #b91c1c;
  }

  :global(.dark) .missing-plan-warning {
    background: #7f1d1d;
    border-color: #ef4444;
    color: #fecaca;
  }

  .desire-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-color, #e5e7eb);
  }

  :global(.dark) .desire-actions {
    border-color: #374151;
  }

  .btn-approve {
    background: #10b981;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-approve:hover:not(:disabled) {
    background: #059669;
  }

  .btn-reject {
    background: #ef4444;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-reject:hover:not(:disabled) {
    background: #dc2626;
  }

  .btn-reset {
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .btn-reset:hover:not(:disabled) {
    background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
  }

  .btn-delete {
    background: #6b7280;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-delete:hover:not(:disabled) {
    background: #4b5563;
  }

  .btn-stage {
    background: #3b82f6;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-stage:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-execute {
    background: #8b5cf6;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-execute:hover:not(:disabled) {
    background: #7c3aed;
  }

  .btn-plan {
    background: #f59e0b;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-plan:hover:not(:disabled) {
    background: #d97706;
  }

  .btn-approve:disabled,
  .btn-reject:disabled,
  .btn-reset:disabled,
  .btn-delete:disabled,
  .btn-stage:disabled,
  .btn-execute:disabled,
  .btn-plan:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty-state {
    text-align: center;
    padding: 2rem;
  }

  .muted {
    color: #6b7280;
  }

  :global(.dark) .muted {
    color: #9ca3af;
  }

  /* ========== PROMINENT REVIEW SECTION ========== */
  .pending-review-section {
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
    border: 3px solid #f59e0b;
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
  }

  :global(.dark) .pending-review-section {
    background: linear-gradient(135deg, #78350f 0%, #92400e 100%);
    border-color: #f59e0b;
  }

  .pending-review-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 2px solid #f59e0b;
  }

  .pending-review-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: #92400e;
  }

  :global(.dark) .pending-review-title {
    color: #fef3c7;
  }

  .pending-review-count {
    background: #f59e0b;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 9999px;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .review-card {
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 10px;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .review-card {
    background: #1f2937;
    border-color: #4b5563;
  }

  .review-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .review-card-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: #1f2937;
  }

  :global(.dark) .review-card-title {
    color: #f3f4f6;
  }

  .review-nature-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    border-radius: 9999px;
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }

  .review-metrics-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.03);
    border-radius: 6px;
    margin-bottom: 1rem;
  }

  :global(.dark) .review-metrics-row {
    background: rgba(255, 255, 255, 0.05);
  }

  .review-metric {
    font-size: 0.75rem;
    color: #4b5563;
    font-weight: 500;
  }

  :global(.dark) .review-metric {
    color: #d1d5db;
  }

  .review-plan-details {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .review-plan-details {
    background: #111827;
    border-color: #374151;
  }

  .plan-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .plan-goal-text {
    font-size: 0.875rem;
    font-style: italic;
    color: #4b5563;
    margin-bottom: 0.75rem;
  }

  :global(.dark) .plan-goal-text {
    color: #9ca3af;
  }

  .review-plan-steps {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .review-step {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.5rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
  }

  :global(.dark) .review-step {
    background: #1f2937;
    border-color: #374151;
  }

  .review-step-number {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    background: #3b82f6;
    color: white;
    border-radius: 50%;
    font-size: 0.875rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .review-step-content {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
  }

  .review-step-action {
    font-weight: 500;
  }

  .review-step-skill {
    color: #6b7280;
    font-size: 0.75rem;
    font-style: italic;
  }

  :global(.dark) .review-step-skill {
    color: #9ca3af;
  }

  .badge.tiny {
    padding: 0.125rem 0.375rem;
    font-size: 0.625rem;
  }

  .review-verdict-box {
    background: #dbeafe;
    border: 1px solid #3b82f6;
    border-radius: 6px;
    padding: 0.75rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .review-verdict-box {
    background: #1e3a5f;
    border-color: #3b82f6;
  }

  .review-critique-section {
    background: #f0fdf4;
    border: 2px solid #22c55e;
    border-radius: 8px;
    padding: 1rem;
  }

  :global(.dark) .review-critique-section {
    background: #14532d;
    border-color: #22c55e;
  }

  .critique-section-title {
    font-weight: 600;
    font-size: 1rem;
    color: #15803d;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .critique-section-title {
    color: #86efac;
  }

  .review-critique-input {
    width: 100%;
    padding: 0.75rem;
    border: 2px solid #86efac;
    border-radius: 6px;
    background: white;
    font-size: 0.875rem;
    resize: vertical;
    min-height: 80px;
  }

  :global(.dark) .review-critique-input {
    background: #0f172a;
    border-color: #22c55e;
    color: white;
  }

  .review-critique-input:focus {
    outline: none;
    border-color: #22c55e;
    box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
  }

  .review-action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .btn-revise-large {
    background: #8b5cf6;
    color: white;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-revise-large:hover:not(:disabled) {
    background: #7c3aed;
    transform: translateY(-1px);
  }

  .btn-revise-large:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-approve-large {
    background: #22c55e;
    color: white;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-approve-large:hover:not(:disabled) {
    background: #16a34a;
    transform: translateY(-1px);
  }

  .btn-approve-large:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-reject-large {
    background: #ef4444;
    color: white;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-reject-large:hover:not(:disabled) {
    background: #dc2626;
    transform: translateY(-1px);
  }

  .btn-reject-large:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Type Badge */
  .type-badge {
    background: #e0e7ff;
    color: #4338ca;
    font-size: 0.65rem;
    padding: 0.125rem 0.375rem;
  }

  :global(.dark) .type-badge {
    background: #312e81;
    color: #c7d2fe;
  }

  /* ========== NEW: Desire Insights Panel Styles ========== */
  .desire-insights {
    margin: 0.75rem 0;
    padding: 1rem;
    border-radius: 10px;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .desire-insights {
    background: var(--dark-bg, #1e293b) !important;
    border-color: rgba(255, 255, 255, 0.1);
  }

  .nature-section {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .nature-badge-large {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-radius: 9999px;
    color: white;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .nature-icon-large {
    font-size: 1.25rem;
  }

  .nature-label-large {
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .nature-explanation {
    font-size: 0.8rem;
    color: #374151;
    flex: 1;
    min-width: 200px;
    margin: 0;
  }

  :global(.dark) .nature-explanation {
    color: #d1d5db;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  @media (max-width: 640px) {
    .metrics-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .metric-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.7);
    border-radius: 8px;
    text-align: center;
  }

  :global(.dark) .metric-item {
    background: rgba(0, 0, 0, 0.3);
  }

  .metric-icon {
    font-size: 1.25rem;
    margin-bottom: 0.25rem;
  }

  .metric-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1f2937;
    line-height: 1;
  }

  :global(.dark) .metric-value {
    color: #f3f4f6;
  }

  .metric-label {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b7280;
    margin-top: 0.25rem;
  }

  :global(.dark) .metric-label {
    color: #9ca3af;
  }

  .strength-section {
    margin-bottom: 0.75rem;
  }

  .strength-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.375rem;
  }

  .strength-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(.dark) .strength-label {
    color: #d1d5db;
  }

  .strength-value {
    font-size: 0.875rem;
    font-weight: 700;
    color: #1f2937;
  }

  :global(.dark) .strength-value {
    color: #f3f4f6;
  }

  .strength-bar-container {
    height: 8px;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 999px;
    overflow: hidden;
  }

  :global(.dark) .strength-bar-container {
    background: rgba(255, 255, 255, 0.1);
  }

  .strength-bar {
    height: 100%;
    border-radius: 999px;
    transition: width 0.3s ease;
  }

  .reinforcement-indicator {
    margin-top: 0.375rem;
    font-size: 0.75rem;
  }

  .reinforcement-positive {
    color: #16a34a;
  }

  :global(.dark) .reinforcement-positive {
    color: #4ade80;
  }

  .reinforcement-negative {
    color: #dc2626;
  }

  :global(.dark) .reinforcement-negative {
    color: #f87171;
  }

  .reinforcement-neutral {
    color: #6b7280;
  }

  :global(.dark) .reinforcement-neutral {
    color: #9ca3af;
  }

  .user-interaction-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    font-size: 0.75rem;
  }

  :global(.dark) .user-interaction-stats {
    border-top-color: rgba(255, 255, 255, 0.1);
  }

  .user-stat {
    color: #4b5563;
  }

  :global(.dark) .user-stat {
    color: #9ca3af;
  }

  /* ========== END: Desire Insights Panel Styles ========== */

  /* Execution Status */
  .execution-status {
    padding: 0.75rem;
    background: #f0f9ff;
    border: 1px solid #0ea5e9;
    border-radius: 6px;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .execution-status {
    background: #082f49;
    border-color: #0ea5e9;
  }

  .execution-status.executing {
    border-color: #22c55e;
    background: #f0fdf4;
    animation: pulse 2s ease-in-out infinite;
  }

  :global(.dark) .execution-status.executing {
    background: #14532d;
    border-color: #22c55e;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .execution-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.25rem;
  }

  .execution-error {
    color: #dc2626;
    margin-top: 0.25rem;
  }

  :global(.dark) .execution-error {
    color: #f87171;
  }

  .execution-meta {
    margin-top: 0.25rem;
  }

  /* Execution Summary Box (for awaiting review section) */
  .execution-summary-box {
    background: #f0f9ff;
    border: 1px solid #3b82f6;
    border-radius: 6px;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
  }

  :global(.dark) .execution-summary-box {
    background: #1e3a5f;
    border-color: #60a5fa;
  }

  .execution-summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  /* Outcome Review */
  .outcome-review {
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 0.5rem;
    border: 1px solid;
  }

  .outcome-review.success {
    background: #f0fdf4;
    border-color: #22c55e;
  }

  .outcome-review.warning {
    background: #fefce8;
    border-color: #eab308;
  }

  .outcome-review.failure {
    background: #fef2f2;
    border-color: #ef4444;
  }

  :global(.dark) .outcome-review.success {
    background: #14532d;
    border-color: #22c55e;
  }

  :global(.dark) .outcome-review.warning {
    background: #713f12;
    border-color: #eab308;
  }

  :global(.dark) .outcome-review.failure {
    background: #7f1d1d;
    border-color: #ef4444;
  }

  .outcome-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .outcome-score {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.1);
  }

  .outcome-reasoning {
    margin-bottom: 0.5rem;
    font-style: italic;
  }

  .outcome-lessons {
    margin-top: 0.5rem;
  }

  .lessons-list {
    list-style: none;
    padding: 0;
    margin: 0.25rem 0 0 0;
  }

  /* Journey Log Button - Enhanced */
  .btn-journey-log {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: linear-gradient(to right, #f8fafc, #f1f5f9);
    border: 2px solid #e5e7eb;
    color: #374151;
    padding: 0.75rem 1rem;
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    margin-bottom: 0.5rem;
    transition: all 0.2s ease;
  }

  .btn-journey-log:hover {
    background: linear-gradient(to right, #f1f5f9, #e2e8f0);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .btn-journey-log.expanded {
    background: white;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-bottom-color: transparent;
  }

  :global(.dark) .btn-journey-log {
    background: linear-gradient(to right, #1f2937, #374151);
    border-color: #4b5563;
    color: #e5e7eb;
  }

  :global(.dark) .btn-journey-log:hover {
    background: linear-gradient(to right, #374151, #4b5563);
  }

  :global(.dark) .btn-journey-log.expanded {
    background: #111827;
    border-bottom-color: transparent;
  }

  .journey-log-icon {
    font-size: 1.25rem;
  }

  .journey-log-text {
    flex: 1;
  }

  .journey-log-count {
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .journey-log-arrow {
    font-size: 0.75rem;
    color: #6b7280;
    margin-left: auto;
  }

  :global(.dark) .journey-log-arrow {
    color: #9ca3af;
  }

  /* Legacy scratchpad button (keeping for compatibility) */
  .btn-scratchpad {
    width: 100%;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    color: #4b5563;
    padding: 0.5rem;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
    text-align: left;
    margin-bottom: 0.5rem;
    transition: background 0.2s;
  }

  .btn-scratchpad:hover {
    background: #e5e7eb;
  }

  :global(.dark) .btn-scratchpad {
    background: #374151;
    border-color: #4b5563;
    color: #d1d5db;
  }

  :global(.dark) .btn-scratchpad:hover {
    background: #4b5563;
  }

  .scratchpad-viewer {
    background: #fafafa;
    border: 2px solid #e5e7eb;
    border-top: none;
    border-radius: 0 0 10px 10px;
    padding: 1rem;
    margin-top: -0.5rem;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .scratchpad-viewer {
    background: #111827;
    border-color: #4b5563;
  }

  .scratchpad-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #e5e7eb;
    margin-bottom: 0.75rem;
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .scratchpad-stats {
    border-bottom-color: #374151;
    color: #9ca3af;
  }

  .scratchpad-entries {
    max-height: 300px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .scratchpad-entry {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
  }

  :global(.dark) .scratchpad-entry {
    background: #1f2937;
    border-color: #374151;
  }

  .entry-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }

  .entry-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .entry-description {
    font-size: 0.875rem;
  }

  .entry-meta {
    font-size: 0.625rem;
  }

  /* Scratchpad Browser */
  .scratchpad-browser {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .scratchpad-browser {
    border-top-color: #374151;
  }

  .browser-title {
    font-size: 0.75rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #374151;
  }

  :global(.dark) .browser-title {
    color: #d1d5db;
  }

  .scratchpad-pagination {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .scratchpad-pagination {
    border-top-color: #374151;
  }

  .pagination-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .pagination-btn:hover:not(:disabled) {
    background: #e5e7eb;
  }

  .pagination-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.dark) .pagination-btn {
    background: #374151;
    border-color: #4b5563;
    color: #d1d5db;
  }

  :global(.dark) .pagination-btn:hover:not(:disabled) {
    background: #4b5563;
  }

  .pagination-info {
    flex: 1;
    text-align: center;
  }

  /* Plan Browser */
  .plan-browser {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .plan-browser {
    border-top-color: #374151;
  }

  .plan-version-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .plan-version-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .plan-version-btn:hover {
    background: #e5e7eb;
  }

  .plan-version-btn.active {
    background: #3b82f6;
    border-color: #2563eb;
    color: white;
  }

  :global(.dark) .plan-version-btn {
    background: #374151;
    border-color: #4b5563;
    color: #d1d5db;
  }

  :global(.dark) .plan-version-btn:hover {
    background: #4b5563;
  }

  :global(.dark) .plan-version-btn.active {
    background: #2563eb;
    border-color: #1d4ed8;
    color: white;
  }

  .viewing-plan {
    background: #f0f9ff;
    border: 1px solid #0ea5e9;
    border-radius: 6px;
    padding: 0.5rem;
    margin-top: 0.5rem;
  }

  :global(.dark) .viewing-plan {
    background: #082f49;
    border-color: #0ea5e9;
  }

  .plan-steps-preview {
    margin-top: 0.25rem;
  }

  .step-preview {
    padding: 0.125rem 0;
    color: #4b5563;
  }

  :global(.dark) .step-preview {
    color: #9ca3af;
  }

  /* File List */
  .file-list-details {
    margin-top: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .file-list-details {
    border-top-color: #374151;
  }

  .file-list-details summary {
    cursor: pointer;
    user-select: none;
  }

  .file-list {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0 0;
    max-height: 150px;
    overflow-y: auto;
  }

  .file-list li {
    padding: 0.125rem 0;
    font-family: monospace;
  }

  .folder-path {
    margin-top: 0.5rem;
    font-family: monospace;
  }

  .scratchpad-summary {
    padding: 0.5rem 0;
  }

  /* Agent loading overlay */
  .agent-loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(4px);
  }

  .agent-loading-content {
    background: linear-gradient(135deg, #1e1e2e 0%, #2d1b4e 50%, #1e1e2e 100%);
    border: 2px solid #8b5cf6;
    border-radius: 16px;
    padding: 2rem 3rem;
    text-align: center;
    box-shadow: 0 0 40px rgba(139, 92, 246, 0.4);
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 40px rgba(139, 92, 246, 0.4); }
    50% { box-shadow: 0 0 60px rgba(139, 92, 246, 0.6); }
  }

  .agent-loading-brain {
    font-size: 4rem;
    animation: float 3s ease-in-out infinite;
    filter: drop-shadow(0 0 10px rgba(139, 92, 246, 0.8));
  }

  @keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-10px); }
  }

  .agent-loading-message {
    margin-top: 1rem;
    font-size: 1.25rem;
    color: #e9d5ff;
    font-style: italic;
    letter-spacing: 0.05em;
    animation: fade-message 2s ease-in-out;
  }

  @keyframes fade-message {
    0% { opacity: 0; transform: translateY(10px); }
    100% { opacity: 1; transform: translateY(0); }
  }

  .agent-loading-bar {
    margin-top: 1.5rem;
    width: 200px;
    height: 6px;
    background: #374151;
    border-radius: 3px;
    overflow: hidden;
    margin-left: auto;
    margin-right: auto;
  }

  .agent-loading-progress {
    height: 100%;
    width: 30%;
    background: linear-gradient(90deg, #8b5cf6, #a78bfa, #8b5cf6);
    border-radius: 3px;
    animation: loading-progress 1.5s ease-in-out infinite;
  }

  @keyframes loading-progress {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }

  /* Expanded content when streaming output is available */
  .agent-loading-content.expanded {
    max-width: 800px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
  }

  /* Streaming status display */
  .streaming-status {
    margin-top: 1rem;
    padding: 0.75rem;
    background: rgba(139, 92, 246, 0.2);
    border-radius: 8px;
    text-align: left;
  }

  .streaming-phase {
    font-size: 1rem;
    color: #a78bfa;
    font-weight: 500;
  }

  .streaming-model,
  .streaming-latency,
  .streaming-steps {
    font-size: 0.8rem;
    color: #9ca3af;
    margin-top: 0.25rem;
    font-family: monospace;
  }

  /* LLM Output container */
  .streaming-output-container {
    margin-top: 1rem;
    text-align: left;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    overflow: hidden;
  }

  .streaming-output-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    background: rgba(139, 92, 246, 0.3);
    font-size: 0.75rem;
    color: #c4b5fd;
    font-weight: 500;
  }

  .streaming-output-length {
    font-family: monospace;
    font-size: 0.7rem;
    color: #9ca3af;
  }

  .streaming-output {
    margin: 0;
    padding: 0.75rem;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.75rem;
    line-height: 1.5;
    color: #e9d5ff;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 300px;
    overflow-y: auto;
  }

  /* Agent button styles */
  .btn-agent {
    background: linear-gradient(135deg, #6d28d9, #8b5cf6) !important;
    border-color: #7c3aed !important;
    color: white !important;
  }

  .btn-agent:hover:not(:disabled) {
    background: linear-gradient(135deg, #7c3aed, #a78bfa) !important;
    box-shadow: 0 0 12px rgba(139, 92, 246, 0.5);
  }

  .btn-agent:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Loading spinner for buttons */
  .loading-spinner {
    display: inline-block;
    width: 1em;
    height: 1em;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: white;
    animation: spin 0.8s linear infinite;
    margin-right: 0.25em;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
