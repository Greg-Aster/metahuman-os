<script lang="ts">
  import { onMount, afterUpdate, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import Thinking from './Thinking.svelte';
  import InputArea from './chat/InputArea.svelte';
  import MessageList from './chat/MessageList.svelte';
  import ApprovalPrompt from './ApprovalPrompt.svelte';
  import { canUseOperator, currentMode } from '../stores/security-policy';
  import { triggerClearAuditStream } from '../stores/clear-events';
  import { yoloModeStore } from '../stores/navigation';
  import { calculateVoiceVolume } from '../lib/client/utils/audio-utils.js';
  import { useTTS } from '../lib/client/composables/useTTS';
  import { useMicrophone } from '../lib/client/composables/useMicrophone';
  import { useThinkingTrace } from '../lib/client/composables/useThinkingTrace';
  import { useMessages, useActivityTracking, useOllamaStatus, type ChatMessage, type MessageRole, type ReasoningStage } from '../lib/client/composables/useMessages';
  // Offline support
  import { healthStatus, isConnected, forceHealthCheck } from '../lib/client/server-health';
  import { getDisplayMessages, appendToBuffer, clearBuffer, type BufferMode, type BufferMessage } from '../lib/client/local-memory';
  import { unifiedChat, type ChatResponse } from '../lib/client/unified-chat';
  import { apiEventSource, apiFetch, isMobileApp } from '../lib/client/api-config';

  // Component state
  let input = '';
  let loading = false;
  let reasoningStages: ReasoningStage[] = [];
  let reasoningDepth: number = 0;
  const reasoningLabels = ['Off', 'Quick', 'Focused', 'Deep'];
  const clampReasoningDepth = (value: number) => Math.max(0, Math.min(reasoningLabels.length - 1, Math.round(value)));
  let bigBrotherEnabled = false;
  let claudeSessionReady = false;
  let claudeSessionChecking = false;
  let chatResponseStream: EventSource | null = null;
  let innerDialogueStream: EventSource | null = null;
  let ttsQueueStream: EventSource | null = null; // TTS queue from node editor
  let lastInnerMessageCount = 0; // Track previous message count for inner dialogue TTS detection
  let lastConversationMessageCount = 0; // Track previous message count for conversation TTS detection
  let mode: 'conversation' | 'inner' = 'conversation';
  let lengthMode: 'auto' | 'concise' | 'detailed' = 'auto';
  let messagesContainer: HTMLDivElement;
  let shouldAutoScroll = true;
  // Buffer stream (innerDialogueStream) provides real-time updates via fs.watch SSE
  let visibilityCleanup: (() => void) | null = null;
  // Convenience toggles
  let ttsEnabled = false;
  let boredomTtsEnabled = false; // For inner dialog voice
  // vLLM Thinking Mode (Qwen3)
  let thinkingModeEnabled = false;
  let thinkingModeLoading = false;
  // Curiosity questions
  let curiosityQuestions: any[] = [];
  let lastQuestionCheck = 0;
  let yoloMode = false;
  // Active Operator toggle
  let activeOperatorEnabled = false;
  let activeOperatorLoading = false;
  // Synchronous guard to prevent double/triple submit race condition
  let sendInProgress = false;

  // Initialize TTS composable
  const ttsApi = useTTS();
  const { isPlaying: ttsIsPlaying, isLoading: ttsIsLoading } = ttsApi;

  // Initialize Messages composable
  const messagesApi = useMessages({
    getMode: () => mode,
    onMessagesChange: (msgs) => {
      // This handles any side effects when messages change
      // (currently none needed, but useful for future extensions)
    }
  });
  const {
    messages,
    selectedMessage,
    selectedMessageIndex,
    conversationSessionId
  } = messagesApi;

  // Initialize Activity Tracking
  const activityApi = useActivityTracking();

  // Initialize LLM Backend Status (supports both Ollama and vLLM)
  const backendApi = useOllamaStatus();
  const {
    running: backendRunning,
    hasModels: backendHasModels,
    modelCount: backendModelCount,
    error: backendError,
    activeBackend
  } = backendApi;

  // Initialize Microphone composable
  const mic = useMicrophone({
    getTTSPlaying: () => get(ttsIsPlaying),
    onTranscript: (transcript: string) => {
      // Auto-send in continuous mode (desktop) or conversation mode (mobile)
      const autoSend = get(mic.isContinuousMode) || get(mic.isConversationMode);

      if (autoSend) {
        // If LLM is busy (thinking or responding), queue the message
        if (loading) {
          console.log('[chat-queue] LLM busy, queueing message:', transcript.substring(0, 50) + (transcript.length > 50 ? '...' : ''));
          mic.queuedMessage.set(transcript); // Will auto-send when loading becomes false
        } else {
          // LLM idle, send immediately
          console.log('[chat-mic] Transcribed & sending:', transcript.substring(0, 50) + (transcript.length > 50 ? '...' : ''));
          input = transcript;
          void sendMessage();
        }
      } else {
        // Single input mode: put transcript in input field for user to review/edit
        // APPEND to existing input if there's already text (allows multiple voice inputs)
        console.log('[chat-mic] Transcribed:', transcript.substring(0, 50) + (transcript.length > 50 ? '...' : ''));
        if (input.trim()) {
          // Append with a space separator
          input = input.trim() + ' ' + transcript;
          console.log('[chat-mic] Appended to existing input, total length:', input.length);
        } else {
          input = transcript;
        }
        // Do NOT auto-send - let user review and edit before manually sending
      }
    },
    onSystemMessage: (message: string) => {
      // Show friendly message to user (add to messages as system message)
      messagesApi.pushMessage('system', message);
    },
    isComponentMounted: () => isComponentMounted,
  });
  const {
    isRecording: micIsRecording,
    isContinuousMode: micIsContinuousMode,
    queuedMessage: micQueuedMessage,
    interimTranscript: micInterimTranscript,
    isNativeMode: micIsNativeMode,
    isWakeWordListening: micIsWakeWordListening,
    isConversationMode: micIsConversationMode,
  } = mic;

  // Initialize Thinking Trace composable
  const thinkingTraceApi = useThinkingTrace({
    getCurrentMode: () => $currentMode || 'dual',
    getReasoningDepth: () => reasoningDepth,
    getConversationSessionId: () => $conversationSessionId,
    getReasoningStagesCount: () => reasoningStages.length,
  });
  const {
    trace: thinkingTrace,
    statusLabel: thinkingStatusLabel,
    active: thinkingActive,
    steps: thinkingSteps,
    showIndicator: showThinkingIndicator
  } = thinkingTraceApi;

  // Debug logging for thinking indicator
  $: console.log('[ThinkingIndicator] showIndicator:', $showThinkingIndicator, 'active:', $thinkingActive, 'trace.length:', $thinkingTrace.length, 'reasoningStages.length:', reasoningStages.length, 'steps:', $thinkingSteps.substring(0, 100));

  // Subscribe to shared YOLO mode store
  const unsubscribeYolo = yoloModeStore.subscribe(value => {
    yoloMode = value;
  });


  // Intersection observer for auto-scroll detection
  let scrollSentinel: HTMLDivElement;
  let scrollObserver: IntersectionObserver | null = null;

  // Component lifecycle flag for cleanup
  let isComponentMounted = true;


  function loadChatPrefs() {
    try {
      const raw = localStorage.getItem('chatPrefs');
      if (!raw) {
        console.log('[chat-prefs] No chatPrefs in localStorage, using defaults');
        ttsEnabled = false;
        return;
      }
      const p = JSON.parse(raw);
      if (typeof p.ttsEnabled === 'boolean') ttsEnabled = p.ttsEnabled;
      if (typeof p.reasoningDepth === 'number') {
        reasoningDepth = clampReasoningDepth(p.reasoningDepth);
      } else if (typeof p.reasoningEnabled === 'boolean') {
        reasoningDepth = p.reasoningEnabled ? 2 : 0;
      }
      if (typeof p.boredomTtsEnabled === 'boolean') boredomTtsEnabled = p.boredomTtsEnabled;
      if (typeof p.bigBrotherEnabled === 'boolean') bigBrotherEnabled = p.bigBrotherEnabled;
      console.log('[chat-prefs] Loaded:', { ttsEnabled, boredomTtsEnabled, reasoningDepth });
    } catch (e) {
      console.error('[chat-prefs] Error loading:', e);
    }
  }
  function saveChatPrefs() {
    try {
      const prefs = {
        ttsEnabled,
        reasoningDepth,
        reasoningEnabled: reasoningDepth > 0,
        bigBrotherEnabled,
        boredomTtsEnabled,
      };
      localStorage.setItem('chatPrefs', JSON.stringify(prefs));
    } catch {}
  }

  /** Get current inner dialogue TTS preference (reads from localStorage to ensure fresh value) */
  function getInnerTtsEnabled(): boolean {
    try {
      const raw = localStorage.getItem('chatPrefs');
      if (raw) {
        const p = JSON.parse(raw);
        return p.boredomTtsEnabled === true;
      }
    } catch {}
    return boredomTtsEnabled;
  }

  // persistToInnerBuffer removed - agents now write directly to buffer via appendReflectionToBuffer/appendDreamToBuffer

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

  // vLLM Thinking Mode toggle
  async function loadThinkingMode() {
    try {
      const res = await apiFetch('/api/llm-backend/status');
      if (res.ok) {
        const data = await res.json();
        // Only relevant when vLLM is active
        if (data.config?.vllm?.enableThinking !== undefined) {
          thinkingModeEnabled = data.config.vllm.enableThinking;
        }
      }
    } catch (error) {
      console.error('[thinking-mode] Failed to load status:', error);
    }
  }

  async function toggleThinkingMode() {
    if (thinkingModeLoading) return;
    thinkingModeLoading = true;

    try {
      const newValue = !thinkingModeEnabled;
      const res = await apiFetch('/api/llm-backend/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vllm: { enableThinking: newValue }
        }),
      });

      if (res.ok) {
        thinkingModeEnabled = newValue;
        console.log(`[thinking-mode] ${newValue ? 'Enabled' : 'Disabled'} - model will ${newValue ? 'show <think> tags' : 'respond directly'}`);
      } else {
        console.error('[thinking-mode] Failed to update config');
      }
    } catch (error) {
      console.error('[thinking-mode] Error toggling:', error);
    } finally {
      thinkingModeLoading = false;
    }
  }

  // Server-first conversation buffer management


  onMount(async () => {
    loadChatPrefs();
    loadThinkingMode(); // Load vLLM thinking mode setting
    loadActiveOperatorStatus(); // Load active operator status
    mic.loadVADSettings(); // Load VAD settings from voice config

    // Enable hardware button capture only if user opted in via Voice Settings
    // This creates a background audio session for earbud/headphone button support
    const hardwareButtonsEnabled = localStorage.getItem('mh-hardware-buttons') === 'true';
    if (hardwareButtonsEnabled) {
      console.log('[chat] Hardware button capture enabled by user preference');
      mic.setupMediaSession();
    }

    if (ttsEnabled) {
      ttsApi.prefetchVoiceResources();
    }

    // Load Big Brother configuration from server
    try {
      const res = await apiFetch('/api/big-brother-config');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.config) {
          bigBrotherEnabled = data.config.enabled ?? false;
          saveChatPrefs(); // Save to local storage

          // If Big Brother is enabled, check/start Claude session
          if (bigBrotherEnabled) {
            const status = await checkClaudeSessionStatus();
            if (!status?.ready && status?.installed) {
              await startClaudeSession();
            } else if (status?.ready) {
              claudeSessionReady = true;
            }
          }
        }
      }
    } catch (error) {
      console.error('[big-brother] Failed to load config:', error);
    }

    // Poll Claude session status every 10 seconds when BB is enabled
    const claudeStatusInterval = setInterval(async () => {
      if (bigBrotherEnabled) {
        await checkClaudeSessionStatus();
      }
    }, 10000);

    // Check LLM backend health status
    backendApi.checkStatus();

    // Initialize or restore conversation session ID
    try {
      const storedSessionId = localStorage.getItem('mh_conversation_session_id');
      if (storedSessionId) {
        conversationSessionId.set(storedSessionId);
      } else {
        const newId = messagesApi.generateSessionId();
        localStorage.setItem('mh_conversation_session_id', newId);
      }
    } catch (e) {
      // Fallback if localStorage unavailable
      messagesApi.generateSessionId();
    }

    // Connect to buffer stream - this loads initial history AND provides real-time updates
    // Uses fs.watch on server, no polling needed
    connectBufferStream(mode);
    console.log(`[ChatInterface] Connected to ${mode} buffer stream`);

    // Connect to TTS queue stream - watches for TTS items from cognitive graph nodes
    connectTTSQueueStream();

    scrollObserver = new IntersectionObserver(
      (entries) => {
        shouldAutoScroll = entries[0].isIntersecting;
      },
      { threshold: 0.1 }
    );

    if (scrollSentinel) {
      scrollObserver.observe(scrollSentinel);
    }

    // Reconnect buffer stream when tab becomes visible (in case connection dropped)
    const handleVisibilityChange = () => {
      if (!document.hidden && (!innerDialogueStream || innerDialogueStream.readyState === EventSource.CLOSED)) {
        console.log('[chat] Tab visible, reconnecting buffer stream');
        connectBufferStream(mode);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Store cleanup function for onDestroy
    visibilityCleanup = () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };

    // Curiosity questions and agent notifications now come through normal conversation flow
    // They're saved as conversation events by agents and loaded via /api/chat/history

    // Listen for voice settings changes (triggered when user updates VAD settings in UI)
    window.addEventListener('voice-settings-updated', handleVoiceSettingsUpdate);
  });

  // Event handler stored at module level for proper cleanup
  function handleVoiceSettingsUpdate() {
    console.log('[chat-mic] Voice settings updated, reloading...');
    mic.loadVADSettings();
  }

  /**
   * Fetch buffer content directly (for initial load and tab switches)
   * Always tries server first, falls back to local IndexedDB on error.
   * This avoids race conditions where isConnected is false on page reload
   * before the health check has run.
   */
  async function fetchBuffer(streamMode: 'conversation' | 'inner') {
    // Always try server first - don't rely on isConnected which may not be accurate yet
    try {
      console.log(`[chat] Fetching ${streamMode} buffer from server...`);
      const response = await apiFetch(`/api/buffer?mode=${streamMode}`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.messages)) {
          console.log(`[chat] Loaded ${data.messages.length} messages from ${streamMode} buffer`);
          messages.set(data.messages);
          return;
        }
      }
      // Non-OK response - fall through to local fallback
      console.warn('[chat] Buffer fetch returned non-OK status:', response.status);
    } catch (err) {
      console.warn('[chat] Server buffer fetch failed, trying local storage:', err);
    }

    // Fallback to local IndexedDB
    try {
      console.log(`[chat] Fetching ${streamMode} from local storage...`);
      const localMessages = await getDisplayMessages(streamMode as BufferMode);
      console.log(`[chat] Loaded ${localMessages.length} messages from local storage`);
      // Convert BufferMessage to ChatMessage format
      const chatMessages = localMessages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        meta: m.meta,
      }));
      messages.set(chatMessages);
    } catch (err) {
      console.error('[chat] Local buffer fetch also failed:', err);
      messages.set([]);
    }
  }

  /**
   * Connect to buffer SSE stream for real-time updates
   * Uses fs.watch on server - no polling needed, instant updates
   * Always attempts connection - SSE has its own error handling
   */
  function connectBufferStream(streamMode: 'conversation' | 'inner') {
    // First, fetch buffer directly for immediate display
    fetchBuffer(streamMode);

    // Close existing stream if any
    if (innerDialogueStream) {
      innerDialogueStream.close();
    }

    // Always try to connect SSE - don't rely on isConnected which may not be accurate yet
    // The SSE onerror handler will deal with connection failures gracefully
    console.log(`[chat] Connecting to ${streamMode} buffer stream...`);
    innerDialogueStream = apiEventSource(`/api/buffer-stream?mode=${streamMode}`);

    innerDialogueStream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[chat] Buffer stream message type: ${data.type}`);
        if (data.type === 'error') {
          console.error('[chat] Buffer stream auth error:', data.error);
          messagesApi.pushMessage('system', `⚠️ ${data.error}`);
          return;
        }
        if (data.type === 'connected') {
          console.log(`[chat] Buffer stream connected, watching: ${data.bufferPath}`);
          // Reset message count to current messages to avoid TTS on reconnect
          const currentCount = get(messages).length;
          if (streamMode === 'inner') {
            lastInnerMessageCount = currentCount;
            console.log(`[chat-tts] Reset inner message count to ${lastInnerMessageCount} on connect`);
          } else {
            lastConversationMessageCount = currentCount;
            console.log(`[chat-tts] Reset conversation message count to ${lastConversationMessageCount} on connect`);
          }
          return;
        }
        if (data.type === 'update' && Array.isArray(data.messages)) {
          // SIMPLE TTS LOGIC (same approach as conversation TTS):
          // 1. Get previous count
          // 2. If we have new messages and TTS enabled, speak the last new one
          // 3. Update count
          // 4. Update messages store

          const prevCount = streamMode === 'inner' ? lastInnerMessageCount : lastConversationMessageCount;
          const newCount = data.messages.length;
          const hasNewMessages = newCount > prevCount && prevCount > 0; // prevCount > 0 means we've seen first load

          console.log(`[chat-tts] Buffer update: mode=${streamMode}, prev=${prevCount}, new=${newCount}, hasNew=${hasNewMessages}`);

          // LEGACY TTS REMOVED - TTS now handled via unified TTS queue stream from cognitive graph nodes
          // Inner dialogue (dreams/reflections) and conversation (curiosity) TTS now go through TTS nodes

          // Update counts for next comparison
          if (streamMode === 'inner') {
            lastInnerMessageCount = newCount;
          } else {
            lastConversationMessageCount = newCount;
          }

          // Update messages store
          messages.set(data.messages);
        }
      } catch (err) {
        console.error('[chat] Buffer stream parse error:', err);
      }
    };

    innerDialogueStream.onerror = (err) => {
      console.error('[chat] Buffer stream error - connection may have been reset:', err);
      // Check if we're now offline
      const stillConnected = get(isConnected);
      if (!stillConnected) {
        console.log('[chat] Now offline, switching to local storage mode');
        fetchBuffer(streamMode);
        return;
      }
      // Attempt reconnection after a delay
      setTimeout(() => {
        console.log('[chat] Attempting buffer stream reconnection...');
        connectBufferStream(streamMode);
      }, 3000);
    };
  }

  function disconnectBufferStream() {
    if (innerDialogueStream) {
      console.log('[chat] Disconnecting buffer stream');
      innerDialogueStream.close();
      innerDialogueStream = null;
    }
  }

  /**
   * Connect to TTS queue stream
   * Watches for TTS items queued by cognitive graph nodes
   * Speaks them if the appropriate toggle is enabled
   */
  function connectTTSQueueStream() {
    if (ttsQueueStream) {
      ttsQueueStream.close();
    }

    console.log('[chat-tts] Connecting to TTS queue stream...');
    ttsQueueStream = apiEventSource('/api/tts-queue-stream');

    ttsQueueStream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          console.log('[chat-tts] TTS queue stream connected');
          return;
        }

        if (data.type === 'error') {
          console.error('[chat-tts] TTS queue stream error:', data.error);
          return;
        }

        if (data.type === 'tts' && Array.isArray(data.items)) {
          // Process queued TTS items
          for (const item of data.items) {
            console.log(`[chat-tts] TTS queue item: mode=${item.mode}, source=${item.source}, text=${item.text?.substring(0, 50)}`);

            // Check if we should speak based on mode and toggles
            // Use getter to ensure we read the latest preference value
            const innerTtsOn = getInnerTtsEnabled();
            if (item.mode === 'conversation' && ttsEnabled) {
              console.log('[chat-tts] SPEAKING conversation TTS from queue');
              void ttsApi.speak(item.text);
            } else if (item.mode === 'inner' && innerTtsOn) {
              console.log('[chat-tts] SPEAKING inner dialogue TTS from queue');
              void ttsApi.speak(item.text);
            } else {
              console.log(`[chat-tts] Skipping TTS (mode=${item.mode}, ttsEnabled=${ttsEnabled}, innerTtsEnabled=${innerTtsOn})`);
            }
          }
        }
      } catch (err) {
        console.error('[chat-tts] TTS queue stream parse error:', err);
      }
    };

    ttsQueueStream.onerror = (err) => {
      console.error('[chat-tts] TTS queue stream error:', err);
      // Attempt reconnection after a delay
      setTimeout(() => {
        if (isComponentMounted) {
          console.log('[chat-tts] Attempting TTS queue stream reconnection...');
          connectTTSQueueStream();
        }
      }, 5000);
    };
  }

  function disconnectTTSQueueStream() {
    if (ttsQueueStream) {
      console.log('[chat-tts] Disconnecting TTS queue stream');
      ttsQueueStream.close();
      ttsQueueStream = null;
    }
  }

  onDestroy(() => {
    // Mark component as unmounted to stop animation loops
    isComponentMounted = false;

    // Clean up event listeners and streams
    visibilityCleanup?.();
    chatResponseStream?.close();
    disconnectBufferStream();
    disconnectTTSQueueStream();
    activityApi.clearActivity();
    ttsApi.cleanup();
    thinkingTraceApi.cleanup();
    unsubscribeYolo();

    // Clean up IntersectionObserver (moved from async onMount which doesn't work for cleanup)
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }

    // Clean up voice settings event listener
    if (typeof window !== 'undefined') {
      window.removeEventListener('voice-settings-updated', handleVoiceSettingsUpdate);
    }

    // Clean up mic resources
    mic.disableMediaSession();
    mic.cleanup();
  });

  afterUpdate(() => {
    if (shouldAutoScroll && messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  });

  /**
   * Send message in offline mode using UnifiedChat with tier selection
   * Routes to: offline LLM → server → cloud based on availability
   */
  async function sendMessageOffline() {
    const userMessage = input.trim();
    if (!userMessage) return;

    input = '';
    messagesApi.clearSelection();

    // Add user message to UI and local buffer
    messagesApi.pushMessage('user', userMessage);
    await appendToBuffer(mode as BufferMode, { role: 'user', content: userMessage });

    loading = true;
    thinkingTraceApi.start();
    thinkingTraceApi.setStatusLabel('🔄 Selecting best tier...');

    try {
      console.log('[sendMessage-offline] Using UnifiedChat for offline/tiered routing');

      // Use unified chat which handles tier selection and fallbacks
      const result: ChatResponse = await unifiedChat.sendMessage(userMessage);

      console.log(`[sendMessage-offline] Response from tier: ${result.tier} (${result.model})`);

      // Add assistant response to UI and local buffer
      messagesApi.pushMessage('assistant', result.response, undefined, {
        tier: result.tier,
        model: result.model,
        latencyMs: result.latencyMs,
      });
      await appendToBuffer(mode as BufferMode, {
        role: 'assistant',
        content: result.response,
        meta: { tier: result.tier, model: result.model },
      });

      // LEGACY TTS REMOVED - TTS handled via unified TTS queue stream from cognitive graph nodes
      // Note: Offline mode may need TTS node integration in the future if offline graphs are added

      thinkingTraceApi.stop();
    } catch (err) {
      console.error('[sendMessage-offline] Error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to get response';
      messagesApi.pushMessage('system', `⚠️ ${errorMsg}`);
      thinkingTraceApi.stop();
    } finally {
      loading = false;
    }
  }

  async function sendMessage() {
    // Synchronous guard: prevent race condition where multiple clicks
    // get past the loading check before loading is set to true
    if (!input.trim() || loading || sendInProgress) return;
    sendInProgress = true;

    let connected = get(isConnected);

    // On mobile or if connection status is uncertain, do a quick health check
    if (isMobileApp() || !connected) {
      const healthResult = await forceHealthCheck();
      connected = healthResult.connected;
    }

    // If offline, use UnifiedChat with tier selection
    if (!connected) {
      sendInProgress = false; // Reset guard before delegating
      await sendMessageOffline();
      return;
    }

    // Check LLM backend status before sending (only when online)
    if (!backendApi.isReady()) {
      sendInProgress = false; // Reset guard on early return
      const backend = get(activeBackend);
      const msg = backend === 'vllm'
        ? 'Cannot send message: vLLM server is not running. Please start vLLM from Settings → Backend.'
        : 'Cannot send message: Ollama is not running or no models are loaded. Please start Ollama and load a model first.';
      alert(msg);
      return;
    }

    await ttsApi.ensureAudioUnlocked();
    if (ttsEnabled) {
      ttsApi.prefetchVoiceResources();
    }

    // Signal activity when sending a message
    activityApi.signalActivity();

    const userMessage = input.trim();
    input = '';

    // Capture replyTo metadata if any message is selected
    const replyToMetadata = messagesApi.getReplyToMetadata();
    const replyToQuestionId = replyToMetadata.questionId;
    const replyToContent = replyToMetadata.content;

    // Clear selection after capturing metadata
    const wasReplying = $selectedMessage !== null;
    messagesApi.clearSelection();

    messagesApi.pushMessage('user', userMessage);

    loading = true;
    sendInProgress = false; // loading now takes over as the guard
    reasoningStages = [];
    thinkingTraceApi.start();
    console.log('[sendMessage] Step 1: Set loading state');

    try {
      console.log('[sendMessage] Step 2: Entered try block');
      let llm_opts = {};
      try {
        const raw = localStorage.getItem('llmOptions');
        if (raw) llm_opts = JSON.parse(raw);
      } catch {}
      console.log('[sendMessage] Step 3: Got llm_opts');

      const params = new URLSearchParams({
        message: userMessage,
        mode,
        length: lengthMode,
        reason: String(reasoningDepth > 0),
        reasoningDepth: String(reasoningDepth),
        llm: JSON.stringify(llm_opts),
        sessionId: $conversationSessionId,
        // forceOperator removed - no longer used
      });
      console.log('[sendMessage] Step 4: Created URLSearchParams');
      params.set('yolo', String(yoloMode));
      // audience removed - focus selector obsolete with ReAct operator

      // Add replyTo metadata if replying to any message (curiosity or regular)
      if (replyToQuestionId) {
        params.set('replyToQuestionId', replyToQuestionId);
        console.log('[reply-to] Replying to curiosity question:', replyToQuestionId);
      }
      if (replyToContent) {
        // Truncate to 500 chars to avoid URL length issues
        params.set('replyToContent', replyToContent.substring(0, 500));
        console.log('[reply-to] Replying to message:', replyToContent.substring(0, 100));
      }

      console.log('[sendMessage] Step 5: Setting up chat request');
      console.log('[sendMessage] URL:', `/api/persona_chat?${params.toString()}`);

      // Force graph pipeline; some runtime toggles can disable it after settings load
      params.set('graph', 'true');

      // Use EventSource for SSE streaming (works for both web and React Native WebView)
      // CRITICAL: Close any existing EventSource before creating a new one
      if (chatResponseStream) {
        console.log('[sendMessage] Closing existing EventSource...');
        chatResponseStream.close();
        chatResponseStream = null;
      }

      chatResponseStream = apiEventSource(`/api/persona_chat?${params.toString()}`);
      console.log('[sendMessage] Step 6: EventSource created!');

      chatResponseStream.onmessage = (event) => {
        console.log('[EventSource] onmessage fired, raw event.data:', event.data.substring(0, 200));
        try {
          const { type, data } = JSON.parse(event.data);
          console.log('[EventSource] Parsed type:', type, 'data keys:', Object.keys(data));

          if (type === 'progress') {
            // Real-time progress updates from graph execution
            if (data && data.message) {
              thinkingTraceApi.setActive(true);

              // Update the thinking trace with progress messages
              const progressMsg = data.message;
              console.log('[Progress Event] step:', data.step, 'message:', progressMsg.substring(0, 100));

              if (data.step === 'loading_graph') {
                thinkingTraceApi.setStatusLabel('📋 Loading workflow...');
                thinkingTraceApi.setTrace([progressMsg]);
              } else if (data.step === 'graph_loaded') {
                thinkingTraceApi.setStatusLabel('⚙️ Executing pipeline...');
                thinkingTraceApi.setTrace([progressMsg]);
              } else if (data.step === 'node_executing') {
                thinkingTraceApi.setStatusLabel('🔄 Processing...');
                // Add to trace, keep last 10 items
                thinkingTraceApi.appendTrace(`▸ ${progressMsg}`, 10);
              } else if (data.step === 'thinking') {
                // Show actual AI thoughts from scratchpad
                console.log('[Thinking Event] Appending to trace:', progressMsg.substring(0, 150));
                console.log('[Thinking Event] Current trace length:', thinkingTraceApi.getTrace().length);
                console.log('[Thinking Event] reasoningStages.length:', reasoningStages.length);
                thinkingTraceApi.setStatusLabel('🧠 Thinking...');
                thinkingTraceApi.appendTrace(progressMsg, 10);
                console.log('[Thinking Event] New trace length:', thinkingTraceApi.getTrace().length);
              } else if (data.step === 'node_error') {
                thinkingTraceApi.setStatusLabel('⚠️ Error detected...');
                thinkingTraceApi.appendTrace(`✗ ${progressMsg}`, 10);
              } else if (data.step === 'graph_complete') {
                // Graph execution completed, waiting for final answer
                thinkingTraceApi.setStatusLabel('✓ Completed, finalizing...');
                thinkingTraceApi.appendTrace(progressMsg, 10);
              } else {
                // Generic progress update
                thinkingTraceApi.appendTrace(progressMsg, 10);
              }
            }
          } else if (type === 'cancelled') {
            // Request was cancelled by user
            thinkingTraceApi.stop();
            messagesApi.pushMessage('system', data.message || '⏸️ Request cancelled');
            loading = false;
            reasoningStages = [];
            chatResponseStream?.close();
          } else if (type === 'reasoning') {
            thinkingTraceApi.stop();
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
            thinkingTraceApi.stop();
            if (reasoningStages.length > 0) {
              // Only persist reasoning to messages in inner dialogue mode
              // In conversation mode, reasoning is shown live then disappears
              if (mode === 'inner') {
                reasoningStages.forEach(stage => {
                  const label = `${messagesApi.formatReasoningLabel(stage)} · ${messagesApi.formatTime(stage.timestamp)}`;
                  messagesApi.pushMessage('reasoning', stage.content, undefined, { stage, label });
                });
              }
              reasoningStages = [];
            }
            messagesApi.pushMessage('assistant', data.response, data?.saved?.assistantRelPath, { facet: data.facet });

            // LEGACY TTS REMOVED - TTS now handled via unified TTS queue stream from cognitive graph nodes
            // Conversation responses are queued by TTS nodes in dual-mode, agent-mode, emulation-mode graphs

            loading = false;
            chatResponseStream?.close();
          } else if (type === 'system_message') {
            // System status message (e.g., summarization progress)
            if (data.content) {
              messagesApi.pushMessage('system', data.content);
            }
          } else if (type === 'error') {
            // Display the actual error message from the server
            const errorMessage = data.message || 'Unknown error occurred';
            const suggestion = data.suggestion || '';
            const isGPUError = data.isGPUError || errorMessage.includes('GPU') || errorMessage.includes('memory');

            console.error('[chat] Server error:', errorMessage);

            // Format user-friendly error message
            let displayMessage = `⚠️ ${errorMessage}`;
            if (suggestion) {
              displayMessage += `\n\n💡 ${suggestion}`;
            } else if (isGPUError) {
              displayMessage += '\n\n💡 Try refreshing the page or wait a moment for GPU memory to clear.';
            }

            messagesApi.pushMessage('system', displayMessage);
            thinkingTraceApi.stop();
            loading = false;
            reasoningStages = [];
            chatResponseStream?.close();
            return; // Don't throw, we handled it
          }
        } catch (err) {
          console.error('Chat stream error:', err);
          messagesApi.pushMessage('system', `Error: ${(err as Error).message || 'Failed to process server response.'}`);
          thinkingTraceApi.stop();
          loading = false;
          reasoningStages = [];
          chatResponseStream?.close();
        }
      };

      chatResponseStream.onerror = async (err) => {
        console.error('[EventSource] onerror fired! Error:', err);
        console.error('[EventSource] ReadyState:', chatResponseStream?.readyState);
        chatResponseStream?.close();

        // Force a health check to get accurate connection status
        const healthResult = await forceHealthCheck();

        // If server is offline, fallback to UnifiedChat
        if (!healthResult.connected) {
          console.log('[EventSource] Server confirmed offline, falling back to UnifiedChat');
          // Remove the user message we just added (will be re-added by sendMessageOffline)
          const currentMessages = get(messages);
          if (currentMessages.length > 0 && currentMessages[currentMessages.length - 1].role === 'user') {
            messages.set(currentMessages.slice(0, -1));
          }
          // Restore input and try offline
          input = userMessage;
          thinkingTraceApi.stop();
          loading = false;
          reasoningStages = [];
          await sendMessageOffline();
          return;
        }

        messagesApi.pushMessage('system', 'Error: Connection to the server was lost. Try again or check server status.');
        thinkingTraceApi.stop();
        loading = false;
        reasoningStages = [];
      };

    } catch (err) {
      console.error('Chat setup error:', err);
      messagesApi.pushMessage('system', 'Error: Could not send message.');
      thinkingTraceApi.stop();
      loading = false;
      sendInProgress = false; // Safety net: ensure guard is reset on error
      reasoningStages = [];
    }
  }

  /**
   * Stop/cancel the current request
   */
  async function stopRequest() {
    if (!loading || !$conversationSessionId) return;

    try {
      console.log('[stop-request] Cancelling session:', $conversationSessionId);

      const response = await apiFetch('/api/cancel-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: $conversationSessionId,
          reason: 'User clicked stop button'
        })
      });

      if (!response.ok) {
        console.error('[stop-request] Failed to cancel:', await response.text());
      } else {
        console.log('[stop-request] Cancellation requested successfully');
      }
    } catch (error) {
      console.error('[stop-request] Error cancelling request:', error);
    }
  }

  // Activity tracking for sleep service

  async function handleKeyPress(e: KeyboardEvent) {
    // Signal activity on key press
    activityApi.signalActivity();

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await sendMessage();
    }
  }

  async function handleDelete(relPath: string) {
    const success = await messagesApi.deleteMessage(relPath);
    if (!success) {
      alert('Failed to delete message');
    }
  }

  async function checkClaudeSessionStatus() {
    try {
      const res = await apiFetch('/api/claude-session');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.status) {
          claudeSessionReady = data.status.ready;
          return data.status;
        }
      }
    } catch (error) {
      console.error('[claude-session] Failed to check status:', error);
    }
    return null;
  }

  async function startClaudeSession() {
    if (claudeSessionChecking) return;

    claudeSessionChecking = true;
    try {
      console.log('[claude-session] Starting Claude CLI session...');
      const res = await apiFetch('/api/claude-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      });

      const data = await res.json();
      if (data.success && data.status) {
        claudeSessionReady = data.status.ready;
        console.log('[claude-session] Status:', data.message);

        // Open the Big Brother terminal for visibility
        if (claudeSessionReady) {
          const { openBigBrotherTerminal } = await import('../stores/bigBrotherTerminal');
          openBigBrotherTerminal();
        }
      } else {
        console.error('[claude-session] Failed to start:', data.error);
      }
    } catch (error) {
      console.error('[claude-session] Error starting session:', error);
    } finally {
      claudeSessionChecking = false;
    }
  }

  async function stopClaudeSession() {
    try {
      await apiFetch('/api/claude-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      claudeSessionReady = false;
    } catch (error) {
      console.error('[claude-session] Error stopping session:', error);
    }
  }

  async function toggleBigBrother() {
    const wasEnabled = bigBrotherEnabled;
    bigBrotherEnabled = !bigBrotherEnabled;
    saveChatPrefs();

    // Update server configuration
    try {
      const res = await apiFetch('/api/big-brother-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: bigBrotherEnabled,
          provider: 'claude-code', // Default provider
          escalateOnStuck: true,
          escalateOnRepeatedFailures: true,
          maxRetries: 1,
          includeFullScratchpad: true,
          autoApplySuggestions: false
        })
      });

      if (!res.ok) {
        const data = await res.json();
        console.error('[big-brother] Failed to update config:', data.error);
        // Revert on failure
        bigBrotherEnabled = wasEnabled;
        saveChatPrefs();
        return;
      }

      // Start or stop Claude session based on BB mode
      if (bigBrotherEnabled) {
        await startClaudeSession();
      } else {
        await stopClaudeSession();
      }
    } catch (error) {
      console.error('[big-brother] Error updating config:', error);
      // Revert on failure
      bigBrotherEnabled = wasEnabled;
      saveChatPrefs();
    }
  }

  async function toggleActiveOperator() {
    if (activeOperatorLoading) return;

    activeOperatorLoading = true;
    const wasEnabled = activeOperatorEnabled;

    try {
      const res = await apiFetch('/api/active-operator/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle' }),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error('[active-operator] Failed to toggle:', data.error);
        return;
      }

      const data = await res.json();
      activeOperatorEnabled = data.mode === 'active';
      console.log('[active-operator] Toggled to:', data.mode);
    } catch (error) {
      console.error('[active-operator] Error toggling:', error);
    } finally {
      activeOperatorLoading = false;
    }
  }

  async function loadActiveOperatorStatus() {
    try {
      const res = await apiFetch('/api/active-operator/status');
      if (res.ok) {
        const status = await res.json();
        // Use isRunning for actual live state, not config.enabled
        activeOperatorEnabled = status.isRunning ?? false;
      }
    } catch (error) {
      console.error('[active-operator] Failed to load status:', error);
    }
  }

  async function handleValidate(relPath: string, status: 'correct' | 'incorrect') {
    try {
      const res = await apiFetch('/api/memories/validate', {
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
    messagesApi.clearMessages();
    reasoningStages = [];
    thinkingTraceApi.stop();

    // Generate new conversation session ID
    try {
      const newId = messagesApi.generateSessionId();
      localStorage.setItem('mh_conversation_session_id', newId);
    } catch (e) {
      messagesApi.generateSessionId();
    }

    // Clear the audit stream display in the right sidebar
    triggerClearAuditStream();

    // Clear audit log files from disk for privacy
    try {
      const response = await apiFetch('/api/audit/clear', {
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

    // CRITICAL: Clear server-side conversation buffer
    const serverCleared = await messagesApi.clearServerBuffer();
    if (serverCleared) {
      console.log('[ChatInterface] Server buffer cleared successfully');
    } else {
      console.warn('[ChatInterface] Failed to clear server buffer');
    }
  }

  function checkBackendStatus() {
    backendApi.checkStatus();
  }

  // Watch for LLM completion and auto-send queued messages
  $: if (!loading && $micQueuedMessage.trim()) {
    console.log('[chat-queue] LLM finished, sending queued message:', $micQueuedMessage.substring(0, 50) + ($micQueuedMessage.length > 50 ? '...' : ''));
    const msg = $micQueuedMessage;
    micQueuedMessage.set(''); // Clear queue before sending
    input = msg;
    void sendMessage();
  }

</script>

<div class="chat-interface">
  <!-- Header with all controls -->
  <div class="mode-toggle-container sm:gap-3">
    <!-- Mode Toggle Buttons -->
    <div class="mode-toggle">
      <button
        class={mode === 'conversation' ? 'mode-btn active' : 'mode-btn'}
        on:click={() => { mode = 'conversation'; connectBufferStream('conversation'); }}
        aria-label="Conversation mode"
      >
        <span class="mode-icon" aria-hidden="true">💬</span>
        <span class="mode-label">Conversation</span>
      </button>
      <button
        class={mode === 'inner' ? 'mode-btn active' : 'mode-btn'}
        on:click={() => { mode = 'inner'; connectBufferStream('inner'); }}
        aria-label="Inner dialogue mode"
      >
        <span class="mode-icon" aria-hidden="true">💭</span>
        <span class="mode-label">Inner Dialogue</span>
      </button>
    </div>

    <!-- Length Toggle -->
    <div class="length-toggle">
      <label class="control-label" for="length-select">
        <span class="control-icon" aria-hidden="true">📏</span>
      </label>
      <select id="length-select" bind:value={lengthMode} aria-label="Response length">
        <option value="auto">Auto</option>
        <option value="concise">Concise</option>
        <option value="detailed">Detailed</option>
      </select>
    </div>

    <!-- Thinking Mode Toggle (vLLM/Qwen3) -->
    <button
      class="thinking-toggle {thinkingModeEnabled ? 'active' : ''}"
      class:loading={thinkingModeLoading}
      title={thinkingModeEnabled
        ? 'Thinking ON - Model reasons before answering (click to disable)'
        : 'Thinking OFF - Direct responses (click to enable reasoning)'}
      on:click={toggleThinkingMode}
      disabled={thinkingModeLoading}
    >
      <span class="thinking-icon">🧠</span>
      {#if thinkingModeEnabled}
        <span class="thinking-badge">On</span>
      {/if}
    </button>

    <!-- Big Brother Mode Toggle -->
    <button
      class="big-brother-toggle {bigBrotherEnabled ? 'active' : ''} {claudeSessionReady ? 'ready' : ''}"
      title={bigBrotherEnabled
        ? claudeSessionReady
          ? 'Big Brother active - Claude CLI ready ✓'
          : claudeSessionChecking
            ? 'Big Brother active - Starting Claude CLI...'
            : 'Big Brother active - Claude CLI not ready'
        : 'Big Brother mode off - Click to enable CLI escalation'}
      on:click={toggleBigBrother}
    >
      <span class="big-brother-icon">🤖</span>
      {#if bigBrotherEnabled}
        {#if claudeSessionReady}
          <span class="big-brother-badge ready">●</span>
        {:else if claudeSessionChecking}
          <span class="big-brother-badge checking">⋯</span>
        {:else}
          <span class="big-brother-badge">BB</span>
        {/if}
      {/if}
    </button>

    <!-- Active Operator Toggle -->
    <button
      class="active-operator-toggle {activeOperatorEnabled ? 'active' : ''}"
      class:loading={activeOperatorLoading}
      title={activeOperatorEnabled
        ? 'Active Operator ON - Continuous autonomous thinking (click to disable)'
        : 'Active Operator OFF - Click to enable autonomous operation'}
      on:click={toggleActiveOperator}
      disabled={activeOperatorLoading}
    >
      <span class="active-operator-icon">⚡</span>
      {#if activeOperatorEnabled}
        <span class="active-operator-badge">On</span>
      {/if}
    </button>

    <!-- Quick voice/tts controls -->
    <div class="quick-audio">
      <button
        class="icon-btn {ttsEnabled ? 'tts-active' : ''}"
        title={ttsEnabled ? 'Disable speech' : 'Enable speech'}
        on:click={() => {
          ttsEnabled = !ttsEnabled;
          if (ttsEnabled) {
            ttsApi.prefetchVoiceResources();
          }
          saveChatPrefs();
        }}>
        <!-- Speaker icon -->
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 10v4h4l5 5V5L7 10H3zM16.5 12a4.5 4.5 0 00-1.5-3.356V15.356A4.5 4.5 0 0016.5 12z"></path></svg>
      </button>

      <!-- Inner dialog voice toggle (only visible in inner mode) -->
      {#if mode === 'inner'}
        <button
          class="icon-btn {boredomTtsEnabled ? 'active' : ''}"
          title={boredomTtsEnabled ? 'Disable inner dialogue TTS' : 'Enable inner dialogue TTS (lizard brain, reflections, dreams)'}
          on:click={() => {
            boredomTtsEnabled = !boredomTtsEnabled;
            console.log('[chat-tts] Inner dialogue TTS toggled:', boredomTtsEnabled);
            saveChatPrefs();
          }}
        >
          <!-- Thought bubble icon for inner dialog -->
          <span style="font-size: 18px; line-height: 1;">💭</span>
          {#if boredomTtsEnabled}<span class="badge">Inner On</span>{/if}
        </button>
      {/if}
    </div>

    {#if $messages.length > 0}
      <button class="clear-btn" on:click={clearChat} title="Clear chat history">
        <span class="clear-icon" aria-hidden="true">🗑️</span>
        <span class="clear-text">Clear</span>
      </button>
    {/if}
  </div>

  <!-- Messages Area -->

  <!-- LLM Backend Status Warning Banner -->
  {#if !$backendRunning || !$backendHasModels}
    <div class="ollama-warning-banner">
      <div class="warning-icon">⚠️</div>
      <div class="warning-content">
        <div class="warning-title">
          {#if !$backendRunning}
            {$activeBackend === 'vllm' ? 'vLLM Server Not Running' : 'Ollama Service Not Running'}
          {:else}
            No Language Models Loaded
          {/if}
        </div>
        <div class="warning-message">
          {#if !$backendRunning}
            {#if $activeBackend === 'vllm'}
              The vLLM server is not running. Start it from Settings → Backend or use the vLLM control panel.
            {:else}
              The Ollama service is not running. Please start it using: <code>systemctl start ollama</code>
            {/if}
          {:else if $backendModelCount === 0}
            {#if $activeBackend === 'vllm'}
              No model is loaded in vLLM. Configure and start the server from Settings → Backend.
            {:else}
              No models are currently loaded. Please install a model using: <code>ollama pull </code>
            {/if}
          {/if}
          {#if $backendError}
            <div class="warning-error">Error: {$backendError}</div>
          {/if}
        </div>
        <button class="warning-refresh-btn" on:click={checkBackendStatus}>
          Recheck Status
        </button>
      </div>
    </div>
  {/if}

  <div class="messages-container" bind:this={messagesContainer}>
    {#if $messages.length === 0}
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
          <button class="suggestion" on:click={() => { input = "Tell me how you will take over the world?"; sendMessage(); }}>
            Tell me how you will take over the world?
          </button>
          <button class="suggestion" on:click={() => { input = "Wimmy wham wham wozzle!?"; sendMessage(); }}>
            Wimmy wham wham wozzle!?
          </button>
          <button class="suggestion" on:click={() => { input = "Tell me about yourself in the most technical way possible"; sendMessage(); }}>
            Tell me about yourself in the most technical way possible.
          </button>
        </div>
      </div>
    {:else}
      <MessageList
        messages={$messages}
        {mode}
        selectedMessageIndex={$selectedMessageIndex}
        {loading}
        {reasoningStages}
        showThinkingIndicator={$showThinkingIndicator}
        thinkingSteps={$thinkingSteps}
        thinkingStatusLabel={$thinkingStatusLabel}
        on:messageClick={(e) => {
          if ($selectedMessageIndex === e.detail.index) {
            messagesApi.clearSelection();
          } else {
            messagesApi.selectMessage(e.detail.message, e.detail.index);
          }
        }}
        on:deleteMessage={(e) => handleDelete(e.detail.relPath)}
        on:validateMessage={(e) => handleValidate(e.detail.relPath, e.detail.status)}
        on:speakMessage={(e) => {
          if (ttsEnabled) {
            ttsApi.speak(e.detail.content);
          }
        }}
      />
      <div bind:this={scrollSentinel} class="scroll-sentinel"></div>
    {/if}
  </div>
  <!-- Approval Prompt - appears above input when desires need approval -->
  {#if mode === 'conversation'}
    <ApprovalPrompt onApprovalChange={() => {
      console.log('[chat] Approval change detected');
    }} />
  {/if}

  <!-- Input Area -->
  <div class="input-container">
    <InputArea
      bind:input
      {loading}
      selectedMessage={$selectedMessage}
      isRecording={$micIsRecording}
      isContinuousMode={$micIsContinuousMode}
      isWakeWordListening={$micIsWakeWordListening}
      isConversationMode={$micIsConversationMode}
      ttsIsPlaying={$ttsIsPlaying}
      interimTranscript={$micInterimTranscript}
      {lengthMode}
      on:send={sendMessage}
      on:stop={stopRequest}
      on:keypress={(e) => handleKeyPress(e.detail.event)}
      on:micClick={() => {
        // Tap on mic: stop any active listening mode first
        if ($micIsWakeWordListening) {
          console.log('[chat-mic] Stopping wake word detection');
          mic.stopWakeWordDetection();
          return;
        }
        if ($micIsConversationMode) {
          console.log('[chat-mic] Stopping conversation mode');
          mic.toggleConversationMode();
          return;
        }
        if ($micIsContinuousMode) {
          mic.toggleContinuousMode();
          return;
        }
        // Normal single recording
        $micIsRecording ? mic.stopMic() : mic.startMic();
      }}
      on:micLongPress={() => {
        // Long-press: toggle conversation mode on ALL devices
        console.log('[chat-mic] Long press detected, toggling conversation mode');
        mic.toggleConversationMode();
      }}
      on:micContextMenu={() => {
        // Right-click: toggle conversation mode on ALL devices
        console.log('[chat-mic] Right-click detected, toggling conversation mode');
        mic.toggleConversationMode();
      }}
      on:ttsStop={() => {
        ttsApi.stopActiveAudio();
        ttsApi.cancelInFlightTts();
      }}
      on:ttsStopAndListen={() => {
        // Tap-to-interrupt: Stop TTS and start listening (ChatGPT/Google style)
        console.log('[chat-mic] Tap-to-interrupt: stopping TTS and starting to listen');
        ttsApi.stopActiveAudio();
        ttsApi.cancelInFlightTts();
        // If in conversation mode, VAD will auto-restart
        // If not, enter conversation mode
        if (!$micIsConversationMode) {
          mic.toggleConversationMode();
        }
      }}
      on:clearSelection={() => messagesApi.clearSelection()}
      on:lengthModeChange={(e) => { lengthMode = e.detail.mode; }}
    />
  </div>
</div>
