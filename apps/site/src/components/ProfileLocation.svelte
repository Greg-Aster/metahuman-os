<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

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
    encryptionType?: 'none' | 'aes256' | 'luks' | 'veracrypt';
    encryptionInfo?: {
      algorithm: string;
      createdAt: string;
      encryptedFiles: number;
      useLoginPassword: boolean;
    };
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

  type EncryptionType = 'none' | 'aes256' | 'luks' | 'veracrypt';

  const CONTAINER_SIZES = [
    { value: 2 * 1024 * 1024 * 1024, label: '2 GB', description: 'Basic profile' },
    { value: 10 * 1024 * 1024 * 1024, label: '10 GB', description: 'Standard profile' },
    { value: 50 * 1024 * 1024 * 1024, label: '50 GB', description: 'Profile with voice data' },
    { value: 100 * 1024 * 1024 * 1024, label: '100 GB', description: 'Large profile with LLM adapters' },
    { value: 200 * 1024 * 1024 * 1024, label: '200 GB', description: 'Full profile with multiple LLMs' },
    { value: 1000 * 1024 * 1024 * 1024, label: '1000 GB', description: 'Small singularity' },
  ];

  let profileConfig: ProfileConfig | null = null;
  let devices: StorageDevice[] = [];
  let loading = true;
  let devicesLoading = false;
  let error = '';
  let success = '';

  let showCustomPath = false;
  let customPath = '';
  let validating = false;
  let validation: ValidationResult | null = null;

  let showMigrationModal = false;
  let migrating = false;
  let migrationProgress: MigrationProgress[] = [];
  let migrationTarget = '';
  let keepSourceFiles = true;
  let overwriteExisting = false;

  let encryptionType: EncryptionType = 'none';
  let encryptionPassword = '';
  let encryptionPasswordConfirm = '';
  let veracryptStatus: VeraCryptStatus | null = null;
  let containerSize = CONTAINER_SIZES[1].value;
  let checkingVeraCrypt = false;
  let useMigrationLoginPassword = false;

  let showConfirmDialog = false;
  let pendingPath = '';

  let devicePaths: Record<string, string> = {};

  let showEncryptModal = false;
  let showDecryptModal = false;
  let encryptInPlacePassword = '';
  let encryptInPlacePasswordConfirm = '';
  let decryptPassword = '';
  let encryptingInPlace = false;
  let decryptingInPlace = false;
  let encryptInPlaceType: 'aes256' = 'aes256';
  let encryptInPlaceProgress: MigrationProgress[] = [];
  let editingDeviceId: string | null = null;
  let useLoginPassword = false;

  let migrationSuccess = false;
  let switchingLocation = false;

  let showChangeLocationModal = false;
  let changeLocationPath = '';

  $: passwordsMatch = encryptionPassword === encryptionPasswordConfirm;
  $: passwordValid = encryptionPassword.length >= 8;
  $: encryptionReady = encryptionType === 'none' ||
    ((encryptionType === 'aes256' || encryptionType === 'luks') && useMigrationLoginPassword && passwordValid) ||
    (passwordValid && passwordsMatch &&
      (encryptionType === 'aes256' || encryptionType === 'luks' || (encryptionType === 'veracrypt' && veracryptStatus?.installed)));

  $: encryptInPlacePasswordsMatch = encryptInPlacePassword === encryptInPlacePasswordConfirm;
  $: encryptInPlacePasswordValid = encryptInPlacePassword.length >= 8;
  $: encryptInPlaceReady = useLoginPassword
    ? encryptInPlacePasswordValid
    : (encryptInPlacePasswordValid && encryptInPlacePasswordsMatch);

  onMount(async () => {
    await Promise.all([loadProfileConfig(), loadDevices(), checkVeraCryptStatus()]);
  });

  async function checkVeraCryptStatus() {
    checkingVeraCrypt = true;
    try {
      const response = await apiFetch('/api/veracrypt/status');
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
      const response = await apiFetch('/api/profile-path');
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
      const response = await apiFetch('/api/profile-path/devices');
      if (response.ok) {
        const data = await response.json();
        devices = data.devices || [];
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
      const response = await apiFetch('/api/profile-path/validate', {
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

    const encryptionOptions = encryptionType !== 'none' ? {
      type: encryptionType,
      password: encryptionPassword,
      containerSize: (encryptionType === 'veracrypt' || encryptionType === 'luks') ? containerSize : undefined,
      useLoginPassword: (encryptionType === 'aes256' || encryptionType === 'luks') ? useMigrationLoginPassword : undefined,
    } : undefined;

    try {
      const response = await apiFetch('/api/profile-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: targetPath,
          keepSource: keepSourceFiles,
          overwrite: overwriteExisting,
          encryption: encryptionOptions,
        }),
      });

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
                    if (data.progress.status === 'completed' && data.progress.step === 'complete') {
                      success = 'Profile migration completed successfully!';
                      migrationSuccess = true;
                      await loadProfileConfig();
                    } else if (data.progress.status === 'failed') {
                      error = data.progress.error || 'Migration failed';
                      migrationSuccess = false;
                    }
                  }
                  if (data.result) {
                    if (data.result.success) {
                      success = `Profile migrated successfully! ${data.result.filesProcessed} files (${formatBytes(data.result.bytesProcessed)}) moved in ${(data.result.duration / 1000).toFixed(1)}s`;
                      migrationSuccess = true;
                    } else {
                      error = data.result.error || 'Migration failed';
                      migrationSuccess = false;
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
          migrationSuccess = false;
        } else if (data.result) {
          if (data.result.success) {
            success = 'Profile migrated successfully!';
            migrationSuccess = true;
            await loadProfileConfig();
          } else {
            error = data.result.error || 'Migration failed';
            migrationSuccess = false;
          }
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Migration failed';
      migrationSuccess = false;
      console.error(err);
    } finally {
      migrating = false;
      encryptionPassword = '';
      encryptionPasswordConfirm = '';
      useMigrationLoginPassword = false;
    }
  }

  async function resetToDefault() {
    if (!confirm('Reset profile location to default? This will only update the configuration, not move any files.')) {
      return;
    }
    try {
      const response = await apiFetch('/api/profile-path', { method: 'DELETE' });
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

  async function encryptProfileInPlace() {
    if (!encryptInPlaceReady) return;
    encryptingInPlace = true;
    encryptInPlaceProgress = [];
    error = '';
    success = '';

    try {
      const response = await apiFetch('/api/profile-path/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: encryptInPlacePassword,
          type: encryptInPlaceType,
          useLoginPassword,
        }),
      });

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
      useLoginPassword = false;
    }
  }

  async function decryptProfileInPlace() {
    if (!decryptPassword) return;
    decryptingInPlace = true;
    encryptInPlaceProgress = [];
    error = '';
    success = '';

    try {
      const response = await apiFetch('/api/profile-path/decrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: decryptPassword }),
      });

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

  async function switchToLocation(targetPath: string) {
    switchingLocation = true;
    error = '';
    success = '';
    try {
      const response = await apiFetch('/api/profile-path', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, type: 'external' }),
      });
      const data = await response.json();
      if (data.success) {
        success = `Switched to ${targetPath}`;
        migrationSuccess = false;
        showMigrationModal = false;
        showChangeLocationModal = false;
        await loadProfileConfig();
      } else {
        error = data.error || 'Failed to switch location';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to switch location';
      console.error(err);
    } finally {
      switchingLocation = false;
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
      case 'usb': return '🔌';
      case 'network': return '🌐';
      case 'encrypted': return '🔒';
      default: return '💾';
    }
  }

  function getStatusIcon(status: string): string {
    switch (status) {
      case 'completed': return '✓';
      case 'failed': return '✗';
      case 'skipped': return '○';
      case 'running': return '→';
      default: return '•';
    }
  }
