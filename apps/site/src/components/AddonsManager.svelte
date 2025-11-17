<script lang="ts">
  import { onMount } from 'svelte';

  interface Addon {
    id: string;
    name: string;
    description: string;
    category: string;
    enabled: boolean;
    installed: boolean;
    size: string;
    requirements: Record<string, string>;
    dependencies: {
      pip?: string[];
      system?: string[];
    };
    installation?: {
      script?: string;
      commands?: string[];
    };
    note?: string;
  }

  interface AddonCategory {
    name: string;
    description: string;
  }

  let addons: Record<string, Addon> = {};
  let categories: Record<string, AddonCategory> = {};
  let loading = true;
  let error: string | null = null;
  let installing: Record<string, boolean> = {};
  let toggling: Record<string, boolean> = {};
  let selectedCategory: string | null = null;

  // Installation progress modal
  let showInstallModal = false;
  let installLogs: Array<{ level: string; message: string; timestamp: Date }> = [];
  let currentInstallAddon: string | null = null;

  onMount(async () => {
    await loadAddons();
  });

  async function loadAddons() {
    try {
      loading = true;
      const response = await fetch('/api/addons');
      if (!response.ok) throw new Error('Failed to load addons');

      const data = await response.json();
      // Force Svelte reactivity by creating new object reference
      addons = { ...data.addons } || {};
      categories = { ...data.categories } || {};
      error = null;
    } catch (e) {
      error = String(e);
      console.error('[AddonsManager] Error loading addons:', e);
    } finally {
      loading = false;
    }
  }

  async function installAddon(addonId: string) {
    if (!confirm(`Install ${addons[addonId].name}?\n\nThis will download and configure the addon. Installation may take several minutes.`)) {
      return;
    }

    try {
      // Show modal and reset logs
      currentInstallAddon = addonId;
      installLogs = [];
      showInstallModal = true;
      installing = { ...installing, [addonId]: true };

      // Map addon to installation script
      const scriptMap: Record<string, { script: string; args: string[] }> = {
        'kokoro': { script: 'bin/install-kokoro.sh', args: ['--yes'] },
        'gpt-sovits': { script: 'bin/install-sovits.sh', args: [] },
        'rvc': { script: 'bin/install-rvc.sh', args: [] },
      };

      const installConfig = scriptMap[addonId];
      if (!installConfig) {
        throw new Error(`No installation script configured for ${addonId}`);
      }

      // Use universal process streaming endpoint
      const response = await fetch('/api/process-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'bash',
          args: [installConfig.script, ...installConfig.args],
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start installation stream');
      }

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          const [eventLine, dataLine] = line.split('\n');
          if (!eventLine || !dataLine) continue;

          const event = eventLine.replace('event: ', '').trim();
          const dataStr = dataLine.replace('data: ', '').trim();

          try {
            const data = JSON.parse(dataStr);

            if (event === 'start') {
              installLogs = [...installLogs, { level: 'info', message: data.message, timestamp: new Date() }];
            } else if (event === 'log') {
              installLogs = [...installLogs, { level: data.level, message: data.message, timestamp: new Date() }];

              // Auto-scroll to bottom
              setTimeout(() => {
                const logContainer = document.querySelector('.install-logs');
                if (logContainer) {
                  logContainer.scrollTop = logContainer.scrollHeight;
                }
              }, 10);
            } else if (event === 'complete') {
              installLogs = [...installLogs, {
                level: data.success ? 'info' : 'error',
                message: data.success ? data.message : data.error,
                timestamp: new Date()
              }];
              installing = { ...installing, [addonId]: false };

              // Mark as installed and reload addon status after success
              if (data.success) {
                // Update etc/addons.json
                await fetch('/api/addons/mark-installed', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ addonId, installed: true }),
                }).catch(err => console.error('Failed to mark addon as installed:', err));

                // Reload addon list
                await loadAddons();
              }
              break; // Exit while loop
            } else if (event === 'error') {
              installLogs = [...installLogs, { level: 'error', message: data.message, timestamp: new Date() }];
              installing = { ...installing, [addonId]: false };
              break; // Exit while loop
            }
          } catch (parseError) {
            console.error('[AddonsManager] Failed to parse SSE data:', parseError);
          }
        }
      }

    } catch (e) {
      error = `Installation failed: ${String(e)}`;
      console.error('[AddonsManager] Install error:', e);
      installing = { ...installing, [addonId]: false };
      showInstallModal = false;
    }
  }

  function closeInstallModal() {
    showInstallModal = false;
    currentInstallAddon = null;
    installLogs = [];
  }

  async function uninstallAddon(addonId: string) {
    if (!confirm(`Uninstall ${addons[addonId].name}?\n\nThis will remove the addon and its data.`)) {
      return;
    }

    try {
      // Trigger Svelte reactivity with object reassignment
      installing = { ...installing, [addonId]: true };

      const response = await fetch('/api/addons/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addonId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Uninstallation failed');
      }

      await loadAddons();
    } catch (e) {
      error = `Uninstallation failed: ${String(e)}`;
      console.error('[AddonsManager] Uninstall error:', e);
    } finally {
      // Trigger Svelte reactivity with object reassignment
      installing = { ...installing, [addonId]: false };
    }
  }

  async function toggleAddon(addonId: string) {
    try {
      // Trigger Svelte reactivity with object reassignment
      toggling = { ...toggling, [addonId]: true };
      const newState = !addons[addonId].enabled;

      const response = await fetch('/api/addons/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addonId, enabled: newState }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Toggle failed');
      }

      await loadAddons();
    } catch (e) {
      error = `Toggle failed: ${String(e)}`;
      console.error('[AddonsManager] Toggle error:', e);
    } finally {
      // Trigger Svelte reactivity with object reassignment
      toggling = { ...toggling, [addonId]: false };
    }
  }

  function getAddonsByCategory(categoryId: string | null): [string, Addon][] {
    const entries = Object.entries(addons);
    if (!categoryId) return entries;
    return entries.filter(([_, addon]) => addon.category === categoryId);
  }

  $: filteredAddons = getAddonsByCategory(selectedCategory);
