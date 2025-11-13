<script lang="ts">
  /**
   * DirectVoiceRecorder
   * Record voice samples for GPT-SoVITS reference audio
   * Minimum 5 seconds, no maximum - user controls when to stop
   */

import { onDestroy } from 'svelte';

export let provider: 'piper' | 'sovits' | 'gpt-sovits' = 'gpt-sovits';
export let speakerId: string = 'default';
export let onRecordingComplete: (success: boolean) => void = () => {};

  let isRecording = false;
  let recordingSeconds = 0;
  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let recordingStream: MediaStream | null = null;
  let countdownInterval: number | null = null;
  let error = '';
  let successMessage = '';
  let audioUrl = '';
  let isPlaying = false;
  let audioElement: HTMLAudioElement | null = null;

  const MIN_DURATION = 5;
  const RECOMMENDED_PROMPT = "The quick brown fox jumps over the lazy dog. Testing, one, two, three.";

  function normalizeProvider(value: string): 'piper' | 'gpt-sovits' {
    return value === 'sovits' ? 'gpt-sovits' : (value as 'piper' | 'gpt-sovits');
  }

  onDestroy(() => {
    cleanup();
  });

  function cleanup() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (recordingStream) {
      recordingStream.getTracks().forEach(track => track.stop());
      recordingStream = null;
    }
    if (audioElement) {
      audioElement.pause();
      audioElement = null;
    }
  }

  async function startRecording() {
    error = '';
    successMessage = '';
    audioUrl = '';
    recordingSeconds = 0;

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStream = stream;

      // Create MediaRecorder
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        await handleRecordingStop();
      };

      mediaRecorder.start();
      isRecording = true;

      // Start countdown
      countdownInterval = window.setInterval(() => {
        recordingSeconds++;
        // No max duration - user controls when to stop
      }, 1000);

    } catch (err) {
      error = `Microphone access denied: ${(err as Error).message}`;
      console.error('[DirectVoiceRecorder] Error:', err);
    }
  }

  function stopRecording() {
    if (!mediaRecorder || !isRecording) return;

    if (recordingSeconds < MIN_DURATION) {
      error = `Recording too short! Must be at least ${MIN_DURATION} seconds.`;
      cleanup();
      isRecording = false;
      recordingSeconds = 0;
      return;
    }

    isRecording = false;
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    mediaRecorder.stop();
    if (recordingStream) {
      recordingStream.getTracks().forEach(track => track.stop());
      recordingStream = null;
    }
  }

  async function handleRecordingStop() {
    if (audioChunks.length === 0) {
      error = 'No audio data recorded';
      return;
    }

    // Create audio blob
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    audioUrl = URL.createObjectURL(audioBlob);

    // Clear old chunks
    audioChunks = [];
  }

  function playRecording() {
    if (!audioUrl) return;

    if (isPlaying && audioElement) {
      audioElement.pause();
      audioElement = null;
      isPlaying = false;
      return;
    }

    audioElement = new Audio(audioUrl);
    audioElement.play();
    isPlaying = true;

    audioElement.addEventListener('ended', () => {
      isPlaying = false;
      audioElement = null;
    });

    audioElement.addEventListener('error', () => {
      error = 'Failed to play recording';
      isPlaying = false;
      audioElement = null;
    });
  }

  function discardRecording() {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = '';
    }
    recordingSeconds = 0;
    error = '';
    successMessage = '';
  }

  async function saveAsVoiceProfile() {
    if (!audioUrl) return;

    try {
      error = '';
      successMessage = '';

      // Fetch the blob from the URL
      const response = await fetch(audioUrl);
      const audioBlob = await response.blob();

      // Create FormData for upload
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('transcript', RECOMMENDED_PROMPT);
      const normalizedProvider = normalizeProvider(provider);
      formData.append('provider', normalizedProvider);
      formData.append('speakerId', speakerId);
      formData.append('duration', recordingSeconds.toString());
      formData.append('quality', '1.0'); // Assume high quality for direct recordings
      formData.append('copyToReference', 'true'); // Immediately set as reference audio

      // Upload to voice profile endpoint
      const uploadResponse = await fetch('/api/voice-profile/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const result = await uploadResponse.json();

      if (result.copiedToReference) {
        successMessage = `✅ Voice profile saved! Created reference.wav in SoVITS directory. Ready for testing. Sample ID: ${result.sampleId}`;
      } else {
        successMessage = `Voice profile saved! Sample ID: ${result.sampleId}`;
      }

      // Clear the recording
      URL.revokeObjectURL(audioUrl);
      audioUrl = '';
      recordingSeconds = 0;

      // Trigger readiness refresh in parent
      onRecordingComplete(true);
    } catch (err) {
      error = `Failed to save voice profile: ${(err as Error).message}`;
      console.error('[DirectVoiceRecorder] Save error:', err);
      onRecordingComplete(false);
    }
  }

  $: canSave = audioUrl && recordingSeconds >= MIN_DURATION;
  $: statusColor = recordingSeconds < MIN_DURATION ? 'text-yellow-400' : 'text-green-400';
</script>

<div class="direct-voice-recorder">
  <div class="recorder-header">
    <h3>Quick Voice Recording</h3>
    <p class="help-text">
      Record at least {MIN_DURATION} seconds of clear speech for voice cloning.
      Speak the prompt below or say anything natural. Click Stop when done.
    </p>
  </div>

  <div class="recording-prompt">
    <label>Recommended prompt:</label>
    <div class="prompt-text">{RECOMMENDED_PROMPT}</div>
  </div>

  {#if error}
    <div class="error-message">{error}</div>
  {/if}

  {#if successMessage}
    <div class="success-message">{successMessage}</div>
  {/if}

  <div class="recorder-controls">
    {#if !isRecording && !audioUrl}
      <button on:click={startRecording} class="btn-record">
        🎤 Start Recording
      </button>
    {:else if isRecording}
      <div class="recording-status">
        <div class="recording-indicator">● Recording...</div>
        <div class="recording-timer {statusColor}">
          {recordingSeconds}s
          {#if recordingSeconds < MIN_DURATION}
            (minimum {MIN_DURATION}s)
          {:else}
            ✓ Ready to stop
          {/if}
        </div>
        <button on:click={stopRecording} class="btn-stop">
          ⏹️ Stop
        </button>
      </div>
    {:else if audioUrl}
      <div class="playback-controls">
        <div class="recording-info">
          Recorded: {recordingSeconds}s
          {#if canSave}
            ✓ Ready to save
          {:else}
            ⚠️ Too short (minimum {MIN_DURATION}s)
          {/if}
        </div>
        <div class="action-buttons">
          <button on:click={playRecording} class="btn-play">
            {isPlaying ? '⏸️ Pause' : '▶️ Play'}
          </button>
          <button on:click={discardRecording} class="btn-discard">
            🗑️ Discard
          </button>
          <button on:click={saveAsVoiceProfile} class="btn-save" disabled={!canSave}>
            💾 Save as Voice Profile
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .direct-voice-recorder {
    border: 1px solid #444;
    border-radius: 8px;
    padding: 1.5rem;
    background: #1a1a1a;
    margin-bottom: 2rem;
  }

  .recorder-header h3 {
    margin: 0 0 0.5rem 0;
    color: #fff;
    font-size: 1.1rem;
  }

  .help-text {
    margin: 0 0 1rem 0;
    color: #888;
    font-size: 0.9rem;
  }

  .recording-prompt {
    background: #252525;
    padding: 1rem;
    border-radius: 4px;
    margin-bottom: 1rem;
  }

  .recording-prompt label {
    display: block;
    color: #888;
    font-size: 0.85rem;
    margin-bottom: 0.5rem;
  }

  .prompt-text {
    color: #ccc;
    font-style: italic;
    line-height: 1.5;
  }

  .error-message {
    background: #3a1a1a;
    border: 1px solid #ff4444;
    color: #ff6666;
    padding: 0.75rem;
    border-radius: 4px;
    margin-bottom: 1rem;
  }

  .success-message {
    background: #1a3a1a;
    border: 1px solid #44ff44;
    color: #66ff66;
    padding: 0.75rem;
    border-radius: 4px;
    margin-bottom: 1rem;
  }

  .recorder-controls {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .btn-record {
    padding: 1rem 2rem;
    font-size: 1.1rem;
    background: #ff4444;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-record:hover {
    background: #ff6666;
  }

  .recording-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .recording-indicator {
    color: #ff4444;
    font-weight: bold;
    font-size: 1.2rem;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .recording-timer {
    font-size: 2rem;
    font-weight: bold;
    font-family: monospace;
  }

  .text-yellow-400 {
    color: #facc15;
  }

  .text-green-400 {
    color: #4ade80;
  }

  .btn-stop {
    padding: 0.75rem 2rem;
    font-size: 1rem;
    background: #666;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-stop:hover {
    background: #888;
  }

  .playback-controls {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .recording-info {
    text-align: center;
    color: #ccc;
    font-size: 1rem;
  }

  .action-buttons {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .action-buttons button {
    padding: 0.75rem 1.5rem;
    font-size: 0.95rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .action-buttons button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-play {
    background: #4444ff;
    color: white;
  }

  .btn-play:hover:not(:disabled) {
    background: #6666ff;
  }

  .btn-discard {
    background: #ff4444;
    color: white;
  }

  .btn-discard:hover {
    background: #ff6666;
  }

  .btn-save {
    background: #44ff44;
    color: #000;
    font-weight: bold;
  }

  .btn-save:hover:not(:disabled) {
    background: #66ff66;
  }
</style>
