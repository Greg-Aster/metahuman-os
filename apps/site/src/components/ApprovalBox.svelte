<script lang="ts">
  /**
   * ApprovalBox Component
   * Displays code change approvals above chat input
   * Similar to Claude Code, Cursor, Windsurf approval UIs
   */

  import { onMount, onDestroy } from 'svelte';

  interface CodeApproval {
    id: string;
    filePath: string;
    absolutePath: string;
    patch: string | null;
    newContent: string | null;
    preview: string | null;
    explanation: string;
    testCommands: string[];
    timestamp: string;
    status: string;
  }

  let approvals: CodeApproval[] = [];
  let currentIndex = 0;
  let isExpanded = false;
  let isApproving = false;
  let pollInterval: number;

  // Get current approval
  $: currentApproval = approvals[currentIndex];
  $: hasApprovals = approvals.length > 0;

  // Fetch pending approvals
  async function fetchApprovals() {
    try {
      const res = await fetch('/api/code-approvals');
      const data = await res.json();
      approvals = data.approvals || [];

      // Auto-expand if there are approvals
      if (approvals.length > 0 && !isExpanded) {
        isExpanded = true;
      }
    } catch (error) {
      console.error('[ApprovalBox] Failed to fetch approvals:', error);
    }
  }

  // Approve code change
  async function approve() {
    if (!currentApproval || isApproving) return;

    isApproving = true;
    try {
      const res = await fetch(`/api/code-approvals/${currentApproval.id}/approve`, {
        method: 'POST',
      });

      if (res.ok) {
        // Remove from list
        approvals = approvals.filter(a => a.id !== currentApproval.id);
        if (currentIndex >= approvals.length) {
          currentIndex = Math.max(0, approvals.length - 1);
        }
        // Collapse if no more approvals
        if (approvals.length === 0) {
          isExpanded = false;
        }
      } else {
        const error = await res.json();
        alert(`Failed to approve: ${error.error}`);
      }
    } catch (error) {
      console.error('[ApprovalBox] Failed to approve:', error);
      alert('Failed to approve code change');
    } finally {
      isApproving = false;
    }
  }

  // Reject code change
  async function reject() {
    if (!currentApproval || isApproving) return;

    isApproving = true;
    try {
      const res = await fetch(`/api/code-approvals/${currentApproval.id}/reject`, {
        method: 'POST',
      });

      if (res.ok) {
        // Remove from list
        approvals = approvals.filter(a => a.id !== currentApproval.id);
        if (currentIndex >= approvals.length) {
          currentIndex = Math.max(0, approvals.length - 1);
        }
        // Collapse if no more approvals
        if (approvals.length === 0) {
          isExpanded = false;
        }
      } else {
        const error = await res.json();
        alert(`Failed to reject: ${error.error}`);
      }
    } catch (error) {
      console.error('[ApprovalBox] Failed to reject:', error);
      alert('Failed to reject code change');
    } finally {
      isApproving = false;
    }
  }

  // Navigate between approvals
  function previous() {
    if (currentIndex > 0) {
      currentIndex--;
    }
  }

  function next() {
    if (currentIndex < approvals.length - 1) {
      currentIndex++;
    }
  }

  // Toggle expansion
  function toggleExpand() {
    isExpanded = !isExpanded;
  }

  // Format file path for display
  function formatPath(path: string): string {
    // Remove leading /home/greggles/metahuman/ if present
    return path.replace(/^\/home\/[^/]+\/metahuman\//, '');
  }

  // Lifecycle
  onMount(() => {
    fetchApprovals();
    // Poll every 5 seconds for new approvals
    pollInterval = setInterval(fetchApprovals, 5000) as unknown as number;
  });

  onDestroy(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }
  });
</script>

