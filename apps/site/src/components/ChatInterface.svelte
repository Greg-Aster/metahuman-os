<script lang="ts">
  import { onMount, afterUpdate, tick, onDestroy } from 'svelte';
  import Thinking from './Thinking.svelte';
  import VoiceInteraction from './VoiceInteraction.svelte';
  import ApprovalBox from './ApprovalBox.svelte';
  import { canUseOperator, currentMode } from '../stores/security-policy';
  import { triggerClearAuditStream, clearChatTrigger } from '../stores/clear-events';
  import { yoloModeStore } from '../stores/navigation';

type MessageRole = 'user' | 'assistant' | 'system' | 'reflection' | 'reasoning';

interface ChatMessage {
  role: MessageRole;
  content: string;
  timestamp: number;
  relPath?: string;
  meta?: Record<string, any> | null;
}

interface ReasoningStage {
  round: number;
  stage: string;
  content: string;
  timestamp: number;
}

// OperatorSkillInfo interface removed - operator controls moved to left sidebar

let messages: ChatMessage[] = [];
  let input = '';
  let loading = false;
let reasoningStages: ReasoningStage[] = [];
  let reasoningDepth: number = 0;
  const reasoningLabels = ['Off', 'Quick', 'Focused', 'Deep'];
  const clampReasoningDepth = (value: number) => Math.max(0, Math.min(reasoningLabels.length - 1, Math.round(value)));
  let chatResponseStream: EventSource | null = null;
  let mode: 'conversation' | 'inner' | 'voice' = 'conversation';
  let lengthMode: 'auto' | 'concise' | 'detailed' = 'auto';
  let messagesContainer: HTMLDivElement;
  let shouldAutoScroll = true;
  let reflectionStream: EventSource | null = null;
  // Convenience toggles
  let ttsEnabled = false;
  // forceOperator removed - unified reasoning always uses operator for authenticated users
  // audience removed - focus selector obsolete with ReAct operator
  let showMiniVoice = false;
  let boredomTtsEnabled = false; // For inner dialog voice
  let audioUnlocked = false;
  let audioCtx: AudioContext | null = null;
  let currentAudio: HTMLAudioElement | null = null;
  let currentObjectUrl: string | null = null;
  let currentTtsAbort: AbortController | null = null;
  let ttsPlaybackToken = 0;
  // Operator status variables removed - controls moved to left sidebar status widget
  let controlsExpanded = true;
  let yoloMode = false;

  // Subscribe to shared YOLO mode store
  yoloModeStore.subscribe(value => {
    yoloMode = value;
  });

  function isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  // Note: We intentionally disable device SpeechSynthesis.
  // Always use server-side Piper via /api/tts for consistent voice.

  function revokeCurrentUrl() {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
  }

  function stopActiveAudio() {
    if (currentAudio) {
      try {
        currentAudio.pause();
      } catch {}
      currentAudio = null;
    }
    revokeCurrentUrl();
  }

  function cancelInFlightTts() {
    if (currentTtsAbort) {
      currentTtsAbort.abort();
      currentTtsAbort = null;
    }
  }

  // Operator status functions removed - functionality moved to left sidebar status widget

  function setYoloMode(value: boolean, persist = true, suppressWarn = false) {
    const changed = yoloMode !== value;
    yoloModeStore.set(value); // Update shared store instead of local variable
    if (persist) saveChatPrefs();
    if (changed && value && !suppressWarn) {
      try {
        if (!localStorage.getItem('yoloWarned')) {
          alert('YOLO mode relaxes safety checks and allows the operator to act more freely. Use with caution.');
          localStorage.setItem('yoloWarned', '1');
        }
      } catch {}
    }
  }

  function handleYoloToggle(event: Event) {
    const target = event.target as HTMLInputElement;
    setYoloMode(target?.checked ?? false);
  }

  function toggleYoloMobile() {
    setYoloMode(!yoloMode);
  }

  function normalizeTextForSpeech(text: string): string {
    if (!text) return '';
    let output = text;

    // Remove code blocks entirely
    output = output.replace(/```[\s\S]*?```/g, ' ');
    // Inline code: keep content
    output = output.replace(/`([^`]+)`/g, '$1');
    // Image markdown
    output = output.replace(/!\[[^\]]*\]\([^)]+\)/g, ' ');
    // Links: keep the readable label
    output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    // Remove emphasis markers like **bold**, _italic_
    output = output.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1');
    // Strip remaining markdown bullets and headings
    output = output.replace(/^#{1,6}\s*/gm, '');
    output = output.replace(/^\s*[-+*]\s+/gm, '');
    // Remove HTML tags
    output = output.replace(/<\/?[^>]+>/g, ' ');
    // Replace multiple punctuation markers such as asterisks or slashes used decoratively
    output = output.replace(/[*/]{2,}/g, ' ');
    // Collapse whitespace
    output = output.replace(/\s+/g, ' ').trim();

    return output;
  }

  async function speakText(text: string): Promise<void> {
    console.log('[chat-tts] speakText called with text length:', text.length);
    const speechText = normalizeTextForSpeech(text);
    console.log('[chat-tts] normalized text length:', speechText?.length || 0);
    if (!speechText) {
      console.log('[chat-tts] No speech text after normalization, aborting');
      return;
    }

    const token = ++ttsPlaybackToken;
    stopActiveAudio();
    cancelInFlightTts();

    const controller = new AbortController();
    currentTtsAbort = controller;

    try {
      console.log('[chat-tts] Fetching TTS from /api/tts...');
      const ttsRes = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: speechText }),
        signal: controller.signal
      });

      if (token !== ttsPlaybackToken) return;
      currentTtsAbort = null;

      if (!ttsRes.ok) {
        console.warn('[chat-tts] TTS request failed:', ttsRes.status);
        return;
      }

      const blob = await ttsRes.blob();
      if (token !== ttsPlaybackToken) return;

      const url = URL.createObjectURL(blob);
      currentObjectUrl = url;

      const audio = new Audio(url);
      currentAudio = audio;

      const cleanup = () => {
        if (token !== ttsPlaybackToken) return;
        stopActiveAudio();
      };

      audio.onended = cleanup;
      audio.onerror = cleanup;

      await audio.play().catch((err) => {
        console.warn('[chat-tts] Audio playback failed:', err);
        cleanup();
      });
    } catch (e) {
      if (controller.signal.aborted) {
        // Expected when superseded by a new utterance
        return;
      }
      console.warn('[chat-tts] speakText failed:', e);
    } finally {
      if (currentTtsAbort === controller) {
        currentTtsAbort = null;
      }
    }
  }

  async function ensureAudioUnlocked(): Promise<void> {
    if (audioUnlocked) return;
    try {
      // Create a short silent buffer to satisfy autoplay policies
      audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
      const buffer = audioCtx.createBuffer(1, 1, 22050);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start(0);
      await audioCtx.resume();
      audioUnlocked = true;
    } catch (e) {
      console.warn('[chat-tts] Failed to unlock audio:', e);
    }
  }

  // Intersection observer for auto-scroll detection
  let scrollSentinel: HTMLDivElement;


  function loadChatPrefs() {
    try {
      const raw = localStorage.getItem('chatPrefs');
      if (!raw) { ttsEnabled = isMobileDevice(); return; }
      const p = JSON.parse(raw);
      if (typeof p.ttsEnabled === 'boolean') ttsEnabled = p.ttsEnabled;
      if (typeof p.reasoningDepth === 'number') {
        reasoningDepth = clampReasoningDepth(p.reasoningDepth);
      } else if (typeof p.reasoningEnabled === 'boolean') {
        reasoningDepth = p.reasoningEnabled ? 2 : 0;
      }
      if (typeof p.boredomTtsEnabled === 'boolean') boredomTtsEnabled = p.boredomTtsEnabled;
      // forceOperator removed - no longer used
      // audience removed - focus selector obsolete with ReAct operator
      if (typeof p.yoloMode === 'boolean') setYoloMode(p.yoloMode, false, true);
    } catch {}
  }
  function saveChatPrefs() {
    try {
      const prefs = {
        ttsEnabled,
        reasoningDepth,
        reasoningEnabled: reasoningDepth > 0,
        boredomTtsEnabled,
        // forceOperator removed - no longer used
        // audience removed - focus selector obsolete with ReAct operator
        yoloMode,
      };
      localStorage.setItem('chatPrefs', JSON.stringify(prefs));
    } catch {}
  }

  function updateReasoningDepth(value: number, persist = false) {
    const clamped = clampReasoningDepth(value);
    if (clamped !== reasoningDepth) {
      reasoningDepth = clamped;
      if (clamped === 0) reasoningStages = [];
    }
    if (persist) saveChatPrefs();
  }

  function handleReasoningInput(event: Event) {
    const target = event.target as HTMLInputElement;
    updateReasoningDepth(Number(target.value), false);
  }

  function handleReasoningChange(event: Event) {
    const target = event.target as HTMLInputElement;
    updateReasoningDepth(Number(target.value), true);
  }

  // Lightweight local session cache to keep assistant replies visible between navigations
  function sessionKey() { return `chatSession:${mode}`; }
  function saveSession() {
    try {
      if (mode === 'voice') return;
      const toSave = messages.slice(-100); // keep last 100
      localStorage.setItem(sessionKey(), JSON.stringify(toSave));
    } catch {}
  }
  function loadSessionFromStorage(): typeof messages | null {
    try {
      const raw = localStorage.getItem(sessionKey());
      if (!raw) return null;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    } catch {}
    return null;
  }

  onMount(() => {
    loadChatPrefs();

    const observer = new IntersectionObserver(
      (entries) => {
        shouldAutoScroll = entries[0].isIntersecting;
      },
      { threshold: 0.1 }
    );

    if (scrollSentinel) {
      observer.observe(scrollSentinel);
    }

    // Connect to reflection stream
    reflectionStream = new EventSource('/api/reflections/stream');

    reflectionStream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'reflection' && data.reflection) {
          messages = [
            ...messages,
            {
              role: 'reflection',
              content: data.reflection,
              timestamp: new Date(data.timestamp).getTime(),
            },
          ];
          
          // Add voice support for inner dialog if enabled
          if (boredomTtsEnabled && mode === 'inner' && data.reflection) {
            void speakText(data.reflection);
          }
        }
      } catch (e) {
        console.error('Failed to parse reflection event:', e);
      }
    };

    reflectionStream.onerror = () => {
      console.log('Reflection stream disconnected, will auto-reconnect');
    };

    // Start with fresh interface - no history loading
    // User can use Clear button to explicitly clear the session
    // Chat conversations are saved to memory/episodic for training purposes
    const cached = loadSessionFromStorage();
    if (cached) messages = cached;

    return () => observer.disconnect();
  });


  // Load chat history from episodic memory for the current mode
  async function loadHistoryForMode() {
    if (mode === 'voice') return;
    try {
      const res = await fetch(`/api/chat/history?mode=${mode}&limit=60`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        // Merge server history with any locally cached assistant replies
        const cached = loadSessionFromStorage();
        if (!cached) {
          messages = data.messages;
        } else {
          const seen = new Set<string>();
          const merged: typeof messages = [];
          for (const m of [...data.messages, ...cached]) {
            // Dedup by role+content only (timestamps may differ between cache and server)
            const key = `${m.role}|${m.content}`;
            if (!seen.has(key)) { seen.add(key); merged.push(m); }
          }
          // Sort by timestamp ascending for correct order
          merged.sort((a, b) => (a.timestamp - b.timestamp));
          messages = merged;
        }
      }
    } catch (e) {
      console.error('Failed to load chat history:', e);
    }
  }

  onDestroy(() => {
    reflectionStream?.close();
    if (activityTimeout) {
      clearTimeout(activityTimeout);
    }
    cancelInFlightTts();
    stopActiveAudio();
    if (audioCtx) {
      try { audioCtx.close(); } catch {}
      audioCtx = null;
    }
    // teardownOperatorOutsideListener removed - operator info popover removed
  });

  afterUpdate(() => {
    if (shouldAutoScroll && messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  });

  function pushMessage(role: MessageRole, content: string, relPath?: string, meta: Record<string, any> | null = null) {
    const trimmed = (content || '').trim();
    if (!trimmed) return;
    // Prevent near-duplicate inserts by checking the last few items for same role+content
    if (role !== 'reasoning') {
      const back = messages.slice(-3);
      if (back.some(m => m.role === role && (m.content || '').trim() === trimmed)) return;
    }
    messages = [
      ...messages,
      { role, content: trimmed, timestamp: Date.now(), relPath, meta },
    ];
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    await ensureAudioUnlocked();

    // Signal activity when sending a message
    signalActivity();
    
    const userMessage = input.trim();
    input = '';

    pushMessage('user', userMessage);

    loading = true;
    reasoningStages = [];

    try {
      let llm_opts = {};
      try {
        const raw = localStorage.getItem('llmOptions');
        if (raw) llm_opts = JSON.parse(raw);
      } catch {}

      const params = new URLSearchParams({
        message: userMessage,
        mode,
        length: lengthMode,
        reason: String(reasoningDepth > 0),
        reasoningDepth: String(reasoningDepth),
        llm: JSON.stringify(llm_opts),
        // forceOperator removed - no longer used
      });
      params.set('yolo', String(yoloMode));
      // audience removed - focus selector obsolete with ReAct operator

      // Use EventSource for streaming with a GET request
      chatResponseStream = new EventSource(`/api/persona_chat?${params.toString()}`);

      chatResponseStream.onmessage = (event) => {
        try {
          const { type, data } = JSON.parse(event.data);

          if (type === 'reasoning') {
            if (typeof data === 'string') {
              reasoningStages = [
                {
                  round: 1,
                  stage: 'plan',
                  content: data,
                  timestamp: Date.now(),
                },
              ];
            } else if (data && typeof data === 'object') {
              const stageObj: ReasoningStage = {
                round: Number(data.round) > 0 ? Number(data.round) : 1,
                stage: String(data.stage || 'plan'),
                content: String(data.content || ''),
                timestamp: Date.now(),
              };
              reasoningStages = [...reasoningStages, stageObj];
            }
          } else if (type === 'answer') {
            if (reasoningStages.length > 0) {
              reasoningStages.forEach(stage => {
                const label = `${formatReasoningLabel(stage)} · ${formatTime(stage.timestamp)}`;
                pushMessage('reasoning', stage.content, undefined, { stage, label });
              });
              reasoningStages = [];
            }
            if (!data.duplicate) {
              pushMessage('assistant', data.response, data?.saved?.assistantRelPath, { facet: data.facet });
            }
            saveSession();

            if (ttsEnabled && mode !== 'voice' && data.response) {
              console.log('[chat-tts] TTS enabled, speaking response:', data.response.substring(0, 50));
              void speakText(data.response);
            } else {
              console.log('[chat-tts] TTS skipped - enabled:', ttsEnabled, 'mode:', mode, 'hasResponse:', !!data.response);
            }

            loading = false;
            chatResponseStream?.close();
          } else if (type === 'error') {
            throw new Error(data.message);
          }
        } catch (err) {
          console.error('Chat stream error:', err);
          pushMessage('system', 'Error: Failed to process server response.');
          loading = false;
          reasoningStages = [];
          chatResponseStream?.close();
        }
      };

      chatResponseStream.onerror = (err) => {
        console.error('EventSource failed:', err);
        pushMessage('system', 'Error: Connection to the server was lost.');
        loading = false;
        reasoningStages = [];
        chatResponseStream?.close();
      };

    } catch (err) {
      console.error('Chat setup error:', err);
      pushMessage('system', 'Error: Could not send message.');
      loading = false;
      reasoningStages = [];
    }
  }
  // Activity tracking for sleep service
  let activityTimeout: number | null = null;

  function signalActivity() {
    // Clear existing timeout
    if (activityTimeout) {
      clearTimeout(activityTimeout);
    }
    
    // Set a new timeout - signal activity after 3 seconds of no further input
    activityTimeout = window.setTimeout(() => {
      fetch('/api/activity-ping', { method: 'POST' })
        .then(response => {
          if (!response.ok) {
            console.error('Failed to signal activity');
          }
        })
        .catch(error => console.error('Error signaling activity:', error));
    }, 3000); // 3000ms = 3 seconds debounce
  }

  function handleKeyPress(e: KeyboardEvent) {
    // Signal activity on key press
    signalActivity();
    
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function handleDelete(relPath: string) {
    try {
      const res = await fetch('/api/memories/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relPath }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to delete');
      messages = messages.filter(m => m.relPath !== relPath);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleValidate(relPath: string, status: 'correct' | 'incorrect') {
    try {
      const res = await fetch('/api/memories/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relPath, status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to validate');
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function clearChat() {
    messages = [];
    reasoningStages = [];
    // Clear localStorage session cache
    try {
      localStorage.removeItem(sessionKey());
    } catch {}
    // Clear the audit stream display in the right sidebar
    triggerClearAuditStream();

    // Clear audit log files from disk for privacy
    try {
      const response = await fetch('/api/audit/clear', {
        method: 'DELETE',
      });

      if (!response.ok) {
        console.warn('Failed to clear audit logs:', response.statusText);
      } else {
        const result = await response.json();
        console.log('Audit logs cleared:', result.message);
      }
    } catch (error) {
      console.warn('Error clearing audit logs:', error);
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function formatReasoningLabel(stage: ReasoningStage): string {
    const stageName = String(stage.stage || 'plan')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    return `🤔 Round ${stage.round}: ${stageName}`;
  }

  // Inline mic capture → STT → insert into input
  let micRecording = false;
  let micStream: MediaStream | null = null;
  let micRecorder: MediaRecorder | null = null;
  let micChunks: BlobPart[] = [];
  let micStartedAt: number | null = null;
  let micAnalyser: AnalyserNode | null = null;
  let micAudioCtx: AudioContext | null = null;
  let micSilenceTimer: number | null = null;

  async function startMic() {
    if (micRecording) return;
    try {
      // Guard for unsupported/insecure contexts (e.g., HTTP over LAN)
      const supported = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
      if (!supported) {
        console.warn('[chat-mic] getUserMedia unavailable (insecure context or unsupported browser)');
        return;
      }
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      micAudioCtx = new AudioContext();
      const source = micAudioCtx.createMediaStreamSource(micStream);
      micAnalyser = micAudioCtx.createAnalyser();
      micAnalyser.fftSize = 256;
      source.connect(micAnalyser);

      micChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      micRecorder = new MediaRecorder(micStream, { mimeType });
      micRecorder.ondataavailable = (e) => { if (e.data?.size) micChunks.push(e.data); };
      micRecorder.onstop = () => { void finalizeMic(); };
      micRecorder.start();
      micRecording = true;
      micStartedAt = Date.now();
      runMicVAD();
    } catch (e) {
      console.error('[chat-mic] Failed to start mic:', e);
    }
  }

  function stopMic() {
    if (!micRecording) return;
    try { micRecorder && micRecorder.state !== 'inactive' && micRecorder.stop(); } catch {}
    if (micSilenceTimer) { clearTimeout(micSilenceTimer); micSilenceTimer = null; }
    micRecording = false;
    try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
    micStream = null;
    try { micAudioCtx?.close(); } catch {}
    micAudioCtx = null; micAnalyser = null;
  }

  async function finalizeMic() {
    try {
      const blob = new Blob(micChunks, { type: 'audio/webm' });
      const buf = await blob.arrayBuffer();
      const dur = micStartedAt ? (Date.now() - micStartedAt) : 0;
      const res = await fetch(`/api/stt?format=webm&collect=1&dur=${dur}`, { method: 'POST', body: buf });
      if (res.ok) {
        const data = await res.json();
        if (data?.transcript) {
          input = data.transcript;
        }
      }
    } catch (e) {
      console.error('[chat-mic] STT failed:', e);
    } finally {
      micChunks = [];
      micStartedAt = null;
    }
  }

  function runMicVAD() {
    const analyser = micAnalyser; if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const THRESH = 12; // similar to Voice tab default
    const STOP_MS = 3000; // ms of silence to stop (3 seconds - allows natural pauses)
    let speaking = false;
    const tickVAD = () => {
      if (!micRecording || !micAnalyser) return;
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const vol = Math.min(100, (avg / 255) * 100);
      if (vol > THRESH) {
        speaking = true;
        if (micSilenceTimer) { clearTimeout(micSilenceTimer); micSilenceTimer = null; }
      } else if (speaking && !micSilenceTimer) {
        micSilenceTimer = window.setTimeout(() => { stopMic(); }, STOP_MS);
      }
      requestAnimationFrame(tickVAD);
    };
    requestAnimationFrame(tickVAD);
  }

</script>

<div class="chat-interface">
  <!-- Mode Toggle -->
  <div class="mode-toggle-container">
    <div class="mode-toggle">
      <button
        class={mode === 'conversation' ? 'mode-btn active' : 'mode-btn'}
        on:click={() => { mode = 'conversation'; loadHistoryForMode(); }}
        aria-label="Conversation mode"
      >
        <span class="mode-icon" aria-hidden="true">💬</span>
        <span class="mode-label">Conversation</span>
      </button>
      <button
        class={mode === 'inner' ? 'mode-btn active' : 'mode-btn'}
        on:click={() => { mode = 'inner'; loadHistoryForMode(); }}
        aria-label="Inner dialogue mode"
      >
        <span class="mode-icon" aria-hidden="true">🧠</span>
        <span class="mode-label">Inner Dialogue</span>
      </button>
      <button
        class={mode === 'voice' ? 'mode-btn active' : 'mode-btn'}
        on:click={() => (mode = 'voice')}
        aria-label="Voice mode"
      >
        <span class="mode-icon" aria-hidden="true">🎤</span>
        <span class="mode-label">Voice</span>
      </button>
    </div>

    <!-- Length toggle -->
    <div class="length-toggle">
      <label class="control-label" for="length-select">
        <span class="control-icon" aria-hidden="true">📏</span>
        <span class="control-text">Length</span>
      </label>
      <select id="length-select" bind:value={lengthMode} aria-label="Response length">
        <option value="auto">Auto</option>
        <option value="concise">Concise</option>
        <option value="detailed">Detailed</option>
      </select>
    </div>

    <!-- Reasoning depth slider -->
    <div class="reasoning-toggle">
      <label class="control-label" for="reasoning-range">
        <span class="control-icon" aria-hidden="true">🧠</span>
        <span class="control-text">Reasoning</span>
      </label>
      <div class="reasoning-slider">
        <input
          id="reasoning-range"
          type="range"
          min="0"
          max={reasoningLabels.length - 1}
          step="1"
          value={reasoningDepth}
          on:input={handleReasoningInput}
          on:change={handleReasoningChange}
        />
        <span class="reasoning-level">{reasoningLabels[reasoningDepth]}</span>
      </div>
    </div>

    <!-- Quick voice/tts controls -->
    <div class="quick-audio">
      <button class="icon-btn" title={ttsEnabled ? 'Disable speech' : 'Enable speech'} on:click={() => { ttsEnabled = !ttsEnabled; saveChatPrefs(); }}>
        <!-- Speaker icon -->
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 10v4h4l5 5V5L7 10H3zM16.5 12a4.5 4.5 0 00-1.5-3.356V15.356A4.5 4.5 0 0016.5 12z"></path></svg>
        {#if ttsEnabled}<span class="badge">On</span>{/if}
      </button>
      <button class="icon-btn" title={showMiniVoice ? 'Hide mic' : 'Show mic'} on:click={() => showMiniVoice = !showMiniVoice}>
        <!-- Mic icon -->
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>
        {#if showMiniVoice}<span class="badge">On</span>{/if}
      </button>
      
      <!-- Inner dialog voice toggle (only visible in inner mode) -->
      {#if mode === 'inner'}
        <button 
          class="icon-btn {boredomTtsEnabled ? 'active' : ''}" 
          title={boredomTtsEnabled ? 'Disable inner dialog voice (boredom service)' : 'Enable inner dialog voice (boredom service)'}
          on:click={() => { boredomTtsEnabled = !boredomTtsEnabled; saveChatPrefs(); }}
        >
          <!-- Robot/Inner dialog icon -->
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
          </svg>
          {#if boredomTtsEnabled}<span class="badge">Inner On</span>{/if}
        </button>
      {/if}
    </div>

    {#if messages.length > 0}
      <button class="clear-btn" on:click={clearChat}>
        Clear
      </button>
    {/if}
  </div>

  <!-- Messages Area / Voice Interface -->
  {#if mode === 'voice'}
    <div class="voice-container">
      <VoiceInteraction />
    </div>
  {:else}
  {#if showMiniVoice}
    <div class="mini-voice">
      <VoiceInteraction />
    </div>
  {/if}
  <div class="messages-container" bind:this={messagesContainer}>
    {#if messages.length === 0}
      <div class="welcome-screen">
        <div class="welcome-icon">🧠 => 💻</div>
        <h2 class="welcome-title">MetaHuman OS</h2>
        <p class="welcome-subtitle">
          {#if mode === 'conversation'}
            Start a conversation with your digital personality extension
          {:else}
            Explore your MetaHuman's inner dialogue
          {/if}
        </p>
        <div class="welcome-suggestions">
          <button class="suggestion" on:click={() => { input = "What are my current goals?"; }}>
            What are my current goals?
          </button>
          <button class="suggestion" on:click={() => { input = "What tasks do I have?"; }}>
            What tasks do I have?
          </button>
          <button class="suggestion" on:click={() => { input = "Tell me about yourself"; }}>
            Tell me about yourself
          </button>
        </div>
      </div>
    {:else}
      <div class="messages-list">
        {#each messages as message}
          {#if mode === 'inner' || message.role !== 'reflection'}
            {#if message.role === 'reasoning'}
              <Thinking
                steps={message.content}
                label={message.meta?.label ?? (message.meta?.stage ? formatReasoningLabel({ ...message.meta.stage, timestamp: message.timestamp }) : '🤔 Reasoning · ' + formatTime(message.timestamp))}
                initiallyOpen={false}
              />
            {:else}
              <div class="message message-{message.role}" data-facet={message.meta?.facet || 'default'}>
                <div class="message-header">
                  <span class="message-role">
                    {#if message.role === 'user'}
                      You
                    {:else if message.role === 'assistant'}
                      MetaHuman{#if message.meta?.facet && message.meta.facet !== 'default'}<span class="facet-indicator" title="Speaking as {message.meta.facet} facet"> · {message.meta.facet}</span>{/if}
                    {:else if message.role === 'reflection'}
                      💭 Idle Thought
                    {:else}
                      System
                    {/if}
                  </span>
                  <span class="message-time">{formatTime(message.timestamp)}</span>

                  {#if message.role === 'assistant' && message.relPath}
                    <span class="message-actions">
                      <button class="msg-btn bad" title="Delete from memory" on:click={() => handleDelete(message.relPath)}>−</button>
                      <button class="msg-btn good" title="Mark as correct" on:click={() => handleValidate(message.relPath, 'correct')}>+</button>
                    </span>
                  {/if}
                </div>
                <div class="message-content">
                  {message.content}
                </div>
              </div>
            {/if}
          {/if}
        {/each}

        {#if reasoningStages.length > 0}
          {#each reasoningStages as stage (stage.timestamp + '-' + stage.round + '-' + stage.stage)}
            <Thinking
              steps={stage.content}
              label={formatReasoningLabel(stage)}
              initiallyOpen={true}
            />
          {/each}
        {/if}

        {#if loading && reasoningStages.length === 0}
          <div class="message message-assistant">
            <div class="message-header">
              <span class="message-role">MetaHuman</span>
            </div>
            <div class="message-content typing">
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
            </div>
          </div>
        {/if}

        <div bind:this={scrollSentinel} class="scroll-sentinel"></div>
      </div>
    {/if}
  </div>
  {/if}

  <!-- Input Area (hidden in voice mode) -->
  {#if mode !== 'voice'}
  <div class="input-container">
    <div class="input-wrapper">
      <div class="input-controls">
        <!-- All operator controls removed: YOLO, trust, and focus now in left sidebar status widget or obsolete -->
      </div>

      <!-- Code approval box appears here when there are pending approvals -->
      <ApprovalBox />

      <div class="input-row">
        <textarea
          bind:value={input}
          on:keypress={handleKeyPress}
          on:focus={() => { void ensureAudioUnlocked() }}
          on:touchstart={() => { void ensureAudioUnlocked() }}
          placeholder={mode === 'conversation' ? 'Message your MetaHuman...' : 'Explore inner dialogue...'}
          rows="1"
          class="chat-input"
          disabled={loading}
        />
        <div class="input-actions">
          {#if $currentMode !== 'emulation'}
            <!-- Operator toggle removed: unified reasoning always uses operator for authenticated users -->
            <button
              class="operator-icon-btn yolo {yoloMode ? 'active' : ''}"
              title={!$canUseOperator ? 'YOLO mode disabled in current mode' : (yoloMode ? 'YOLO mode enabled' : 'Enable YOLO mode')}
              aria-pressed={yoloMode}
              disabled={!$canUseOperator}
              on:click={toggleYoloMobile}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M13 2L3 14h7l-1 8 10-12h-7z" />
              </svg>
            </button>
          {/if}
          <button
            class="mic-btn {micRecording ? 'recording' : ''}"
            title={micRecording ? 'Listening… click to stop' : 'Click to speak'}
            on:click={() => micRecording ? stopMic() : startMic()}
            disabled={loading}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
            </svg>
          </button>
          <button
            class="send-btn"
            on:click={sendMessage}
            disabled={!input.trim() || loading}
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
  {/if}
</div>

<style>
  /* Component-specific overrides and unique styles only */

  /* YOLO toggle special styling */
  .small-toggle.yolo-toggle {
    color: rgb(217 119 6);
    font-weight: 600;
  }
  .small-toggle.yolo-toggle input {
    accent-color: rgb(234 179 8);
  }
  .small-toggle.yolo-toggle span {
    color: inherit;
    padding-inline: 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 999px;
    transition: color 0.2s ease, background 0.2s ease;
  }
  .small-toggle.yolo-toggle input:checked + span {
    background: rgba(234, 179, 8, 0.18);
    color: rgb(202 138 4);
  }
  :global(.dark) .small-toggle.yolo-toggle {
    color: rgb(253 224 71);
  }
  :global(.dark) .small-toggle.yolo-toggle input:checked + span {
    background: rgba(250, 204, 21, 0.22);
    color: rgb(250 204 21);
  }

  /* Operator trigger SVG animation */
  .operator-info-trigger svg {
    transition: transform 0.2s ease;
  }
  .operator-info-trigger:focus-visible {
    outline: 2px solid rgba(79, 70, 229, 0.45);
    outline-offset: 2px;
  }
  .operator-info-trigger[aria-expanded="true"] svg {
    transform: rotate(180deg);
  }
  /* Operator popover internal components */
  .operator-popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .operator-popover-header strong {
    font-size: 12px;
    letter-spacing: 0.02em;
  }
  .operator-popover-close {
    border: none;
    background: transparent;
    color: inherit;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .operator-popover-close:focus-visible {
    outline: 2px solid rgba(79,70,229,0.45);
    outline-offset: 2px;
  }
  .operator-popover-trust {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 8px;
    color: rgba(79, 70, 229, 0.85);
  }
  :global(.dark) .operator-popover-trust {
    color: rgba(167, 139, 250, 0.85);
  }
  .operator-popover-state {
    font-size: 11px;
    line-height: 1.45;
  }
  .operator-popover-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 11px;
    color: rgb(185, 28, 28);
  }
  .operator-popover-error button {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 9999px;
    border: 1px solid rgba(185, 28, 28, 0.6);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .operator-popover-content {
    max-height: 240px;
    overflow-y: auto;
    padding-right: 4px;
    margin-bottom: 6px;
  }
  .operator-popover-content::-webkit-scrollbar {
    width: 6px;
  }
  .operator-popover-content::-webkit-scrollbar-thumb {
    background: rgba(79,70,229,0.3);
    border-radius: 9999px;
  }
  :global(.dark) .operator-popover-content::-webkit-scrollbar-thumb {
    background: rgba(167,139,250,0.4);
  }
  .operator-popover-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .operator-popover-list li {
    padding: 6px;
    border-radius: 8px;
    background: rgba(79, 70, 229, 0.06);
    border: 1px solid rgba(79, 70, 229, 0.08);
  }
  :global(.dark) .operator-popover-list li {
    background: rgba(167, 139, 250, 0.12);
    border-color: rgba(167, 139, 250, 0.18);
  }
  .skill-head {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
  }
  .skill-meta {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(79, 70, 229, 0.75);
  }
  :global(.dark) .skill-meta {
    color: rgba(167, 139, 250, 0.75);
  }
  .skill-desc {
    margin-top: 3px;
    font-size: 11px;
    line-height: 1.4;
  }
  .operator-popover-footnote {
    margin-top: 8px;
    font-size: 10px;
    line-height: 1.45;
    color: rgba(55, 65, 81, 0.75);
  }
  :global(.dark) .operator-popover-footnote {
    color: rgba(226, 232, 240, 0.75);
  }

  /* Mobile responsive adjustments */
  @media (max-width: 640px) {
    .mode-toggle-container {
      flex-wrap: nowrap;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 0.5rem;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }

    .mode-toggle-container::-webkit-scrollbar {
      display: none;
    }

    .mode-toggle {
      flex: 0 0 auto;
      gap: 0.35rem;
    }

    .mode-btn {
      flex: 0 0 auto;
      justify-content: center;
      padding: 0.4rem 0.55rem;
    }

    .mode-label,
    .control-text {
      display: none;
    }

    .length-toggle,
    .reasoning-toggle,
    .quick-audio {
      flex: 0 0 auto;
      gap: 0.35rem;
      white-space: nowrap;
    }

    .length-toggle select {
      width: 82px;
      padding: 0.3rem 0.5rem;
    }

    .reasoning-slider {
      gap: 0.4rem;
    }

    .reasoning-slider input[type="range"] {
      width: 80px;
    }

    .reasoning-level {
      display: none;
    }

    .quick-audio {
      gap: 0.35rem;
      flex-wrap: nowrap;
    }

    .icon-btn {
      padding: 0.3rem 0.4rem;
    }
  }



  /* Mode Toggle */
  .mode-toggle-container {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    flex-shrink: 0;
  }

  :global(.dark) .mode-toggle-container {
    border-bottom-color: rgba(255, 255, 255, 0.1);
  }

  .mode-toggle {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 0.5rem;
  }

  :global(.dark) .mode-toggle {
    background: rgba(255, 255, 255, 0.05);
  }

  .mode-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.85rem;
    border: none;
    background: transparent;
    border-radius: 0.375rem;
    font-size: 0.85rem;
    font-weight: 500;
    color: rgb(107 114 128);
    cursor: pointer;
    transition: all 0.2s;
    min-width: fit-content;
  }

  :global(.dark) .mode-btn {
    color: rgb(156 163 175);
  }

  .mode-icon {
    font-size: 1rem;
    line-height: 1;
  }

  .mode-label {
    white-space: nowrap;
  }

  .control-label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: rgb(107 114 128);
    cursor: pointer;
  }

  :global(.dark) .control-label {
    color: rgb(156 163 175);
  }

  .control-icon {
    font-size: 1rem;
    line-height: 1;
  }

  .control-text {
    white-space: nowrap;
  }

  .mode-btn:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .mode-btn:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .mode-btn.active {
    background: white;
    color: rgb(17 24 39);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .mode-btn.active {
    background: rgb(17 24 39);
    color: rgb(243 244 246);
  }

  .clear-btn {
    padding: 0.5rem 1rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
    background: transparent;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: rgb(107 114 128);
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(.dark) .clear-btn {
    border-color: rgba(255, 255, 255, 0.1);
    color: rgb(156 163 175);
  }

  .clear-btn:hover {
    border-color: rgb(220 38 38);
    color: rgb(220 38 38);
  }

  :global(.dark) .clear-btn:hover {
    border-color: rgb(252 165 165);
    color: rgb(252 165 165);
  }

  /* Length toggle styling */
  .length-toggle { display: flex; align-items: center; gap: 0.5rem; }
  .length-toggle select {
    appearance: none;
    padding: 0.35rem 0.75rem;
    border: 1px solid rgba(0,0,0,0.15);
    border-radius: 0.375rem;
    background: white;
    color: rgb(17 24 39);
  }
  :global(.dark) .length-toggle select {
    background: rgb(17 24 39);
    color: rgb(243 244 246);
    border-color: rgba(255,255,255,0.2);
  }

  .quick-audio { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .reasoning-toggle { display: flex; align-items: center; gap: 0.5rem; }
  .reasoning-slider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .reasoning-slider input[type="range"] {
    width: 140px;
    max-width: 100%;
    accent-color: rgb(124 58 237);
    cursor: pointer;
  }

  :global(.dark) .reasoning-slider input[type="range"] {
    accent-color: rgb(167 139 250);
  }

  .reasoning-level {
    font-size: 0.8rem;
    font-weight: 600;
    color: rgb(107 114 128);
    min-width: 3.5rem;
  }

  :global(.dark) .reasoning-level {
    color: rgb(156 163 175);
  }
  .icon-btn {
    display: inline-flex; align-items: center; gap: 0.25rem;
    padding: 0.35rem 0.5rem; border: 1px solid rgba(0,0,0,0.15);
    background: white; color: rgb(17 24 39);
    border-radius: 0.375rem; cursor: pointer;
  }
  .icon-btn.active {
    background: #7c3aed; /* purple background when active */
    color: white;
    border-color: #7c3aed;
  }
  :global(.dark) .icon-btn { background: rgb(17 24 39); color: rgb(243 244 246); border-color: rgba(255,255,255,0.2); }
  :global(.dark) .icon-btn.active { background: #8b5cf6; color: rgb(17 24 39); border-color: #8b5cf6; }
  .icon-btn .badge { font-size: 0.65rem; background: #10b981; color: white; border-radius: 0.25rem; padding: 0 0.25rem; }

  .mini-voice { border-bottom: 1px solid rgba(0,0,0,0.1); }
  :global(.dark) .mini-voice { border-bottom-color: rgba(255,255,255,0.1); }
  /* Compact voice interface inside chat */
  :global(.mini-voice .voice-interface) { min-height: 180px; padding: 0.75rem; }
  :global(.mini-voice .mode-selector), :global(.mini-voice .vad-settings) { display: none; }

  /* Messages Container */
  .messages-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .voice-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  /* Welcome Screen */
  .welcome-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
    text-align: center;
  }

  .welcome-icon {
    font-size: 4rem;
    margin-bottom: 1rem;
  }

  .welcome-title {
    font-size: 1.875rem;
    font-weight: 700;
    color: rgb(17 24 39);
    margin: 0 0 0.5rem 0;
  }

  :global(.dark) .welcome-title {
    color: rgb(243 244 246);
  }

  .welcome-subtitle {
    font-size: 1rem;
    color: rgb(107 114 128);
    margin: 0 0 2rem 0;
  }

  :global(.dark) .welcome-subtitle {
    color: rgb(156 163 175);
  }

  .welcome-suggestions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 400px;
    width: 100%;
  }

  .suggestion {
    padding: 1rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
    background: white;
    border-radius: 0.75rem;
    font-size: 0.875rem;
    color: rgb(17 24 39);
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
  }

  :global(.dark) .suggestion {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgb(17 24 39);
    color: rgb(243 244 246);
  }

  .suggestion:hover {
    border-color: rgb(124 58 237);
    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.15);
  }

  :global(.dark) .suggestion:hover {
    border-color: rgb(167 139 250);
    box-shadow: 0 4px 12px rgba(167, 139, 250, 0.15);
  }

  /* Messages List */
  .messages-list {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 2rem;
    max-width: 48rem;
    margin: 0 auto;
    width: 100%;
  }

  .message-actions {
    display: inline-flex;
    gap: 0.25rem;
    margin-left: 0.5rem;
  }

  .msg-btn {
    width: 1.25rem;
    height: 1.25rem;
    line-height: 1rem;
    border: 1px solid rgba(0,0,0,0.15);
    border-radius: 0.25rem;
    background: transparent;
    color: rgba(0,0,0,0.6);
    cursor: pointer;
  }

  :global(.dark) .msg-btn { border-color: rgba(255,255,255,0.2); color: rgba(255,255,255,0.8); }
  .msg-btn.good { border-color: rgba(34,197,94,0.5); }
  .msg-btn.bad { border-color: rgba(239,68,68,0.5); }

  .message {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .message-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .message-role {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgb(107 114 128);
  }

  :global(.dark) .message-role {
    color: rgb(156 163 175);
  }

  .message-user .message-role {
    color: rgb(124 58 237);
  }

  :global(.dark) .message-user .message-role {
    color: rgb(167 139 250);
  }

  .message-time {
    font-size: 0.7rem;
    color: rgb(156 163 175);
  }

  :global(.dark) .message-time {
    color: rgb(107 114 128);
  }

  .message-content {
    padding: 1rem;
    border-radius: 0.75rem;
    font-size: 0.9375rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .message-user .message-content {
    background: rgb(124 58 237);
    color: white;
    margin-left: auto;
    max-width: 85%;
  }

  :global(.dark) .message-user .message-content {
    background: rgb(167 139 250);
    color: rgb(17 24 39);
  }

  .message-assistant .message-content {
    background: rgba(0, 0, 0, 0.05);
    color: rgb(17 24 39);
    max-width: 85%;
  }

  :global(.dark) .message-assistant .message-content {
    background: rgba(255, 255, 255, 0.05);
    color: rgb(243 244 246);
  }

  /* Facet-specific border colors for assistant messages */
  .message-assistant[data-facet="poet"] .message-content {
    border-left: 3px solid rgba(99,102,241,0.6);
  }

  .message-assistant[data-facet="thinker"] .message-content {
    border-left: 3px solid rgba(59,130,246,0.6);
  }

  .message-assistant[data-facet="friend"] .message-content {
    border-left: 3px solid rgba(34,197,94,0.6);
  }

  .message-assistant[data-facet="antagonist"] .message-content {
    border-left: 3px solid rgba(239,68,68,0.6);
  }

  .message-assistant[data-facet="default"] .message-content {
    border-left: 3px solid rgba(139,92,246,0.6);
  }

  /* Facet indicator styling */
  .facet-indicator {
    font-size: 0.75rem;
    opacity: 0.7;
    font-weight: normal;
    text-transform: capitalize;
  }

  .message-reflection .message-content {
    background: rgba(167, 139, 250, 0.1);
    color: rgb(109 40 217);
    border: 1px solid rgba(167, 139, 250, 0.3);
    max-width: 85%;
    font-style: italic;
  }

  :global(.dark) .message-reflection .message-content {
    background: rgba(167, 139, 250, 0.1);
    color: rgb(196 181 253);
    border-color: rgba(167, 139, 250, 0.3);
  }

  .message-system .message-content {
    background: rgb(254 226 226);
    color: rgb(153 27 27);
    border: 1px solid rgb(252 165 165);
    font-size: 0.875rem;
    text-align: center;
  }

  :global(.dark) .message-system .message-content {
    background: rgba(185, 28, 28, 0.2);
    color: rgb(252 165 165);
    border-color: rgba(252, 165, 165, 0.3);
  }

  /* Typing Indicator */
  .typing {
    display: flex;
    gap: 0.375rem;
    padding: 0.75rem 1rem;
  }

  .typing-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: rgb(107 114 128);
    animation: typing 1.4s infinite;
  }

  :global(.dark) .typing-dot {
    background: rgb(156 163 175);
  }

  .typing-dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .typing-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes typing {
    0%, 60%, 100% {
      transform: translateY(0);
      opacity: 0.7;
    }
    30% {
      transform: translateY(-0.5rem);
      opacity: 1;
    }
  }

  .scroll-sentinel {
    height: 1px;
  }

  /* Input Container */
  .input-container {
    padding: 1rem;
    /* Ensure visible above iOS home indicator and Android gesture bar */
    padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(12px);
    flex-shrink: 0;
  }

  :global(.dark) .input-container {
    border-top-color: rgba(255, 255, 255, 0.1);
    background: rgba(3, 7, 18, 0.8);
  }

  .input-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 48rem;
    margin: 0 auto;
  }

  .input-row {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
  }

  .chat-input {
    flex: 1;
    padding: 0.75rem 1rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.75rem;
    font-size: 0.9375rem;
    font-family: inherit;
    resize: none;
    max-height: 200px;
    background: white;
    color: rgb(17 24 39);
  }

  :global(.dark) .chat-input {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgb(17 24 39);
    color: rgb(243 244 246);
  }

  .chat-input:focus {
    outline: none;
    border-color: rgb(124 58 237);
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
  }

  :global(.dark) .chat-input:focus {
    border-color: rgb(167 139 250);
    box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.1);
  }

  .chat-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .input-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .send-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.75rem;
    border: none;
    border-radius: 0.75rem;
    background: rgb(124 58 237);
    color: white;
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(.dark) .send-btn {
    background: rgb(167 139 250);
    color: rgb(17 24 39);
  }

  .send-btn:hover:not(:disabled) {
    background: rgb(109 40 217);
    transform: translateY(-1px);
  }

  :global(.dark) .send-btn:hover:not(:disabled) {
    background: rgb(196 181 253);
  }

  .send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Mobile-only operator icon button (hidden on desktop) */
  .operator-icon-btn {
    display: none;
    align-items: center;
    justify-content: center;
    padding: 0.55rem 0.6rem;
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 0.75rem;
    background: white;
    color: rgb(17 24 39);
  }
  :global(.dark) .operator-icon-btn { background: rgb(17 24 39); color: rgb(243 244 246); border-color: rgba(255,255,255,0.1); }
  .operator-icon-btn.active { border-color: rgb(167 139 250); box-shadow: 0 0 0 3px rgba(167,139,250,0.25); }
  :global(.dark) .operator-icon-btn.active { border-color: rgb(167, 139, 250); box-shadow: 0 0 0 3px rgba(167,139,250,0.35); background: rgba(167,139,250,0.15); }
  .operator-icon-btn.yolo { border-color: rgba(234,179,8,0.4); color: rgb(202 138 4); background: rgba(253, 230, 138, 0.2); }
  :global(.dark) .operator-icon-btn.yolo { border-color: rgba(253,224,71,0.35); background: rgba(146, 64, 14, 0.28); color: rgb(253 224 71); }
  .operator-icon-btn.yolo.active { border-color: rgb(234,179,8); box-shadow: 0 0 0 3px rgba(234,179,8,0.32); background: rgba(253, 224, 71, 0.3); }
  :global(.dark) .operator-icon-btn.yolo.active { border-color: rgb(250,204,21); box-shadow: 0 0 0 3px rgba(250,204,21,0.36); background: rgba(214, 158, 46, 0.4); }

  .mic-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.55rem 0.6rem;
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 0.75rem;
    background: white;
    color: rgb(17 24 39);
    cursor: pointer;
  }
  :global(.dark) .mic-btn { background: rgb(17 24 39); color: rgb(243 244 246); border-color: rgba(255,255,255,0.1); }
  .mic-btn[disabled] { opacity: 0.6; cursor: not-allowed; }
  .mic-btn.recording {
    border-color: rgb(167 139 250);
    box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.2);
    position: relative;
  }
  .mic-btn.recording::after {
    content: '';
    position: absolute;
    inset: -6px;
    border: 2px solid rgba(167, 139, 250, 0.8);
    border-radius: 0.75rem;
    animation: pulseMic 1.2s infinite ease-out;
    pointer-events: none;
  }
  @keyframes pulseMic {
    0% { transform: scale(0.9); opacity: 0.6 }
    80% { transform: scale(1.15); opacity: 0 }
    100% { transform: scale(1.2); opacity: 0 }
  }

  /* Scrollbar */
  .messages-container::-webkit-scrollbar {
    width: 8px;
  }

  .messages-container::-webkit-scrollbar-track {
    background: transparent;
  }

  .messages-container::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
  }

  :global(.dark) .messages-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }

  .messages-container::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.3);
  }

  :global(.dark) .messages-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  /* Responsive (mobile) adjustments */
  @media (max-width: 767px) {
    /* Hide verbose controls on mobile */
    .small-toggle,
    .mic-btn { display: none; }

    .input-row { flex-direction: column; align-items: stretch; gap: 0.5rem; }
    .input-actions { justify-content: space-between; }

    /* Show compact operator icon */
    .operator-icon-btn { display: inline-flex; }

    /* Tighten spacing to give input more room */
    .input-wrapper { gap: 0.5rem; }
    .chat-input { font-size: 0.95rem; padding: 0.65rem 0.8rem; }
  }
</style>
