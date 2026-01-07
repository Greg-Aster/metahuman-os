<script lang="ts">
  import { onMount } from 'svelte';
  import {
    systemCoderStore,
    systemCoderHealth,
    systemCoderStats,
    systemCoderErrors,
    systemCoderLoading,
    fetchStatus,
    fetchErrors,
    ignoreError,
    requestFix,
    submitCodingRequest,
    fetchCodingRequests,
    fetchFixes,
    approveFix,
    rejectFix,
    applyFix,
    revertFix,
    getMaintenanceStatus,
    runMaintenance,
    getMaintenanceReport,
    type CodingRequest,
    type ProposedFix,
    type FileChange,
    type MaintenanceReport,
    type MaintenanceIssue,
    type CheckType,
  } from '../stores/systemCoder';
  import type { CapturedError } from '../stores/systemCoder';

  // Tab state
  type Tab = 'request' | 'errors' | 'fixes' | 'maintenance';
  let activeTab: Tab = 'request';

  // Filter state for errors
  let statusFilter: string = 'new';
  let sourceFilter: string = '';
  let severityFilter: string = '';

  // Loading states
  let processingId: string | null = null;

  // Coding request form state
  let requestType: CodingRequest['type'] = 'fix';
  let requestDescription: string = '';
  let requestContext: string = '';
  let requestFiles: string = '';
  let requestSubmitting: boolean = false;
  let requestSuccess: string | null = null;
  let requestError: string | null = null;
  let codingRequests: CodingRequest[] = [];

  // Fixes state
  let fixes: ProposedFix[] = [];
  let fixesLoading: boolean = false;
  let fixStatusFilter: string = '';
  let selectedFix: ProposedFix | null = null;
  let showFixModal: boolean = false;
  let fixActionLoading: boolean = false;
  let fixActionError: string | null = null;
  let rejectReason: string = '';

  // Maintenance state
  let maintenanceReport: MaintenanceReport | null = null;
  let maintenanceLoading: boolean = false;
  let maintenanceRunning: boolean = false;
  let maintenanceError: string | null = null;
  let lastMaintenanceRun: string | null = null;
  let selectedChecks: CheckType[] = ['type_errors', 'security_vulnerabilities', 'documentation_drift'];

  // Subscribe to store
  $: health = $systemCoderHealth;
  $: stats = $systemCoderStats;
  $: errors = $systemCoderErrors;
  $: loading = $systemCoderLoading;
  $: storeError = $systemCoderStore.error;

  // Filtered errors
  $: filteredErrors = errors.filter((e) => {
    if (statusFilter && e.status !== statusFilter) return false;
    if (sourceFilter && e.source !== sourceFilter) return false;
    if (severityFilter && e.severity !== severityFilter) return false;
    return true;
  });

  onMount(() => {
    fetchStatus();
    fetchErrors({ status: statusFilter || undefined });
    loadCodingRequests();
    loadFixes();
    loadMaintenanceStatus();
  });

  async function loadCodingRequests() {
    codingRequests = await fetchCodingRequests();
  }

  async function loadFixes() {
    fixesLoading = true;
    const result = await fetchFixes({ status: fixStatusFilter || undefined });
    fixes = result.fixes;
    fixesLoading = false;
  }

  async function loadMaintenanceStatus() {
    const status = await getMaintenanceStatus();
    maintenanceRunning = status.isRunning;
    lastMaintenanceRun = status.lastRun || null;
    const report = await getMaintenanceReport();
    maintenanceReport = report;
  }

  async function handleRunMaintenance() {
    maintenanceLoading = true;
    maintenanceError = null;
    maintenanceRunning = true;

    const result = await runMaintenance(selectedChecks.length > 0 ? selectedChecks : undefined);

    maintenanceLoading = false;
    maintenanceRunning = false;

    if (result.success && result.report) {
      maintenanceReport = result.report;
      lastMaintenanceRun = result.report.timestamp;
    } else {
      maintenanceError = result.error || 'Maintenance failed';
    }
  }

  function toggleCheck(check: CheckType) {
    if (selectedChecks.includes(check)) {
      selectedChecks = selectedChecks.filter(c => c !== check);
    } else {
      selectedChecks = [...selectedChecks, check];
    }
  }

  function getIssueSeverityColor(severity: string): string {
    switch (severity) {
      case 'info': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'warning': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'error': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  }

  function getCheckLabel(check: string): string {
    switch (check) {
      case 'type_errors': return 'Type Errors';
      case 'unused_exports': return 'Unused Exports';
      case 'deprecated_apis': return 'Deprecated APIs';
      case 'security_vulnerabilities': return 'Security Issues';
      case 'documentation_drift': return 'Documentation Drift';
      case 'dead_code': return 'Dead Code';
      default: return check;
    }
  }

  function openFixModal(fix: ProposedFix) {
    selectedFix = fix;
    showFixModal = true;
    fixActionError = null;
    rejectReason = '';
  }

  function closeFixModal() {
    showFixModal = false;
    selectedFix = null;
    fixActionError = null;
    rejectReason = '';
  }

  async function handleApproveFix() {
    if (!selectedFix) return;
    fixActionLoading = true;
    fixActionError = null;
    const result = await approveFix(selectedFix.id);
    fixActionLoading = false;
    if (result.success) {
      await loadFixes();
      closeFixModal();
    } else {
      fixActionError = result.error || 'Failed to approve';
    }
  }

  async function handleRejectFix() {
    if (!selectedFix) return;
    fixActionLoading = true;
    fixActionError = null;
    const result = await rejectFix(selectedFix.id, rejectReason);
    fixActionLoading = false;
    if (result.success) {
      await loadFixes();
      closeFixModal();
    } else {
      fixActionError = result.error || 'Failed to reject';
    }
  }

  async function handleApplyFix() {
    if (!selectedFix) return;
    fixActionLoading = true;
    fixActionError = null;
    const result = await applyFix(selectedFix.id);
    fixActionLoading = false;
    if (result.success) {
      await loadFixes();
      closeFixModal();
    } else {
      fixActionError = result.error || 'Failed to apply';
    }
  }

  async function handleRevertFix() {
    if (!selectedFix) return;
    fixActionLoading = true;
    fixActionError = null;
    const result = await revertFix(selectedFix.id);
    fixActionLoading = false;
    if (result.success) {
      await loadFixes();
      closeFixModal();
    } else {
      fixActionError = result.error || 'Failed to revert';
    }
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

  function getFixStatusColor(status: string): string {
    switch (status) {
      case 'pending': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'approved': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'rejected': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'applied': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'reverted': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  }

  function getChangeTypeIcon(changeType: string): string {
    switch (changeType) {
      case 'create': return '+';
      case 'modify': return '~';
      case 'delete': return '-';
      default: return '?';
    }
  }

  function getChangeTypeColor(changeType: string): string {
    switch (changeType) {
      case 'create': return 'text-green-600 dark:text-green-400';
      case 'modify': return 'text-yellow-600 dark:text-yellow-400';
      case 'delete': return 'text-red-600 dark:text-red-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  }

  async function handleSubmitRequest() {
    if (!requestDescription.trim()) {
      requestError = 'Please provide a description';
      return;
    }

    requestSubmitting = true;
    requestError = null;
    requestSuccess = null;

    const result = await submitCodingRequest({
      type: requestType,
      description: requestDescription,
      context: requestContext || undefined,
      files: requestFiles ? requestFiles.split(',').map(f => f.trim()) : undefined,
    });

    requestSubmitting = false;

    if (result.success) {
      requestSuccess = `Request submitted! ID: ${result.requestId}`;
      requestDescription = '';
      requestContext = '';
      requestFiles = '';
      await loadCodingRequests();
    } else {
      requestError = result.error || 'Failed to submit request';
    }
  }

  function getHealthColor(health: string): string {
    switch (health) {
      case 'green': return 'bg-green-500';
      case 'yellow': return 'bg-yellow-500';
      case 'red': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  }

  function getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical': return 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30';
      case 'error': return 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30';
      case 'warning': return 'text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30';
      default: return 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800';
    }
  }

  function getSourceIcon(source: string): string {
    switch (source) {
      case 'terminal': return '>';
      case 'web_console': return 'W';
      case 'build': return 'B';
      case 'test': return 'T';
      case 'runtime': return 'R';
      default: return '?';
    }
  }

  function getStatusBadge(status: string): string {
    switch (status) {
      case 'new': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'reviewing': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'fixed': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'ignored': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      case 'wont_fix': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    }
  }

  function getRequestTypeBadge(type: string): string {
    switch (type) {
      case 'fix': return 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300';
      case 'feature': return 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300';
      case 'refactor': return 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300';
      case 'docs': return 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
      case 'review': return 'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
      default: return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
    }
  }

  function getRequestStatusBadge(status: string): string {
    switch (status) {
      case 'pending': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'processing': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
      case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
      case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  }

  function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  async function handleIgnore(error: CapturedError) {
    processingId = error.id;
    await ignoreError(error.id);
    processingId = null;
  }

  async function handleRequestFix(error: CapturedError) {
    processingId = error.id;
    await requestFix(error.id);
    processingId = null;
  }

  function handleFilterChange() {
    fetchErrors({
      status: statusFilter || undefined,
      source: sourceFilter || undefined,
      severity: severityFilter || undefined,
    });
  }
</script>

<div class="flex flex-col h-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
  <!-- Header with Health Status -->
  <div class="p-4 px-6 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
    <div class="flex items-center gap-4 mb-3">
      <h2 class="text-xl font-semibold m-0">System Coder</h2>
      <div class="flex items-center gap-2 px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs capitalize">
        <span class="w-2 h-2 rounded-full {getHealthColor(health)}"></span>
        <span>{health === 'unknown' ? 'Loading...' : health}</span>
      </div>
    </div>

    {#if stats}
      <div class="flex gap-6">
        <div class="flex flex-col">
          <span class="text-2xl font-semibold">{stats.errorsNew}</span>
          <span class="text-xs muted">New Errors</span>
        </div>
        <div class="flex flex-col">
          <span class="text-2xl font-semibold">{stats.fixesPending}</span>
          <span class="text-xs muted">Pending Fixes</span>
        </div>
        <div class="flex flex-col">
          <span class="text-2xl font-semibold">{stats.fixesApplied}</span>
          <span class="text-xs muted">Applied</span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Tabs -->
  <div class="flex gap-1 px-6 py-2 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
    <button
      class="px-4 py-2 border-none bg-transparent text-gray-500 cursor-pointer rounded-md text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 {activeTab === 'request' ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium' : ''}"
      on:click={() => (activeTab = 'request')}
    >
      Request
    </button>
    <button
      class="px-4 py-2 border-none bg-transparent text-gray-500 cursor-pointer rounded-md text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 {activeTab === 'errors' ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium' : ''}"
      on:click={() => (activeTab = 'errors')}
    >
      Errors
      {#if stats && stats.errorsNew > 0}
        <span class="px-1.5 py-0.5 bg-red-500 text-white rounded-full text-[0.625rem] font-semibold">{stats.errorsNew}</span>
      {/if}
    </button>
    <button
      class="px-4 py-2 border-none bg-transparent text-gray-500 cursor-pointer rounded-md text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 {activeTab === 'fixes' ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium' : ''}"
      on:click={() => (activeTab = 'fixes')}
    >
      Fixes
      {#if stats && stats.fixesPending > 0}
        <span class="px-1.5 py-0.5 bg-red-500 text-white rounded-full text-[0.625rem] font-semibold">{stats.fixesPending}</span>
      {/if}
    </button>
    <button
      class="px-4 py-2 border-none bg-transparent text-gray-500 cursor-pointer rounded-md text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 {activeTab === 'maintenance' ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium' : ''}"
      on:click={() => (activeTab = 'maintenance')}
    >
      Maintenance
    </button>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto p-4 px-6">
    {#if activeTab === 'request'}
      <!-- Request Tab -->
      <div class="flex flex-col gap-6">
        <div class="panel p-6">
          <h3 class="m-0 mb-2 text-lg font-semibold">Submit Coding Request</h3>
          <p class="muted text-sm mb-4">Describe what you'd like the system coder to work on.</p>

          {#if requestSuccess}
            <div class="p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-md text-green-800 dark:text-green-200 mb-4">
              {requestSuccess}
            </div>
          {/if}

          {#if requestError}
            <div class="banner banner-error mb-4">{requestError}</div>
          {/if}

          <div class="mb-4">
            <label for="request-type" class="block mb-1.5 text-sm font-medium">Request Type</label>
            <select id="request-type" bind:value={requestType} class="select-field">
              <option value="fix">Bug Fix</option>
              <option value="feature">New Feature</option>
              <option value="refactor">Refactor</option>
              <option value="docs">Documentation</option>
              <option value="review">Code Review</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div class="mb-4">
            <label for="request-description" class="block mb-1.5 text-sm font-medium">Description *</label>
            <textarea
              id="request-description"
              bind:value={requestDescription}
              placeholder="Describe what you need..."
              rows="4"
              class="input-field resize-y min-h-[80px]"
            ></textarea>
          </div>

          <div class="mb-4">
            <label for="request-context" class="block mb-1.5 text-sm font-medium">Additional Context (optional)</label>
            <textarea
              id="request-context"
              bind:value={requestContext}
              placeholder="Any relevant background info, error messages, or requirements..."
              rows="3"
              class="input-field resize-y min-h-[80px]"
            ></textarea>
          </div>

          <div class="mb-4">
            <label for="request-files" class="block mb-1.5 text-sm font-medium">Related Files (optional)</label>
            <input
              type="text"
              id="request-files"
              bind:value={requestFiles}
              placeholder="e.g., src/components/Chat.svelte, packages/core/src/llm.ts"
              class="input-field"
            />
            <span class="block mt-1 text-xs muted">Comma-separated file paths</span>
          </div>

          <button
            class="btn-primary w-full py-3 text-base font-medium"
            on:click={handleSubmitRequest}
            disabled={requestSubmitting || !requestDescription.trim()}
          >
            {requestSubmitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>

        {#if codingRequests.length > 0}
          <div class="panel p-6">
            <div class="flex justify-between items-center mb-4">
              <h3 class="m-0 text-base font-semibold">Previous Requests</h3>
              <button class="btn-secondary btn-sm" on:click={loadCodingRequests}>Refresh</button>
            </div>

            {#each codingRequests as req (req.id)}
              <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-md mb-3 last:mb-0">
                <div class="flex items-center gap-2 mb-2">
                  <span class="px-2 py-0.5 rounded text-xs font-medium capitalize {getRequestTypeBadge(req.type)}">{req.type}</span>
                  <span class="px-2 py-0.5 rounded text-xs font-medium capitalize {getRequestStatusBadge(req.status)}">{req.status}</span>
                  <span class="text-xs muted">{formatTimestamp(req.timestamp)}</span>
                </div>
                <div class="text-sm leading-relaxed mb-2">{req.description}</div>
                {#if req.files && req.files.length > 0}
                  <div class="text-xs muted font-mono">Files: {req.files.join(', ')}</div>
                {/if}
                {#if req.result}
                  <div class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-sm">
                    <strong>Result:</strong> {req.result}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

    {:else if activeTab === 'errors'}
      <!-- Errors Tab -->
      <div class="flex gap-2 mb-4 flex-wrap">
        <select bind:value={statusFilter} on:change={handleFilterChange} class="select-field">
          <option value="">All Status</option>
          <option value="new">New</option>
          <option value="reviewing">Reviewing</option>
          <option value="fixed">Fixed</option>
          <option value="ignored">Ignored</option>
        </select>

        <select bind:value={sourceFilter} on:change={handleFilterChange} class="select-field">
          <option value="">All Sources</option>
          <option value="terminal">Terminal</option>
          <option value="web_console">Web Console</option>
          <option value="build">Build</option>
          <option value="test">Test</option>
          <option value="runtime">Runtime</option>
        </select>

        <select bind:value={severityFilter} on:change={handleFilterChange} class="select-field">
          <option value="">All Severity</option>
          <option value="critical">Critical</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
        </select>

        <button class="btn-secondary btn-sm" on:click={() => fetchErrors()} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {#if storeError}
        <div class="banner banner-error mb-4">{storeError}</div>
      {/if}

      {#if filteredErrors.length === 0}
        <div class="text-center py-12 muted">
          <p class="my-2">No errors found</p>
          <p class="my-2 text-sm opacity-70">
            {statusFilter === 'new' ? 'Great! No new errors to review.' : 'Try adjusting your filters.'}
          </p>
        </div>
      {:else}
        <div class="flex flex-col gap-3">
          {#each filteredErrors as error (error.id)}
            <div class="panel p-4">
              <div class="flex justify-between items-center mb-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="w-6 h-6 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded text-xs font-semibold font-mono" title={error.source}>
                    {getSourceIcon(error.source)}
                  </span>
                  <span class="px-2 py-0.5 rounded text-xs font-medium capitalize {getSeverityColor(error.severity)}">
                    {error.severity}
                  </span>
                  <span class="px-2 py-0.5 rounded text-xs font-medium capitalize {getStatusBadge(error.status)}">
                    {error.status}
                  </span>
                  <span class="text-xs muted">{formatTimestamp(error.timestamp)}</span>
                </div>
              </div>

              <div class="font-mono text-sm leading-relaxed mb-2 break-words">{error.message}</div>

              {#if error.context?.file}
                <div class="text-xs muted mb-2">
                  <span class="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                    {error.context.file}{error.context.line ? `:${error.context.line}` : ''}
                  </span>
                </div>
              {/if}

              {#if error.stack}
                <details class="mt-2 text-xs">
                  <summary class="cursor-pointer muted">Stack Trace</summary>
                  <pre class="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded overflow-x-auto whitespace-pre-wrap break-words">{error.stack}</pre>
                </details>
              {/if}

              {#if error.status === 'new' || error.status === 'reviewing'}
                <div class="flex gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <button
                    class="btn-primary btn-sm"
                    on:click={() => handleRequestFix(error)}
                    disabled={processingId === error.id || error.status === 'reviewing'}
                  >
                    {error.status === 'reviewing' ? 'Reviewing...' : 'Request Fix'}
                  </button>
                  <button
                    class="btn-secondary btn-sm"
                    on:click={() => handleIgnore(error)}
                    disabled={processingId === error.id}
                  >
                    Ignore
                  </button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

    {:else if activeTab === 'fixes'}
      <!-- Fixes Tab -->
      <div class="flex gap-2 mb-4">
        <select bind:value={fixStatusFilter} on:change={loadFixes} class="select-field">
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="applied">Applied</option>
          <option value="reverted">Reverted</option>
        </select>

        <button class="btn-secondary btn-sm" on:click={loadFixes} disabled={fixesLoading}>
          {fixesLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {#if fixes.length === 0}
        <div class="text-center py-12 muted">
          <p class="my-2">No Fixes Found</p>
          <p class="my-2 text-sm opacity-70">
            {fixStatusFilter ? 'No fixes match the selected filter.' : 'Fixes will appear here when the system coder generates them. Request a fix from the Errors tab to get started.'}
          </p>
        </div>
      {:else}
        <div class="flex flex-col gap-3">
          {#each fixes as fix (fix.id)}
            <div
              class="panel p-4 cursor-pointer transition-all hover:border-blue-500 hover:shadow-md"
              on:click={() => openFixModal(fix)}
              on:keydown={(e) => e.key === 'Enter' && openFixModal(fix)}
              role="button"
              tabindex="0"
            >
              <div class="mb-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="px-2 py-0.5 rounded text-xs font-medium capitalize {getFixStatusColor(fix.status)}">
                    {fix.status}
                  </span>
                  <span class="px-2 py-0.5 rounded text-xs font-medium capitalize {getRiskColor(fix.risk)}">
                    {fix.risk} risk
                  </span>
                  <span class="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-800 muted">
                    {Math.round(fix.confidence * 100)}% confidence
                  </span>
                  <span class="text-xs muted">{formatTimestamp(fix.timestamp)}</span>
                </div>
              </div>

              <div class="font-semibold text-base mb-1.5">{fix.title}</div>
              <div class="text-sm muted mb-2 leading-relaxed">{fix.explanation.substring(0, 150)}{fix.explanation.length > 150 ? '...' : ''}</div>

              <div class="flex gap-2 flex-wrap mb-2">
                {#each fix.changes as change}
                  <span class="font-mono text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded {getChangeTypeColor(change.changeType)}">
                    {getChangeTypeIcon(change.changeType)} {change.filePath.split('/').pop()}
                  </span>
                {/each}
              </div>

              <div class="text-xs muted">
                Generated by: {fix.generatedBy === 'big_brother' ? 'Claude CLI' : fix.generatedBy}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Fix Review Modal -->
      {#if showFixModal && selectedFix}
        <div
          class="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4"
          on:click={closeFixModal}
          on:keydown={(e) => e.key === 'Escape' && closeFixModal()}
          role="button"
          tabindex="-1"
        >
          <div
            class="bg-white dark:bg-gray-900 dark:border dark:border-gray-700 rounded-lg max-w-[800px] w-full max-h-[80vh] flex flex-col shadow-2xl"
            on:click|stopPropagation
            role="dialog"
            aria-modal="true"
          >
            <div class="flex justify-between items-center p-4 px-6 border-b border-gray-200 dark:border-gray-700">
              <h3 class="m-0 text-lg font-semibold">{selectedFix.title}</h3>
              <button class="bg-transparent border-none text-2xl cursor-pointer p-1 leading-none muted hover:text-gray-900 dark:hover:text-gray-100" on:click={closeFixModal}>&times;</button>
            </div>

            <div class="flex-1 overflow-y-auto p-6">
              <div class="flex gap-2 mb-6 flex-wrap">
                <span class="px-2 py-0.5 rounded text-xs font-medium capitalize {getFixStatusColor(selectedFix.status)}">
                  {selectedFix.status}
                </span>
                <span class="px-2 py-0.5 rounded text-xs font-medium capitalize {getRiskColor(selectedFix.risk)}">
                  {selectedFix.risk} risk
                </span>
                <span class="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-800 muted">
                  {Math.round(selectedFix.confidence * 100)}% confidence
                </span>
              </div>

              <div class="mb-6">
                <h4 class="m-0 mb-2 text-sm font-semibold uppercase muted">Explanation</h4>
                <p class="m-0 leading-relaxed">{selectedFix.explanation}</p>
              </div>

              <div class="mb-6">
                <h4 class="m-0 mb-2 text-sm font-semibold uppercase muted">File Changes ({selectedFix.changes.length})</h4>
                {#each selectedFix.changes as change}
                  <div class="mb-3 p-3 bg-gray-100 dark:bg-gray-950 rounded-md">
                    <div class="flex items-center gap-2 mb-2">
                      <span class="font-semibold uppercase text-xs {getChangeTypeColor(change.changeType)}">{change.changeType}</span>
                      <span class="font-mono text-sm">{change.filePath}</span>
                    </div>
                    {#if change.newContent}
                      <details class="mt-2">
                        <summary class="cursor-pointer text-xs muted mb-2">View Content</summary>
                        <pre class="m-0 p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs overflow-x-auto max-h-48 whitespace-pre-wrap break-words">{change.newContent}</pre>
                      </details>
                    {/if}
                  </div>
                {/each}
              </div>

              {#if selectedFix.testCommands && selectedFix.testCommands.length > 0}
                <div class="mb-6">
                  <h4 class="m-0 mb-2 text-sm font-semibold uppercase muted">Test Commands</h4>
                  <ul class="m-0 pl-5">
                    {#each selectedFix.testCommands as cmd}
                      <li class="mb-1"><code class="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{cmd}</code></li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if fixActionError}
                <div class="banner banner-error mb-4">{fixActionError}</div>
              {/if}

              {#if selectedFix.status === 'pending'}
                <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <label for="reject-reason" class="block mb-1.5 text-sm font-medium">Rejection Reason (optional)</label>
                  <input
                    type="text"
                    id="reject-reason"
                    bind:value={rejectReason}
                    placeholder="Reason for rejecting this fix..."
                    class="input-field"
                  />
                </div>
              {/if}
            </div>

            <div class="flex gap-2 p-4 px-6 border-t border-gray-200 dark:border-gray-700 justify-end">
              {#if selectedFix.status === 'pending'}
                <button class="btn-primary btn-sm" on:click={handleApproveFix} disabled={fixActionLoading}>
                  {fixActionLoading ? 'Processing...' : 'Approve'}
                </button>
                <button class="btn-danger btn-sm" on:click={handleRejectFix} disabled={fixActionLoading}>
                  Reject
                </button>
              {:else if selectedFix.status === 'approved'}
                <button class="btn-primary btn-sm" on:click={handleApplyFix} disabled={fixActionLoading}>
                  {fixActionLoading ? 'Applying...' : 'Apply Fix'}
                </button>
                <button class="btn-danger btn-sm" on:click={handleRejectFix} disabled={fixActionLoading}>
                  Reject
                </button>
              {:else if selectedFix.status === 'applied'}
                <button class="btn-danger btn-sm" on:click={handleRevertFix} disabled={fixActionLoading}>
                  {fixActionLoading ? 'Reverting...' : 'Revert Fix'}
                </button>
              {/if}
              <button class="btn-secondary btn-sm" on:click={closeFixModal}>Close</button>
            </div>
          </div>
        </div>
      {/if}

    {:else if activeTab === 'maintenance'}
      <!-- Maintenance Tab -->
      <div class="panel p-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="m-0 text-base font-semibold">Code Maintenance</h3>
          <button
            class="btn-primary btn-sm"
            on:click={handleRunMaintenance}
            disabled={maintenanceLoading || maintenanceRunning}
          >
            {maintenanceLoading ? 'Running...' : 'Run Maintenance'}
          </button>
        </div>

        {#if maintenanceError}
          <div class="banner banner-error mb-4">{maintenanceError}</div>
        {/if}

        <div class="mb-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-md">
          <h4 class="m-0 mb-3 text-sm font-semibold">Select Checks to Run</h4>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
            {#each ['type_errors', 'security_vulnerabilities', 'documentation_drift', 'deprecated_apis', 'unused_exports', 'dead_code'] as check}
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={selectedChecks.includes(check)} on:change={() => toggleCheck(check)} class="cursor-pointer" />
                <span>{getCheckLabel(check)}</span>
              </label>
            {/each}
          </div>
        </div>

        <p class="muted text-sm mb-4">Last run: {lastMaintenanceRun ? formatTimestamp(lastMaintenanceRun) : 'Never'}</p>

        {#if maintenanceReport}
          <div class="mt-4">
            <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
              <h4 class="m-0 text-base font-semibold">Last Report</h4>
              <span class="text-xs muted">
                {maintenanceReport.checksRun.length} checks |
                {maintenanceReport.summary.total} issues found |
                {Math.round(maintenanceReport.duration / 1000)}s
              </span>
            </div>

            {#if maintenanceReport.summary.total > 0}
              <div class="mb-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-md">
                <div class="flex items-center gap-3">
                  <span class="text-sm font-medium">By Severity:</span>
                  <div class="flex gap-2 flex-wrap">
                    {#if maintenanceReport.summary.bySeverity.critical}
                      <span class="px-2 py-0.5 rounded text-xs font-medium bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300">{maintenanceReport.summary.bySeverity.critical} critical</span>
                    {/if}
                    {#if maintenanceReport.summary.bySeverity.error}
                      <span class="px-2 py-0.5 rounded text-xs font-medium bg-orange-50 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">{maintenanceReport.summary.bySeverity.error} error</span>
                    {/if}
                    {#if maintenanceReport.summary.bySeverity.warning}
                      <span class="px-2 py-0.5 rounded text-xs font-medium bg-yellow-50 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300">{maintenanceReport.summary.bySeverity.warning} warning</span>
                    {/if}
                    {#if maintenanceReport.summary.bySeverity.info}
                      <span class="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">{maintenanceReport.summary.bySeverity.info} info</span>
                    {/if}
                  </div>
                </div>
              </div>

              <div class="flex flex-col gap-2">
                {#each maintenanceReport.issues as issue (issue.id)}
                  <div class="p-3 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-md">
                    <div class="flex items-center gap-2 mb-1.5">
                      <span class="px-1.5 py-0.5 rounded text-[0.625rem] font-semibold uppercase {getIssueSeverityColor(issue.severity)}">{issue.severity}</span>
                      <span class="text-xs muted">{getCheckLabel(issue.checkType)}</span>
                    </div>
                    <div class="text-sm leading-relaxed mb-1">{issue.message}</div>
                    {#if issue.file}
                      <div class="text-xs mb-1">
                        <code class="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{issue.file}{issue.line ? `:${issue.line}` : ''}</code>
                      </div>
                    {/if}
                    {#if issue.suggestion}
                      <div class="text-xs muted mt-1 pt-1 border-t border-dashed border-gray-200 dark:border-gray-700">
                        <strong>Suggestion:</strong> {issue.suggestion}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <div class="text-center py-8 text-green-600 dark:text-green-400 font-medium">
                No issues found! Your codebase is looking good.
              </div>
            {/if}
          </div>
        {:else}
          <div class="text-center py-8 muted">
            <p class="my-2">No maintenance report available.</p>
            <p class="my-2 text-sm opacity-70">Run maintenance checks to analyze your codebase.</p>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
