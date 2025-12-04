<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/client/api-config';

  export let onNext: () => void;
  export let onBack: () => void;
  export let onSkip: () => void;

  let uploadedFiles: File[] = [];
  let uploading = false;
  let uploadProgress = 0;
  let uploadStatus = '';
  let error = '';
  let dragActive = false;

  let fileInput: HTMLInputElement;

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragActive = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragActive = false;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragActive = false;

    const files = Array.from(e.dataTransfer?.files || []);
    addFiles(files);
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = Array.from(target.files || []);
    addFiles(files);
  }

  function addFiles(files: File[]) {
    // Filter for supported file types
    const supportedTypes = [
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/json',
      'text/csv',
    ];

    const validFiles = files.filter(f => {
      return supportedTypes.includes(f.type) ||
             f.name.endsWith('.txt') ||
             f.name.endsWith('.md') ||
             f.name.endsWith('.pdf') ||
             f.name.endsWith('.json') ||
             f.name.endsWith('.csv');
    });

    if (validFiles.length < files.length) {
      error = 'Some files were skipped (unsupported type). Supported: .txt, .md, .pdf, .json, .csv';
    }

    uploadedFiles = [...uploadedFiles, ...validFiles];
  }

  function removeFile(index: number) {
    uploadedFiles = uploadedFiles.filter((_, i) => i !== index);
  }

  async function handleUpload() {
    if (uploadedFiles.length === 0) {
      // Skip is OK - user might not have documents to import
      onNext();
      return;
    }

    uploading = true;
    uploadProgress = 0;
    uploadStatus = '';
    error = '';

    try {
      const totalFiles = uploadedFiles.length;
      let processedFiles = 0;

      for (const file of uploadedFiles) {
        uploadStatus = `Uploading ${file.name}...`;

        const formData = new FormData();
        formData.append('file', file);

        const response = await apiFetch('/api/ingest', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }

        processedFiles++;
        uploadProgress = (processedFiles / totalFiles) * 100;
      }

      // Increment files ingested counter
      await apiFetch('/api/onboarding/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: {
            dataCollected: {
              filesIngested: uploadedFiles.length,
            },
          },
        }),
      });

      uploadStatus = `✓ Successfully uploaded ${totalFiles} file${totalFiles > 1 ? 's' : ''}`;

      // Continue to next step after brief delay
      setTimeout(() => {
        onNext();
      }, 1500);

    } catch (err) {
      error = (err as Error).message;
      uploading = false;
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
</script>

<div class="step-context">
  <div class="step-header">
    <h2>Import Your Context</h2>
    <p class="step-description">
      Upload documents, journals, notes, or any text files that provide context about your life,
      work, or interests. Your MetaHuman will process these to better understand you.
    </p>
  </div>

  <div class="upload-section">
    <div
      class="dropzone"
      class:active={dragActive}
      on:dragenter={handleDragEnter}
      on:dragleave={handleDragLeave}
      on:dragover={handleDragOver}
      on:drop={handleDrop}
      role="button"
      tabindex="0"
    >
      <div class="dropzone-icon">📁</div>
      <h3>Drag & Drop Files Here</h3>
      <p>or</p>
      <button
        class="btn btn-upload"
        on:click={() => fileInput.click()}
        disabled={uploading}
      >
        Browse Files
      </button>
      <input
        bind:this={fileInput}
        type="file"
        multiple
        accept=".txt,.md,.pdf,.json,.csv,text/plain,text/markdown,application/pdf,application/json,text/csv"
        on:change={handleFileSelect}
        style="display: none"
      />
      <p class="supported-types">
        Supported: Text (.txt), Markdown (.md), PDF (.pdf), JSON (.json), CSV (.csv)
      </p>
    </div>

    {#if uploadedFiles.length > 0}
      <div class="file-list">
        <h3>Files to Upload ({uploadedFiles.length})</h3>
        <div class="files">
          {#each uploadedFiles as file, i}
            <div class="file-item">
              <div class="file-icon">
                {#if file.type === 'application/pdf' || file.name.endsWith('.pdf')}
                  📄
                {:else if file.name.endsWith('.md')}
                  📝
                {:else if file.name.endsWith('.json')}
                  🔧
                {:else if file.name.endsWith('.csv')}
                  📊
                {:else}
                  📃
                {/if}
              </div>
              <div class="file-info">
                <div class="file-name">{file.name}</div>
                <div class="file-size">{formatFileSize(file.size)}</div>
              </div>
              <button
                class="btn-remove"
                on:click={() => removeFile(i)}
                disabled={uploading}
                aria-label="Remove file"
              >
                ✕
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if uploading}
      <div class="upload-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: {uploadProgress}%"></div>
        </div>
        <p class="progress-status">{uploadStatus}</p>
      </div>
    {/if}

    {#if error}
      <div class="error-message">
        <span class="error-icon">⚠️</span>
        {error}
      </div>
    {/if}
  </div>

  <div class="context-info">
    <div class="info-icon">💡</div>
    <div class="info-text">
      <strong>What to upload:</strong>
      <ul>
        <li>Personal journals or diary entries</li>
        <li>Work documents or project notes</li>
        <li>Creative writing or blog posts</li>
        <li>Meeting notes or conversation logs</li>
        <li>Any text that represents your thoughts, interests, or experiences</li>
      </ul>
      <p>
        <strong>Privacy:</strong> All files are processed locally on your machine.
        Nothing is uploaded to external servers.
      </p>
    </div>
  </div>

  <div class="skip-notice">
    <p>
      <strong>Don't have files to upload?</strong> No problem! You can skip this step
      and add context later through Memory Capture, Chat, or the File Ingestion utility.
    </p>
  </div>

  <div class="step-actions">
    <button class="btn btn-secondary" on:click={onBack} disabled={uploading}>
      ← Back
    </button>
    <button class="btn btn-ghost" on:click={onSkip} disabled={uploading}>
      Skip
    </button>
    <button
      class="btn btn-primary"
      on:click={handleUpload}
      disabled={uploading}
    >
      {uploading ? 'Uploading...' : uploadedFiles.length > 0 ? 'Upload & Continue →' : 'Continue →'}
    </button>
  </div>
</div>

<style>
  .step-context {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
  }

  .step-header h2 {
    font-size: 1.8rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    color: #111827;
  }

  :global(.dark) .step-header h2 {
    color: #f9fafb;
  }

  .step-description {
    font-size: 1rem;
    line-height: 1.6;
    color: #6b7280;
    margin: 0;
  }

  :global(.dark) .step-description {
    color: #9ca3af;
  }

  .upload-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 3rem 2rem;
    border: 2px dashed #d1d5db;
    border-radius: 12px;
    background: #f9fafb;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  :global(.dark) .dropzone {
    background: #1f2937;
    border-color: #4b5563;
  }

  .dropzone.active {
    border-color: #667eea;
    background: #eff6ff;
    transform: scale(1.02);
  }

  :global(.dark) .dropzone.active {
    background: #1e3a8a;
    border-color: #818cf8;
  }

  .dropzone-icon {
    font-size: 4rem;
  }

  .dropzone h3 {
    font-size: 1.3rem;
    font-weight: 600;
    margin: 0;
    color: #111827;
  }

  :global(.dark) .dropzone h3 {
    color: #f9fafb;
  }

  .dropzone p {
    margin: 0;
    font-size: 1rem;
    color: #6b7280;
  }

  :global(.dark) .dropzone p {
    color: #9ca3af;
  }

  .btn-upload {
    padding: 0.75rem 2rem;
    font-size: 1rem;
    font-weight: 600;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-upload:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .btn-upload:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .supported-types {
    font-size: 0.85rem !important;
    color: #9ca3af !important;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .file-list h3 {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
    color: #111827;
  }

  :global(.dark) .file-list h3 {
    color: #f9fafb;
  }

  .files {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    transition: all 0.2s ease;
  }

  :global(.dark) .file-item {
    background: #374151;
    border-color: #4b5563;
  }

  .file-item:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .file-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .file-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .file-name {
    font-size: 0.95rem;
    font-weight: 500;
    color: #111827;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.dark) .file-name {
    color: #f9fafb;
  }

  .file-size {
    font-size: 0.8rem;
    color: #6b7280;
  }

  :global(.dark) .file-size {
    color: #9ca3af;
  }

  .btn-remove {
    padding: 0.25rem 0.5rem;
    font-size: 1.2rem;
    color: #ef4444;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .btn-remove:hover:not(:disabled) {
    background: #fee2e2;
    color: #dc2626;
  }

  :global(.dark) .btn-remove:hover:not(:disabled) {
    background: #7f1d1d;
  }

  .btn-remove:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .upload-progress {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .progress-bar {
    height: 12px;
    background: #e5e7eb;
    border-radius: 6px;
    overflow: hidden;
  }

  :global(.dark) .progress-bar {
    background: #374151;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    transition: width 0.3s ease;
  }

  .progress-status {
    margin: 0;
    font-size: 0.9rem;
    color: #6b7280;
    text-align: center;
  }

  :global(.dark) .progress-status {
    color: #9ca3af;
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: #fee2e2;
    border: 1px solid #ef4444;
    border-radius: 6px;
    color: #991b1b;
    font-size: 0.9rem;
  }

  :global(.dark) .error-message {
    background: #7f1d1d;
    border-color: #ef4444;
    color: #fecaca;
  }

  .context-info {
    display: flex;
    align-items: start;
    gap: 0.75rem;
    padding: 1rem;
    background: #eff6ff;
    border-left: 4px solid #3b82f6;
    border-radius: 4px;
  }

  :global(.dark) .context-info {
    background: #1e3a8a;
    border-color: #60a5fa;
  }

  .info-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .info-text {
    font-size: 0.9rem;
    line-height: 1.5;
    color: #1e40af;
  }

  :global(.dark) .info-text {
    color: #bfdbfe;
  }

  .info-text strong {
    color: #1e3a8a;
  }

  :global(.dark) .info-text strong {
    color: #93c5fd;
  }

  .info-text ul {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .info-text p {
    margin: 0.5rem 0 0 0;
  }

  .skip-notice {
    padding: 1rem 1.5rem;
    background: #fef3c7;
    border-left: 4px solid #fbbf24;
    border-radius: 4px;
  }

  :global(.dark) .skip-notice {
    background: #451a03;
    border-color: #f59e0b;
  }

  .skip-notice p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.6;
    color: #92400e;
  }

  :global(.dark) .skip-notice p {
    color: #fcd34d;
  }

  .skip-notice strong {
    color: #78350f;
  }

  :global(.dark) .skip-notice strong {
    color: #fbbf24;
  }

  .step-actions {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .step-actions {
    border-color: #374151;
  }

  .btn {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #d1d5db;
  }

  :global(.dark) .btn-secondary {
    background: #374151;
    color: #d1d5db;
    border-color: #4b5563;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #e5e7eb;
  }

  :global(.dark) .btn-secondary:hover:not(:disabled) {
    background: #4b5563;
  }

  .btn-ghost {
    background: transparent;
    color: #6b7280;
  }

  :global(.dark) .btn-ghost {
    color: #9ca3af;
  }

  .btn-ghost:hover:not(:disabled) {
    color: #111827;
    background: #f3f4f6;
  }

  :global(.dark) .btn-ghost:hover:not(:disabled) {
    color: #f9fafb;
    background: #374151;
  }

  @media (max-width: 768px) {
    .step-context {
      padding: 1rem;
    }

    .dropzone {
      padding: 2rem 1rem;
    }

    .step-actions {
      flex-direction: column;
    }
  }
</style>
