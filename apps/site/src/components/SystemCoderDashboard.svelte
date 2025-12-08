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
    // Fetch initial data (no polling)
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

    // Load last report if available
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
      case 'green':
        return 'bg-green-500';
      case 'yellow':
        return 'bg-yellow-500';
      case 'red':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  }

  function getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical':
        return 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30';
      case 'error':
        return 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30';
      case 'warning':
        return 'text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30';
      default:
        return 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800';
    }
  }

  function getSourceIcon(source: string): string {
    switch (source) {
      case 'terminal':
        return '>';
      case 'web_console':
        return 'W';
      case 'build':
        return 'B';
      case 'test':
        return 'T';
      case 'runtime':
        return 'R';
      default:
        return '?';
    }
  }

  function getStatusBadge(status: string): string {
    switch (status) {
      case 'new':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'reviewing':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'fixed':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'ignored':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      case 'wont_fix':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
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

<div class="system-coder-dashboard">
  <!-- Header with Health Status -->
  <div class="header">
    <div class="title-section">
      <h2 class="title">System Coder</h2>
      <div class="health-indicator">
        <span class="health-dot {getHealthColor(health)}"></span>
        <span class="health-text">{health === 'unknown' ? 'Loading...' : health}</span>
      </div>
    </div>

    {#if stats}
      <div class="stats">
        <div class="stat">
          <span class="stat-value">{stats.errorsNew}</span>
          <span class="stat-label">New Errors</span>
        </div>
        <div class="stat">
          <span class="stat-value">{stats.fixesPending}</span>
          <span class="stat-label">Pending Fixes</span>
        </div>
        <div class="stat">
          <span class="stat-value">{stats.fixesApplied}</span>
          <span class="stat-label">Applied</span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <button
      class="tab"
      class:active={activeTab === 'request'}
      on:click={() => (activeTab = 'request')}
    >
      Request
    </button>
    <button
      class="tab"
      class:active={activeTab === 'errors'}
      on:click={() => (activeTab = 'errors')}
    >
      Errors
      {#if stats && stats.errorsNew > 0}
        <span class="tab-badge">{stats.errorsNew}</span>
      {/if}
    </button>
    <button
      class="tab"
      class:active={activeTab === 'fixes'}
      on:click={() => (activeTab = 'fixes')}
    >
      Fixes
      {#if stats && stats.fixesPending > 0}
        <span class="tab-badge">{stats.fixesPending}</span>
      {/if}
    </button>
    <button
      class="tab"
      class:active={activeTab === 'maintenance'}
      on:click={() => (activeTab = 'maintenance')}
    >
      Maintenance
    </button>
  </div>

  <!-- Content -->
  <div class="content">
    {#if activeTab === 'request'}
      <!-- Request Tab -->
      <div class="request-section">
        <div class="request-form">
          <h3>Submit Coding Request</h3>
          <p class="form-description">
            Describe what you'd like the system coder to work on.
          </p>

          {#if requestSuccess}
            <div class="success-banner">
              {requestSuccess}
            </div>
          {/if}

          {#if requestError}
            <div class="error-banner">
              {requestError}
            </div>
          {/if}

          <div class="form-group">
            <label for="request-type">Request Type</label>
            <select id="request-type" bind:value={requestType}>
              <option value="fix">Bug Fix</option>
              <option value="feature">New Feature</option>
              <option value="refactor">Refactor</option>
              <option value="docs">Documentation</option>
              <option value="review">Code Review</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div class="form-group">
            <label for="request-description">Description *</label>
            <textarea
              id="request-description"
              bind:value={requestDescription}
              placeholder="Describe what you need..."
              rows="4"
            ></textarea>
          </div>

          <div class="form-group">
            <label for="request-context">Additional Context (optional)</label>
            <textarea
              id="request-context"
              bind:value={requestContext}
              placeholder="Any relevant background info, error messages, or requirements..."
              rows="3"
            ></textarea>
          </div>

          <div class="form-group">
            <label for="request-files">Related Files (optional)</label>
            <input
              type="text"
              id="request-files"
              bind:value={requestFiles}
              placeholder="e.g., src/components/Chat.svelte, packages/core/src/llm.ts"
            />
            <span class="hint">Comma-separated file paths</span>
          </div>

          <button
            class="action-btn primary submit-btn"
            on:click={handleSubmitRequest}
            disabled={requestSubmitting || !requestDescription.trim()}
          >
            {requestSubmitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>

        {#if codingRequests.length > 0}
          <div class="requests-list">
            <div class="requests-header">
              <h3>Previous Requests</h3>
              <button class="refresh-btn" on:click={loadCodingRequests}>
                Refresh
              </button>
            </div>

            {#each codingRequests as req (req.id)}
              <div class="request-card">
                <div class="request-card-header">
                  <span class="request-type-badge {req.type}">{req.type}</span>
                  <span class="request-status-badge {req.status}">{req.status}</span>
                  <span class="timestamp">{formatTimestamp(req.timestamp)}</span>
                </div>
                <div class="request-description">
                  {req.description}
                </div>
                {#if req.files && req.files.length > 0}
                  <div class="request-files">
                    Files: {req.files.join(', ')}
                  </div>
                {/if}
                {#if req.result}
                  <div class="request-result">
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
      <div class="filters">
        <select bind:value={statusFilter} on:change={handleFilterChange}>
          <option value="">All Status</option>
          <option value="new">New</option>
          <option value="reviewing">Reviewing</option>
          <option value="fixed">Fixed</option>
          <option value="ignored">Ignored</option>
        </select>

        <select bind:value={sourceFilter} on:change={handleFilterChange}>
          <option value="">All Sources</option>
          <option value="terminal">Terminal</option>
          <option value="web_console">Web Console</option>
          <option value="build">Build</option>
          <option value="test">Test</option>
          <option value="runtime">Runtime</option>
        </select>

        <select bind:value={severityFilter} on:change={handleFilterChange}>
          <option value="">All Severity</option>
          <option value="critical">Critical</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
        </select>

        <button class="refresh-btn" on:click={() => fetchErrors()} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {#if storeError}
        <div class="error-banner">
          {storeError}
        </div>
      {/if}

      {#if filteredErrors.length === 0}
        <div class="empty-state">
          <p>No errors found</p>
          <p class="muted">
            {statusFilter === 'new'
              ? 'Great! No new errors to review.'
              : 'Try adjusting your filters.'}
          </p>
        </div>
      {:else}
        <div class="error-list">
          {#each filteredErrors as error (error.id)}
            <div class="error-card">
              <div class="error-header">
                <div class="error-meta">
                  <span class="source-badge" title={error.source}>
                    {getSourceIcon(error.source)}
                  </span>
                  <span class="severity-badge {getSeverityColor(error.severity)}">
                    {error.severity}
                  </span>
                  <span class="status-badge {getStatusBadge(error.status)}">
                    {error.status}
                  </span>
                  <span class="timestamp">{formatTimestamp(error.timestamp)}</span>
                </div>
              </div>

              <div class="error-message">
                {error.message}
              </div>

              {#if error.context?.file}
                <div class="error-context">
                  <span class="context-file">
                    {error.context.file}{error.context.line ? `:${error.context.line}` : ''}
                  </span>
                </div>
              {/if}

              {#if error.stack}
                <details class="stack-trace">
                  <summary>Stack Trace</summary>
                  <pre>{error.stack}</pre>
                </details>
              {/if}

              {#if error.status === 'new' || error.status === 'reviewing'}
                <div class="error-actions">
                  <button
                    class="action-btn primary"
                    on:click={() => handleRequestFix(error)}
                    disabled={processingId === error.id || error.status === 'reviewing'}
                  >
                    {error.status === 'reviewing' ? 'Reviewing...' : 'Request Fix'}
                  </button>
                  <button
                    class="action-btn secondary"
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
      <div class="fixes-filters">
        <select bind:value={fixStatusFilter} on:change={loadFixes}>
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="applied">Applied</option>
          <option value="reverted">Reverted</option>
        </select>

        <button class="refresh-btn" on:click={loadFixes} disabled={fixesLoading}>
          {fixesLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {#if fixes.length === 0}
        <div class="empty-state">
          <p>No Fixes Found</p>
          <p class="muted">
            {fixStatusFilter
              ? 'No fixes match the selected filter.'
              : 'Fixes will appear here when the system coder generates them. Request a fix from the Errors tab to get started.'}
          </p>
        </div>
      {:else}
        <div class="fix-list">
          {#each fixes as fix (fix.id)}
            <div class="fix-card" on:click={() => openFixModal(fix)} on:keydown={(e) => e.key === 'Enter' && openFixModal(fix)} role="button" tabindex="0">
              <div class="fix-header">
                <div class="fix-meta">
                  <span class="fix-status-badge {getFixStatusColor(fix.status)}">
                    {fix.status}
                  </span>
                  <span class="fix-risk-badge {getRiskColor(fix.risk)}">
                    {fix.risk} risk
                  </span>
                  <span class="confidence-badge">
                    {Math.round(fix.confidence * 100)}% confidence
                  </span>
                  <span class="timestamp">{formatTimestamp(fix.timestamp)}</span>
                </div>
              </div>

              <div class="fix-title">{fix.title}</div>

              <div class="fix-explanation">{fix.explanation.substring(0, 150)}{fix.explanation.length > 150 ? '...' : ''}</div>

              <div class="fix-changes-summary">
                {#each fix.changes as change}
                  <span class="change-indicator {getChangeTypeColor(change.changeType)}">
                    {getChangeTypeIcon(change.changeType)} {change.filePath.split('/').pop()}
                  </span>
                {/each}
              </div>

              <div class="fix-generated-by">
                Generated by: {fix.generatedBy === 'big_brother' ? 'Claude CLI' : fix.generatedBy}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Fix Review Modal -->
      {#if showFixModal && selectedFix}
        <div class="modal-overlay" on:click={closeFixModal} on:keydown={(e) => e.key === 'Escape' && closeFixModal()} role="button" tabindex="-1">
          <div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
            <div class="modal-header">
              <h3>{selectedFix.title}</h3>
              <button class="close-btn" on:click={closeFixModal}>&times;</button>
            </div>

            <div class="modal-body">
              <div class="fix-detail-meta">
                <span class="fix-status-badge {getFixStatusColor(selectedFix.status)}">
                  {selectedFix.status}
                </span>
                <span class="fix-risk-badge {getRiskColor(selectedFix.risk)}">
                  {selectedFix.risk} risk
                </span>
                <span class="confidence-badge">
                  {Math.round(selectedFix.confidence * 100)}% confidence
                </span>
              </div>

              <div class="fix-detail-section">
                <h4>Explanation</h4>
                <p>{selectedFix.explanation}</p>
              </div>

              <div class="fix-detail-section">
                <h4>File Changes ({selectedFix.changes.length})</h4>
                {#each selectedFix.changes as change, i}
                  <div class="change-detail">
                    <div class="change-header">
                      <span class="change-type-indicator {getChangeTypeColor(change.changeType)}">
                        {change.changeType}
                      </span>
                      <span class="change-file">{change.filePath}</span>
                    </div>
                    {#if change.newContent}
                      <details class="change-content">
                        <summary>View Content</summary>
                        <pre>{change.newContent}</pre>
                      </details>
                    {/if}
                  </div>
                {/each}
              </div>

              {#if selectedFix.testCommands && selectedFix.testCommands.length > 0}
                <div class="fix-detail-section">
                  <h4>Test Commands</h4>
                  <ul class="test-commands">
                    {#each selectedFix.testCommands as cmd}
                      <li><code>{cmd}</code></li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if fixActionError}
                <div class="error-banner">
                  {fixActionError}
                </div>
              {/if}

              {#if selectedFix.status === 'pending'}
                <div class="reject-reason-section">
                  <label for="reject-reason">Rejection Reason (optional)</label>
                  <input
                    type="text"
                    id="reject-reason"
                    bind:value={rejectReason}
                    placeholder="Reason for rejecting this fix..."
                  />
                </div>
              {/if}
            </div>

            <div class="modal-footer">
              {#if selectedFix.status === 'pending'}
                <button
                  class="action-btn primary"
                  on:click={handleApproveFix}
                  disabled={fixActionLoading}
                >
                  {fixActionLoading ? 'Processing...' : 'Approve'}
                </button>
                <button
                  class="action-btn danger"
                  on:click={handleRejectFix}
                  disabled={fixActionLoading}
                >
                  Reject
                </button>
              {:else if selectedFix.status === 'approved'}
                <button
                  class="action-btn primary"
                  on:click={handleApplyFix}
                  disabled={fixActionLoading}
                >
                  {fixActionLoading ? 'Applying...' : 'Apply Fix'}
                </button>
                <button
                  class="action-btn danger"
                  on:click={handleRejectFix}
                  disabled={fixActionLoading}
                >
                  Reject
                </button>
              {:else if selectedFix.status === 'applied'}
                <button
                  class="action-btn danger"
                  on:click={handleRevertFix}
                  disabled={fixActionLoading}
                >
                  {fixActionLoading ? 'Reverting...' : 'Revert Fix'}
                </button>
              {/if}
              <button class="action-btn secondary" on:click={closeFixModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      {/if}

    {:else if activeTab === 'maintenance'}
      <!-- Maintenance Tab -->
      <div class="maintenance-section">
        <div class="maintenance-header">
          <h3>Code Maintenance</h3>
          <button
            class="action-btn primary"
            on:click={handleRunMaintenance}
            disabled={maintenanceLoading || maintenanceRunning}
          >
            {maintenanceLoading ? 'Running...' : 'Run Maintenance'}
          </button>
        </div>

        {#if maintenanceError}
          <div class="error-banner">
            {maintenanceError}
          </div>
        {/if}

        <div class="check-selection">
          <h4>Select Checks to Run</h4>
          <div class="check-options">
            {#each ['type_errors', 'security_vulnerabilities', 'documentation_drift', 'deprecated_apis', 'unused_exports', 'dead_code'] as check}
              <label class="check-option">
                <input
                  type="checkbox"
                  checked={selectedChecks.includes(check)}
                  on:change={() => toggleCheck(check)}
                />
                <span>{getCheckLabel(check)}</span>
              </label>
            {/each}
          </div>
        </div>

        <p class="muted last-run">
          Last run: {lastMaintenanceRun ? formatTimestamp(lastMaintenanceRun) : 'Never'}
        </p>

        {#if maintenanceReport}
          <div class="report-section">
            <div class="report-header">
              <h4>Last Report</h4>
              <span class="report-meta">
                {maintenanceReport.checksRun.length} checks |
                {maintenanceReport.summary.total} issues found |
                {Math.round(maintenanceReport.duration / 1000)}s
              </span>
            </div>

            {#if maintenanceReport.summary.total > 0}
              <div class="report-summary">
                <div class="summary-row">
                  <span class="summary-label">By Severity:</span>
                  <div class="summary-badges">
                    {#if maintenanceReport.summary.bySeverity.critical}
                      <span class="severity-count critical">{maintenanceReport.summary.bySeverity.critical} critical</span>
                    {/if}
                    {#if maintenanceReport.summary.bySeverity.error}
                      <span class="severity-count error">{maintenanceReport.summary.bySeverity.error} error</span>
                    {/if}
                    {#if maintenanceReport.summary.bySeverity.warning}
                      <span class="severity-count warning">{maintenanceReport.summary.bySeverity.warning} warning</span>
                    {/if}
                    {#if maintenanceReport.summary.bySeverity.info}
                      <span class="severity-count info">{maintenanceReport.summary.bySeverity.info} info</span>
                    {/if}
                  </div>
                </div>
              </div>

              <div class="issues-list">
                {#each maintenanceReport.issues as issue (issue.id)}
                  <div class="issue-card">
                    <div class="issue-header">
                      <span class="issue-severity {getIssueSeverityColor(issue.severity)}">
                        {issue.severity}
                      </span>
                      <span class="issue-type">{getCheckLabel(issue.checkType)}</span>
                    </div>
                    <div class="issue-message">{issue.message}</div>
                    {#if issue.file}
                      <div class="issue-location">
                        <code>{issue.file}{issue.line ? `:${issue.line}` : ''}</code>
                      </div>
                    {/if}
                    {#if issue.suggestion}
                      <div class="issue-suggestion">
                        <strong>Suggestion:</strong> {issue.suggestion}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <div class="no-issues">
                No issues found! Your codebase is looking good.
              </div>
            {/if}
          </div>
        {:else}
          <div class="no-report">
            <p>No maintenance report available.</p>
            <p class="muted">Run maintenance checks to analyze your codebase.</p>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .system-coder-dashboard {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-secondary, #f5f5f5);
    color: var(--text-primary, #1a1a1a);
  }

  :global(.dark) .system-coder-dashboard {
    background: #1a1a1a;
    color: #e5e5e5;
  }

  .header {
    padding: 1rem 1.5rem;
    background: var(--bg-primary, white);
    border-bottom: 1px solid var(--border-color, #e0e0e0);
  }

  :global(.dark) .header {
    background: #0d0d0d;
    border-color: #2a2a2a;
  }

  .title-section {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .title {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
  }

  .health-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.75rem;
    background: var(--bg-secondary, #f5f5f5);
    border-radius: 9999px;
    font-size: 0.75rem;
    text-transform: capitalize;
  }

  :global(.dark) .health-indicator {
    background: #2a2a2a;
  }

  .health-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .stats {
    display: flex;
    gap: 1.5rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 600;
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
  }

  :global(.dark) .stat-label {
    color: #888;
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.5rem 1.5rem;
    background: var(--bg-primary, white);
    border-bottom: 1px solid var(--border-color, #e0e0e0);
  }

  :global(.dark) .tabs {
    background: #0d0d0d;
    border-color: #2a2a2a;
  }

  .tab {
    padding: 0.5rem 1rem;
    border: none;
    background: transparent;
    color: var(--text-muted, #666);
    cursor: pointer;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .tab:hover {
    background: var(--bg-secondary, #f5f5f5);
  }

  :global(.dark) .tab:hover {
    background: #1a1a1a;
  }

  .tab.active {
    background: var(--bg-secondary, #f5f5f5);
    color: var(--text-primary, #1a1a1a);
    font-weight: 500;
  }

  :global(.dark) .tab.active {
    background: #1a1a1a;
    color: #e5e5e5;
  }

  .tab-badge {
    padding: 0.125rem 0.375rem;
    background: #ef4444;
    color: white;
    border-radius: 9999px;
    font-size: 0.625rem;
    font-weight: 600;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.5rem;
  }

  .filters {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .filters select {
    padding: 0.5rem;
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.375rem;
    background: var(--bg-primary, white);
    color: var(--text-primary, #1a1a1a);
    font-size: 0.875rem;
  }

  :global(.dark) .filters select {
    background: #1a1a1a;
    border-color: #2a2a2a;
    color: #e5e5e5;
  }

  .refresh-btn {
    padding: 0.5rem 1rem;
    background: var(--bg-secondary, #f5f5f5);
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 0.875rem;
  }

  :global(.dark) .refresh-btn {
    background: #2a2a2a;
    border-color: #3a3a3a;
    color: #e5e5e5;
  }

  .refresh-btn:hover:not(:disabled) {
    background: var(--bg-hover, #e5e5e5);
  }

  :global(.dark) .refresh-btn:hover:not(:disabled) {
    background: #3a3a3a;
  }

  .error-banner {
    padding: 0.75rem 1rem;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 0.375rem;
    color: #dc2626;
    margin-bottom: 1rem;
  }

  :global(.dark) .error-banner {
    background: #450a0a;
    border-color: #7f1d1d;
    color: #fca5a5;
  }

  .empty-state {
    text-align: center;
    padding: 3rem;
    color: var(--text-muted, #666);
  }

  :global(.dark) .empty-state {
    color: #888;
  }

  .empty-state p {
    margin: 0.5rem 0;
  }

  .muted {
    font-size: 0.875rem;
    opacity: 0.7;
  }

  .error-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .error-card {
    padding: 1rem;
    background: var(--bg-primary, white);
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.5rem;
  }

  :global(.dark) .error-card {
    background: #0d0d0d;
    border-color: #2a2a2a;
  }

  .error-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .error-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .source-badge {
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-secondary, #f5f5f5);
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    font-family: monospace;
  }

  :global(.dark) .source-badge {
    background: #2a2a2a;
  }

  .severity-badge,
  .status-badge {
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: capitalize;
  }

  .timestamp {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
  }

  :global(.dark) .timestamp {
    color: #888;
  }

  .error-message {
    font-family: monospace;
    font-size: 0.875rem;
    line-height: 1.5;
    margin-bottom: 0.5rem;
    word-break: break-word;
  }

  .error-context {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
    margin-bottom: 0.5rem;
  }

  :global(.dark) .error-context {
    color: #888;
  }

  .context-file {
    font-family: monospace;
    background: var(--bg-secondary, #f5f5f5);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
  }

  :global(.dark) .context-file {
    background: #2a2a2a;
  }

  .stack-trace {
    margin-top: 0.5rem;
    font-size: 0.75rem;
  }

  .stack-trace summary {
    cursor: pointer;
    color: var(--text-muted, #666);
  }

  :global(.dark) .stack-trace summary {
    color: #888;
  }

  .stack-trace pre {
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: var(--bg-secondary, #f5f5f5);
    border-radius: 0.25rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  :global(.dark) .stack-trace pre {
    background: #1a1a1a;
  }

  .error-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-color, #e0e0e0);
  }

  :global(.dark) .error-actions {
    border-color: #2a2a2a;
  }

  .action-btn {
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    cursor: pointer;
    border: none;
  }

  .action-btn.primary {
    background: #3b82f6;
    color: white;
  }

  .action-btn.primary:hover:not(:disabled) {
    background: #2563eb;
  }

  .action-btn.secondary {
    background: var(--bg-secondary, #f5f5f5);
    color: var(--text-primary, #1a1a1a);
    border: 1px solid var(--border-color, #e0e0e0);
  }

  :global(.dark) .action-btn.secondary {
    background: #2a2a2a;
    color: #e5e5e5;
    border-color: #3a3a3a;
  }

  .action-btn.secondary:hover:not(:disabled) {
    background: var(--bg-hover, #e5e5e5);
  }

  :global(.dark) .action-btn.secondary:hover:not(:disabled) {
    background: #3a3a3a;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .maintenance-section {
    background: var(--bg-primary, white);
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.5rem;
    padding: 1.5rem;
  }

  :global(.dark) .maintenance-section {
    background: #0d0d0d;
    border-color: #2a2a2a;
  }

  .maintenance-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .maintenance-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .check-selection {
    margin-bottom: 1rem;
    padding: 1rem;
    background: var(--bg-secondary, #f5f5f5);
    border-radius: 0.375rem;
  }

  :global(.dark) .check-selection {
    background: #1a1a1a;
  }

  .check-selection h4 {
    margin: 0 0 0.75rem 0;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .check-options {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.5rem;
  }

  .check-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .check-option input {
    cursor: pointer;
  }

  .last-run {
    margin-bottom: 1rem;
  }

  .report-section {
    margin-top: 1rem;
  }

  .report-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border-color, #e0e0e0);
  }

  :global(.dark) .report-header {
    border-color: #2a2a2a;
  }

  .report-header h4 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .report-meta {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
  }

  :global(.dark) .report-meta {
    color: #888;
  }

  .report-summary {
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: var(--bg-secondary, #f5f5f5);
    border-radius: 0.375rem;
  }

  :global(.dark) .report-summary {
    background: #1a1a1a;
  }

  .summary-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .summary-label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .summary-badges {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .severity-count {
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .severity-count.critical {
    background: #fef2f2;
    color: #dc2626;
  }

  :global(.dark) .severity-count.critical {
    background: #450a0a;
    color: #fca5a5;
  }

  .severity-count.error {
    background: #fff7ed;
    color: #ea580c;
  }

  :global(.dark) .severity-count.error {
    background: #431407;
    color: #fdba74;
  }

  .severity-count.warning {
    background: #fefce8;
    color: #ca8a04;
  }

  :global(.dark) .severity-count.warning {
    background: #422006;
    color: #fde047;
  }

  .severity-count.info {
    background: #eff6ff;
    color: #2563eb;
  }

  :global(.dark) .severity-count.info {
    background: #1e3a8a;
    color: #93c5fd;
  }

  .issues-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .issue-card {
    padding: 0.75rem;
    background: var(--bg-primary, white);
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.375rem;
  }

  :global(.dark) .issue-card {
    background: #0d0d0d;
    border-color: #2a2a2a;
  }

  .issue-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.375rem;
  }

  .issue-severity {
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .issue-type {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
  }

  :global(.dark) .issue-type {
    color: #888;
  }

  .issue-message {
    font-size: 0.875rem;
    line-height: 1.4;
    margin-bottom: 0.25rem;
  }

  .issue-location {
    font-size: 0.75rem;
    margin-bottom: 0.25rem;
  }

  .issue-location code {
    font-family: monospace;
    background: var(--bg-secondary, #f5f5f5);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
  }

  :global(.dark) .issue-location code {
    background: #2a2a2a;
  }

  .issue-suggestion {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
    margin-top: 0.25rem;
    padding-top: 0.25rem;
    border-top: 1px dashed var(--border-color, #e0e0e0);
  }

  :global(.dark) .issue-suggestion {
    color: #888;
    border-color: #2a2a2a;
  }

  .no-issues {
    text-align: center;
    padding: 2rem;
    color: #16a34a;
    font-weight: 500;
  }

  :global(.dark) .no-issues {
    color: #4ade80;
  }

  .no-report {
    text-align: center;
    padding: 2rem;
    color: var(--text-muted, #666);
  }

  :global(.dark) .no-report {
    color: #888;
  }

  .no-report p {
    margin: 0.5rem 0;
  }

  /* Request Tab Styles */
  .request-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .request-form {
    background: var(--bg-primary, white);
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.5rem;
    padding: 1.5rem;
  }

  :global(.dark) .request-form {
    background: #0d0d0d;
    border-color: #2a2a2a;
  }

  .request-form h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .form-description {
    color: var(--text-muted, #666);
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .form-description {
    color: #888;
  }

  .success-banner {
    padding: 0.75rem 1rem;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 0.375rem;
    color: #166534;
    margin-bottom: 1rem;
  }

  :global(.dark) .success-banner {
    background: #052e16;
    border-color: #166534;
    color: #86efac;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .form-group select,
  .form-group textarea,
  .form-group input[type="text"] {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.375rem;
    background: var(--bg-primary, white);
    color: var(--text-primary, #1a1a1a);
    font-size: 0.875rem;
    font-family: inherit;
  }

  :global(.dark) .form-group select,
  :global(.dark) .form-group textarea,
  :global(.dark) .form-group input[type="text"] {
    background: #1a1a1a;
    border-color: #2a2a2a;
    color: #e5e5e5;
  }

  .form-group textarea {
    resize: vertical;
    min-height: 80px;
  }

  .form-group .hint {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-muted, #666);
  }

  :global(.dark) .form-group .hint {
    color: #888;
  }

  .submit-btn {
    width: 100%;
    padding: 0.75rem 1rem;
    font-size: 1rem;
    font-weight: 500;
  }

  .requests-list {
    background: var(--bg-primary, white);
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.5rem;
    padding: 1.5rem;
  }

  :global(.dark) .requests-list {
    background: #0d0d0d;
    border-color: #2a2a2a;
  }

  .requests-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .requests-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .request-card {
    padding: 1rem;
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.375rem;
    margin-bottom: 0.75rem;
  }

  :global(.dark) .request-card {
    border-color: #2a2a2a;
  }

  .request-card:last-child {
    margin-bottom: 0;
  }

  .request-card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .request-type-badge {
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: capitalize;
  }

  .request-type-badge.fix {
    background: #fef2f2;
    color: #dc2626;
  }

  :global(.dark) .request-type-badge.fix {
    background: #450a0a;
    color: #fca5a5;
  }

  .request-type-badge.feature {
    background: #f0fdf4;
    color: #166534;
  }

  :global(.dark) .request-type-badge.feature {
    background: #052e16;
    color: #86efac;
  }

  .request-type-badge.refactor {
    background: #fefce8;
    color: #a16207;
  }

  :global(.dark) .request-type-badge.refactor {
    background: #422006;
    color: #fde047;
  }

  .request-type-badge.docs {
    background: #eff6ff;
    color: #1d4ed8;
  }

  :global(.dark) .request-type-badge.docs {
    background: #1e3a8a;
    color: #93c5fd;
  }

  .request-type-badge.review {
    background: #faf5ff;
    color: #7c3aed;
  }

  :global(.dark) .request-type-badge.review {
    background: #4c1d95;
    color: #c4b5fd;
  }

  .request-type-badge.other {
    background: #f5f5f5;
    color: #525252;
  }

  :global(.dark) .request-type-badge.other {
    background: #262626;
    color: #a3a3a3;
  }

  .request-status-badge {
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: capitalize;
  }

  .request-status-badge.pending {
    background: #fef3c7;
    color: #92400e;
  }

  :global(.dark) .request-status-badge.pending {
    background: #451a03;
    color: #fcd34d;
  }

  .request-status-badge.processing {
    background: #dbeafe;
    color: #1e40af;
  }

  :global(.dark) .request-status-badge.processing {
    background: #1e3a8a;
    color: #93c5fd;
  }

  .request-status-badge.completed {
    background: #dcfce7;
    color: #166534;
  }

  :global(.dark) .request-status-badge.completed {
    background: #052e16;
    color: #86efac;
  }

  .request-status-badge.failed {
    background: #fee2e2;
    color: #991b1b;
  }

  :global(.dark) .request-status-badge.failed {
    background: #450a0a;
    color: #fca5a5;
  }

  .request-description {
    font-size: 0.875rem;
    line-height: 1.5;
    margin-bottom: 0.5rem;
  }

  .request-files {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
    font-family: monospace;
  }

  :global(.dark) .request-files {
    color: #888;
  }

  .request-result {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-color, #e0e0e0);
    font-size: 0.875rem;
  }

  :global(.dark) .request-result {
    border-color: #2a2a2a;
  }

  /* Fixes Tab Styles */
  .fixes-filters {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .fixes-filters select {
    padding: 0.5rem;
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.375rem;
    background: var(--bg-primary, white);
    color: var(--text-primary, #1a1a1a);
    font-size: 0.875rem;
  }

  :global(.dark) .fixes-filters select {
    background: #1a1a1a;
    border-color: #2a2a2a;
    color: #e5e5e5;
  }

  .fix-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .fix-card {
    padding: 1rem;
    background: var(--bg-primary, white);
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  :global(.dark) .fix-card {
    background: #0d0d0d;
    border-color: #2a2a2a;
  }

  .fix-card:hover {
    border-color: #3b82f6;
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.15);
  }

  .fix-header {
    margin-bottom: 0.5rem;
  }

  .fix-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .fix-status-badge,
  .fix-risk-badge {
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: capitalize;
  }

  .confidence-badge {
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    background: var(--bg-secondary, #f5f5f5);
    color: var(--text-muted, #666);
  }

  :global(.dark) .confidence-badge {
    background: #2a2a2a;
    color: #888;
  }

  .fix-title {
    font-weight: 600;
    font-size: 1rem;
    margin-bottom: 0.375rem;
  }

  .fix-explanation {
    font-size: 0.875rem;
    color: var(--text-muted, #666);
    margin-bottom: 0.5rem;
    line-height: 1.4;
  }

  :global(.dark) .fix-explanation {
    color: #888;
  }

  .fix-changes-summary {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }

  .change-indicator {
    font-family: monospace;
    font-size: 0.75rem;
    padding: 0.125rem 0.375rem;
    background: var(--bg-secondary, #f5f5f5);
    border-radius: 0.25rem;
  }

  :global(.dark) .change-indicator {
    background: #2a2a2a;
  }

  .fix-generated-by {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
  }

  :global(.dark) .fix-generated-by {
    color: #888;
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-primary, white);
    border-radius: 0.5rem;
    max-width: 800px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  }

  :global(.dark) .modal-content {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border-color, #e0e0e0);
  }

  :global(.dark) .modal-header {
    border-color: #2a2a2a;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.25rem;
    line-height: 1;
    color: var(--text-muted, #666);
  }

  :global(.dark) .close-btn {
    color: #888;
  }

  .close-btn:hover {
    color: var(--text-primary, #1a1a1a);
  }

  :global(.dark) .close-btn:hover {
    color: #e5e5e5;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .fix-detail-meta {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .fix-detail-section {
    margin-bottom: 1.5rem;
  }

  .fix-detail-section h4 {
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-muted, #666);
  }

  :global(.dark) .fix-detail-section h4 {
    color: #888;
  }

  .fix-detail-section p {
    margin: 0;
    line-height: 1.5;
  }

  .change-detail {
    margin-bottom: 0.75rem;
    padding: 0.75rem;
    background: var(--bg-secondary, #f5f5f5);
    border-radius: 0.375rem;
  }

  :global(.dark) .change-detail {
    background: #0d0d0d;
  }

  .change-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .change-type-indicator {
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.75rem;
  }

  .change-file {
    font-family: monospace;
    font-size: 0.875rem;
  }

  .change-content {
    margin-top: 0.5rem;
  }

  .change-content summary {
    cursor: pointer;
    font-size: 0.75rem;
    color: var(--text-muted, #666);
    margin-bottom: 0.5rem;
  }

  :global(.dark) .change-content summary {
    color: #888;
  }

  .change-content pre {
    margin: 0;
    padding: 0.75rem;
    background: var(--bg-primary, white);
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.25rem;
    font-size: 0.75rem;
    overflow-x: auto;
    max-height: 200px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  :global(.dark) .change-content pre {
    background: #1a1a1a;
    border-color: #2a2a2a;
  }

  .test-commands {
    margin: 0;
    padding-left: 1.25rem;
  }

  .test-commands li {
    margin-bottom: 0.25rem;
  }

  .test-commands code {
    font-family: monospace;
    font-size: 0.875rem;
    background: var(--bg-secondary, #f5f5f5);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
  }

  :global(.dark) .test-commands code {
    background: #2a2a2a;
  }

  .reject-reason-section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-color, #e0e0e0);
  }

  :global(.dark) .reject-reason-section {
    border-color: #2a2a2a;
  }

  .reject-reason-section label {
    display: block;
    margin-bottom: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .reject-reason-section input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 0.375rem;
    background: var(--bg-primary, white);
    color: var(--text-primary, #1a1a1a);
    font-size: 0.875rem;
  }

  :global(.dark) .reject-reason-section input {
    background: #0d0d0d;
    border-color: #2a2a2a;
    color: #e5e5e5;
  }

  .modal-footer {
    display: flex;
    gap: 0.5rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--border-color, #e0e0e0);
    justify-content: flex-end;
  }

  :global(.dark) .modal-footer {
    border-color: #2a2a2a;
  }

  .action-btn.danger {
    background: #ef4444;
    color: white;
  }

  .action-btn.danger:hover:not(:disabled) {
    background: #dc2626;
  }
</style>