{#if hasApprovals}
  <div class="approval-box" class:expanded={isExpanded}>
    <!-- Collapsed header -->
    {#if !isExpanded}
      <div class="approval-header collapsed" on:click={toggleExpand}>
        <div class="header-left">
          <span class="icon">⚡</span>
          <span class="title">Code Change Pending Approval</span>
          <span class="badge">{approvals.length}</span>
        </div>
        <button class="expand-btn" aria-label="Expand">▲</button>
      </div>
    {/if}

    <!-- Expanded content -->
    {#if isExpanded && currentApproval}
      <div class="approval-content">
        <!-- Header with navigation -->
        <div class="approval-header">
          <div class="header-left">
            <span class="icon">⚡</span>
            <span class="title">Code Change</span>
            {#if approvals.length > 1}
              <span class="counter">{currentIndex + 1} / {approvals.length}</span>
            {/if}
          </div>
          <div class="header-right">
            {#if approvals.length > 1}
              <button class="nav-btn" on:click={previous} disabled={currentIndex === 0}>◀</button>
              <button class="nav-btn" on:click={next} disabled={currentIndex === approvals.length - 1}>▶</button>
            {/if}
            <button class="collapse-btn" on:click={toggleExpand} aria-label="Collapse">▼</button>
          </div>
        </div>

        <!-- File info -->
        <div class="file-info">
          <div class="file-path">{formatPath(currentApproval.filePath)}</div>
          <div class="explanation">{currentApproval.explanation}</div>
        </div>

        <!-- Code preview -->
        <div class="code-preview">
          {#if currentApproval.preview || currentApproval.newContent}
            <pre><code>{currentApproval.preview || currentApproval.newContent}</code></pre>
          {:else if currentApproval.patch}
            <pre><code>{currentApproval.patch}</code></pre>
          {:else}
            <div class="no-preview">No preview available</div>
          {/if}
        </div>

        <!-- Test commands -->
        {#if currentApproval.testCommands && currentApproval.testCommands.length > 0}
          <div class="test-commands">
            <div class="test-label">Suggested tests:</div>
            {#each currentApproval.testCommands as cmd}
              <code class="test-cmd">{cmd}</code>
            {/each}
          </div>
        {/if}

        <!-- Action buttons -->
        <div class="approval-actions">
          <button
            class="btn btn-reject"
            on:click={reject}
            disabled={isApproving}
          >
            Reject
          </button>
          <button
            class="btn btn-approve"
            on:click={approve}
            disabled={isApproving}
          >
            {isApproving ? 'Applying...' : 'Approve & Apply'}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .approval-box {
    background: var(--approval-bg, #f8f9fa);
    border: 1px solid var(--approval-border, #dee2e6);
    border-radius: 8px;
    margin-bottom: 12px;
    overflow: hidden;
    transition: all 0.2s ease;
  }

  :global(.dark) .approval-box {
    --approval-bg: #1e1e1e;
    --approval-border: #333;
  }

  .approval-box.expanded {
    max-height: 500px;
  }

  .approval-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--header-bg, #e9ecef);
    cursor: pointer;
    user-select: none;
  }

  :global(.dark) .approval-header {
    --header-bg: #2a2a2a;
  }

  .approval-header.collapsed:hover {
    background: var(--header-hover, #dee2e6);
  }

  :global(.dark) .approval-header.collapsed:hover {
    --header-hover: #333;
  }

  .header-left, .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .icon {
    font-size: 18px;
  }

  .title {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary, #212529);
  }

  :global(.dark) .title {
    --text-primary: #e0e0e0;
  }

  .badge {
    background: var(--badge-bg, #6366f1);
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
  }

  .counter {
    font-size: 13px;
    color: var(--text-secondary, #6c757d);
  }

  :global(.dark) .counter {
    --text-secondary: #999;
  }

  .expand-btn, .collapse-btn, .nav-btn {
    background: transparent;
    border: none;
    color: var(--btn-color, #6c757d);
    cursor: pointer;
    padding: 4px 8px;
    font-size: 12px;
  }

  :global(.dark) .expand-btn, :global(.dark) .collapse-btn, :global(.dark) .nav-btn {
    --btn-color: #999;
  }

  .expand-btn:hover, .collapse-btn:hover, .nav-btn:hover:not(:disabled) {
    color: var(--btn-hover, #495057);
  }

  :global(.dark) .expand-btn:hover, :global(.dark) .collapse-btn:hover, :global(.dark) .nav-btn:hover:not(:disabled) {
    --btn-hover: #ccc;
  }

  .nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .approval-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .file-info {
    padding: 0 16px;
  }

  .file-path {
    font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    font-size: 13px;
    color: var(--path-color, #6366f1);
    font-weight: 600;
  }

  :global(.dark) .file-path {
    --path-color: #818cf8;
  }

  .explanation {
    margin-top: 4px;
    font-size: 14px;
    color: var(--text-secondary, #6c757d);
  }

  .code-preview {
    max-height: 300px;
    overflow-y: auto;
    background: var(--code-bg, #f1f3f5);
    border: 1px solid var(--code-border, #dee2e6);
    border-radius: 4px;
    margin: 0 16px;
  }

  :global(.dark) .code-preview {
    --code-bg: #1a1a1a;
    --code-border: #333;
  }

  .code-preview pre {
    margin: 0;
    padding: 12px;
    font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.5;
    color: var(--code-text, #212529);
  }

  :global(.dark) .code-preview pre {
    --code-text: #e0e0e0;
  }

  .code-preview code {
    white-space: pre;
    word-wrap: normal;
  }

  .no-preview {
    padding: 20px;
    text-align: center;
    color: var(--text-secondary, #6c757d);
    font-style: italic;
  }

  .test-commands {
    padding: 0 16px;
    font-size: 13px;
  }

  .test-label {
    color: var(--text-secondary, #6c757d);
    margin-bottom: 6px;
  }

  .test-cmd {
    display: block;
    background: var(--cmd-bg, #f1f3f5);
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 4px;
    font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    font-size: 12px;
  }

  :global(.dark) .test-cmd {
    --cmd-bg: #2a2a2a;
  }

  .approval-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 16px;
    border-top: 1px solid var(--approval-border, #dee2e6);
  }

  .btn {
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-reject {
    background: var(--reject-bg, #e9ecef);
    color: var(--reject-text, #495057);
  }

  :global(.dark) .btn-reject {
    --reject-bg: #2a2a2a;
    --reject-text: #ccc;
  }

  .btn-reject:hover:not(:disabled) {
    background: var(--reject-hover, #dee2e6);
  }

  :global(.dark) .btn-reject:hover:not(:disabled) {
    --reject-hover: #333;
  }

  .btn-approve {
    background: var(--approve-bg, #6366f1);
    color: white;
  }

  .btn-approve:hover:not(:disabled) {
    background: var(--approve-hover, #4f46e5);
  }
</style>
