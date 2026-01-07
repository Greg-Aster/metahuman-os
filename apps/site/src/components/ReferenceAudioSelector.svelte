<script lang="ts">
  /**
   * ReferenceAudioSelector
   * UI for selecting voice samples to use as reference audio
   * For GPT-SoVITS: Allows setting specific samples as the active reference
   */

  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  export let provider: 'piper' | 'sovits' | 'gpt-sovits' | 'rvc' = 'gpt-sovits';
  export let speakerId: string = 'default';
  export let minQuality: number = 0.8;
  export let onSelectionChange: (selectedIds: string[]) => void = () => {};
  export let onReferenceSet: (sampleId: string) => void = () => {};

  interface VoiceSample {
    id: string;
    audioPath: string;
    transcriptPath: string;
    duration: number;
    timestamp: string;
    quality: number;
  }

  interface CurrentReference {
    sampleId: string | null;
    referencePath: string | null;
    transcript: string | null;
  }

  let samples: VoiceSample[] = [];
  let selectedIds: Set<string> = new Set();
  let loading = false;
  let error = '';
  let totalDuration = 0;
  let avgQuality = 0;
  let playingId: string | null = null;
  let audioElement: HTMLAudioElement | null = null;
  let currentReference: CurrentReference | null = null;
  let settingReference = false;
  let testingVoice = false;

  onMount(() => {
    loadSamples();
    if (provider === 'gpt-sovits' || provider === 'sovits') {
      loadCurrentReference();
    }
  });

  async function loadSamples() {
    loading = true;
    error = '';
    try {
      const response = await apiFetch(
        `/api/sovits-training?action=available-samples&provider=${provider}&minQuality=${minQuality}&limit=1000`
      );
      if (!response.ok) throw new Error('Failed to load samples');

      const data = await response.json();
      samples = data.samples || [];

      // Calculate stats
      totalDuration = samples.reduce((sum, s) => sum + s.duration, 0);
      avgQuality = samples.length > 0
        ? samples.reduce((sum, s) => sum + s.quality, 0) / samples.length
        : 0;
    } catch (err) {
      error = String(err);
      console.error('[ReferenceAudioSelector] Error loading samples:', err);
    } finally {
      loading = false;
    }
  }

  async function loadCurrentReference() {
    try {
      const response = await apiFetch(
        `/api/sovits-training?action=current-reference&provider=gpt-sovits&speakerId=${speakerId}`
      );
      if (response.ok) {
        currentReference = await response.json();
      }
    } catch (err) {
      console.error('[ReferenceAudioSelector] Error loading current reference:', err);
    }
  }

  async function setAsReference(sampleId: string, event: Event) {
    event.stopPropagation();
    settingReference = true;
    error = '';

    try {
      const response = await apiFetch('/api/sovits-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-reference',
          provider: 'gpt-sovits',
          speakerId,
          sampleId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to set reference');
      }

      // Reload current reference
      await loadCurrentReference();
      onReferenceSet(sampleId);
    } catch (err) {
      error = String(err);
      console.error('[ReferenceAudioSelector] Error setting reference:', err);
    } finally {
      settingReference = false;
    }
  }

  async function testVoiceWithSample(sampleId: string, event: Event) {
    event.stopPropagation();
    testingVoice = true;
    error = '';

    try {
      // First set this sample as the reference
      await setAsReference(sampleId, event);

      // Then trigger a voice test via TTS API
      const testText = 'Testing voice with this reference sample.';
      const response = await apiFetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: testText,
          provider: 'gpt-sovits',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate test audio');
      }

      // Play the generated audio
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.play();

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
      };
    } catch (err) {
      error = String(err);
      console.error('[ReferenceAudioSelector] Error testing voice:', err);
    } finally {
      testingVoice = false;
    }
  }

  function toggleSelection(id: string) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    selectedIds = selectedIds; // Trigger reactivity
    onSelectionChange(Array.from(selectedIds));
  }

  function selectAll() {
    selectedIds = new Set(samples.map(s => s.id));
    onSelectionChange(Array.from(selectedIds));
  }

  function clearSelection() {
    selectedIds = new Set();
    onSelectionChange(Array.from(selectedIds));
  }

  function selectBest(count: number = 5) {
    // Sort by quality and select top N
    const sorted = [...samples].sort((a, b) => b.quality - a.quality);
    selectedIds = new Set(sorted.slice(0, count).map(s => s.id));
    onSelectionChange(Array.from(selectedIds));
  }

  function formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  }

  function formatTimestamp(timestamp: string): string {
    try {
      return new Date(timestamp).toLocaleDateString();
    } catch {
      return timestamp;
    }
  }

  function togglePlayAudio(sample: VoiceSample, event: Event) {
    event.stopPropagation(); // Prevent checkbox toggle

    // If already playing this sample, stop it
    if (playingId === sample.id) {
      if (audioElement) {
        audioElement.pause();
        audioElement = null;
      }
      playingId = null;
      return;
    }

    // Stop any currently playing audio
    if (audioElement) {
      audioElement.pause();
      audioElement = null;
    }

    // Start playing the selected sample via API endpoint
    playingId = sample.id;
    // Use API endpoint to serve the audio file
    const audioUrl = `/api/voice-samples/${sample.id}`;
    audioElement = new Audio(audioUrl);

    audioElement.addEventListener('ended', () => {
      playingId = null;
      audioElement = null;
    });

    audioElement.addEventListener('error', (e) => {
      error = `Failed to play audio: ${sample.id}`;
      playingId = null;
      audioElement = null;
      console.error('[ReferenceAudioSelector] Audio playback error:', e);
    });

    audioElement.play().catch(err => {
      error = `Failed to play audio: ${err.message}`;
      playingId = null;
      audioElement = null;
      console.error('[ReferenceAudioSelector] Audio play() failed:', err);
    });
  }

  $: selectedSamples = samples.filter(s => selectedIds.has(s.id));
  $: selectedDuration = selectedSamples.reduce((sum, s) => sum + s.duration, 0);
  $: selectedQuality = selectedSamples.length > 0
    ? selectedSamples.reduce((sum, s) => sum + s.quality, 0) / selectedSamples.length
    : 0;
