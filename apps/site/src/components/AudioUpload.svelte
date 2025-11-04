<script lang="ts">
  import { onDestroy } from 'svelte';

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

      const response = await fetch('/api/audio/upload', {
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

<div class="audio-upload">
  <div class="upload-header">
    <h3>Upload Audio Recording</h3>
    <p class="subtitle">Voice notes, meetings, lectures - automatically transcribed and organized</p>
  </div>

  <input
    type="file"
    bind:this={fileInput}
    on:change={handleFileSelect}
    accept="audio/mp3,audio/wav,audio/m4a,audio/ogg,audio/webm,audio/flac"
    class="file-input"
  />

  {#if !uploadedFile}
    <button class="select-btn" on:click={triggerFileInput}>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      Select Audio File
    </button>
    <p class="formats">Supported: MP3, WAV, M4A, OGG, WebM, FLAC (max 100MB)</p>
  {:else}
    <div class="file-preview">
      <div class="file-info">
        <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <div class="file-details">
          <div class="file-name">{uploadedFile.name}</div>
          <div class="file-size">{formatFileSize(uploadedFile.size)}</div>
        </div>
      </div>

      <div class="action-buttons">
        <button class="clear-btn" on:click={clearSelection} disabled={uploading}>
          Clear
        </button>
        <button class="upload-btn" on:click={uploadAudio} disabled={uploading}>
          {uploading ? 'Uploading...' : 'Upload & Transcribe'}
        </button>
      </div>
    </div>
  {/if}

  {#if uploading}
    <div class="progress-bar">
      <div class="progress-fill" style="width: {uploadProgress}%"></div>
    </div>
  {/if}

  {#if uploadStatus}
    <div class="status success">
      <svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <div class="status-text">
        <div>{uploadStatus}</div>
        {#if audioId}
          <div class="audio-id">Audio ID: {audioId}</div>
        {/if}
      </div>
    </div>
  {/if}

  {#if error}
    <div class="status error">
      <svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
      <span>{error}</span>
    </div>
  {/if}
</div>

<style>
  .audio-upload {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    background: rgba(255, 255, 255, 0.5);
    border-radius: 0.75rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .audio-upload {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .upload-header {
    text-align: center;
  }

  .upload-header h3 {
    font-size: 1.25rem;
    font-weight: 700;
    color: rgb(17 24 39);
    margin: 0 0 0.5rem 0;
  }

  :global(.dark) .upload-header h3 {
    color: rgb(243 244 246);
  }

  .subtitle {
    font-size: 0.875rem;
    color: rgb(107 114 128);
    margin: 0;
  }

  :global(.dark) .subtitle {
    color: rgb(156 163 175);
  }

  .file-input {
    display: none;
  }

  .select-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1.25rem 2rem;
    border: 2px dashed rgba(124, 58, 237, 0.3);
    border-radius: 0.5rem;
    background: rgba(124, 58, 237, 0.05);
    color: rgb(124 58 237);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
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

  .icon {
    width: 1.5rem;
    height: 1.5rem;
  }

  .formats {
    text-align: center;
    font-size: 0.75rem;
    color: rgb(107 114 128);
    margin: 0;
  }

  :global(.dark) .formats {
    color: rgb(156 163 175);
  }

  .file-preview {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.03);
    border-radius: 0.5rem;
  }

  :global(.dark) .file-preview {
    background: rgba(255, 255, 255, 0.03);
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .file-icon {
    width: 2.5rem;
    height: 2.5rem;
    color: rgb(124 58 237);
    flex-shrink: 0;
  }

  :global(.dark) .file-icon {
    color: rgb(167 139 250);
  }

  .file-details {
    flex: 1;
    min-width: 0;
  }

  .file-name {
    font-weight: 600;
    color: rgb(17 24 39);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.dark) .file-name {
    color: rgb(243 244 246);
  }

  .file-size {
    font-size: 0.875rem;
    color: rgb(107 114 128);
    margin-top: 0.25rem;
  }

  :global(.dark) .file-size {
    color: rgb(156 163 175);
  }

  .action-buttons {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  .clear-btn,
  .upload-btn {
    padding: 0.5rem 1.5rem;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .clear-btn {
    background: rgba(0, 0, 0, 0.05);
    color: rgb(107 114 128);
  }

  .clear-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .clear-btn {
    background: rgba(255, 255, 255, 0.05);
    color: rgb(156 163 175);
  }

  :global(.dark) .clear-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  .upload-btn {
    background: rgb(124 58 237);
    color: white;
  }

  .upload-btn:hover:not(:disabled) {
    background: rgb(109 40 217);
  }

  .upload-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.dark) .upload-btn {
    background: rgb(167 139 250);
    color: rgb(17 24 39);
  }

  :global(.dark) .upload-btn:hover:not(:disabled) {
    background: rgb(196 181 253);
  }

  .progress-bar {
    height: 0.5rem;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 9999px;
    overflow: hidden;
  }

  :global(.dark) .progress-bar {
    background: rgba(255, 255, 255, 0.1);
  }

  .progress-fill {
    height: 100%;
    background: rgb(124 58 237);
    transition: width 0.3s;
  }

  :global(.dark) .progress-fill {
    background: rgb(167 139 250);
  }

  .status {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
  }

  .status.success {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    color: rgb(22 163 74);
  }

  :global(.dark) .status.success {
    background: rgba(134, 239, 172, 0.1);
    border-color: rgba(134, 239, 172, 0.3);
    color: rgb(134 239 172);
  }

  .status.error {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: rgb(220 38 38);
  }

  :global(.dark) .status.error {
    background: rgba(252, 165, 165, 0.1);
    border-color: rgba(252, 165, 165, 0.3);
    color: rgb(252 165 165);
  }

  .status-icon {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
  }

  .status-text {
    flex: 1;
  }

  .audio-id {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    font-family: monospace;
    opacity: 0.8;
  }
</style>
