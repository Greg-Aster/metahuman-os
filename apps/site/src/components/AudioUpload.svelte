<script lang="ts">
  import { onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  let uploading = false;
  let uploadProgress = 0;
  let uploadStatus = '';
  let uploadedFile: File | null = null;
  let audioId = '';
  let error = '';

  let fileInput: HTMLInputElement;

  function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    const files = target.files;

    if (files && files.length > 0) {
      uploadedFile = files[0];
      error = '';
      uploadStatus = '';
      audioId = '';
    }
  }

  async function uploadAudio() {
    if (!uploadedFile) {
      error = 'Please select an audio file';
      return;
    }

    uploading = true;
    uploadProgress = 0;
    uploadStatus = 'Uploading...';
    error = '';

    try {
      const formData = new FormData();
      formData.append('audio', uploadedFile);

      const response = await apiFetch('/api/audio/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        audioId = result.audioId;
        uploadStatus = 'Upload successful! Transcription will begin automatically.';
        uploadProgress = 100;

        // Clear file input after successful upload
        uploadedFile = null;
        if (fileInput) {
          fileInput.value = '';
        }
      } else {
        error = result.error || 'Upload failed';
        uploadStatus = '';
      }
    } catch (err) {
      error = `Upload failed: ${(err as Error).message}`;
      uploadStatus = '';
    } finally {
      uploading = false;
    }
  }

  function triggerFileInput() {
    fileInput?.click();
  }

  function clearSelection() {
    uploadedFile = null;
    uploadStatus = '';
    audioId = '';
    error = '';
    if (fileInput) {
      fileInput.value = '';
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
</script>

<div class="flex flex-col gap-4 p-6 bg-white/50 dark:bg-white/5 rounded-xl border border-black/10 dark:border-white/10">
  <div class="text-center">
    <h3 class="text-xl font-bold text-gray-900 dark:text-gray-100 m-0 mb-2">Upload Audio Recording</h3>
    <p class="text-sm text-gray-500 dark:text-gray-400 m-0">Voice notes, meetings, lectures - automatically transcribed and organized</p>
  </div>

  <input
    type="file"
    bind:this={fileInput}
    on:change={handleFileSelect}
    accept="audio/mp3,audio/wav,audio/m4a,audio/ogg,audio/webm,audio/flac"
    class="hidden"
  />

  {#if !uploadedFile}
    <button class="select-btn" on:click={triggerFileInput}>
      <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      Select Audio File
    </button>
    <p class="text-center text-xs text-gray-500 dark:text-gray-400 m-0">Supported: MP3, WAV, M4A, OGG, WebM, FLAC (max 100MB)</p>
  {:else}
    <div class="flex flex-col gap-4 p-4 bg-black/[0.03] dark:bg-white/[0.03] rounded-lg">
      <div class="flex items-center gap-4">
        <svg class="w-10 h-10 text-violet-600 dark:text-violet-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-gray-900 dark:text-gray-100 truncate">{uploadedFile.name}</div>
          <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">{formatFileSize(uploadedFile.size)}</div>
        </div>
      </div>

      <div class="flex gap-3 justify-end">
        <button class="btn-secondary py-2 px-6 text-sm" on:click={clearSelection} disabled={uploading}>
          Clear
        </button>
        <button class="upload-btn" on:click={uploadAudio} disabled={uploading}>
          {uploading ? 'Uploading...' : 'Upload & Transcribe'}
        </button>
      </div>
    </div>
  {/if}

  {#if uploading}
    <div class="progress-bar-track">
      <div class="progress-bar-fill" style="width: {uploadProgress}%"></div>
    </div>
  {/if}

  {#if uploadStatus}
    <div class="banner banner-success flex items-start gap-3">
      <svg class="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <div class="flex-1">
        <div>{uploadStatus}</div>
        {#if audioId}
          <div class="mt-1 text-xs font-mono opacity-80">Audio ID: {audioId}</div>
        {/if}
      </div>
    </div>
  {/if}

  {#if error}
    <div class="banner banner-error flex items-start gap-3">
      <svg class="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
      <span>{error}</span>
    </div>
  {/if}
</div>

<style>
  /* Select file button - dashed border style */
  .select-btn {
    @apply flex items-center justify-center gap-3 py-5 px-8 rounded-lg text-base font-semibold cursor-pointer transition-all;
    border: 2px dashed rgba(124, 58, 237, 0.3);
    background: rgba(124, 58, 237, 0.05);
    color: rgb(124 58 237);
  }
  .select-btn:hover {
    border-color: rgba(124, 58, 237, 0.5);
    background: rgba(124, 58, 237, 0.1);
  }
  :global(.dark) .select-btn {
    border-color: rgba(167, 139, 250, 0.3);
    background: rgba(167, 139, 250, 0.05);
    color: rgb(167 139 250);
  }
  :global(.dark) .select-btn:hover {
    border-color: rgba(167, 139, 250, 0.5);
    background: rgba(167, 139, 250, 0.1);
  }

  /* Upload button - solid violet */
  .upload-btn {
    @apply py-2 px-6 border-0 rounded-md text-sm font-semibold cursor-pointer transition-all bg-violet-600 text-white;
  }
  .upload-btn:hover:not(:disabled) {
    @apply bg-violet-700;
  }
  .upload-btn:disabled {
    @apply opacity-50 cursor-not-allowed;
  }
  :global(.dark) .upload-btn {
    @apply bg-violet-400 text-gray-900;
  }
  :global(.dark) .upload-btn:hover:not(:disabled) {
    @apply bg-violet-300;
  }
</style>