</script>

<div class="addons-manager">
  <div class="header">
    <h2>Addons</h2>
    <p class="subtitle">Extend MetaHuman with optional features. Install only what you need to keep the system lightweight.</p>
  </div>

  {#if error}
    <div class="error-message">{error}</div>
  {/if}

  {#if loading}
    <div class="loading">Loading addons...</div>
  {:else}
    <!-- Category filter -->
    <div class="category-filter">
      <button
        class="category-btn"
        class:active={selectedCategory === null}
        on:click={() => (selectedCategory = null)}
      >
        All Addons
      </button>
      {#each Object.entries(categories) as [catId, category]}
        <button
          class="category-btn"
          class:active={selectedCategory === catId}
          on:click={() => (selectedCategory = catId)}
        >
          {category.name}
        </button>
      {/each}
    </div>

    <!-- Addons grid -->
    <div class="addons-grid">
      {#each filteredAddons as [addonId, addon]}
        <div class="addon-card" class:installed={addon.installed}>
          <div class="addon-header">
            <div class="addon-title">
              <h3>{addon.name}</h3>
              <span class="addon-category">{categories[addon.category]?.name || addon.category}</span>
            </div>
            <div class="addon-status">
              {#if addon.installed}
                <span class="status-badge installed">Installed</span>
                {#if addon.enabled}
                  <span class="status-badge enabled">Enabled</span>
                {:else}
                  <span class="status-badge disabled">Disabled</span>
                {/if}
              {:else}
                <span class="status-badge not-installed">Not Installed</span>
              {/if}
            </div>
          </div>

          <p class="addon-description">{addon.description}</p>

          {#if addon.note}
            <div class="addon-note">ℹ️ {addon.note}</div>
          {/if}

          <div class="addon-details">
            <div class="detail-item">
              <span class="detail-label">Size:</span>
              <span class="detail-value">{addon.size}</span>
            </div>
            {#if addon.requirements.python}
              <div class="detail-item">
                <span class="detail-label">Python:</span>
                <span class="detail-value">{addon.requirements.python}</span>
              </div>
            {/if}
            {#if addon.requirements.gpu}
              <div class="detail-item">
                <span class="detail-label">GPU:</span>
                <span class="detail-value">{addon.requirements.gpu}</span>
              </div>
            {/if}
            {#if addon.requirements.vram}
              <div class="detail-item">
                <span class="detail-label">VRAM:</span>
                <span class="detail-value">{addon.requirements.vram}</span>
              </div>
            {/if}
          </div>

          {#if addon.dependencies?.pip && addon.dependencies.pip.length > 0}
            <div class="addon-dependencies">
              <strong>Python packages:</strong>
              <div class="deps-list">
                {#each addon.dependencies.pip as dep}
                  <code class="dep-tag">{dep}</code>
                {/each}
              </div>
            </div>
          {/if}

          <div class="addon-actions">
            {#if addon.installed}
              <button
                class="btn btn-toggle"
                class:enabled={addon.enabled}
                on:click={() => toggleAddon(addonId)}
                disabled={toggling[addonId]}
              >
                {toggling[addonId] ? 'Updating...' : addon.enabled ? '✓ Enabled' : 'Enable'}
              </button>
              <button
                class="btn btn-secondary"
                on:click={() => uninstallAddon(addonId)}
                disabled={installing[addonId]}
              >
                {installing[addonId] ? 'Uninstalling...' : 'Uninstall'}
              </button>
            {:else}
              <button
                class="btn btn-primary"
                on:click={() => installAddon(addonId)}
                disabled={installing[addonId]}
              >
                {installing[addonId] ? 'Installing...' : 'Install'}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    {#if filteredAddons.length === 0}
      <div class="empty-state">
        <p>No addons found in this category.</p>
      </div>
    {/if}
  {/if}

  <!-- Installation Progress Modal -->
  {#if showInstallModal && currentInstallAddon}
    <div class="modal-overlay" on:click={closeInstallModal}>
      <div class="modal-content" on:click|stopPropagation>
        <div class="modal-header">
          <h3>Installing {addons[currentInstallAddon]?.name || currentInstallAddon}</h3>
          <button class="close-btn" on:click={closeInstallModal}>×</button>
        </div>

        <div class="install-logs">
          {#each installLogs as log}
            <div class="log-entry log-{log.level}">
              <span class="log-time">{log.timestamp.toLocaleTimeString()}</span>
              <span class="log-message">{log.message}</span>
            </div>
          {/each}
          {#if installLogs.length === 0}
            <div class="log-placeholder">Waiting for installation to start...</div>
          {/if}
        </div>

        <div class="modal-footer">
          {#if installing[currentInstallAddon]}
            <div class="installing-indicator">
              <span class="spinner">⏳</span> Installation in progress...
            </div>
          {:else}
            <button class="btn btn-primary" on:click={closeInstallModal}>Close</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .addons-manager {
    padding: 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
  }

  .header {
    margin-bottom: 2rem;
  }

  .header h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.75rem;
    color: #1f2937;
  }

  :global(.dark) .header h2 {
    color: #f3f4f6;
  }

  .subtitle {
    margin: 0;
    color: #6b7280;
    font-size: 0.95rem;
  }

  :global(.dark) .subtitle {
    color: #9ca3af;
  }

  .category-filter {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .category-btn {
    padding: 0.5rem 1rem;
    border: 2px solid #d1d5db;
    border-radius: 0.375rem;
    background: white;
    color: #6b7280;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(.dark) .category-btn {
    background: #1f2937;
    border-color: #374151;
    color: #9ca3af;
  }

  .category-btn:hover {
    border-color: #7c3aed;
    color: #7c3aed;
  }

  .category-btn.active {
    border-color: #7c3aed;
    background: #7c3aed;
    color: white;
  }

  .addons-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 1.5rem;
  }

  .addon-card {
    border: 2px solid #e5e7eb;
    border-radius: 0.75rem;
    padding: 1.5rem;
    background: white;
    transition: all 0.2s;
  }

  :global(.dark) .addon-card {
    background: #1f2937;
    border-color: #374151;
  }

  .addon-card:hover {
    border-color: #7c3aed;
    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.1);
  }

  .addon-card.installed {
    border-color: #10b981;
  }

  :global(.dark) .addon-card.installed {
    border-color: #059669;
  }

  .addon-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1rem;
  }

  .addon-title h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1.25rem;
    color: #1f2937;
  }

  :global(.dark) .addon-title h3 {
    color: #f3f4f6;
  }

  .addon-category {
    font-size: 0.75rem;
    color: #7c3aed;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .status-badge {
    padding: 0.25rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .status-badge.installed {
    background: #d1fae5;
    color: #065f46;
  }

  :global(.dark) .status-badge.installed {
    background: #064e3b;
    color: #6ee7b7;
  }

  .status-badge.not-installed {
    background: #e5e7eb;
    color: #6b7280;
  }

  :global(.dark) .status-badge.not-installed {
    background: #374151;
    color: #9ca3af;
  }

  .status-badge.enabled {
    background: #dbeafe;
    color: #1e40af;
  }

  :global(.dark) .status-badge.enabled {
    background: #1e3a8a;
    color: #93c5fd;
  }

  .status-badge.disabled {
    background: #fef3c7;
    color: #92400e;
  }

  :global(.dark) .status-badge.disabled {
    background: #78350f;
    color: #fcd34d;
  }

  .addon-status {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .addon-description {
    margin: 0 0 1rem 0;
    color: #4b5563;
    font-size: 0.95rem;
    line-height: 1.5;
  }

  :global(.dark) .addon-description {
    color: #d1d5db;
  }

  .addon-note {
    padding: 0.75rem;
    background: #fef3c7;
    border-radius: 0.375rem;
    color: #92400e;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .addon-note {
    background: #451a03;
    color: #fcd34d;
  }

  .addon-details {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: #f9fafb;
    border-radius: 0.375rem;
  }

  :global(.dark) .addon-details {
    background: #111827;
  }

  .detail-item {
    display: flex;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .detail-label {
    color: #6b7280;
    font-weight: 600;
  }

  :global(.dark) .detail-label {
    color: #9ca3af;
  }

  .detail-value {
    color: #1f2937;
  }

  :global(.dark) .detail-value {
    color: #f3f4f6;
  }

  .addon-dependencies {
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .addon-dependencies strong {
    display: block;
    margin-bottom: 0.5rem;
    color: #4b5563;
  }

  :global(.dark) .addon-dependencies strong {
    color: #d1d5db;
  }

  .deps-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .dep-tag {
    padding: 0.25rem 0.5rem;
    background: #e0e7ff;
    color: #4338ca;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-family: 'Courier New', monospace;
  }

  :global(.dark) .dep-tag {
    background: #312e81;
    color: #c7d2fe;
  }

  .addon-actions {
    display: flex;
    gap: 0.75rem;
  }

  .btn {
    flex: 1;
    padding: 0.625rem 1rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #7c3aed;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #6d28d9;
  }

  .btn-secondary {
    background: #e5e7eb;
    color: #4b5563;
  }

  :global(.dark) .btn-secondary {
    background: #374151;
    color: #d1d5db;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #d1d5db;
  }

  :global(.dark) .btn-secondary:hover:not(:disabled) {
    background: #4b5563;
  }

  .btn-toggle {
    background: #e5e7eb;
    color: #4b5563;
  }

  :global(.dark) .btn-toggle {
    background: #374151;
    color: #d1d5db;
  }

  .btn-toggle.enabled {
    background: #10b981;
    color: white;
  }

  .btn-toggle:hover:not(:disabled) {
    background: #059669;
    color: white;
  }

  .loading,
  .empty-state {
    text-align: center;
    padding: 3rem;
    color: #6b7280;
  }

  :global(.dark) .loading,
  :global(.dark) .empty-state {
    color: #9ca3af;
  }

  .error-message {
    padding: 1rem;
    background: #fee2e2;
    color: #991b1b;
    border-radius: 0.375rem;
    margin-bottom: 1.5rem;
  }

  :global(.dark) .error-message {
    background: #7f1d1d;
    color: #fecaca;
  }

  /* Installation Progress Modal */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: white;
    border-radius: 0.75rem;
    width: 90%;
    max-width: 800px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .modal-content {
    background: #1f2937;
  }

  .modal-header {
    padding: 1.5rem;
    border-bottom: 2px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  :global(.dark) .modal-header {
    border-bottom-color: #374151;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.25rem;
    color: #1f2937;
  }

  :global(.dark) .modal-header h3 {
    color: #f3f4f6;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 2rem;
    line-height: 1;
    color: #6b7280;
    cursor: pointer;
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    color: #1f2937;
  }

  :global(.dark) .close-btn:hover {
    color: #f3f4f6;
  }

  .install-logs {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    background: #f9fafb;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.875rem;
    max-height: 500px;
  }

  :global(.dark) .install-logs {
    background: #111827;
  }

  .log-entry {
    padding: 0.5rem;
    margin-bottom: 0.25rem;
    border-radius: 0.25rem;
    display: flex;
    gap: 0.75rem;
  }

  .log-entry.log-info {
    background: #eff6ff;
    color: #1e40af;
  }

  :global(.dark) .log-entry.log-info {
    background: #1e3a8a;
    color: #93c5fd;
  }

  .log-entry.log-error {
    background: #fee2e2;
    color: #991b1b;
  }

  :global(.dark) .log-entry.log-error {
    background: #7f1d1d;
    color: #fecaca;
  }

  .log-time {
    flex-shrink: 0;
    opacity: 0.7;
    font-weight: 600;
  }

  .log-message {
    flex: 1;
    word-break: break-word;
  }

  .log-placeholder {
    text-align: center;
    padding: 3rem;
    color: #6b7280;
    font-style: italic;
  }

  :global(.dark) .log-placeholder {
    color: #9ca3af;
  }

  .modal-footer {
    padding: 1.5rem;
    border-top: 2px solid #e5e7eb;
    display: flex;
    justify-content: center;
  }

  :global(.dark) .modal-footer {
    border-top-color: #374151;
  }

  .installing-indicator {
    color: #7c3aed;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .spinner {
    animation: spin 2s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
