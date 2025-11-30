<script lang="ts">
  import { onMount } from 'svelte';

  interface StorageDevice {
    id: string;
    path: string;
    type: 'usb' | 'network' | 'encrypted' | 'internal';
    label: string;
    fsType?: string;
    mounted: boolean;
    writable: boolean;
    freeSpace: number;
    freeSpaceFormatted: string;
    totalSpace: number;
    totalSpaceFormatted: string;
    isExternal: boolean;
    suggestedPath: string;
  }

  interface ProfileConfig {
    currentPath: string;
    defaultPath: string;
    storageType: string;
    isCustom: boolean;
    usingFallback: boolean;
    fallbackReason?: string;
    isEncrypted?: boolean;
    encryptionType?: 'none' | 'aes256' | 'veracrypt';
    storageInfo?: {
      id: string;
      type: string;
      label: string;
      freeSpace: number;
      freeSpaceFormatted: string;
      totalSpace: number;
      totalSpaceFormatted: string;
      writable: boolean;
    };
  }

  interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    resolvedPath: string;
  }

  interface MigrationProgress {
    step: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    progress?: number;
    message: string;
    error?: string;
    currentFile?: string;
    totalFiles?: number;
    processedFiles?: number;
    bytesProcessed?: number;
    totalBytes?: number;
  }

  interface VeraCryptStatus {
    installed: boolean;
    version?: string;
    platform: string;
  }

  // Encryption types
  type EncryptionType = 'none' | 'aes256' | 'veracrypt';

  // Container size presets
  const CONTAINER_SIZES = [
    { value: 500 * 1024 * 1024, label: '500 MB', description: 'Basic profile' },
    { value: 2 * 1024 * 1024 * 1024, label: '2 GB', description: 'Standard profile' },
    { value: 10 * 1024 * 1024 * 1024, label: '10 GB', description: 'Large profile with voice data' },
  ];

  let profileConfig: ProfileConfig | null = null;
  let devices: StorageDevice[] = [];
  let loading = true;
  let devicesLoading = false;
  let error = '';
  let success = '';

  // Custom path input
  let showCustomPath = false;
  let customPath = '';
  let validating = false;
  let validation: ValidationResult | null = null;

  // Migration state
  let showMigrationModal = false;
  let migrating = false;
  let migrationProgress: MigrationProgress[] = [];
  let migrationTarget = '';
  let keepSourceFiles = true;
  let overwriteExisting = false;

  // Encryption state
  let encryptionType: EncryptionType = 'none';
  let encryptionPassword = '';
  let encryptionPasswordConfirm = '';
  let veracryptStatus: VeraCryptStatus | null = null;
  let containerSize = CONTAINER_SIZES[1].value; // Default 2GB
  let checkingVeraCrypt = false;

  // Confirmation dialog
  let showConfirmDialog = false;
  let pendingPath = '';

  // Editable device paths (keyed by device.id)
  let devicePaths: Record<string, string> = {};

  // In-place encryption/decryption state
  let showEncryptModal = false;
  let showDecryptModal = false;
  let encryptInPlacePassword = '';
  let encryptInPlacePasswordConfirm = '';
  let decryptPassword = '';
  let encryptingInPlace = false;
  let decryptingInPlace = false;
  let encryptInPlaceType: 'aes256' = 'aes256'; // Only AES-256 supported for in-place
  let encryptInPlaceProgress: MigrationProgress[] = [];
  let editingDeviceId: string | null = null;

  // Password validation
  $: passwordsMatch = encryptionPassword === encryptionPasswordConfirm;
  $: passwordValid = encryptionPassword.length >= 8;
  $: encryptionReady = encryptionType === 'none' ||
    (passwordValid && passwordsMatch &&
      (encryptionType === 'aes256' || (encryptionType === 'veracrypt' && veracryptStatus?.installed)));

  // In-place encryption validation
  $: encryptInPlacePasswordsMatch = encryptInPlacePassword === encryptInPlacePasswordConfirm;
  $: encryptInPlacePasswordValid = encryptInPlacePassword.length >= 8;
  $: encryptInPlaceReady = encryptInPlacePasswordValid && encryptInPlacePasswordsMatch;

  onMount(async () => {
    await Promise.all([loadProfileConfig(), loadDevices(), checkVeraCryptStatus()]);
  });

  async function checkVeraCryptStatus() {
    checkingVeraCrypt = true;
    try {
      const response = await fetch('/api/veracrypt/status');
      if (response.ok) {
        veracryptStatus = await response.json();
      } else {
        veracryptStatus = { installed: false, platform: 'unknown' };
      }
    } catch {
      veracryptStatus = { installed: false, platform: 'unknown' };
    } finally {
      checkingVeraCrypt = false;
    }
  }

  async function loadProfileConfig() {
    loading = true;
    error = '';

    try {
      const response = await fetch('/api/profile-path');
      if (response.ok) {
        profileConfig = await response.json();
      } else {
        const data = await response.json();
        error = data.error || 'Failed to load profile configuration';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load profile configuration';
      console.error(err);
    } finally {
      loading = false;
    }
  }

  async function loadDevices() {
    devicesLoading = true;

    try {
      const response = await fetch('/api/profile-path/devices');
      if (response.ok) {
        const data = await response.json();
        devices = data.devices || [];
        // Initialize editable paths for each device
        for (const device of devices) {
          if (!devicePaths[device.id]) {
            devicePaths[device.id] = device.suggestedPath;
          }
        }
      }
    } catch (err) {
      console.error('Failed to load storage devices:', err);
    } finally {
      devicesLoading = false;
    }
  }

  function getDevicePath(device: StorageDevice): string {
    return devicePaths[device.id] || device.suggestedPath;
  }

  function startEditingPath(device: StorageDevice) {
    editingDeviceId = device.id;
    if (!devicePaths[device.id]) {
      devicePaths[device.id] = device.suggestedPath;
    }
  }

  function stopEditingPath() {
    editingDeviceId = null;
  }

  function resetDevicePath(device: StorageDevice) {
    devicePaths[device.id] = device.suggestedPath;
  }

  async function validatePath(path: string): Promise<ValidationResult | null> {
    try {
      const response = await fetch('/api/profile-path/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      if (response.ok) {
        return await response.json();
      } else {
        const data = await response.json();
        return {
          valid: false,
          errors: [data.error || 'Validation failed'],
          warnings: [],
          resolvedPath: path,
        };
      }
    } catch (err) {
      return {
        valid: false,
        errors: [err instanceof Error ? err.message : 'Validation failed'],
        warnings: [],
        resolvedPath: path,
      };
    }
  }

  async function handleValidateCustomPath() {
    if (!customPath.trim()) return;

    validating = true;
    validation = null;

    validation = await validatePath(customPath.trim());
    validating = false;
  }

  function initiateMove(targetPath: string) {
    pendingPath = targetPath;
    showConfirmDialog = true;
  }

  async function confirmMove() {
    showConfirmDialog = false;
    await startMigration(pendingPath);
  }

  async function startMigration(targetPath: string) {
    migrationTarget = targetPath;
    migrationProgress = [];
    showMigrationModal = true;
    migrating = true;
    error = '';
    success = '';

    // Build encryption options
    const encryptionOptions = encryptionType !== 'none' ? {
      type: encryptionType,
      password: encryptionPassword,
      containerSize: encryptionType === 'veracrypt' ? containerSize : undefined,
    } : undefined;

    try {
      const response = await fetch('/api/profile-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: targetPath,
          keepSource: keepSourceFiles,
          overwrite: overwriteExisting,
          encryption: encryptionOptions,
        }),
      });

      // Check for error responses first
      if (!response.ok && !response.headers.get('content-type')?.includes('text/event-stream')) {
        const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        error = data.error || data.details?.join(', ') || `Migration failed (${response.status})`;
        migrationProgress = [{
          step: 'error',
          status: 'failed',
          message: 'Request failed',
          error: error,
        }];
        return;
      }

      // Handle SSE streaming response
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.progress) {
                    migrationProgress = [...migrationProgress, data.progress];
                    // Auto-scroll to bottom
                    if (data.progress.status === 'completed' && data.progress.step === 'complete') {
                      success = 'Profile migration completed successfully!';
                      await loadProfileConfig();
                    } else if (data.progress.status === 'failed') {
                      error = data.progress.error || 'Migration failed';
                    }
                  }
                  if (data.result) {
                    if (data.result.success) {
                      success = `Profile migrated successfully! ${data.result.filesProcessed} files (${formatBytes(data.result.bytesProcessed)}) moved in ${(data.result.duration / 1000).toFixed(1)}s`;
                    } else {
                      error = data.result.error || 'Migration failed';
                    }
                  }
                  if (data.error) {
                    error = data.error;
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }
        }
      } else {
        // Non-streaming response
        const data = await response.json();
        if (data.error) {
          error = data.error;
        } else if (data.result) {
          if (data.result.success) {
            success = 'Profile migrated successfully!';
            await loadProfileConfig();
          } else {
            error = data.result.error || 'Migration failed';
          }
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Migration failed';
      console.error(err);
    } finally {
      migrating = false;
    }
  }

  async function resetToDefault() {
    if (!confirm('Reset profile location to default? This will only update the configuration, not move any files.')) {
      return;
    }

    try {
      const response = await fetch('/api/profile-path', {
        method: 'DELETE',
      });

      const data = await response.json();
      if (data.success) {
        success = 'Profile location reset to default';
        await loadProfileConfig();
        showCustomPath = false;
        customPath = '';
        validation = null;
      } else {
        error = data.error || 'Failed to reset profile location';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to reset profile location';
      console.error(err);
    }
  }

  /**
   * Encrypt existing profile data in-place with AES-256
   */
  async function encryptProfileInPlace() {
    if (!encryptInPlaceReady) return;

    encryptingInPlace = true;
    encryptInPlaceProgress = [];
    error = '';
    success = '';

    try {
      const response = await fetch('/api/profile-path/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: encryptInPlacePassword,
          type: encryptInPlaceType,
        }),
      });

      // Handle SSE streaming response
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.progress) {
                    encryptInPlaceProgress = [...encryptInPlaceProgress, data.progress];
                    if (data.progress.status === 'completed' && data.progress.step === 'complete') {
                      success = 'Profile encrypted successfully!';
                      await loadProfileConfig();
                    } else if (data.progress.status === 'failed') {
                      error = data.progress.error || 'Encryption failed';
                    }
                  }
                  if (data.result) {
                    if (data.result.success) {
                      success = `Profile encrypted! ${data.result.filesProcessed} files (${formatBytes(data.result.bytesProcessed)}) encrypted.`;
                    } else {
                      error = data.result.error || 'Encryption failed';
                    }
                  }
                  if (data.error) {
                    error = data.error;
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }
        }
      } else {
        const data = await response.json();
        if (data.error) {
          error = data.error;
        } else if (data.success) {
          success = 'Profile encrypted successfully!';
          await loadProfileConfig();
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Encryption failed';
      console.error(err);
    } finally {
      encryptingInPlace = false;
      encryptInPlacePassword = '';
      encryptInPlacePasswordConfirm = '';
    }
  }

  /**
   * Decrypt existing encrypted profile data in-place
   */
  async function decryptProfileInPlace() {
    if (!decryptPassword) return;

    decryptingInPlace = true;
    encryptInPlaceProgress = [];
    error = '';
    success = '';

    try {
      const response = await fetch('/api/profile-path/decrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: decryptPassword,
        }),
      });

      // Handle SSE streaming response
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.progress) {
                    encryptInPlaceProgress = [...encryptInPlaceProgress, data.progress];
                    if (data.progress.status === 'completed' && data.progress.step === 'complete') {
                      success = 'Profile decrypted successfully!';
                      await loadProfileConfig();
                    } else if (data.progress.status === 'failed') {
                      error = data.progress.error || 'Decryption failed';
                    }
                  }
                  if (data.result) {
                    if (data.result.success) {
                      success = `Profile decrypted! ${data.result.filesProcessed} files restored.`;
                    } else {
                      error = data.result.error || 'Decryption failed';
                    }
                  }
                  if (data.error) {
                    error = data.error;
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }
        }
      } else {
        const data = await response.json();
        if (data.error) {
          error = data.error;
        } else if (data.success) {
          success = 'Profile decrypted successfully!';
          await loadProfileConfig();
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Decryption failed';
      console.error(err);
    } finally {
      decryptingInPlace = false;
      decryptPassword = '';
    }
  }

  function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  function getStorageTypeIcon(type: string): string {
    switch (type) {
      case 'usb':
        return '🔌';
      case 'network':
        return '🌐';
      case 'encrypted':
        return '🔒';
      default:
        return '💾';
    }
  }

  function getStatusIcon(status: string): string {
    switch (status) {
      case 'completed':
        return '✓';
      case 'failed':
        return '✗';
      case 'skipped':
        return '○';
      case 'running':
        return '→';
      default:
        return '•';
    }
  }