</script>

<div class="p-8 max-w-[900px] mx-auto h-full overflow-y-auto">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">📁 Profile Storage Location</h1>
    <p class="text-gray-500 dark:text-gray-400">Configure where your profile data is stored</p>
  </div>

  {#if loading}
    <div class="flex flex-col items-center justify-center py-16">
      <div class="spinner"></div>
      <p class="mt-4 text-gray-500 dark:text-gray-400 italic">Loading profile configuration...</p>
    </div>
  {:else}
    {#if error}
      <div class="banner banner-error mb-4">
        <span>{error}</span>
        <button class="ml-auto text-2xl opacity-60 hover:opacity-100" on:click={() => error = ''}>×</button>
      </div>
    {/if}

    {#if success}
      <div class="banner banner-success mb-4">
        <span>{success}</span>
        <button class="ml-auto text-2xl opacity-60 hover:opacity-100" on:click={() => success = ''}>×</button>
      </div>
    {/if}

    <!-- Current Configuration -->
    {#if profileConfig}
      <div class="panel mb-6">
        <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Current Location</h2>
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-4">
            <span class="font-medium text-gray-500 dark:text-gray-400 min-w-[120px]">Path:</span>
            <code class="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-violet-600 dark:text-violet-400 rounded font-mono text-sm break-all">{profileConfig.currentPath}</code>
          </div>
          <div class="flex items-center gap-4">
            <span class="font-medium text-gray-500 dark:text-gray-400 min-w-[120px]">Storage Type:</span>
            <span class="px-3 py-1 rounded-full text-sm font-medium
                        {profileConfig.storageType === 'internal' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : ''}
                        {profileConfig.storageType === 'external' || profileConfig.storageType === 'usb' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : ''}
                        {profileConfig.storageType === 'network' ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' : ''}
                        {profileConfig.storageType === 'encrypted' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : ''}">
              {getStorageTypeIcon(profileConfig.storageType)} {profileConfig.storageType}
            </span>
          </div>
          <div class="flex items-center gap-4">
            <span class="font-medium text-gray-500 dark:text-gray-400 min-w-[120px]">Custom Location:</span>
            <span class="text-gray-900 dark:text-gray-100">{profileConfig.isCustom ? 'Yes' : 'No (Default)'}</span>
          </div>

          {#if profileConfig.usingFallback}
            <div class="banner banner-warning mt-3">
              <div>
                <strong>⚠️ External Drive Unavailable</strong>
                <p class="text-sm mt-1">{profileConfig.fallbackReason || 'Custom location unavailable'}</p>
                <div class="mt-3 pt-3 border-t border-amber-500/30">
                  <p class="font-medium mb-2">To reconnect:</p>
                  <ol class="list-decimal ml-5 text-sm space-y-1">
                    <li>Ensure your external drive is connected and mounted</li>
                    <li>Click the <strong>Refresh</strong> button in "Available Storage Devices" below</li>
                    <li>Use <strong>Change Location</strong> to switch back to your external profile</li>
                  </ol>
                  <p class="mt-3 text-sm italic opacity-90">Currently using fallback location. Changes will be saved locally until you reconnect.</p>
                </div>
              </div>
            </div>
          {/if}

          {#if profileConfig.storageInfo}
            <div class="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Storage Details</h3>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div class="flex flex-col">
                  <span class="text-xs text-gray-500 dark:text-gray-400">Device ID</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{profileConfig.storageInfo.id}</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-xs text-gray-500 dark:text-gray-400">Label</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{profileConfig.storageInfo.label}</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-xs text-gray-500 dark:text-gray-400">Free Space</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{profileConfig.storageInfo.freeSpaceFormatted}</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-xs text-gray-500 dark:text-gray-400">Total Space</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{profileConfig.storageInfo.totalSpaceFormatted}</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-xs text-gray-500 dark:text-gray-400">Writable</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{profileConfig.storageInfo.writable ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>
          {/if}

          <!-- Encryption Status -->
          <div class="mt-6 p-4 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
            <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">🔐 Encryption Status</h3>
            <div class="flex flex-col gap-3">
              {#if profileConfig.isEncrypted}
                <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full font-medium w-fit bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                  <span class="text-xl">🔒</span>
                  <span class="text-sm">Encrypted ({profileConfig.encryptionType === 'veracrypt' ? 'VeraCrypt' : profileConfig.encryptionType === 'luks' ? 'LUKS' : 'AES-256'})</span>
                </div>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Your profile data is protected with encryption.
                  {#if profileConfig.encryptionType === 'aes256'}
                    Individual files are encrypted with AES-256-GCM.
                  {:else if profileConfig.encryptionType === 'luks'}
                    Data is stored in an encrypted LUKS volume (Linux native).
                  {:else}
                    Data is stored in an encrypted VeraCrypt container.
                  {/if}
                </p>
                {#if profileConfig.encryptionType === 'aes256'}
                  <button class="btn-secondary btn-sm w-fit" on:click={() => showDecryptModal = true} disabled={decryptingInPlace}>
                    🔓 Decrypt Profile
                  </button>
                {/if}
              {:else}
                <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full font-medium w-fit bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  <span class="text-xl">📁</span>
                  <span class="text-sm">Not Encrypted</span>
                </div>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Your profile data is stored as plain files. Consider encrypting for better security, especially if using external storage.
                </p>
                <button class="btn-primary btn-sm w-fit" on:click={() => showEncryptModal = true} disabled={encryptingInPlace}>
                  🔒 Encrypt Profile
                </button>
              {/if}
            </div>
          </div>

          <div class="flex gap-3 mt-4 flex-wrap">
            <button class="btn-secondary" on:click={() => { showChangeLocationModal = true; changeLocationPath = ''; }}>
              📂 Change Location
            </button>
            {#if profileConfig.isCustom}
              <button class="btn-secondary" on:click={resetToDefault}>
                Reset to Default Location
              </button>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- Available Storage Devices -->
    <div class="panel mb-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Available Storage Devices</h2>
        <button class="btn-secondary btn-sm" on:click={loadDevices} disabled={devicesLoading}>
          {devicesLoading ? 'Scanning...' : '🔄 Refresh'}
        </button>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 mb-4">
        💡 Plugged in a new drive? Click <strong>Refresh</strong> to detect it.
      </p>

      {#if devicesLoading}
        <p class="text-gray-500 dark:text-gray-400 italic">Scanning for storage devices...</p>
      {:else if devices.length === 0}
        <div class="text-center py-8 text-gray-500 dark:text-gray-400">
          <p>No external storage devices detected.</p>
          <small class="block mt-2 text-sm">Connect a USB drive or network storage and click Refresh to see it here.</small>
        </div>
      {:else}
        <div class="flex flex-col gap-4">
          {#each devices as device}
            <div class="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-colors hover:border-violet-500 {device.isExternal ? 'border-l-[3px] border-l-amber-500' : ''}">
              <div class="flex items-start gap-3 mb-3">
                <span class="text-2xl">{getStorageTypeIcon(device.type)}</span>
                <div class="flex-1">
                  <strong class="block text-gray-900 dark:text-gray-100">{device.label}</strong>
                  <code class="text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">{device.path}</code>
                </div>
              </div>
              <div class="flex flex-wrap gap-2 mb-3">
                <span class="px-2 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{device.type}</span>
                <span class="px-2 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{device.fsType || 'Unknown'}</span>
                <span class="px-2 py-0.5 text-xs rounded-full {device.freeSpace < 1024 * 1024 * 1024 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}">
                  {device.freeSpaceFormatted} free
                </span>
                {#if !device.writable}
                  <span class="px-2 py-0.5 text-xs rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300">Read Only</span>
                {/if}
              </div>
              <div class="flex items-center gap-3">
                <div class="flex-1 flex items-center gap-2 min-w-0">
                  {#if editingDeviceId === device.id}
                    <input
                      type="text"
                      class="input-field flex-1 font-mono text-xs"
                      bind:value={devicePaths[device.id]}
                      on:blur={stopEditingPath}
                      on:keydown={(e) => e.key === 'Enter' && stopEditingPath()}
                      placeholder={device.suggestedPath}
                    />
                    {#if devicePaths[device.id] !== device.suggestedPath}
                      <button class="btn-ghost btn-sm" title="Reset to default" on:click={() => resetDevicePath(device)}>↺</button>
                    {/if}
                  {:else}
                    <code
                      class="flex-1 text-xs text-violet-600 dark:text-violet-400 cursor-pointer px-2 py-1 rounded hover:bg-violet-500/10 break-all {devicePaths[device.id] && devicePaths[device.id] !== device.suggestedPath ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}"
                      on:click={() => startEditingPath(device)}
                      title="Click to edit path"
                    >
                      {getDevicePath(device)}
                    </code>
                    <button class="btn-ghost btn-sm" title="Edit path" on:click={() => startEditingPath(device)}>✏️</button>
                  {/if}
                </div>
                <button class="btn-primary btn-sm" on:click={() => initiateMove(getDevicePath(device))} disabled={!device.writable || migrating}>
                  Move Here
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Custom Path Input -->
    <div class="panel mb-6">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Custom Path</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">Specify a custom location for your profile data</p>

      {#if !showCustomPath}
        <button class="btn-secondary" on:click={() => showCustomPath = true}>Enter Custom Path</button>
      {:else}
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <label for="customPath" class="font-medium text-gray-700 dark:text-gray-300">Profile Path</label>
            <input
              id="customPath"
              type="text"
              class="input-field font-mono"
              bind:value={customPath}
              placeholder="/path/to/your/profile"
              on:blur={handleValidateCustomPath}
              disabled={validating || migrating}
            />
            <small class="text-sm text-gray-500 dark:text-gray-400">Enter an absolute path where you want to store your profile data</small>
          </div>

          {#if validating}
            <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <div class="spinner spinner-sm"></div>
              <span>Validating path...</span>
            </div>
          {:else if validation}
            <div class="p-4 rounded-lg {validation.valid ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800'}">
              {#if validation.valid}
                <div class="text-green-700 dark:text-green-300">
                  <strong>✓ Valid Path</strong>
                  <code class="block mt-2 px-2 py-1 bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200 rounded text-sm">{validation.resolvedPath}</code>
                </div>
              {:else}
                <div class="text-red-700 dark:text-red-300">
                  <strong>✗ Invalid Path</strong>
                  <ul class="mt-2 ml-5 list-disc">
                    {#each validation.errors as err}
                      <li>{err}</li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if validation.warnings.length > 0}
                <div class="mt-3 pt-3 border-t border-amber-400 dark:border-amber-600 text-amber-700 dark:text-amber-300">
                  <strong>⚠️ Warnings:</strong>
                  <ul class="mt-2 ml-5 list-disc">
                    {#each validation.warnings as warning}
                      <li>{warning}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/if}

          <div class="flex gap-3">
            <button class="btn-primary" on:click={() => initiateMove(customPath.trim())} disabled={!validation?.valid || migrating}>
              Move to Custom Path
            </button>
            <button class="btn-secondary" on:click={() => { showCustomPath = false; customPath = ''; validation = null; }} disabled={migrating}>
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Security Warning -->
    <div class="panel bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700">
      <h2 class="text-xl font-semibold text-amber-800 dark:text-amber-300 mb-3">⚠️ Security Considerations</h2>
      <ul class="list-disc ml-5 text-amber-700 dark:text-amber-300 space-y-2">
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
    <div class="modal-content max-w-[500px]" on:click|stopPropagation>
      <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">📁 Configure Migration</h3>

      <div class="space-y-4">
        <div class="pb-4 border-b border-gray-200 dark:border-gray-700">
          <label class="block font-semibold text-sm text-gray-700 dark:text-gray-300 mb-2">Destination</label>
          <code class="block p-3 bg-gray-100 dark:bg-gray-800 text-violet-600 dark:text-violet-400 rounded-lg font-mono text-sm break-all">{pendingPath}</code>
        </div>

        <!-- Encryption Selection -->
        <div class="pb-4 border-b border-gray-200 dark:border-gray-700">
          <label class="block font-semibold text-sm text-gray-700 dark:text-gray-300 mb-3">🔐 Encryption</label>
          <div class="flex gap-2 mb-3">
            {#each [
              { value: 'none', label: '📁 None' },
              { value: 'aes256', label: '🔒 AES-256' },
              { value: 'luks', label: '🐧 LUKS' },
              { value: 'veracrypt', label: '🛡️ VeraCrypt' },
            ] as option}
              <label class="flex-1 flex items-center justify-center px-3 py-2 bg-gray-100 dark:bg-gray-800 border-2 border-transparent rounded-lg cursor-pointer transition-all hover:border-violet-500 {encryptionType === option.value ? 'bg-violet-500/10 border-violet-500' : ''}">
                <input type="radio" bind:group={encryptionType} value={option.value} class="hidden" />
                <span class="text-sm font-medium {encryptionType === option.value ? 'text-violet-600 dark:text-violet-400' : 'text-gray-700 dark:text-gray-300'}">{option.label}</span>
              </label>
            {/each}
          </div>

          {#if encryptionType !== 'none'}
            <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
              {#if encryptionType === 'aes256' || encryptionType === 'luks'}
                <label class="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" bind:checked={useMigrationLoginPassword} on:change={() => { encryptionPassword = ''; encryptionPasswordConfirm = ''; }} class="w-4 h-4 accent-violet-500" />
                  <span class="text-sm text-gray-700 dark:text-gray-300">Use my login password for encryption</span>
                </label>
              {/if}

              {#if !useMigrationLoginPassword || encryptionType === 'veracrypt'}
                <div class="flex gap-2">
                  <input type="password" bind:value={encryptionPassword} placeholder="Password (min 8 characters)" class="input-field flex-1" />
                  <input type="password" bind:value={encryptionPasswordConfirm} placeholder="Confirm password" class="input-field flex-1" />
                </div>
                {#if encryptionPassword && !passwordValid}
                  <span class="text-xs text-red-500">Password must be at least 8 characters</span>
                {/if}
                {#if encryptionPasswordConfirm && !passwordsMatch}
                  <span class="text-xs text-red-500">Passwords do not match</span>
                {/if}
              {:else}
                <input type="password" bind:value={encryptionPassword} placeholder="Enter your login password" class="input-field" />
                {#if encryptionPassword && !passwordValid}
                  <span class="text-xs text-red-500">Password must be at least 8 characters</span>
                {/if}
              {/if}

              {#if encryptionType === 'luks' || encryptionType === 'veracrypt'}
                <div class="flex items-center gap-2">
                  <label class="text-sm text-gray-500 dark:text-gray-400">Container Size:</label>
                  <select bind:value={containerSize} class="select-field">
                    {#each CONTAINER_SIZES as size}
                      <option value={size.value}>{size.label}</option>
                    {/each}
                  </select>
                </div>
              {/if}

              {#if encryptionType === 'veracrypt' && !veracryptStatus?.installed}
                <div class="p-2 bg-amber-100 dark:bg-amber-900/30 rounded text-xs text-amber-700 dark:text-amber-300">
                  ⚠️ VeraCrypt not installed. <a href="https://www.veracrypt.fr/en/Downloads.html" target="_blank" class="text-blue-500 underline">Download</a>
                </div>
              {/if}

              <p class="text-xs {useMigrationLoginPassword ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}">
                {useMigrationLoginPassword ? '✓ Your login password will be verified and used for encryption.' : '⚠️ Password is never stored. If forgotten, data cannot be recovered.'}
              </p>
            </div>
          {/if}
        </div>

        <!-- Migration Options -->
        <div class="pb-4 border-b border-gray-200 dark:border-gray-700">
          <label class="block font-semibold text-sm text-gray-700 dark:text-gray-300 mb-3">⚙️ Options</label>
          <div class="space-y-2">
            <label class="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" bind:checked={keepSourceFiles} class="w-4 h-4 accent-violet-500" />
              <span>Keep source files after migration</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" bind:checked={overwriteExisting} class="w-4 h-4 accent-violet-500" />
              <span>Overwrite existing files at destination</span>
            </label>
          </div>
        </div>

        <!-- Summary -->
        <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border-l-[3px] border-l-violet-500">
          <strong class="block text-sm text-gray-500 dark:text-gray-400 mb-2">This will:</strong>
          <ul class="list-disc ml-5 text-sm text-gray-700 dark:text-gray-300 space-y-1">
            {#if encryptionType === 'veracrypt'}
              <li>Create encrypted VeraCrypt container</li>
            {:else if encryptionType === 'luks'}
              <li>Create encrypted LUKS volume (Linux native)</li>
            {:else if encryptionType === 'aes256'}
              <li>Encrypt files with AES-256-GCM</li>
            {:else}
              <li>Copy files to new location</li>
            {/if}
            <li>Update system configuration</li>
            {#if !keepSourceFiles}
              <li class="text-red-500 dark:text-red-400 font-medium">Delete original files</li>
            {/if}
          </ul>
        </div>
      </div>

      <div class="modal-footer mt-6">
        <button class="btn-secondary" on:click={() => showConfirmDialog = false}>Cancel</button>
        <button class="btn-primary" on:click={confirmMove} disabled={!encryptionReady} title={!encryptionReady ? 'Complete encryption settings first' : ''}>
          {encryptionType !== 'none' ? '🔐 Start Encrypted Migration' : '📦 Start Migration'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Migration Progress Modal -->
{#if showMigrationModal}
  <div class="modal-overlay">
    <div class="modal-content max-w-[700px]">
      <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">📦 Migration in Progress</h3>

      <div class="flex items-center gap-2 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg mb-4">
        <span class="text-sm text-gray-500 dark:text-gray-400">Target:</span>
        <code class="flex-1 text-sm text-violet-600 dark:text-violet-400 break-all">{migrationTarget}</code>
      </div>

      <div class="flex flex-col gap-2 max-h-[400px] overflow-y-auto mb-4">
        {#each migrationProgress as step}
          <div class="progress-step {step.status}">
            <span class="font-bold w-5 text-center {step.status === 'completed' ? 'text-green-500' : step.status === 'failed' ? 'text-red-500' : step.status === 'running' ? 'text-blue-500' : ''}">{getStatusIcon(step.status)}</span>
            <div class="flex-1">
              <span class="block text-sm text-gray-700 dark:text-gray-300">{step.message}</span>
              {#if step.progress !== undefined}
                <div class="progress-bar-track mt-2">
                  <div class="progress-bar-fill" style="width: {step.progress}%"></div>
                </div>
              {/if}
              {#if step.error}
                <span class="block mt-1 text-xs text-red-500">{step.error}</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      {#if !migrating}
        <div class="modal-footer">
          {#if migrationSuccess}
            <div class="w-full text-center">
              <p class="text-green-500 font-medium mb-4">✅ Migration completed! Would you like to switch to the new location?</p>
              <div class="flex gap-3 justify-center flex-wrap">
                <button class="btn-primary" on:click={() => switchToLocation(migrationTarget)} disabled={switchingLocation}>
                  {switchingLocation ? 'Switching...' : '🔄 Switch to New Location'}
                </button>
                <button class="btn-secondary" on:click={() => { showMigrationModal = false; migrationSuccess = false; }}>
                  Keep Current Location
                </button>
              </div>
            </div>
          {:else}
            <button class="btn-primary" on:click={() => showMigrationModal = false}>Close</button>
          {/if}
        </div>
      {:else}
        <div class="flex items-center justify-center gap-3 py-4 text-gray-500 dark:text-gray-400">
          <div class="spinner spinner-sm"></div>
          <span>Please wait...</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Encrypt Profile Modal -->
{#if showEncryptModal}
  <div class="modal-overlay" on:click={() => !encryptingInPlace && (showEncryptModal = false)}>
    <div class="modal-content max-w-[450px]" on:click|stopPropagation>
      <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">🔒 Encrypt Profile Data</h3>

      {#if !encryptingInPlace && encryptInPlaceProgress.length === 0}
        <div class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            Encrypt all existing profile data with AES-256-GCM encryption. This will convert all plain JSON files to encrypted format in-place.
          </p>

          <div class="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg space-y-4">
            <label class="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" bind:checked={useLoginPassword} on:change={() => { encryptInPlacePassword = ''; encryptInPlacePasswordConfirm = ''; }} class="w-5 h-5 accent-violet-500" />
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Use my login password for encryption</span>
            </label>
            <p class="text-xs text-gray-500 dark:text-gray-400 ml-8">
              Your login password will be used as the encryption key. You won't need to remember a separate password.
            </p>
          </div>

          {#if !useLoginPassword}
            <div class="space-y-3">
              <div class="flex flex-col gap-1.5">
                <label for="encryptInPlacePassword" class="text-sm font-medium text-gray-700 dark:text-gray-300">Encryption Password</label>
                <input id="encryptInPlacePassword" type="password" bind:value={encryptInPlacePassword} placeholder="Enter password (min 8 characters)" class="input-field" />
              </div>
              <div class="flex flex-col gap-1.5">
                <label for="encryptInPlacePasswordConfirm" class="text-sm font-medium text-gray-700 dark:text-gray-300">Confirm Password</label>
                <input id="encryptInPlacePasswordConfirm" type="password" bind:value={encryptInPlacePasswordConfirm} placeholder="Confirm password" class="input-field" />
              </div>
              {#if encryptInPlacePassword && !encryptInPlacePasswordValid}
                <span class="text-xs text-red-500">Password must be at least 8 characters</span>
              {/if}
              {#if encryptInPlacePasswordConfirm && !encryptInPlacePasswordsMatch}
                <span class="text-xs text-red-500">Passwords do not match</span>
              {/if}
              <div class="p-3 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg text-sm text-amber-700 dark:text-amber-300">
                <strong>⚠️ Important:</strong> Your password is never stored. If you forget it, your data cannot be recovered. Write it down somewhere safe!
              </div>
            </div>
          {:else}
            <div class="space-y-3">
              <div class="flex flex-col gap-1.5">
                <label for="encryptInPlacePassword" class="text-sm font-medium text-gray-700 dark:text-gray-300">Enter Your Login Password</label>
                <input id="encryptInPlacePassword" type="password" bind:value={encryptInPlacePassword} placeholder="Enter your login password" class="input-field" />
              </div>
              {#if encryptInPlacePassword && !encryptInPlacePasswordValid}
                <span class="text-xs text-red-500">Password must be at least 8 characters</span>
              {/if}
              <div class="p-3 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg text-sm text-green-700 dark:text-green-300">
                <strong>✓ Convenient:</strong> Your login password will be verified and used for encryption. If you change your login password later, you'll need to decrypt and re-encrypt your data.
              </div>
            </div>
          {/if}
        </div>

        <div class="modal-footer mt-6">
          <button class="btn-secondary" on:click={() => showEncryptModal = false}>Cancel</button>
          <button class="btn-primary" on:click={encryptProfileInPlace} disabled={!encryptInPlaceReady}>🔒 Start Encryption</button>
        </div>
      {:else}
        <div class="flex flex-col gap-2 max-h-[400px] overflow-y-auto mb-4">
          {#each encryptInPlaceProgress as step}
            <div class="progress-step {step.status}">
              <span class="font-bold w-5 text-center {step.status === 'completed' ? 'text-green-500' : step.status === 'failed' ? 'text-red-500' : step.status === 'running' ? 'text-blue-500' : ''}">{getStatusIcon(step.status)}</span>
              <div class="flex-1">
                <span class="block text-sm text-gray-700 dark:text-gray-300">{step.message}</span>
                {#if step.progress !== undefined}
                  <div class="progress-bar-track mt-2">
                    <div class="progress-bar-fill" style="width: {step.progress}%"></div>
                  </div>
                {/if}
                {#if step.error}
                  <span class="block mt-1 text-xs text-red-500">{step.error}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        {#if !encryptingInPlace}
          <div class="modal-footer">
            <button class="btn-primary" on:click={() => { showEncryptModal = false; encryptInPlaceProgress = []; }}>Close</button>
          </div>
        {:else}
          <div class="flex items-center justify-center gap-3 py-4 text-gray-500 dark:text-gray-400">
            <div class="spinner spinner-sm"></div>
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
    <div class="modal-content max-w-[450px]" on:click|stopPropagation>
      <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">🔓 Decrypt Profile Data</h3>

      {#if !decryptingInPlace && encryptInPlaceProgress.length === 0}
        <div class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            Decrypt all encrypted profile data back to plain JSON files. You will need your encryption password to proceed.
          </p>

          {#if profileConfig?.encryptionInfo?.useLoginPassword}
            <div class="p-3 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg text-sm text-green-700 dark:text-green-300">
              <strong>💡 Hint:</strong> This profile was encrypted using your login password. Enter your login password below.
            </div>
          {/if}

          <div class="flex flex-col gap-1.5">
            <label for="decryptPassword" class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {profileConfig?.encryptionInfo?.useLoginPassword ? 'Login Password' : 'Encryption Password'}
            </label>
            <input
              id="decryptPassword"
              type="password"
              bind:value={decryptPassword}
              placeholder={profileConfig?.encryptionInfo?.useLoginPassword ? 'Enter your login password' : 'Enter your encryption password'}
              class="input-field"
            />
          </div>

          <div class="p-3 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg text-sm text-amber-700 dark:text-amber-300">
            <strong>⚠️ Security Note:</strong> After decryption, your profile data will be stored as plain files. Anyone with access to this location can read your data.
          </div>
        </div>

        <div class="modal-footer mt-6">
          <button class="btn-secondary" on:click={() => showDecryptModal = false}>Cancel</button>
          <button class="btn-primary" on:click={decryptProfileInPlace} disabled={!decryptPassword}>🔓 Start Decryption</button>
        </div>
      {:else}
        <div class="flex flex-col gap-2 max-h-[400px] overflow-y-auto mb-4">
          {#each encryptInPlaceProgress as step}
            <div class="progress-step {step.status}">
              <span class="font-bold w-5 text-center {step.status === 'completed' ? 'text-green-500' : step.status === 'failed' ? 'text-red-500' : step.status === 'running' ? 'text-blue-500' : ''}">{getStatusIcon(step.status)}</span>
              <div class="flex-1">
                <span class="block text-sm text-gray-700 dark:text-gray-300">{step.message}</span>
                {#if step.progress !== undefined}
                  <div class="progress-bar-track mt-2">
                    <div class="progress-bar-fill" style="width: {step.progress}%"></div>
                  </div>
                {/if}
                {#if step.error}
                  <span class="block mt-1 text-xs text-red-500">{step.error}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        {#if !decryptingInPlace}
          <div class="modal-footer">
            <button class="btn-primary" on:click={() => { showDecryptModal = false; encryptInPlaceProgress = []; }}>Close</button>
          </div>
        {:else}
          <div class="flex items-center justify-center gap-3 py-4 text-gray-500 dark:text-gray-400">
            <div class="spinner spinner-sm"></div>
            <span>Decrypting files...</span>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<!-- Change Location Modal -->
{#if showChangeLocationModal}
  <div class="modal-overlay" on:click={() => !switchingLocation && (showChangeLocationModal = false)}>
    <div class="modal-content max-w-[550px]" on:click|stopPropagation>
      <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">📂 Change Profile Location</h3>

      <div class="space-y-4">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          Switch to a different profile location. The new location must contain existing profile data (persona/ or memory/ folders).
        </p>

        <div class="flex flex-col gap-1.5">
          <label for="changeLocationPath" class="text-sm font-medium text-gray-700 dark:text-gray-300">Profile Path</label>
          <input
            id="changeLocationPath"
            type="text"
            class="input-field font-mono"
            bind:value={changeLocationPath}
            placeholder="/path/to/existing/profile"
            disabled={switchingLocation}
          />
          <small class="text-sm text-gray-500 dark:text-gray-400">Enter the absolute path to an existing profile directory</small>
        </div>

        {#if devices.length > 0}
          <div class="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Quick Select:</label>
            <div class="flex gap-2 flex-wrap">
              {#each devices as device}
                {#if device.writable}
                  <button class="btn-ghost btn-sm border border-gray-300 dark:border-gray-600" on:click={() => changeLocationPath = getDevicePath(device)} disabled={switchingLocation}>
                    {getStorageTypeIcon(device.type)} {device.label}
                  </button>
                {/if}
              {/each}
            </div>
          </div>
        {/if}

        <div class="p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded-lg text-sm text-blue-700 dark:text-blue-300">
          <strong>ℹ️ Note:</strong> This will only switch to a location that already contains your profile data. To migrate data to a new location, use the "Move Here" option in the Available Storage Devices section.
        </div>
      </div>

      <div class="modal-footer mt-6">
        <button class="btn-secondary" on:click={() => showChangeLocationModal = false} disabled={switchingLocation}>Cancel</button>
        <button class="btn-primary" on:click={() => switchToLocation(changeLocationPath)} disabled={!changeLocationPath.trim() || switchingLocation}>
          {switchingLocation ? 'Switching...' : '🔄 Switch Location'}
        </button>
      </div>
    </div>
  </div>
{/if}
