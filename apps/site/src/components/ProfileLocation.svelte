<script lang="ts">
  import { onMount } from 'svelte';

  interface EncryptionInfo {
    algorithm: string;
    createdAt: string;
    encryptedFiles: number;
    passwordMode: 'user' | 'separate';
  }

  interface ProfileConfig {
    path: string;
    isEncrypted: boolean;
    passwordMode: 'user' | 'separate' | null;
    encryptionInfo: EncryptionInfo | null;
  }

  let profileConfig: ProfileConfig | null = null;
  let loading = true;
  let error = '';

  // Encrypt modal state
  let showEncryptModal = false;
  let encryptPassword = '';
  let encryptPasswordConfirm = '';
  let encryptPasswordMode: 'user' | 'separate' = 'user';
  let encryptProgress: { step: string; status: string; message: string; progress?: number } | null = null;
  let encrypting = false;

  // Decrypt modal state
  let showDecryptModal = false;
  let decryptPassword = '';
  let decryptProgress: { step: string; status: string; message: string; progress?: number } | null = null;
  let decrypting = false;

  // Validation
  $: encryptPasswordValid = encryptPassword.length >= 8;
  $: encryptPasswordsMatch = encryptPassword === encryptPasswordConfirm;
  $: canEncrypt = encryptPasswordValid && encryptPasswordsMatch && !encrypting;
  $: canDecrypt = decryptPassword.length >= 8 && !decrypting;

  onMount(async () => {
    await fetchProfileConfig();
  });

  async function fetchProfileConfig() {
    loading = true;
    error = '';
    try {
      const res = await fetch('/api/profile-path');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch profile config');
      }
      profileConfig = await res.json();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function encryptProfile() {
    if (!canEncrypt) return;
    encrypting = true;
    encryptProgress = null;
    error = '';

    try {
      const res = await fetch('/api/profile-path/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: encryptPassword,
          passwordMode: encryptPasswordMode,
        }),
      });

      if (!res.ok && !res.headers.get('content-type')?.includes('event-stream')) {
        const data = await res.json();
        throw new Error(data.error || 'Encryption failed');
      }

      // Handle SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          const lines = text.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              if (data.progress) {
                encryptProgress = data.progress;
              }
              if (data.result) {
                if (data.result.success) {
                  showEncryptModal = false;
                  encryptPassword = '';
                  encryptPasswordConfirm = '';
                  await fetchProfileConfig();
                } else {
                  throw new Error(data.result.error || 'Encryption failed');
                }
              }
            }
          }
        }
      }
    } catch (e) {
      error = (e as Error).message;
      encryptProgress = { step: 'error', status: 'failed', message: (e as Error).message };
    } finally {
      encrypting = false;
    }
  }

  async function decryptProfile() {
    if (!canDecrypt) return;
    decrypting = true;
    decryptProgress = null;
    error = '';

    try {
      const res = await fetch('/api/profile-path/decrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: decryptPassword }),
      });

      if (!res.ok && !res.headers.get('content-type')?.includes('event-stream')) {
        const data = await res.json();
        throw new Error(data.error || 'Decryption failed');
      }

      // Handle SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          const lines = text.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              if (data.progress) {
                decryptProgress = data.progress;
              }
              if (data.result) {
                if (data.result.success) {
                  showDecryptModal = false;
                  decryptPassword = '';
                  await fetchProfileConfig();
                } else {
                  throw new Error(data.result.error || 'Decryption failed');
                }
              }
            }
          }
        }
      }
    } catch (e) {
      error = (e as Error).message;
      decryptProgress = { step: 'error', status: 'failed', message: (e as Error).message };
    } finally {
      decrypting = false;
    }
  }

  function closeEncryptModal() {
    if (!encrypting) {
      showEncryptModal = false;
      encryptPassword = '';
      encryptPasswordConfirm = '';
      encryptProgress = null;
    }
  }

  function closeDecryptModal() {
    if (!decrypting) {
      showDecryptModal = false;
      decryptPassword = '';
      decryptProgress = null;
    }
  }
</script>