</script>

<div class="bg-gray-900 dark:bg-gray-900 rounded-lg p-6 text-white">
  <div class="mb-6">
    <h3 class="m-0 mb-2 text-xl text-white">Select Reference Audio Samples</h3>
    <p class="m-0 text-sm text-gray-400 opacity-80">
      {#if provider === 'gpt-sovits' || provider === 'sovits'}
        GPT-SoVITS voice cloning - Select a sample and click "🎯 Set Reference" to use it, then "🔊 Test" to hear your cloned voice
      {:else}
        Select samples for voice training (more is better)
      {/if}
    </p>
  </div>

  <!-- Current Reference Display for GPT-SoVITS -->
  {#if (provider === 'gpt-sovits' || provider === 'sovits') && currentReference?.sampleId}
    <div class="bg-blue-900/50 border border-blue-700 rounded-lg p-4 mb-6">
      <div class="flex items-center gap-2 text-[0.95rem]">
        <span class="text-xl">🎯</span>
        <strong>Active Reference:</strong>
        <span class="text-blue-300 font-mono bg-black/20 px-2 py-0.5 rounded">{currentReference.sampleId}</span>
      </div>
      {#if currentReference.transcript}
        <div class="mt-2 italic text-gray-400 text-sm">"{currentReference.transcript}"</div>
      {/if}
    </div>
  {:else if (provider === 'gpt-sovits' || provider === 'sovits')}
    <div class="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-4 mb-6 flex items-center gap-2">
      <span class="text-xl">⚠️</span>
      <span>No reference set. Select a sample below and click "🎯 Set Reference"</span>
    </div>
  {/if}

  {#if loading}
    <div class="p-8 text-center">Loading samples...</div>
  {:else if error}
    <div class="p-8 text-center text-red-400">{error}</div>
  {:else}
    <div class="flex justify-between items-center mb-4 pb-4 border-b border-gray-700 md:flex-col md:items-stretch md:gap-4">
      <div class="flex gap-2 flex-wrap">
        <button on:click={selectAll} class="px-3 py-1.5 text-sm bg-gray-700 text-white border border-gray-600 rounded cursor-pointer transition-all hover:bg-gray-600 hover:border-gray-500">Select All ({samples.length})</button>
        <button on:click={clearSelection} class="px-3 py-1.5 text-sm bg-gray-700 text-white border border-gray-600 rounded cursor-pointer transition-all hover:bg-gray-600 hover:border-gray-500">Clear</button>
        <button on:click={() => selectBest(5)} class="px-3 py-1.5 text-sm bg-gray-700 text-white border border-gray-600 rounded cursor-pointer transition-all hover:bg-gray-600 hover:border-gray-500">Select Top 5</button>
        <button on:click={() => selectBest(10)} class="px-3 py-1.5 text-sm bg-gray-700 text-white border border-gray-600 rounded cursor-pointer transition-all hover:bg-gray-600 hover:border-gray-500">Select Top 10</button>
      </div>

      <div class="flex gap-4 md:justify-between md:w-full">
        <div class="flex flex-col items-end">
          <label class="text-xs text-gray-400 uppercase tracking-wide">Selected:</label>
          <span class="text-base font-semibold mt-0.5">{selectedIds.size} samples</span>
        </div>
        <div class="flex flex-col items-end">
          <label class="text-xs text-gray-400 uppercase tracking-wide">Duration:</label>
          <span class="text-base font-semibold mt-0.5">{formatDuration(selectedDuration)}</span>
        </div>
        <div class="flex flex-col items-end">
          <label class="text-xs text-gray-400 uppercase tracking-wide">Avg Quality:</label>
          <span class="text-base font-semibold mt-0.5 {selectedQuality >= 0.9 ? 'text-green-400' : selectedQuality >= 0.7 ? 'text-yellow-400' : 'text-red-400'}">
            {(selectedQuality * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>

    <div class="max-h-[400px] overflow-y-auto border border-gray-700 rounded-md bg-gray-950">
      {#if samples.length === 0}
        <div class="p-8 text-center text-gray-400">
          No samples found above quality threshold ({minQuality}).
          <br>Try recording more voice samples or lowering the quality threshold.
        </div>
      {:else}
        {#each samples as sample (sample.id)}
          <div
            class="flex items-center px-4 py-3 border-b border-gray-800 cursor-pointer transition-all relative hover:bg-gray-800 {selectedIds.has(sample.id) ? 'bg-blue-900/30 border-l-[3px] border-l-blue-500' : ''}"
            on:click={() => toggleSelection(sample.id)}
          >
            <div class="mr-3">
              <input
                type="checkbox"
                checked={selectedIds.has(sample.id)}
                on:change={() => toggleSelection(sample.id)}
                class="w-5 h-5 cursor-pointer"
              />
            </div>

            <div class="flex-1">
              <div class="font-medium mb-1 text-[0.95rem]">{sample.id}</div>
              <div class="flex gap-4 text-sm md:flex-col md:gap-1">
                <span class="flex gap-1">
                  <span class="text-gray-400">Duration:</span>
                  <span class="text-white font-medium">{formatDuration(sample.duration)}</span>
                </span>
                <span class="flex gap-1">
                  <span class="text-gray-400">Quality:</span>
                  <span class="font-medium {sample.quality >= 0.9 ? 'text-green-400' : sample.quality >= 0.7 ? 'text-yellow-400' : 'text-red-400'}">
                    {(sample.quality * 100).toFixed(0)}%
                  </span>
                </span>
                <span class="flex gap-1">
                  <span class="text-gray-400">Date:</span>
                  <span class="text-white font-medium">{formatTimestamp(sample.timestamp)}</span>
                </span>
              </div>
            </div>

            <div class="flex items-center gap-2 mr-2">
              <button
                class="p-2 bg-blue-600 text-white border-none rounded-full w-10 h-10 flex items-center justify-center cursor-pointer text-base transition-all hover:bg-blue-700 hover:scale-110"
                on:click={(e) => togglePlayAudio(sample, e)}
                title={playingId === sample.id ? 'Stop' : 'Play sample'}
              >
                {playingId === sample.id ? '⏸️' : '▶️'}
              </button>

              {#if provider === 'gpt-sovits' || provider === 'sovits'}
                <button
                  class="p-1.5 border rounded-md w-9 h-9 flex items-center justify-center cursor-pointer text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-110 {currentReference?.sampleId === sample.id ? 'bg-green-500 border-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-green-900/50 border-green-700 hover:bg-green-800/50'}"
                  on:click={(e) => setAsReference(sample.id, e)}
                  disabled={settingReference}
                  title="Set as active reference for voice cloning"
                >
                  {currentReference?.sampleId === sample.id ? '✓' : '🎯'}
                </button>
                <button
                  class="p-1.5 bg-blue-900/50 border border-blue-700 rounded-md w-9 h-9 flex items-center justify-center cursor-pointer text-sm transition-all hover:bg-blue-800/50 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed"
                  on:click={(e) => testVoiceWithSample(sample.id, e)}
                  disabled={testingVoice}
                  title="Test voice with this sample"
                >
                  {testingVoice ? '...' : '🔊'}
                </button>
              {/if}
            </div>

            <div class="w-20 h-1.5 bg-gray-800 rounded overflow-hidden ml-4 md:hidden">
              <div class="h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 transition-all duration-300" style="width: {sample.quality * 100}%"></div>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="mt-4 pt-4 border-t border-gray-700">
      <div class="flex justify-around gap-4">
        <div class="flex flex-col items-center">
          <label class="text-xs text-gray-400 mb-0.5 uppercase tracking-wide">Total Available:</label>
          <span class="text-base font-semibold">{samples.length} samples</span>
        </div>
        <div class="flex flex-col items-center">
          <label class="text-xs text-gray-400 mb-0.5 uppercase tracking-wide">Total Duration:</label>
          <span class="text-base font-semibold">{formatDuration(totalDuration)}</span>
        </div>
        <div class="flex flex-col items-center">
          <label class="text-xs text-gray-400 mb-0.5 uppercase tracking-wide">Avg Quality:</label>
          <span class="text-base font-semibold">{(avgQuality * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  {/if}
</div>

