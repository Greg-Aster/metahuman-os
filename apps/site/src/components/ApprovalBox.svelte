<script lang="ts">
  /**
   * ApprovalBox Component
   * Displays code change approvals above chat input
   * Similar to Claude Code, Cursor, Windsurf approval UIs
   */

  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { codeToHtml } from 'shiki';
  import { isOwner } from '../stores/security-policy';

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
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let highlightedCode: string = '';
  let isEditing = false;
  let editedCode: string = '';

  // Get current approval
  $: currentApproval = approvals[currentIndex];
  $: hasApprovals = approvals.length > 0;

  // Highlight code when approval changes
  $: if (currentApproval) {
    highlightCode(currentApproval);
    editedCode = currentApproval.preview || currentApproval.newContent || currentApproval.patch || '';
  }

  // Fetch pending approvals
  async function fetchApprovals() {
    if (!get(isOwner)) {
      approvals = [];
      isExpanded = false;
      return;
    }
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
    if (!get(isOwner)) return;
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
    if (!get(isOwner)) return;
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

  // Toggle editing mode
  function toggleEdit() {
    isEditing = !isEditing;
    if (!isEditing && currentApproval) {
      // Reset to original when canceling edit
      editedCode = currentApproval.preview || currentApproval.newContent || currentApproval.patch || '';
    }
  }

  // Save edited code
  function saveEdit() {
    if (!currentApproval) return;
    // Update the approval with edited code
    if (currentApproval.newContent) {
      currentApproval.newContent = editedCode;
    } else if (currentApproval.patch) {
      currentApproval.patch = editedCode;
    } else if (currentApproval.preview) {
      currentApproval.preview = editedCode;
    }
    isEditing = false;
    highlightCode(currentApproval);
  }

  // Format file path for display
  function formatPath(path: string): string {
    // Remove leading /home/greggles/metahuman/ if present
    return path.replace(/^\/home\/[^/]+\/metahuman\//, '');
  }

  // Highlight code with Shiki
  async function highlightCode(approval: CodeApproval) {
    try {
      const code = approval.preview || approval.newContent || approval.patch || '';
      if (!code) {
        highlightedCode = '';
        return;
      }

      // Detect language from file extension
      const ext = approval.filePath.split('.').pop() || 'txt';
      const langMap: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'typescript',
        'js': 'javascript',
        'jsx': 'javascript',
        'json': 'json',
        'md': 'markdown',
        'py': 'python',
        'rs': 'rust',
        'go': 'go',
        'java': 'java',
        'c': 'c',
        'cpp': 'cpp',
        'css': 'css',
        'html': 'html',
        'xml': 'xml',
        'yaml': 'yaml',
        'yml': 'yaml',
        'sh': 'bash',
      };
      const lang = langMap[ext] || 'typescript';

      highlightedCode = await codeToHtml(code, {
        lang,
        theme: document.documentElement.classList.contains('dark') ? 'github-dark' : 'github-light',
      });
    } catch (error) {
      console.error('[ApprovalBox] Failed to highlight code:', error);
      highlightedCode = '';
    }
  }

  // Lifecycle
  onMount(() => {
    fetchApprovals();
    // Poll every 5 seconds for new approvals
    pollInterval = setInterval(fetchApprovals, 5000) as unknown as number;
  });

</script>

{#if $isOwner && hasApprovals}
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
        <div class="approval-header-expanded">
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

        <!-- Code preview/editor -->
        <div class="code-container">
          <div class="code-toolbar">
            <button class="edit-btn" on:click={toggleEdit}>
              {isEditing ? '👁️ Preview' : '✏️ Edit'}
            </button>
            {#if isEditing}
              <button class="save-btn" on:click={saveEdit}>💾 Save</button>
            {/if}
          </div>

          <div class="code-preview">
            {#if isEditing}
              <textarea
                class="code-editor"
                bind:value={editedCode}
                spellcheck="false"
              ></textarea>
            {:else if highlightedCode}
              {@html highlightedCode}
            {:else if currentApproval.preview || currentApproval.newContent || currentApproval.patch}
              <pre><code>{currentApproval.preview || currentApproval.newContent || currentApproval.patch}</code></pre>
            {:else}
              <div class="no-preview">No preview available</div>
            {/if}
          </div>
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

        <!-- Footer with action buttons -->
        <div class="approval-footer">
          <button
            class="btn btn-reject"
            on:click={reject}
            disabled={isApproving}
          >
            ✗ Reject
          </button>
          <button
            class="btn btn-approve"
            on:click={approve}
            disabled={isApproving}
          >
            {isApproving ? '⏳ Applying...' : '✓ Approve & Apply'}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .approval-box {
    background: var(--approval-bg, rgba(99, 102, 241, 0.05));
    border: 1px solid var(--approval-border, rgba(99, 102, 241, 0.2));
    border-radius: 12px;
    margin-bottom: 12px;
    overflow: hidden;
    transition: all 0.3s ease;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.1);
  }

  :global(.dark) .approval-box {
    --approval-bg: rgba(99, 102, 241, 0.08);
    --approval-border: rgba(99, 102, 241, 0.25);
  }

  .approval-box.expanded {
    max-height: 80vh;
    display: flex;
    flex-direction: column;
  }

  .approval-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--header-bg, rgba(99, 102, 241, 0.08));
    cursor: pointer;
    user-select: none;
    border-radius: 8px;
  }

  .approval-header-expanded {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--header-bg, rgba(99, 102, 241, 0.08));
    border-radius: 8px 8px 0 0;
    flex-shrink: 0;
  }

  :global(.dark) .approval-header,
  :global(.dark) .approval-header-expanded {
    --header-bg: rgba(99, 102, 241, 0.12);
  }

  .approval-header.collapsed:hover {
    background: var(--header-hover, rgba(99, 102, 241, 0.12));
  }

  :global(.dark) .approval-header.collapsed:hover {
    --header-hover: rgba(99, 102, 241, 0.18);
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
    gap: 0;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .file-info {
    padding: 12px 16px;
    flex-shrink: 0;
  }

  .code-container {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .code-toolbar {
    display: flex;
    gap: 8px;
    padding: 8px 16px;
    background: var(--toolbar-bg, rgba(99, 102, 241, 0.05));
    border-top: 1px solid var(--approval-border, rgba(99, 102, 241, 0.2));
    border-bottom: 1px solid var(--approval-border, rgba(99, 102, 241, 0.2));
    flex-shrink: 0;
  }

  :global(.dark) .code-toolbar {
    --toolbar-bg: rgba(99, 102, 241, 0.08);
  }

  .edit-btn,
  .save-btn {
    padding: 4px 12px;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    background: var(--btn-bg, rgba(99, 102, 241, 0.1));
    color: var(--btn-color, #6366f1);
    transition: all 0.2s;
  }

  :global(.dark) .edit-btn,
  :global(.dark) .save-btn {
    --btn-bg: rgba(99, 102, 241, 0.15);
    --btn-color: #818cf8;
  }

  .edit-btn:hover,
  .save-btn:hover {
    background: var(--btn-hover, rgba(99, 102, 241, 0.2));
  }

  .save-btn {
    background: var(--save-bg, #10b981);
    color: white;
  }

  .save-btn:hover {
    background: var(--save-hover, #059669);
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
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;
    background: var(--code-bg, #ffffff);
    margin: 0;
    min-height: 200px;
    max-height: 400px;
  }

  :global(.dark) .code-preview {
    --code-bg: #0d1117;
  }

  .code-editor {
    width: 100%;
    height: 100%;
    min-height: 300px;
    padding: 16px;
    font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.6;
    background: var(--code-bg, #ffffff);
    color: var(--code-text, #24292f);
    border: none;
    resize: vertical;
    outline: none;
  }

  :global(.dark) .code-editor {
    --code-bg: #0d1117;
    --code-text: #c9d1d9;
  }

  .code-preview pre {
    margin: 0;
    padding: 16px;
    font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.6;
    color: var(--code-text, #24292f);
  }

  :global(.dark) .code-preview pre {
    --code-text: #c9d1d9;
  }

  /* Shiki syntax highlighting overrides */
  .code-preview :global(pre) {
    background: transparent !important;
    margin: 0;
    padding: 16px;
  }

  .code-preview :global(code) {
    font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.6;
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
    padding: 12px 16px;
    font-size: 13px;
    flex-shrink: 0;
    background: var(--test-bg, rgba(99, 102, 241, 0.03));
    border-top: 1px solid var(--approval-border, rgba(99, 102, 241, 0.15));
  }

  :global(.dark) .test-commands {
    --test-bg: rgba(99, 102, 241, 0.05);
  }

  .test-label {
    color: var(--text-secondary, #6c757d);
    margin-bottom: 6px;
    font-weight: 600;
  }

  .test-cmd {
    display: block;
    background: var(--cmd-bg, rgba(99, 102, 241, 0.08));
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 4px;
    font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    font-size: 12px;
  }

  :global(.dark) .test-cmd {
    --cmd-bg: rgba(99, 102, 241, 0.12);
  }

  .approval-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: var(--footer-bg, rgba(99, 102, 241, 0.05));
    border-top: 1px solid var(--approval-border, rgba(99, 102, 241, 0.2));
    border-radius: 0 0 12px 12px;
    flex-shrink: 0;
  }

  :global(.dark) .approval-footer {
    --footer-bg: rgba(99, 102, 241, 0.08);
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-reject {
    background: var(--reject-bg, rgba(239, 68, 68, 0.1));
    color: var(--reject-text, #ef4444);
    border: 1px solid var(--reject-border, rgba(239, 68, 68, 0.3));
  }

  :global(.dark) .btn-reject {
    --reject-bg: rgba(239, 68, 68, 0.15);
    --reject-text: #f87171;
    --reject-border: rgba(239, 68, 68, 0.4);
  }

  .btn-reject:hover:not(:disabled) {
    background: var(--reject-hover, rgba(239, 68, 68, 0.15));
    border-color: var(--reject-border-hover, rgba(239, 68, 68, 0.5));
  }

  :global(.dark) .btn-reject:hover:not(:disabled) {
    --reject-hover: rgba(239, 68, 68, 0.2);
    --reject-border-hover: rgba(239, 68, 68, 0.6);
  }

  .btn-approve {
    background: var(--approve-bg, #10b981);
    color: white;
    border: 1px solid var(--approve-border, #059669);
  }

  :global(.dark) .btn-approve {
    --approve-bg: #10b981;
    --approve-border: #059669;
  }

  .btn-approve:hover:not(:disabled) {
    background: var(--approve-hover, #059669);
    border-color: var(--approve-border-hover, #047857);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }
</style>