</script>

<div class="profile-location-container">
  <div class="section-header">
    <h1>📁 Profile Storage Location</h1>
    <p>Configure where your profile data is stored</p>
  </div>

  {#if loading}
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading profile configuration...</p>
    </div>
  {:else}
    {#if error}
      <div class="alert alert-error">
        <span>{error}</span>
        <button on:click={() => error = ''} class="alert-close">×</button>
      </div>
    {/if}

    {#if success}
      <div class="alert alert-success">
        <span>{success}</span>
        <button on:click={() => success = ''} class="alert-close">×</button>
      </div>
    {/if}

    <!-- Current Configuration -->
    {#if profileConfig}
      <div class="card">
        <h2>Current Location</h2>
        <div class="current-config">
          <div class="config-row">
            <span class="label">Path:</span>
            <code class="path-value">{profileConfig.currentPath}</code>
          </div>
          <div class="config-row">
            <span class="label">Storage Type:</span>
            <span class="storage-badge storage-{profileConfig.storageType}">
              {getStorageTypeIcon(profileConfig.storageType)} {profileConfig.storageType}
            </span>
          </div>
          <div class="config-row">
            <span class="label">Custom Location:</span>
            <span class="value">{profileConfig.isCustom ? 'Yes' : 'No (Default)'}</span>
          </div>

          {#if profileConfig.usingFallback}
            <div class="warning-box">
              <strong>⚠️ Using Fallback Location</strong>
              <p>{profileConfig.fallbackReason || 'Custom location unavailable'}</p>
            </div>
          {/if}

          {#if profileConfig.storageInfo}
            <div class="storage-info">
              <h3>Storage Details</h3>
              <div class="info-grid">
                <div class="info-item">
                  <span class="info-label">Device ID:</span>
                  <span class="info-value">{profileConfig.storageInfo.id}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Label:</span>
                  <span class="info-value">{profileConfig.storageInfo.label}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Free Space:</span>
                  <span class="info-value">{profileConfig.storageInfo.freeSpaceFormatted}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Total Space:</span>
                  <span class="info-value">{profileConfig.storageInfo.totalSpaceFormatted}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Writable:</span>
                  <span class="info-value">{profileConfig.storageInfo.writable ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>
          {/if}

          <!-- Encryption Status & Controls -->
          <div class="encryption-status-card">
            <h3>🔐 Encryption Status</h3>
            <div class="encryption-status-content">
              {#if profileConfig.isEncrypted}
                <div class="status-badge encrypted">
                  <span class="status-icon">🔒</span>
                  <span class="status-text">
                    Encrypted ({profileConfig.encryptionType === 'veracrypt' ? 'VeraCrypt' : 'AES-256'})
                  </span>
                </div>
                <p class="status-description">
                  Your profile data is protected with encryption.
                  {#if profileConfig.encryptionType === 'aes256'}
                    Individual files are encrypted with AES-256-GCM.
                  {:else}
                    Data is stored in an encrypted VeraCrypt container.
                  {/if}
                </p>
                {#if profileConfig.encryptionType === 'aes256'}
                  <button
                    class="btn btn-secondary btn-sm"
                    on:click={() => showDecryptModal = true}
                    disabled={decryptingInPlace}
                  >
                    🔓 Decrypt Profile
                  </button>
                {/if}
              {:else}
                <div class="status-badge unencrypted">
                  <span class="status-icon">📁</span>
                  <span class="status-text">Not Encrypted</span>
                </div>
                <p class="status-description">
                  Your profile data is stored as plain files. Consider encrypting for better security,
                  especially if using external storage.
                </p>
                <button
                  class="btn btn-primary btn-sm"
                  on:click={() => showEncryptModal = true}
                  disabled={encryptingInPlace}
                >
                  🔒 Encrypt Profile
                </button>
              {/if}
            </div>
          </div>

          {#if profileConfig.isCustom}
            <button class="btn btn-secondary" on:click={resetToDefault}>
              Reset to Default Location
            </button>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Available Storage Devices -->
    <div class="card">
      <div class="card-header">
        <h2>Available Storage Devices</h2>
        <button class="btn btn-secondary btn-sm" on:click={loadDevices} disabled={devicesLoading}>
          {devicesLoading ? 'Scanning...' : '🔄 Refresh'}
        </button>
      </div>
      <p class="card-note">
        💡 Plugged in a new drive? Click <strong>Refresh</strong> to detect it.
      </p>

      {#if devicesLoading}
        <div class="loading-text">Scanning for storage devices...</div>
      {:else if devices.length === 0}
        <div class="empty-state">
          <p>No external storage devices detected.</p>
          <small>Connect a USB drive or network storage and click Refresh to see it here.</small>
        </div>
      {:else}
        <div class="devices-list">
          {#each devices as device}
            <div class="device-card" class:external={device.isExternal}>
              <div class="device-header">
                <span class="device-icon">{getStorageTypeIcon(device.type)}</span>
                <div class="device-info">
                  <strong class="device-label">{device.label}</strong>
                  <code class="device-path">{device.path}</code>
                </div>
              </div>
              <div class="device-details">
                <span class="device-type">{device.type}</span>
                <span class="device-fs">{device.fsType || 'Unknown'}</span>
                <span class="device-space" class:low-space={device.freeSpace < 1024 * 1024 * 1024}>
                  {device.freeSpaceFormatted} free
                </span>
                {#if !device.writable}
                  <span class="device-readonly">Read Only</span>
                {/if}
              </div>
              <div class="device-actions">
                <div class="path-editor">
                  {#if editingDeviceId === device.id}
                    <input
                      type="text"
                      class="path-input"
                      bind:value={devicePaths[device.id]}
                      on:blur={stopEditingPath}
                      on:keydown={(e) => e.key === 'Enter' && stopEditingPath()}
                      placeholder={device.suggestedPath}
                    />
                    {#if devicePaths[device.id] !== device.suggestedPath}
                      <button
                        class="btn btn-icon"
                        title="Reset to default"
                        on:click={() => resetDevicePath(device)}
                      >
                        ↺
                      </button>
                    {/if}
                  {:else}
                    <code
                      class="suggested-path"
                      class:modified={devicePaths[device.id] && devicePaths[device.id] !== device.suggestedPath}
                      on:click={() => startEditingPath(device)}
                      title="Click to edit path"
                    >
                      {getDevicePath(device)}
                    </code>
                    <button
                      class="btn btn-icon"
                      title="Edit path"
                      on:click={() => startEditingPath(device)}
                    >
                      ✏️
                    </button>
                  {/if}
                </div>
                <button
                  class="btn btn-primary btn-sm"
                  on:click={() => initiateMove(getDevicePath(device))}
                  disabled={!device.writable || migrating}
                >
                  Move Here
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Custom Path Input -->
    <div class="card">
      <h2>Custom Path</h2>
      <p class="card-description">Specify a custom location for your profile data</p>

      {#if !showCustomPath}
        <button class="btn btn-secondary" on:click={() => showCustomPath = true}>
          Enter Custom Path
        </button>
      {:else}
        <div class="custom-path-form">
          <div class="form-group">
            <label for="customPath">Profile Path</label>
            <input
              id="customPath"
              type="text"
              bind:value={customPath}
              placeholder="/path/to/your/profile"
              on:blur={handleValidateCustomPath}
              disabled={validating || migrating}
            />
            <small>Enter an absolute path where you want to store your profile data</small>
          </div>

          {#if validating}
            <div class="validation-status validating">
              <div class="spinner small"></div>
              <span>Validating path...</span>
            </div>
          {:else if validation}
            <div class="validation-result" class:valid={validation.valid} class:invalid={!validation.valid}>
              {#if validation.valid}
                <div class="validation-success">
                  <strong>✓ Valid Path</strong>
                  <code>{validation.resolvedPath}</code>
                </div>
              {:else}
                <div class="validation-errors">
                  <strong>✗ Invalid Path</strong>
                  <ul>
                    {#each validation.errors as err}
                      <li>{err}</li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if validation.warnings.length > 0}
                <div class="validation-warnings">
                  <strong>⚠️ Warnings:</strong>
                  <ul>
                    {#each validation.warnings as warning}
                      <li>{warning}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/if}

          <div class="form-actions">
            <button
              class="btn btn-primary"
              on:click={() => initiateMove(customPath.trim())}
              disabled={!validation?.valid || migrating}
            >
              Move to Custom Path
            </button>
            <button
              class="btn btn-secondary"
              on:click={() => { showCustomPath = false; customPath = ''; validation = null; }}
              disabled={migrating}
            >
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Security Warning -->
    <div class="card warning-card">
      <h2>⚠️ Security Considerations</h2>
      <ul>
        <li><strong>External Storage:</strong> Data on external drives may be accessible if the drive is lost or stolen - <em>use encryption!</em></li>
        <li><strong>Network Storage:</strong> Network drives may have different access controls and backup policies</li>
        <li><strong>Password Security:</strong> Use a strong, unique password for encryption</li>
        <li><strong>Availability:</strong> If the external storage is disconnected, the system will fall back to the default location or show an error</li>
      </ul>
    </div>
  {/if}
</div>

<!-- Confirmation Dialog with Migration Options -->
{#if showConfirmDialog}
  <div class="modal-overlay" on:click={() => showConfirmDialog = false}>
    <div class="modal-content migration-config-modal" on:click|stopPropagation>
      <h3>📁 Configure Migration</h3>

      <div class="modal-body">
        <div class="config-section">
          <label class="config-label">Destination</label>
          <code class="target-path">{pendingPath}</code>
        </div>

        <!-- Encryption Selection -->
        <div class="config-section">
          <label class="config-label">🔐 Encryption</label>
          <div class="encryption-options-compact">
            <label class="radio-option" class:selected={encryptionType === 'none'}>
              <input type="radio" bind:group={encryptionType} value="none" />
              <span class="radio-label">📁 None</span>
            </label>
            <label class="radio-option" class:selected={encryptionType === 'aes256'}>
              <input type="radio" bind:group={encryptionType} value="aes256" />
              <span class="radio-label">🔒 AES-256</span>
            </label>
            <label class="radio-option" class:selected={encryptionType === 'veracrypt'}>
              <input type="radio" bind:group={encryptionType} value="veracrypt" />
              <span class="radio-label">🛡️ VeraCrypt</span>
            </label>
          </div>

          {#if encryptionType !== 'none'}
            <div class="encryption-fields">
              <div class="form-row">
                <input
                  type="password"
                  bind:value={encryptionPassword}
                  placeholder="Password (min 8 characters)"
                  class="input-field"
                />
                <input
                  type="password"
                  bind:value={encryptionPasswordConfirm}
                  placeholder="Confirm password"
                  class="input-field"
                />
              </div>
              {#if encryptionPassword && !passwordValid}
                <span class="field-error">Password must be at least 8 characters</span>
              {/if}
              {#if encryptionPasswordConfirm && !passwordsMatch}
                <span class="field-error">Passwords do not match</span>
              {/if}

              {#if encryptionType === 'veracrypt'}
                {#if !veracryptStatus?.installed}
                  <div class="veracrypt-warning">
                    ⚠️ VeraCrypt not installed. <a href="https://www.veracrypt.fr/en/Downloads.html" target="_blank">Download</a>
                  </div>
                {:else}
                  <div class="form-row">
                    <label class="inline-label">Container Size:</label>
                    <select bind:value={containerSize} class="select-field">
                      {#each CONTAINER_SIZES as size}
                        <option value={size.value}>{size.label}</option>
                      {/each}
                    </select>
                  </div>
                {/if}
              {/if}

              <p class="password-note">
                ⚠️ Password is never stored. If forgotten, data cannot be recovered.
              </p>
            </div>
          {/if}
        </div>

        <!-- Migration Options -->
        <div class="config-section">
          <label class="config-label">⚙️ Options</label>
          <div class="toggle-options">
            <label class="checkbox-option">
              <input type="checkbox" bind:checked={keepSourceFiles} />
              <span>Keep source files after migration</span>
            </label>
            <label class="checkbox-option">
              <input type="checkbox" bind:checked={overwriteExisting} />
              <span>Overwrite existing files at destination</span>
            </label>
          </div>
        </div>

        <!-- Summary -->
        <div class="migration-summary">
          <strong>This will:</strong>
          <ul>
            {#if encryptionType === 'veracrypt'}
              <li>Create encrypted VeraCrypt container</li>
            {:else if encryptionType === 'aes256'}
              <li>Encrypt files with AES-256-GCM</li>
            {:else}
              <li>Copy files to new location</li>
            {/if}
            <li>Update system configuration</li>
            {#if !keepSourceFiles}
              <li class="destructive">Delete original files</li>
            {/if}
          </ul>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" on:click={() => showConfirmDialog = false}>
          Cancel
        </button>
        <button
          class="btn btn-primary"
          on:click={confirmMove}
          disabled={!encryptionReady}
          title={!encryptionReady ? 'Complete encryption settings first' : ''}
        >
          {encryptionType !== 'none' ? '🔐 Start Encrypted Migration' : '📦 Start Migration'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Migration Progress Modal -->
{#if showMigrationModal}
  <div class="modal-overlay">
    <div class="modal-content migration-modal">
      <h3>📦 Migration in Progress</h3>

      <div class="migration-target">
        <span class="label">Target:</span>
        <code>{migrationTarget}</code>
      </div>

      <div class="progress-container">
        {#each migrationProgress as step}
          <div class="progress-step" class:completed={step.status === 'completed'} class:failed={step.status === 'failed'} class:running={step.status === 'running'} class:skipped={step.status === 'skipped'}>
            <span class="step-icon">{getStatusIcon(step.status)}</span>
            <div class="step-content">
              <span class="step-message">{step.message}</span>
              {#if step.progress !== undefined}
                <div class="progress-bar">
                  <div class="progress-fill" style="width: {step.progress}%"></div>
                </div>
              {/if}
              {#if step.error}
                <span class="step-error">{step.error}</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      {#if !migrating}
        <div class="modal-actions">
          <button class="btn btn-primary" on:click={() => showMigrationModal = false}>
            Close
          </button>
        </div>
      {:else}
        <div class="migrating-indicator">
          <div class="spinner"></div>
          <span>Please wait...</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Encrypt Profile Modal -->
{#if showEncryptModal}
  <div class="modal-overlay" on:click={() => !encryptingInPlace && (showEncryptModal = false)}>
    <div class="modal-content encryption-modal" on:click|stopPropagation>
      <h3>🔒 Encrypt Profile Data</h3>

      {#if !encryptingInPlace && encryptInPlaceProgress.length === 0}
        <div class="modal-body">
          <p class="encryption-modal-description">
            Encrypt all existing profile data with AES-256-GCM encryption. This will convert
            all plain JSON files to encrypted format in-place.
          </p>

          <div class="encryption-fields">
            <div class="form-group">
              <label for="encryptInPlacePassword">Encryption Password</label>
              <input
                id="encryptInPlacePassword"
                type="password"
                bind:value={encryptInPlacePassword}
                placeholder="Enter password (min 8 characters)"
                class="input-field"
              />
            </div>
            <div class="form-group">
              <label for="encryptInPlacePasswordConfirm">Confirm Password</label>
              <input
                id="encryptInPlacePasswordConfirm"
                type="password"
                bind:value={encryptInPlacePasswordConfirm}
                placeholder="Confirm password"
                class="input-field"
              />
            </div>

            {#if encryptInPlacePassword && !encryptInPlacePasswordValid}
              <span class="field-error">Password must be at least 8 characters</span>
            {/if}
            {#if encryptInPlacePasswordConfirm && !encryptInPlacePasswordsMatch}
              <span class="field-error">Passwords do not match</span>
            {/if}

            <div class="password-warning">
              <strong>⚠️ Important:</strong> Your password is never stored. If you forget it,
              your data cannot be recovered. Write it down somewhere safe!
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" on:click={() => showEncryptModal = false}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            on:click={encryptProfileInPlace}
            disabled={!encryptInPlaceReady}
          >
            🔒 Start Encryption
          </button>
        </div>
      {:else}
        <!-- Progress view -->
        <div class="progress-container">
          {#each encryptInPlaceProgress as step}
            <div class="progress-step" class:completed={step.status === 'completed'} class:failed={step.status === 'failed'} class:running={step.status === 'running'}>
              <span class="step-icon">{getStatusIcon(step.status)}</span>
              <div class="step-content">
                <span class="step-message">{step.message}</span>
                {#if step.progress !== undefined}
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: {step.progress}%"></div>
                  </div>
                {/if}
                {#if step.error}
                  <span class="step-error">{step.error}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        {#if !encryptingInPlace}
          <div class="modal-actions">
            <button class="btn btn-primary" on:click={() => { showEncryptModal = false; encryptInPlaceProgress = []; }}>
              Close
            </button>
          </div>
        {:else}
          <div class="migrating-indicator">
            <div class="spinner"></div>
            <span>Encrypting files...</span>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<!-- Decrypt Profile Modal -->
{#if showDecryptModal}
  <div class="modal-overlay" on:click={() => !decryptingInPlace && (showDecryptModal = false)}>
    <div class="modal-content encryption-modal" on:click|stopPropagation>
      <h3>🔓 Decrypt Profile Data</h3>

      {#if !decryptingInPlace && encryptInPlaceProgress.length === 0}
        <div class="modal-body">
          <p class="encryption-modal-description">
            Decrypt all encrypted profile data back to plain JSON files. You will need
            your encryption password to proceed.
          </p>

          <div class="encryption-fields">
            <div class="form-group">
              <label for="decryptPassword">Encryption Password</label>
              <input
                id="decryptPassword"
                type="password"
                bind:value={decryptPassword}
                placeholder="Enter your encryption password"
                class="input-field"
              />
            </div>

            <div class="warning-box">
              <strong>⚠️ Security Note:</strong> After decryption, your profile data will be
              stored as plain files. Anyone with access to this location can read your data.
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" on:click={() => showDecryptModal = false}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            on:click={decryptProfileInPlace}
            disabled={!decryptPassword}
          >
            🔓 Start Decryption
          </button>
        </div>
      {:else}
        <!-- Progress view -->
        <div class="progress-container">
          {#each encryptInPlaceProgress as step}
            <div class="progress-step" class:completed={step.status === 'completed'} class:failed={step.status === 'failed'} class:running={step.status === 'running'}>
              <span class="step-icon">{getStatusIcon(step.status)}</span>
              <div class="step-content">
                <span class="step-message">{step.message}</span>
                {#if step.progress !== undefined}
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: {step.progress}%"></div>
                  </div>
                {/if}
                {#if step.error}
                  <span class="step-error">{step.error}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        {#if !decryptingInPlace}
          <div class="modal-actions">
            <button class="btn btn-primary" on:click={() => { showDecryptModal = false; encryptInPlaceProgress = []; }}>
              Close
            </button>
          </div>
        {:else}
          <div class="migrating-indicator">
            <div class="spinner"></div>
            <span>Decrypting files...</span>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .profile-location-container {
    padding: 2rem;
    max-width: 900px;
    margin: 0 auto;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .section-header {
    margin-bottom: 2rem;
  }

  .section-header h1 {
    font-size: 2rem;
    font-weight: 700;
    color: rgb(17 24 39);
    margin: 0 0 0.5rem 0;
  }

  :global(.dark) .section-header h1 {
    color: rgb(243 244 246);
  }

  .section-header p {
    color: rgb(107 114 128);
    margin: 0;
  }

  :global(.dark) .section-header p {
    color: rgb(156 163 175);
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(139, 92, 246, 0.2);
    border-top-color: rgb(139, 92, 246);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .spinner.small {
    width: 20px;
    height: 20px;
    border-width: 2px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-state p,
  .loading-text {
    margin-top: 1rem;
    color: rgb(107 114 128);
    font-style: italic;
  }

  :global(.dark) .loading-state p,
  :global(.dark) .loading-text {
    color: rgb(156 163 175);
  }

  .alert {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .alert-error {
    background: rgb(254 242 242);
    border: 1px solid rgb(254 226 226);
    color: rgb(153 27 27);
  }

  :global(.dark) .alert-error {
    background: rgb(127 29 29 / 0.3);
    border-color: rgb(153 27 27);
    color: rgb(254 226 226);
  }

  .alert-success {
    background: rgb(240 253 244);
    border: 1px solid rgb(187 247 208);
    color: rgb(22 101 52);
  }

  :global(.dark) .alert-success {
    background: rgb(20 83 45 / 0.3);
    border-color: rgb(22 101 52);
    color: rgb(187 247 208);
  }

  .alert-close {
    background: transparent;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: inherit;
    opacity: 0.6;
    padding: 0;
    line-height: 1;
  }

  .alert-close:hover {
    opacity: 1;
  }

  .card {
    background: white;
    border: 1px solid rgb(229 231 235);
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  :global(.dark) .card {
    background: rgb(17 24 39);
    border-color: rgb(55 65 81);
  }

  .card h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: rgb(17 24 39);
    margin: 0 0 1rem 0;
  }

  :global(.dark) .card h2 {
    color: rgb(243 244 246);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .card-header h2 {
    margin: 0;
  }

  .card-description {
    color: rgb(107 114 128);
    margin: 0 0 1rem 0;
  }

  :global(.dark) .card-description {
    color: rgb(156 163 175);
  }

  .card-note {
    font-size: 0.875rem;
    color: rgb(107 114 128);
    background: rgb(249 250 251);
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    margin: 0 0 1rem 0;
  }

  :global(.dark) .card-note {
    color: rgb(156 163 175);
    background: rgb(31 41 55);
  }

  .current-config {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .config-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .label {
    font-weight: 500;
    color: rgb(107 114 128);
    min-width: 120px;
  }

  :global(.dark) .label {
    color: rgb(156 163 175);
  }

  .value {
    color: rgb(17 24 39);
  }

  :global(.dark) .value {
    color: rgb(243 244 246);
  }

  .path-value {
    background: rgb(243 244 246);
    color: rgb(139, 92, 246);
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-family: monospace;
    font-size: 0.875rem;
    word-break: break-all;
  }

  :global(.dark) .path-value {
    background: rgb(31 41 55);
    color: rgb(196 181 253);
  }

  .storage-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .storage-badge.storage-internal {
    background: rgb(219 234 254);
    color: rgb(30 64 175);
  }

  :global(.dark) .storage-badge.storage-internal {
    background: rgb(30 58 138 / 0.3);
    color: rgb(191 219 254);
  }

  .storage-badge.storage-external,
  .storage-badge.storage-usb {
    background: rgb(254 243 199);
    color: rgb(146 64 14);
  }

  :global(.dark) .storage-badge.storage-external,
  :global(.dark) .storage-badge.storage-usb {
    background: rgb(120 53 15 / 0.3);
    color: rgb(253 224 71);
  }

  .storage-badge.storage-network {
    background: rgb(237 233 254);
    color: rgb(91 33 182);
  }

  :global(.dark) .storage-badge.storage-network {
    background: rgb(76 29 149 / 0.3);
    color: rgb(216 180 254);
  }

  .storage-badge.storage-encrypted {
    background: rgb(209 250 229);
    color: rgb(22 101 52);
  }

  :global(.dark) .storage-badge.storage-encrypted {
    background: rgb(20 83 45 / 0.3);
    color: rgb(187 247 208);
  }

  .warning-box {
    padding: 1rem;
    background: rgb(254 252 232);
    border: 1px solid rgb(253 224 71);
    border-radius: 0.5rem;
    margin-top: 0.75rem;
  }

  :global(.dark) .warning-box {
    background: rgb(113 63 18 / 0.2);
    border-color: rgb(180 83 9);
  }

  .warning-box strong {
    display: block;
    color: rgb(120 53 15);
    margin-bottom: 0.25rem;
  }

  :global(.dark) .warning-box strong {
    color: rgb(253 224 71);
  }

  .warning-box p {
    margin: 0;
    font-size: 0.875rem;
    color: rgb(161 98 7);
  }

  :global(.dark) .warning-box p {
    color: rgb(250 204 21);
  }

  .warning-box ul {
    margin: 0.5rem 0 0 0;
    padding-left: 1.25rem;
  }

  .warning-box li {
    font-size: 0.875rem;
    color: rgb(161 98 7);
    margin-bottom: 0.25rem;
  }

  :global(.dark) .warning-box li {
    color: rgb(250 204 21);
  }

  .storage-info {
    margin-top: 1rem;
    padding: 1rem;
    background: rgb(249 250 251);
    border-radius: 0.5rem;
  }

  :global(.dark) .storage-info {
    background: rgb(31 41 55);
  }

  .storage-info h3 {
    font-size: 0.875rem;
    font-weight: 600;
    color: rgb(55 65 81);
    margin: 0 0 0.75rem 0;
  }

  :global(.dark) .storage-info h3 {
    color: rgb(209 213 219);
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.5rem;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .info-label {
    font-size: 0.75rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .info-label {
    color: rgb(156 163 175);
  }

  .info-value {
    font-size: 0.875rem;
    font-weight: 500;
    color: rgb(17 24 39);
  }

  :global(.dark) .info-value {
    color: rgb(243 244 246);
  }

  /* Devices List */
  .devices-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .empty-state {
    text-align: center;
    padding: 2rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .empty-state {
    color: rgb(156 163 175);
  }

  .empty-state small {
    display: block;
    margin-top: 0.5rem;
    font-size: 0.875rem;
  }

  .device-card {
    background: rgb(249 250 251);
    border: 1px solid rgb(229 231 235);
    border-radius: 0.5rem;
    padding: 1rem;
    transition: border-color 0.2s;
  }

  :global(.dark) .device-card {
    background: rgb(31 41 55);
    border-color: rgb(55 65 81);
  }

  .device-card.external {
    border-left: 3px solid rgb(245 158 11);
  }

  .device-card:hover {
    border-color: rgb(139, 92, 246);
  }

  .device-header {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .device-icon {
    font-size: 1.5rem;
  }

  .device-info {
    flex: 1;
  }

  .device-label {
    display: block;
    color: rgb(17 24 39);
    margin-bottom: 0.125rem;
  }

  :global(.dark) .device-label {
    color: rgb(243 244 246);
  }

  .device-path {
    font-size: 0.75rem;
    background: rgb(229 231 235);
    color: rgb(55 65 81);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
  }

  :global(.dark) .device-path {
    background: rgb(55 65 81);
    color: rgb(209 213 219);
  }

  .device-details {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .device-type,
  .device-fs,
  .device-space,
  .device-readonly {
    font-size: 0.75rem;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    background: rgb(229 231 235);
    color: rgb(55 65 81);
  }

  :global(.dark) .device-type,
  :global(.dark) .device-fs,
  :global(.dark) .device-space,
  :global(.dark) .device-readonly {
    background: rgb(55 65 81);
    color: rgb(209 213 219);
  }

  .device-space.low-space {
    background: rgb(254 226 226);
    color: rgb(153 27 27);
  }

  :global(.dark) .device-space.low-space {
    background: rgb(127 29 29);
    color: rgb(254 226 226);
  }

  .device-readonly {
    background: rgb(254 226 226);
    color: rgb(153 27 27);
  }

  :global(.dark) .device-readonly {
    background: rgb(127 29 29);
    color: rgb(254 226 226);
  }

  .device-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .path-editor {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .path-input {
    flex: 1;
    min-width: 0;
    padding: 0.5rem 0.75rem;
    border: 1px solid rgb(139, 92, 246);
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-family: monospace;
    background: white;
    color: rgb(55 65 81);
  }

  :global(.dark) .path-input {
    background: rgb(31 41 55);
    border-color: rgb(139, 92, 246);
    color: rgb(209 213 219);
  }

  .path-input:focus {
    outline: none;
    box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.2);
  }

  .suggested-path {
    flex: 1;
    font-size: 0.75rem;
    color: rgb(139, 92, 246);
    background: transparent;
    word-break: break-all;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    transition: background-color 0.15s;
  }

  .suggested-path:hover {
    background: rgba(139, 92, 246, 0.1);
  }

  .suggested-path.modified {
    color: rgb(245, 158, 11);
    font-weight: 500;
  }

  :global(.dark) .suggested-path.modified {
    color: rgb(253, 224, 71);
  }

  .btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    font-size: 0.875rem;
    background: transparent;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  :global(.dark) .btn-icon {
    border-color: rgb(55 65 81);
  }

  .btn-icon:hover {
    background: rgb(243 244 246);
    border-color: rgb(139, 92, 246);
  }

  :global(.dark) .btn-icon:hover {
    background: rgb(55 65 81);
  }

  /* Custom Path Form */
  .custom-path-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    font-weight: 500;
    color: rgb(55 65 81);
  }

  :global(.dark) .form-group label {
    color: rgb(209 213 219);
  }

  .form-group input {
    padding: 0.75rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.5rem;
    font-size: 1rem;
    background: white;
    color: rgb(17 24 39);
    font-family: monospace;
  }

  :global(.dark) .form-group input {
    background: rgb(31 41 55);
    border-color: rgb(55 65 81);
    color: rgb(243 244 246);
  }

  .form-group input:focus {
    outline: none;
    border-color: rgb(139, 92, 246);
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
  }

  .form-group small {
    font-size: 0.875rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .form-group small {
    color: rgb(156 163 175);
  }

  .validation-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: rgb(107 114 128);
  }

  .validation-result {
    padding: 1rem;
    border-radius: 0.5rem;
  }

  .validation-result.valid {
    background: rgb(240 253 244);
    border: 1px solid rgb(187 247 208);
  }

  :global(.dark) .validation-result.valid {
    background: rgb(20 83 45 / 0.3);
    border-color: rgb(22 101 52);
  }

  .validation-result.invalid {
    background: rgb(254 242 242);
    border: 1px solid rgb(254 226 226);
  }

  :global(.dark) .validation-result.invalid {
    background: rgb(127 29 29 / 0.3);
    border-color: rgb(153 27 27);
  }

  .validation-success {
    color: rgb(22 101 52);
  }

  :global(.dark) .validation-success {
    color: rgb(187 247 208);
  }

  .validation-success code {
    display: block;
    margin-top: 0.5rem;
    background: rgb(187 247 208);
    color: rgb(22 101 52);
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
  }

  :global(.dark) .validation-success code {
    background: rgb(20 83 45);
    color: rgb(187 247 208);
  }

  .validation-errors {
    color: rgb(153 27 27);
  }

  :global(.dark) .validation-errors {
    color: rgb(254 226 226);
  }

  .validation-errors ul,
  .validation-warnings ul {
    margin: 0.5rem 0 0 0;
    padding-left: 1.25rem;
  }

  .validation-warnings {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgb(253 224 71);
    color: rgb(120 53 15);
  }

  :global(.dark) .validation-warnings {
    border-color: rgb(180 83 9);
    color: rgb(253 224 71);
  }

  .form-actions {
    display: flex;
    gap: 0.75rem;
  }

  /* Options Card */
  .options-card {
    background: rgb(249 250 251);
  }

  :global(.dark) .options-card {
    background: rgb(31 41 55);
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
  }

  .toggle-label input[type="checkbox"] {
    display: none;
  }

  .toggle-switch {
    position: relative;
    width: 48px;
    height: 24px;
    background: rgb(209 213 219);
    border-radius: 9999px;
    transition: background 0.2s;
  }

  :global(.dark) .toggle-switch {
    background: rgb(55 65 81);
  }

  .toggle-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
  }

  .toggle-label input:checked + .toggle-switch {
    background: rgb(139, 92, 246);
  }

  .toggle-label input:checked + .toggle-switch::after {
    transform: translateX(24px);
  }

  .toggle-text {
    font-weight: 500;
    color: rgb(17 24 39);
  }

  :global(.dark) .toggle-text {
    color: rgb(243 244 246);
  }

  .option-description {
    display: block;
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .option-description {
    color: rgb(156 163 175);
  }

  /* Encryption Card */
  .encryption-card {
    background: linear-gradient(135deg, rgb(249 250 251) 0%, rgb(243 244 246) 100%);
    border: 1px solid rgb(209 213 219);
  }

  :global(.dark) .encryption-card {
    background: linear-gradient(135deg, rgb(17 24 39) 0%, rgb(31 41 55) 100%);
    border-color: rgb(55 65 81);
  }

  .encryption-type-selector {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .encryption-option {
    display: flex;
    cursor: pointer;
  }

  .encryption-option input {
    display: none;
  }

  .encryption-option .option-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1rem;
    background: white;
    border: 2px solid rgb(229 231 235);
    border-radius: 0.75rem;
    transition: all 0.2s;
  }

  :global(.dark) .encryption-option .option-content {
    background: rgb(31 41 55);
    border-color: rgb(55 65 81);
  }

  .encryption-option:hover .option-content {
    border-color: rgb(139, 92, 246);
  }

  .encryption-option.selected .option-content {
    border-color: rgb(139, 92, 246);
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(219, 39, 119, 0.05) 100%);
  }

  :global(.dark) .encryption-option.selected .option-content {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(219, 39, 119, 0.1) 100%);
  }

  .option-icon {
    font-size: 1.75rem;
    margin-bottom: 0.5rem;
  }

  .option-label {
    font-weight: 600;
    color: rgb(17 24 39);
    font-size: 0.875rem;
    text-align: center;
  }

  :global(.dark) .option-label {
    color: rgb(243 244 246);
  }

  .option-desc {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    text-align: center;
    margin-top: 0.25rem;
  }

  :global(.dark) .option-desc {
    color: rgb(156 163 175);
  }

  .encryption-settings {
    padding: 1rem;
    background: rgb(249 250 251);
    border-radius: 0.75rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .encryption-settings {
    background: rgb(17 24 39);
  }

  .encryption-settings .form-group {
    margin-bottom: 1rem;
  }

  .encryption-settings .form-group:last-child {
    margin-bottom: 0;
  }

  .field-error {
    display: block;
    color: rgb(220 38 38);
    font-size: 0.75rem;
    margin-top: 0.25rem;
  }

  :global(.dark) .field-error {
    color: rgb(252 165 165);
  }

  .veracrypt-options {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid rgb(229 231 235);
  }

  :global(.dark) .veracrypt-options {
    border-color: rgb(55 65 81);
  }

  .veracrypt-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .veracrypt-status.checking {
    background: rgb(243 244 246);
    color: rgb(107 114 128);
  }

  :global(.dark) .veracrypt-status.checking {
    background: rgb(31 41 55);
    color: rgb(156 163 175);
  }

  .veracrypt-status.installed {
    background: rgb(220 252 231);
    color: rgb(22 101 52);
  }

  :global(.dark) .veracrypt-status.installed {
    background: rgb(20 83 45 / 0.3);
    color: rgb(134 239 172);
  }

  .veracrypt-status.not-installed {
    background: rgb(254 226 226);
    color: rgb(153 27 27);
  }

  :global(.dark) .veracrypt-status.not-installed {
    background: rgb(127 29 29 / 0.3);
    color: rgb(252 165 165);
  }

  .veracrypt-status a {
    margin-left: auto;
    color: rgb(59 130 246);
    text-decoration: underline;
  }

  .status-icon {
    font-weight: bold;
    font-size: 1.25rem;
  }

  .encryption-info {
    margin-top: 1rem;
    padding: 1rem;
    background: rgb(239 246 255);
    border: 1px solid rgb(191 219 254);
    border-radius: 0.5rem;
  }

  :global(.dark) .encryption-info {
    background: rgb(30 58 138 / 0.2);
    border-color: rgb(59 130 246);
  }

  .encryption-info h4 {
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: rgb(30 64 175);
  }

  :global(.dark) .encryption-info h4 {
    color: rgb(147 197 253);
  }

  .encryption-info ul {
    margin: 0;
    padding-left: 1.25rem;
    font-size: 0.8rem;
  }

  .encryption-info li {
    color: rgb(55 65 81);
    margin-bottom: 0.25rem;
  }

  :global(.dark) .encryption-info li {
    color: rgb(209 213 219);
  }

  .password-warning {
    padding: 0.75rem;
    background: rgb(254 243 199);
    border: 1px solid rgb(253 224 71);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    color: rgb(120 53 15);
  }

  :global(.dark) .password-warning {
    background: rgb(120 53 15 / 0.2);
    border-color: rgb(180 83 9);
    color: rgb(253 224 71);
  }

  .encryption-summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: rgb(243 244 246);
    border-radius: 0.5rem;
  }

  :global(.dark) .encryption-summary {
    background: rgb(31 41 55);
  }

  .encryption-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .encryption-badge.aes {
    background: rgb(220 252 231);
    color: rgb(22 101 52);
  }

  :global(.dark) .encryption-badge.aes {
    background: rgb(20 83 45);
    color: rgb(134 239 172);
  }

  .encryption-badge.veracrypt {
    background: rgb(237 233 254);
    color: rgb(91 33 182);
  }

  :global(.dark) .encryption-badge.veracrypt {
    background: rgb(76 29 149);
    color: rgb(216 180 254);
  }

  /* Warning Card */
  .warning-card {
    background: rgb(254 243 199);
    border-color: rgb(253 224 71);
  }

  :global(.dark) .warning-card {
    background: rgb(120 53 15 / 0.2);
    border-color: rgb(180 83 9);
  }

  .warning-card h2 {
    color: rgb(120 53 15);
  }

  :global(.dark) .warning-card h2 {
    color: rgb(253 224 71);
  }

  .warning-card ul {
    margin: 0;
    padding-left: 1.25rem;
  }

  .warning-card li {
    color: rgb(161 98 7);
    margin-bottom: 0.5rem;
  }

  :global(.dark) .warning-card li {
    color: rgb(250 204 21);
  }

  /* Buttons */
  .btn {
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-sm {
    padding: 0.5rem 1rem;
    font-size: 0.75rem;
  }

  .btn-primary {
    background: linear-gradient(135deg, rgb(139, 92, 246) 0%, rgb(219, 39, 119) 100%);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
  }

  .btn-secondary {
    background: rgb(243 244 246);
    color: rgb(55 65 81);
  }

  :global(.dark) .btn-secondary {
    background: rgb(55 65 81);
    color: rgb(209 213 219);
  }

  .btn-secondary:hover:not(:disabled) {
    background: rgb(229 231 235);
  }

  :global(.dark) .btn-secondary:hover:not(:disabled) {
    background: rgb(75 85 99);
  }

  /* Modal */
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
  }

  .modal-content {
    background: white;
    border-radius: 0.75rem;
    padding: 1.5rem;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
  }

  :global(.dark) .modal-content {
    background: rgb(17 24 39);
  }

  .modal-content h3 {
    font-size: 1.25rem;
    font-weight: 600;
    color: rgb(17 24 39);
    margin: 0 0 1rem 0;
  }

  :global(.dark) .modal-content h3 {
    color: rgb(243 244 246);
  }

  .modal-body {
    margin-bottom: 1.5rem;
  }

  .modal-body p {
    color: rgb(55 65 81);
    margin: 0 0 0.75rem 0;
  }

  :global(.dark) .modal-body p {
    color: rgb(209 213 219);
  }

  .target-path {
    display: block;
    background: rgb(243 244 246);
    color: rgb(139, 92, 246);
    padding: 0.75rem;
    border-radius: 0.5rem;
    font-family: monospace;
    font-size: 0.875rem;
    margin-bottom: 1rem;
    word-break: break-all;
  }

  :global(.dark) .target-path {
    background: rgb(31 41 55);
    color: rgb(196 181 253);
  }

  .time-warning {
    font-size: 0.875rem;
    color: rgb(107 114 128);
    font-style: italic;
  }

  :global(.dark) .time-warning {
    color: rgb(156 163 175);
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  /* Migration Configuration Modal */
  .migration-config-modal {
    max-width: 500px;
  }

  .migration-config-modal h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .config-section {
    margin-bottom: 1.25rem;
    padding-bottom: 1.25rem;
    border-bottom: 1px solid rgb(229 231 235);
  }

  :global(.dark) .config-section {
    border-bottom-color: rgb(55 65 81);
  }

  .config-section:last-of-type {
    border-bottom: none;
    padding-bottom: 0;
    margin-bottom: 0;
  }

  .config-label {
    display: block;
    font-weight: 600;
    font-size: 0.875rem;
    color: rgb(55 65 81);
    margin-bottom: 0.75rem;
  }

  :global(.dark) .config-label {
    color: rgb(209 213 219);
  }

  .encryption-options-compact {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .radio-option {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem 0.75rem;
    background: rgb(243 244 246);
    border: 2px solid transparent;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  :global(.dark) .radio-option {
    background: rgb(31 41 55);
  }

  .radio-option:hover {
    border-color: rgb(139, 92, 246);
  }

  .radio-option.selected {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(219, 39, 119, 0.1) 100%);
    border-color: rgb(139, 92, 246);
  }

  .radio-option input {
    display: none;
  }

  .radio-label {
    font-size: 0.8rem;
    font-weight: 500;
    color: rgb(55 65 81);
    white-space: nowrap;
  }

  :global(.dark) .radio-label {
    color: rgb(209 213 219);
  }

  .radio-option.selected .radio-label {
    color: rgb(139, 92, 246);
  }

  .encryption-fields {
    background: rgb(249 250 251);
    border-radius: 0.5rem;
    padding: 0.75rem;
  }

  :global(.dark) .encryption-fields {
    background: rgb(31 41 55);
  }

  .form-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .input-field {
    flex: 1;
    padding: 0.5rem 0.75rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: white;
    color: rgb(17 24 39);
  }

  :global(.dark) .input-field {
    background: rgb(17 24 39);
    border-color: rgb(55 65 81);
    color: rgb(243 244 246);
  }

  .input-field:focus {
    outline: none;
    border-color: rgb(139, 92, 246);
    box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.1);
  }

  .select-field {
    padding: 0.5rem 0.75rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: white;
    color: rgb(17 24 39);
    cursor: pointer;
  }

  :global(.dark) .select-field {
    background: rgb(17 24 39);
    border-color: rgb(55 65 81);
    color: rgb(243 244 246);
  }

  .inline-label {
    font-size: 0.8rem;
    color: rgb(107 114 128);
    white-space: nowrap;
    display: flex;
    align-items: center;
  }

  :global(.dark) .inline-label {
    color: rgb(156 163 175);
  }

  .veracrypt-warning {
    padding: 0.5rem;
    background: rgb(254 243 199);
    border-radius: 0.375rem;
    font-size: 0.75rem;
    color: rgb(120 53 15);
    margin-bottom: 0.5rem;
  }

  :global(.dark) .veracrypt-warning {
    background: rgb(120 53 15 / 0.3);
    color: rgb(253 224 71);
  }

  .veracrypt-warning a {
    color: rgb(59 130 246);
    text-decoration: underline;
    margin-left: 0.25rem;
  }

  .password-note {
    font-size: 0.7rem;
    color: rgb(161 98 7);
    margin: 0.5rem 0 0 0;
    padding: 0.5rem;
    background: rgb(254 252 232);
    border-radius: 0.375rem;
  }

  :global(.dark) .password-note {
    background: rgb(113 63 18 / 0.2);
    color: rgb(250 204 21);
  }

  .toggle-options {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .checkbox-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.875rem;
    color: rgb(55 65 81);
  }

  :global(.dark) .checkbox-option {
    color: rgb(209 213 219);
  }

  .checkbox-option input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: rgb(139, 92, 246);
    cursor: pointer;
  }

  .checkbox-option:hover {
    color: rgb(139, 92, 246);
  }

  .migration-summary {
    margin-top: 1rem;
    padding: 0.75rem;
    background: rgb(249 250 251);
    border-radius: 0.5rem;
    border-left: 3px solid rgb(139, 92, 246);
  }

  :global(.dark) .migration-summary {
    background: rgb(31 41 55);
  }

  .migration-summary strong {
    display: block;
    font-size: 0.8rem;
    color: rgb(107 114 128);
    margin-bottom: 0.5rem;
  }

  :global(.dark) .migration-summary strong {
    color: rgb(156 163 175);
  }

  .migration-summary ul {
    margin: 0;
    padding-left: 1.25rem;
    font-size: 0.8rem;
  }

  .migration-summary li {
    color: rgb(55 65 81);
    margin-bottom: 0.25rem;
  }

  :global(.dark) .migration-summary li {
    color: rgb(209 213 219);
  }

  .migration-summary li.destructive {
    color: rgb(220 38 38);
    font-weight: 500;
  }

  :global(.dark) .migration-summary li.destructive {
    color: rgb(252 165 165);
  }

  /* Migration Modal */
  .migration-modal {
    max-width: 700px;
  }

  .migration-target {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    padding: 0.75rem;
    background: rgb(249 250 251);
    border-radius: 0.5rem;
  }

  :global(.dark) .migration-target {
    background: rgb(31 41 55);
  }

  .migration-target code {
    flex: 1;
    font-size: 0.875rem;
    color: rgb(139, 92, 246);
    word-break: break-all;
  }

  .progress-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 400px;
    overflow-y: auto;
    margin-bottom: 1.5rem;
  }

  .progress-step {
    display: flex;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 0.5rem;
    background: rgb(249 250 251);
  }

  :global(.dark) .progress-step {
    background: rgb(31 41 55);
  }

  .progress-step.running {
    background: rgb(219 234 254);
    border-left: 3px solid rgb(59 130 246);
  }

  :global(.dark) .progress-step.running {
    background: rgb(30 58 138 / 0.3);
    border-left-color: rgb(59 130 246);
  }

  .progress-step.completed {
    background: rgb(240 253 244);
    border-left: 3px solid rgb(34 197 94);
  }

  :global(.dark) .progress-step.completed {
    background: rgb(20 83 45 / 0.3);
    border-left-color: rgb(34 197 94);
  }

  .progress-step.failed {
    background: rgb(254 242 242);
    border-left: 3px solid rgb(239 68 68);
  }

  :global(.dark) .progress-step.failed {
    background: rgb(127 29 29 / 0.3);
    border-left-color: rgb(239 68 68);
  }

  .progress-step.skipped {
    opacity: 0.6;
  }

  .step-icon {
    font-weight: bold;
    width: 20px;
    text-align: center;
  }

  .progress-step.completed .step-icon {
    color: rgb(34 197 94);
  }

  .progress-step.failed .step-icon {
    color: rgb(239 68 68);
  }

  .progress-step.running .step-icon {
    color: rgb(59 130 246);
  }

  .step-content {
    flex: 1;
  }

  .step-message {
    display: block;
    font-size: 0.875rem;
    color: rgb(55 65 81);
  }

  :global(.dark) .step-message {
    color: rgb(209 213 219);
  }

  .progress-bar {
    margin-top: 0.5rem;
    height: 4px;
    background: rgb(229 231 235);
    border-radius: 9999px;
    overflow: hidden;
  }

  :global(.dark) .progress-bar {
    background: rgb(55 65 81);
  }

  .progress-fill {
    height: 100%;
    background: rgb(139, 92, 246);
    transition: width 0.3s;
  }

  .step-error {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: rgb(239 68 68);
  }

  :global(.dark) .step-error {
    color: rgb(252 165 165);
  }

  .migrating-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .migrating-indicator {
    color: rgb(156 163 175);
  }

  /* Encryption Status Card */
  .encryption-status-card {
    margin-top: 1.5rem;
    padding: 1rem;
    background: linear-gradient(135deg, rgb(249 250 251) 0%, rgb(243 244 246) 100%);
    border: 1px solid rgb(229 231 235);
    border-radius: 0.75rem;
  }

  :global(.dark) .encryption-status-card {
    background: linear-gradient(135deg, rgb(17 24 39) 0%, rgb(31 41 55) 100%);
    border-color: rgb(55 65 81);
  }

  .encryption-status-card h3 {
    font-size: 1rem;
    font-weight: 600;
    color: rgb(17 24 39);
    margin: 0 0 1rem 0;
  }

  :global(.dark) .encryption-status-card h3 {
    color: rgb(243 244 246);
  }

  .encryption-status-content {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-radius: 9999px;
    font-weight: 500;
    width: fit-content;
  }

  .status-badge.encrypted {
    background: rgb(220 252 231);
    color: rgb(22 101 52);
  }

  :global(.dark) .status-badge.encrypted {
    background: rgb(20 83 45 / 0.4);
    color: rgb(134 239 172);
  }

  .status-badge.unencrypted {
    background: rgb(254 243 199);
    color: rgb(120 53 15);
  }

  :global(.dark) .status-badge.unencrypted {
    background: rgb(120 53 15 / 0.3);
    color: rgb(253 224 71);
  }

  .status-badge .status-icon {
    font-size: 1.25rem;
  }

  .status-badge .status-text {
    font-size: 0.875rem;
  }

  .status-description {
    font-size: 0.875rem;
    color: rgb(107 114 128);
    margin: 0;
    line-height: 1.5;
  }

  :global(.dark) .status-description {
    color: rgb(156 163 175);
  }

  /* Encryption Modal */
  .encryption-modal {
    max-width: 450px;
  }

  .encryption-modal-description {
    font-size: 0.875rem;
    color: rgb(55 65 81);
    margin: 0 0 1rem 0;
    line-height: 1.5;
  }

  :global(.dark) .encryption-modal-description {
    color: rgb(209 213 219);
  }

  .encryption-modal .encryption-fields {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .encryption-modal .encryption-fields .form-group {
    margin-bottom: 0;
  }

  .encryption-modal .encryption-fields .form-group label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    color: rgb(55 65 81);
    margin-bottom: 0.375rem;
  }

  :global(.dark) .encryption-modal .encryption-fields .form-group label {
    color: rgb(209 213 219);
  }

  .encryption-modal .encryption-fields .input-field {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.5rem;
    font-size: 1rem;
    background: white;
    color: rgb(17 24 39);
  }

  :global(.dark) .encryption-modal .encryption-fields .input-field {
    background: rgb(31 41 55);
    border-color: rgb(55 65 81);
    color: rgb(243 244 246);
  }

  .encryption-modal .encryption-fields .input-field:focus {
    outline: none;
    border-color: rgb(139, 92, 246);
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
  }
</style>
