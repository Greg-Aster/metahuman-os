<script lang="ts">
  /**
   * DirectVoiceRecorder
   * Record voice samples for GPT-SoVITS reference audio
   * Minimum 5 seconds, no maximum - user controls when to stop
   */

import { onDestroy } from 'svelte';
import { apiFetch } from '../lib/client/api-config';

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
      const uploadResponse = await apiFetch('/api/voice-profile/upload', {
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

<div class="border border-gray-700 rounded-lg p-6 bg-gray-900 mb-8">
  <div class="mb-4">
    <h3 class="m-0 mb-2 text-white text-lg">Quick Voice Recording</h3>
    <p class="m-0 mb-4 text-gray-500 text-sm">
      Record at least {MIN_DURATION} seconds of clear speech for voice cloning.
      Speak the prompt below or say anything natural. Click Stop when done.
    </p>
  </div>

  <div class="bg-gray-800 p-4 rounded mb-4">
    <label class="block text-gray-500 text-sm mb-2">Recommended prompt:</label>
    <div class="text-gray-300 italic leading-relaxed">{RECOMMENDED_PROMPT}</div>
  </div>

  {#if error}
    <div class="banner banner-error mb-4">{error}</div>
  {/if}

  {#if successMessage}
    <div class="banner banner-success mb-4">{successMessage}</div>
  {/if}

  <div class="flex flex-col gap-4">
    {#if !isRecording && !audioUrl}
      <button on:click={startRecording} class="py-4 px-8 text-lg bg-red-500 text-white border-0 rounded cursor-pointer hover:bg-red-400 transition-colors">
        🎤 Start Recording
      </button>
    {:else if isRecording}
      <div class="flex flex-col items-center gap-4">
        <div class="recording-indicator">● Recording...</div>
        <div class="text-3xl font-bold font-mono {statusColor}">
          {recordingSeconds}s
          {#if recordingSeconds < MIN_DURATION}
            (minimum {MIN_DURATION}s)
          {:else}
            ✓ Ready to stop
          {/if}
        </div>
        <button on:click={stopRecording} class="py-3 px-8 text-base bg-gray-600 text-white border-0 rounded cursor-pointer hover:bg-gray-500">
          ⏹️ Stop
        </button>
      </div>
    {:else if audioUrl}
      <div class="flex flex-col gap-4">
        <div class="text-center text-gray-300">
          Recorded: {recordingSeconds}s
          {#if canSave}
            ✓ Ready to save
          {:else}
            ⚠️ Too short (minimum {MIN_DURATION}s)
          {/if}
        </div>
        <div class="flex gap-2 justify-center flex-wrap">
          <button on:click={playRecording} class="action-btn bg-blue-600 text-white hover:bg-blue-500">
            {isPlaying ? '⏸️ Pause' : '▶️ Play'}
          </button>
          <button on:click={discardRecording} class="action-btn bg-red-500 text-white hover:bg-red-400">
            🗑️ Discard
          </button>
          <button on:click={saveAsVoiceProfile} class="action-btn bg-green-500 text-black font-bold hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canSave}>
            💾 Save as Voice Profile
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Recording indicator pulsing animation */
  .recording-indicator {
    @apply text-red-500 font-bold text-xl;
    animation: pulse 1s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Action button base */
  .action-btn {
    @apply py-3 px-6 text-sm border-0 rounded cursor-pointer transition-opacity;
  }
</style>