<div class="profile-location">
  <h3>Profile Storage</h3>

  {#if loading}
    <div class="loading">Loading profile configuration...</div>
  {:else if error && !profileConfig}
    <div class="error">{error}</div>
  {:else if profileConfig}
    <div class="config-section">
      <div class="config-row">
        <span class="label">Profile Path:</span>
        <code class="value">{profileConfig.path}</code>
      </div>
    </div>

    <div class="encryption-section">
      <h4>Encryption</h4>

      {#if profileConfig.isEncrypted}
        <div class="status-card encrypted">
          <div class="status-header">
            <span class="status-icon">&#x1F512;</span>
            <span class="status-text">Profile Encrypted</span>
          </div>
          <div class="status-details">
            <div class="detail-row">
              <span class="detail-label">Algorithm:</span>
              <span class="detail-value">{profileConfig.encryptionInfo?.algorithm}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Password Mode:</span>
              <span class="detail-value password-mode">
                {#if profileConfig.encryptionInfo?.passwordMode === 'user'}
                  <span class="mode-badge user">Login Password</span>
                {:else}
                  <span class="mode-badge separate">Separate Password</span>
                {/if}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Encrypted:</span>
              <span class="detail-value">{profileConfig.encryptionInfo?.createdAt ? new Date(profileConfig.encryptionInfo.createdAt).toLocaleDateString() : 'Unknown'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Files:</span>
              <span class="detail-value">{profileConfig.encryptionInfo?.encryptedFiles} files</span>
            </div>
          </div>
          <button class="decrypt-btn" on:click={() => showDecryptModal = true}>
            &#x1F513; Decrypt Profile
          </button>
        </div>
      {:else}
        <div class="status-card unencrypted">
          <div class="status-header">
            <span class="status-icon">&#x1F4C1;</span>
            <span class="status-text">Profile Not Encrypted</span>
          </div>
          <p class="status-description">
            Your profile data is stored in plain text. Encrypt it to protect your memories and persona data.
          </p>
          <button class="encrypt-btn" on:click={() => showEncryptModal = true}>
            &#x1F512; Encrypt Profile
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Encrypt Modal -->
{#if showEncryptModal}
  <div class="modal-backdrop" on:click={closeEncryptModal} on:keydown={(e) => e.key === 'Escape' && closeEncryptModal()} role="button" tabindex="0">
    <div class="modal" on:click|stopPropagation role="dialog" aria-modal="true">
      <h3>&#x1F512; Encrypt Profile</h3>

      {#if !encrypting || encryptProgress?.status === 'failed'}
        <div class="form-group">
          <label class="password-mode-label">Password Mode</label>
          <div class="password-mode-options">
            <label class="mode-option">
              <input type="radio" bind:group={encryptPasswordMode} value="user" />
              <div class="mode-content">
                <strong>Use Login Password</strong>
                <span class="mode-desc">Single password for login and encryption (recommended)</span>
              </div>
            </label>
            <label class="mode-option">
              <input type="radio" bind:group={encryptPasswordMode} value="separate" />
              <div class="mode-content">
                <strong>Separate Password</strong>
                <span class="mode-desc">Use a different password for encryption (more secure)</span>
              </div>
            </label>
          </div>
        </div>

        <div class="form-group">
          <label for="encrypt-password">
            {encryptPasswordMode === 'user' ? 'Enter your login password' : 'Enter encryption password'}
          </label>
          <input
            id="encrypt-password"
            type="password"
            bind:value={encryptPassword}
            placeholder={encryptPasswordMode === 'user' ? 'Your login password' : 'Encryption password (min 8 chars)'}
            autocomplete="off"
          />
          {#if encryptPassword && !encryptPasswordValid}
            <span class="validation-error">Password must be at least 8 characters</span>
          {/if}
        </div>

        <div class="form-group">
          <label for="encrypt-password-confirm">Confirm password</label>
          <input
            id="encrypt-password-confirm"
            type="password"
            bind:value={encryptPasswordConfirm}
            placeholder="Confirm password"
            autocomplete="off"
          />
          {#if encryptPasswordConfirm && !encryptPasswordsMatch}
            <span class="validation-error">Passwords do not match</span>
          {/if}
        </div>

        {#if error}
          <div class="error-message">{error}</div>
        {/if}

        <div class="modal-actions">
          <button class="cancel-btn" on:click={closeEncryptModal}>Cancel</button>
          <button class="confirm-btn" disabled={!canEncrypt} on:click={encryptProfile}>
            Encrypt Profile
          </button>
        </div>
      {:else}
        <div class="progress-section">
          <div class="progress-step">
            <span class="step-status" class:completed={encryptProgress?.status === 'completed'} class:running={encryptProgress?.status === 'running'}>
              {encryptProgress?.status === 'completed' ? '&#x2713;' : encryptProgress?.status === 'running' ? '&#x23F3;' : '&#x2022;'}
            </span>
            <span class="step-message">{encryptProgress?.message}</span>
          </div>
          {#if encryptProgress?.progress !== undefined}
            <div class="progress-bar">
              <div class="progress-fill" style="width: {encryptProgress.progress}%"></div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Decrypt Modal -->
{#if showDecryptModal}
  <div class="modal-backdrop" on:click={closeDecryptModal} on:keydown={(e) => e.key === 'Escape' && closeDecryptModal()} role="button" tabindex="0">
    <div class="modal" on:click|stopPropagation role="dialog" aria-modal="true">
      <h3>&#x1F513; Decrypt Profile</h3>

      {#if !decrypting || decryptProgress?.status === 'failed'}
        <div class="form-group">
          <label for="decrypt-password">
            {#if profileConfig?.encryptionInfo?.passwordMode === 'user'}
              Enter your login password
            {:else}
              Enter your encryption password
            {/if}
          </label>
          <input
            id="decrypt-password"
            type="password"
            bind:value={decryptPassword}
            placeholder={profileConfig?.encryptionInfo?.passwordMode === 'user' ? 'Your login password' : 'Encryption password'}
            autocomplete="off"
          />
        </div>

        {#if error}
          <div class="error-message">{error}</div>
        {/if}

        <div class="modal-actions">
          <button class="cancel-btn" on:click={closeDecryptModal}>Cancel</button>
          <button class="confirm-btn" disabled={!canDecrypt} on:click={decryptProfile}>
            Decrypt Profile
          </button>
        </div>
      {:else}
        <div class="progress-section">
          <div class="progress-step">
            <span class="step-status" class:completed={decryptProgress?.status === 'completed'} class:running={decryptProgress?.status === 'running'}>
              {decryptProgress?.status === 'completed' ? '&#x2713;' : decryptProgress?.status === 'running' ? '&#x23F3;' : '&#x2022;'}
            </span>
            <span class="step-message">{decryptProgress?.message}</span>
          </div>
          {#if decryptProgress?.progress !== undefined}
            <div class="progress-bar">
              <div class="progress-fill" style="width: {decryptProgress.progress}%"></div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .profile-location {
    padding: 1rem;
  }

  h3 {
    margin: 0 0 1rem 0;
    font-size: 1.1rem;
    color: var(--text-primary, #1a1a1a);
  }

  :global(.dark) h3 {
    color: var(--text-primary, #e5e5e5);
  }

  h4 {
    margin: 1.5rem 0 0.75rem 0;
    font-size: 0.95rem;
    color: var(--text-secondary, #666);
  }

  :global(.dark) h4 {
    color: var(--text-secondary, #aaa);
  }

  .loading, .error {
    padding: 1rem;
    text-align: center;
  }

  .error {
    color: #dc2626;
  }

  .config-section {
    margin-bottom: 1rem;
  }

  .config-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem 0;
  }

  .label {
    font-weight: 500;
    color: var(--text-secondary, #666);
  }

  :global(.dark) .label {
    color: var(--text-secondary, #aaa);
  }

  .value {
    font-family: monospace;
    font-size: 0.85rem;
    padding: 0.25rem 0.5rem;
    background: var(--bg-secondary, #f5f5f5);
    border-radius: 4px;
  }

  :global(.dark) .value {
    background: var(--bg-secondary, #2a2a2a);
  }

  .encryption-section {
    margin-top: 1rem;
  }

  .status-card {
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid var(--border-color, #ddd);
  }

  :global(.dark) .status-card {
    border-color: var(--border-color, #444);
  }

  .status-card.encrypted {
    background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
    border-color: #86efac;
  }

  :global(.dark) .status-card.encrypted {
    background: linear-gradient(135deg, #14532d 0%, #166534 100%);
    border-color: #22c55e;
  }

  .status-card.unencrypted {
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
    border-color: #fcd34d;
  }

  :global(.dark) .status-card.unencrypted {
    background: linear-gradient(135deg, #78350f 0%, #92400e 100%);
    border-color: #f59e0b;
  }

  .status-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .status-icon {
    font-size: 1.25rem;
  }

  .status-text {
    font-weight: 600;
    font-size: 1rem;
    color: #1a1a1a;
  }

  :global(.dark) .status-text {
    color: #e5e5e5;
  }

  .status-description {
    margin: 0 0 1rem 0;
    font-size: 0.9rem;
    color: #666;
  }

  :global(.dark) .status-description {
    color: #ccc;
  }

  .status-details {
    margin-bottom: 1rem;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    padding: 0.25rem 0;
    font-size: 0.85rem;
  }

  .detail-label {
    color: #666;
  }

  :global(.dark) .detail-label {
    color: #aaa;
  }

  .detail-value {
    font-weight: 500;
    color: #1a1a1a;
  }

  :global(.dark) .detail-value {
    color: #e5e5e5;
  }

  .mode-badge {
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .mode-badge.user {
    background: #dbeafe;
    color: #1d4ed8;
  }

  :global(.dark) .mode-badge.user {
    background: #1e3a5f;
    color: #60a5fa;
  }

  .mode-badge.separate {
    background: #fae8ff;
    color: #a21caf;
  }

  :global(.dark) .mode-badge.separate {
    background: #4a1d5f;
    color: #e879f9;
  }

  .encrypt-btn, .decrypt-btn {
    width: 100%;
    padding: 0.75rem;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .encrypt-btn {
    background: #2563eb;
    color: white;
  }

  .encrypt-btn:hover {
    background: #1d4ed8;
  }

  .decrypt-btn {
    background: #dc2626;
    color: white;
  }

  .decrypt-btn:hover {
    background: #b91c1c;
  }

  /* Modal styles */
  .modal-backdrop {
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
  }

  .modal {
    background: white;
    padding: 1.5rem;
    border-radius: 12px;
    width: 90%;
    max-width: 450px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .modal {
    background: #1f1f1f;
    border: 1px solid #333;
  }

  .modal h3 {
    margin: 0 0 1.5rem 0;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    font-size: 0.9rem;
    color: var(--text-primary, #1a1a1a);
  }

  :global(.dark) .form-group label {
    color: var(--text-primary, #e5e5e5);
  }

  .form-group input[type="password"] {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 6px;
    font-size: 1rem;
    background: var(--bg-primary, white);
    color: var(--text-primary, #1a1a1a);
  }

  :global(.dark) .form-group input[type="password"] {
    background: var(--bg-secondary, #2a2a2a);
    border-color: var(--border-color, #444);
    color: var(--text-primary, #e5e5e5);
  }

  .password-mode-label {
    margin-bottom: 0.75rem !important;
  }

  .password-mode-options {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .mode-option {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s;
  }

  :global(.dark) .mode-option {
    border-color: var(--border-color, #444);
  }

  .mode-option:hover {
    border-color: #2563eb;
  }

  .mode-option:has(input:checked) {
    border-color: #2563eb;
    background: #eff6ff;
  }

  :global(.dark) .mode-option:has(input:checked) {
    background: #1e3a5f;
  }

  .mode-option input[type="radio"] {
    margin-top: 0.25rem;
  }

  .mode-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .mode-content strong {
    font-size: 0.9rem;
    color: var(--text-primary, #1a1a1a);
  }

  :global(.dark) .mode-content strong {
    color: var(--text-primary, #e5e5e5);
  }

  .mode-desc {
    font-size: 0.8rem;
    color: var(--text-secondary, #666);
  }

  :global(.dark) .mode-desc {
    color: var(--text-secondary, #aaa);
  }

  .validation-error {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.8rem;
    color: #dc2626;
  }

  .error-message {
    padding: 0.75rem;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    color: #dc2626;
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .error-message {
    background: #450a0a;
    border-color: #7f1d1d;
    color: #fca5a5;
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    margin-top: 1.5rem;
  }

  .cancel-btn, .confirm-btn {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .cancel-btn {
    background: var(--bg-secondary, #f5f5f5);
    color: var(--text-primary, #1a1a1a);
  }

  :global(.dark) .cancel-btn {
    background: var(--bg-secondary, #333);
    color: var(--text-primary, #e5e5e5);
  }

  .cancel-btn:hover {
    background: var(--bg-tertiary, #e5e5e5);
  }

  :global(.dark) .cancel-btn:hover {
    background: var(--bg-tertiary, #444);
  }

  .confirm-btn {
    background: #2563eb;
    color: white;
  }

  .confirm-btn:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .confirm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .progress-section {
    padding: 1rem 0;
  }

  .progress-step {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .step-status {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--bg-secondary, #f5f5f5);
    font-size: 0.8rem;
  }

  :global(.dark) .step-status {
    background: var(--bg-secondary, #333);
  }

  .step-status.completed {
    background: #22c55e;
    color: white;
  }

  .step-status.running {
    background: #2563eb;
    color: white;
  }

  .step-message {
    font-size: 0.9rem;
    color: var(--text-primary, #1a1a1a);
  }

  :global(.dark) .step-message {
    color: var(--text-primary, #e5e5e5);
  }

  .progress-bar {
    height: 8px;
    background: var(--bg-secondary, #e5e5e5);
    border-radius: 4px;
    overflow: hidden;
  }

  :global(.dark) .progress-bar {
    background: var(--bg-secondary, #333);
  }

  .progress-fill {
    height: 100%;
    background: #2563eb;
    transition: width 0.3s ease;
  }
</style>
