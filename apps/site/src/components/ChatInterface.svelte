<script lang="ts">
  import { onMount, afterUpdate, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import Thinking from './Thinking.svelte';
  import InputArea from './chat/InputArea.svelte';
  import MessageList from './chat/MessageList.svelte';
  import ApprovalPrompt from './ApprovalPrompt.svelte';
  // OperatorProposalPrompt removed - proposals now shown inline in LizardBrainCard
  import TerminalManager from './TerminalManager.svelte';
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
  import { connectProposalsStream, disconnectProposalsStream } from '../stores/proposals';

  // Component state
  let input = '';
  let loading = false;
  let reasoningStages: ReasoningStage[] = [];
  let reasoningDepth: number = 0;
  const reasoningLabels = ['Off', 'Quick', 'Focused', 'Deep'];
  const clampReasoningDepth = (value: number) => Math.max(0, Math.min(reasoningLabels.length - 1, Math.round(value)));
  let bigBrotherEnabled = false;
  let bigBrotherDelegateAll = false;
  let bigBrotherProvider = 'claude-code';
  let bigBrotherReady = false;
  let bigBrotherProviderLabel = 'Claude Code';
  let claudeSessionReady = false;
  let claudeSessionChecking = false;
  let chatResponseStream: EventSource | null = null;
  let innerDialogueStream: EventSource | null = null;
  let ttsQueueStream: EventSource | null = null; // TTS queue from node editor
  let isTabVisible = true;
  let lastInnerMessageCount = 0; // Track previous message count for inner dialogue TTS detection
  let lastConversationMessageCount = 0; // Track previous message count for conversation TTS detection
  // View selection: VS Code-style multi-select
  // All three tabs can be combined for unified feed
  // - Conversation: user/assistant messages from conversation buffer
  // - Inner: reflection/dream/reasoning from inner buffer
  // - System: execution/system messages from system buffer + split panel
  let selectedViews = new Set<'conversation' | 'inner' | 'system'>(['conversation', 'inner', 'system']);

  // Show terminal split panel when system tab is selected
  $: showSystemTerminal = selectedViews.has('system');
  let terminalMinimized = false;
  let terminalHeight = 300; // Default height in pixels
  let isResizing = false;
  let resizeStartY = 0;
  let resizeStartHeight = 0;

  // Compute display mode based on selected views
  // 'combined' = show all messages, 'conversation' = only chat, 'inner' = only reflections/dreams
  $: displayMode = (selectedViews.has('conversation') && selectedViews.has('inner'))
    ? 'combined'
    : selectedViews.has('inner')
      ? 'inner'
      : 'conversation';

  // Legacy mode for compatibility - keep message mode tied to chat buffers
  $: mode = displayMode as 'conversation' | 'inner';
  let messagesContainer: HTMLDivElement;
  let shouldAutoScroll = true;
  // Buffer stream (innerDialogueStream) provides real-time updates via fs.watch SSE
  let visibilityCleanup: (() => void) | null = null;
  // Convenience toggles
  let ttsEnabled = false;
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
  // Terminal mode doesn't use messages, default to 'conversation' for the messages API
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
      if (typeof p.bigBrotherEnabled === 'boolean') bigBrotherEnabled = p.bigBrotherEnabled;
      if (typeof p.bigBrotherDelegateAll === 'boolean') bigBrotherDelegateAll = p.bigBrotherDelegateAll;
      console.log('[chat-prefs] Loaded:', { ttsEnabled, reasoningDepth });
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
        bigBrotherDelegateAll,
      };
      localStorage.setItem('chatPrefs', JSON.stringify(prefs));
    } catch {}
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

    // Load saved terminal height
    try {
      const savedHeight = localStorage.getItem('mh-terminal-height');
      if (savedHeight) {
        terminalHeight = Math.max(100, parseInt(savedHeight, 10) || 300);
      }
    } catch {}

    // Connect to proposals SSE stream for real-time updates (no polling)
    connectProposalsStream();

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

    // Load Big Brother configuration from server (includes operator integration settings)
    try {
      const res = await apiFetch('/api/big-brother-config');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.config) {
          bigBrotherEnabled = data.config.enabled ?? false;
          bigBrotherDelegateAll = data.config.delegateAll ?? false;
          bigBrotherProvider = data.config.provider || 'claude-code';
          updateBigBrotherUiState();
          saveChatPrefs(); // Save to local storage
          console.log('[big-brother] Loaded configuration:', { 
            enabled: bigBrotherEnabled, 
            provider: data.config.provider,
            delegateAll: bigBrotherDelegateAll 
          });

          // If Big Brother is enabled, check/start Claude session when provider is Claude
          if (bigBrotherProvider !== 'claude-code') {
            claudeSessionReady = false;
          }
          updateBigBrotherUiState();

          if (bigBrotherEnabled && bigBrotherProvider === 'claude-code') {
            const status = await checkClaudeSessionStatus();
            if (!status?.ready && status?.installed) {
              await startClaudeSession();
            } else if (status?.ready) {
              claudeSessionReady = true;
              updateBigBrotherUiState();
            }
          }
        }
      }
    } catch (error) {
      console.error('[big-brother] Failed to load config:', error);
    }

    // Poll Claude session status every 10 seconds when BB is enabled
    const claudeStatusInterval = setInterval(async () => {
    if (bigBrotherEnabled && bigBrotherProvider === 'claude-code') {
      await checkClaudeSessionStatus();
      updateBigBrotherUiState();
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

    // Connect to buffer streams for all selected views - this loads initial history AND provides real-time updates
    // Uses fs.watch on server, no polling needed
    // Fetch all selected buffers and merge them
    await fetchAllSelectedBuffers();
    // Connect streams for real-time updates
    connectMultipleBufferStreams();
    console.log(`[ChatInterface] Connected to buffer streams for:`, Array.from(selectedViews));

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

    isTabVisible = !document.hidden;
    // Reconnect buffer streams when tab becomes visible (in case connection dropped)
    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
      if (!isTabVisible) {
        disconnectAllBufferStreams();
        disconnectTTSQueueStream();
        return;
      }

      if (selectedViews.size > 0) {
        // Check if any streams need reconnection
        const needsReconnect =
          (selectedViews.has('conversation') && (!conversationStream || conversationStream.readyState === EventSource.CLOSED)) ||
          (selectedViews.has('inner') && (!innerDialogueStream || innerDialogueStream.readyState === EventSource.CLOSED)) ||
          (selectedViews.has('system') && (!systemStream || systemStream.readyState === EventSource.CLOSED));

        if (needsReconnect) {
          console.log('[chat] Tab visible, reconnecting buffer streams');
          fetchAllSelectedBuffers();
          connectMultipleBufferStreams();
        }
      }

      connectTTSQueueStream();
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
   * Returns messages array without setting the store - caller handles merging.
   */
  async function fetchSingleBuffer(streamMode: 'conversation' | 'inner' | 'system'): Promise<ChatMessage[]> {
    // Always try server first - don't rely on isConnected which may not be accurate yet
    try {
      console.log(`[chat] Fetching ${streamMode} buffer from server...`);
      const response = await apiFetch(`/api/buffer?mode=${streamMode}`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.messages)) {
          console.log(`[chat] Loaded ${data.messages.length} messages from ${streamMode} buffer`);
          return data.messages;
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
      return localMessages.map(m => ({
        role: m.role as MessageRole,
        content: m.content,
        timestamp: m.timestamp,
        meta: m.meta,
      }));
    } catch (err) {
      console.error('[chat] Local buffer fetch also failed:', err);
      return [];
    }
  }

  // Concurrency guard for buffer fetches - prevents overlapping requests
  let fetchInProgress = false;
  let fetchNeededAfterCurrent = false;

  /**
   * Fetch and merge messages from all selected buffers
   * Merges messages by timestamp for unified display
   *
   * Three distinct buffers:
   * - conversation tab → conversation buffer (user/assistant)
   * - inner tab → inner buffer (reflection/dream/reasoning)
   * - system tab → system buffer (execution/system messages)
   */
  async function fetchAllSelectedBuffers() {
    // Concurrency guard: if a fetch is already in progress, mark that we need another one
    if (fetchInProgress) {
      console.log('[chat] Fetch already in progress, will re-fetch when complete');
      fetchNeededAfterCurrent = true;
      return;
    }

    fetchInProgress = true;
    fetchNeededAfterCurrent = false;

    try {
      // Map selected views directly to buffer modes (1:1 mapping now)
      // System buffer only fetched when system tab is selected
      const bufferModes: ('conversation' | 'inner' | 'system')[] = [];
      if (selectedViews.has('conversation')) bufferModes.push('conversation');
      if (selectedViews.has('inner')) bufferModes.push('inner');
      if (selectedViews.has('system')) bufferModes.push('system');

      console.log(`[chat] Fetching buffers for views:`, Array.from(selectedViews), '→ modes:', bufferModes);

      // Fetch all buffers in parallel
      const bufferPromises = bufferModes.map(mode => fetchSingleBuffer(mode));
      const bufferResults = await Promise.all(bufferPromises);

      // Flatten and merge all messages
      const allMessages: ChatMessage[] = [];
      for (const bufferMessages of bufferResults) {
        allMessages.push(...bufferMessages);
      }

      // Sort by timestamp (oldest first for chat display)
      allMessages.sort((a, b) => a.timestamp - b.timestamp);

      // Remove duplicates (same timestamp + content)
      const seen = new Set<string>();
      const uniqueMessages = allMessages.filter(msg => {
        const key = `${msg.timestamp}-${msg.content.substring(0, 50)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      console.log(`[chat] Merged ${uniqueMessages.length} unique messages from ${bufferModes.length} buffer(s)`);
      messages.set(uniqueMessages);
    } finally {
      fetchInProgress = false;

      // If another fetch was requested while we were busy, do it now
      if (fetchNeededAfterCurrent) {
        console.log('[chat] Re-fetching due to pending request');
        fetchAllSelectedBuffers();
      }
    }
  }

  function disconnectAllBufferStreams() {
    if (innerDialogueStream) {
      innerDialogueStream.close();
      innerDialogueStream = null;
    }
    if (conversationStream) {
      conversationStream.close();
      conversationStream = null;
    }
    if (systemStream) {
      systemStream.close();
      systemStream = null;
    }
  }

  /**
   * Connect to TTS queue stream
   * Watches for TTS items queued by cognitive graph nodes
   * Speaks them if the appropriate toggle is enabled
   */
  function connectTTSQueueStream() {
    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }
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
          // Process queued TTS items - unified toggle for all modes (conversation, inner, system)
          for (const item of data.items) {
            console.log(`[chat-tts] TTS queue item: mode=${item.mode}, source=${item.source}, text=${item.text?.substring(0, 50)}`);

            if (ttsEnabled) {
              console.log(`[chat-tts] SPEAKING ${item.mode} TTS from queue`);
              void ttsApi.speak(item.text);
            } else {
              console.log(`[chat-tts] Skipping TTS (ttsEnabled=${ttsEnabled})`);
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
        if (isComponentMounted && !document.hidden) {
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
    disconnectAllBufferStreams();
    disconnectTTSQueueStream();
    disconnectProposalsStream(); // Clean up proposals SSE stream
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
    const replyToDesireId = replyToMetadata.desireId;
    const replyToDesireTitle = replyToMetadata.desireTitle;

    // Clear selection after capturing metadata
    const wasReplying = $selectedMessage !== null;
    messagesApi.clearSelection();

    messagesApi.pushMessage('user', userMessage);

    loading = true;
    sendInProgress = false; // loading now takes over as the guard
    reasoningStages = [];

    // Timestamp helper for detailed trace
    const timestamp = () => new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const msgStartTime = Date.now();

    // Show detailed timestamped information IMMEDIATELY
    thinkingTraceApi.setStatusLabel('📤 Sending message...');
    thinkingTraceApi.setTrace([
      `[${timestamp()}] 📤 MESSAGE SENT`,
      `[${timestamp()}] Content: "${userMessage.substring(0, 60)}${userMessage.length > 60 ? '...' : ''}"`,
    ]);
    thinkingTraceApi.setActive(true);
    console.log('[sendMessage] Step 1: Set loading state');

    try {
      console.log('[sendMessage] Step 2: Entered try block');
      thinkingTraceApi.appendTrace(`[${timestamp()}] ⏳ Preparing request...`, 15);

      let llm_opts = {};
      try {
        const raw = localStorage.getItem('llmOptions');
        if (raw) llm_opts = JSON.parse(raw);
      } catch {}
      console.log('[sendMessage] Step 3: Got llm_opts');

      const params = new URLSearchParams({
        message: userMessage,
        mode,
        reason: String(reasoningDepth > 0),
        reasoningDepth: String(reasoningDepth),
        llm: JSON.stringify(llm_opts),
        sessionId: $conversationSessionId,
        // forceOperator removed - no longer used
      });
      console.log('[sendMessage] Step 4: Created URLSearchParams');
      thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ Request params built`, 15);
      params.set('yolo', String(yoloMode));
      // audience removed - focus selector obsolete with ReAct operator

      // Add replyTo metadata if replying to any message (curiosity, desire, or regular)
      if (replyToQuestionId) {
        params.set('replyToQuestionId', replyToQuestionId);
        console.log('[reply-to] Replying to curiosity question:', replyToQuestionId);
      }
      if (replyToDesireId) {
        params.set('replyToDesireId', replyToDesireId);
        if (replyToDesireTitle) {
          params.set('replyToDesireTitle', replyToDesireTitle);
        }
        console.log('[reply-to] Replying to desire/goal:', replyToDesireId, replyToDesireTitle);
      }
      if (replyToContent) {
        // Truncate to 500 chars to avoid URL length issues
        params.set('replyToContent', replyToContent.substring(0, 500));
        console.log('[reply-to] Replying to message:', replyToContent.substring(0, 100));
      }

      console.log('[sendMessage] Step 5: Setting up chat request');
      console.log('[sendMessage] URL:', `/api/persona_chat?${params.toString()}`);
      thinkingTraceApi.appendTrace(`[${timestamp()}] 🌐 Opening connection to /api/persona_chat`, 15);

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
      thinkingTraceApi.appendTrace(`[${timestamp()}] 🔌 EventSource created, waiting for server...`, 15);
      thinkingTraceApi.setStatusLabel('🔌 Connecting...');

      // Track connection time for user visibility
      const connectStart = Date.now();
      let connectionTimer: ReturnType<typeof setInterval> | null = null;

      // Start timer to show elapsed time WITH timestamps
      connectionTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - connectStart) / 1000);
        const totalElapsed = Math.floor((Date.now() - msgStartTime) / 1000);
        thinkingTraceApi.appendTrace(`[${timestamp()}] ⏱️ Waiting for server response... (${elapsed}s)`, 15);
      }, 2000);

      chatResponseStream.onopen = () => {
        console.log('[EventSource] Connection opened!');
        if (connectionTimer) clearInterval(connectionTimer);
        const elapsed = Math.floor((Date.now() - connectStart) / 1000);
        thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ CONNECTION OPENED (${elapsed}s)`, 15);
        thinkingTraceApi.setStatusLabel('⚡ Connected - Executing graph...');
      };

      chatResponseStream.onerror = (err) => {
        console.error('[EventSource] Connection error:', err);
        if (connectionTimer) clearInterval(connectionTimer);
        const elapsed = Math.floor((Date.now() - connectStart) / 1000);
        thinkingTraceApi.appendTrace(`[${timestamp()}] ❌ CONNECTION ERROR after ${elapsed}s`, 15);
        thinkingTraceApi.appendTrace(`[${timestamp()}] Check server terminal for errors`, 15);
        thinkingTraceApi.setStatusLabel('⚠️ Connection Failed');
      };

      chatResponseStream.onmessage = (event) => {
        if (connectionTimer) clearInterval(connectionTimer);
        console.log('[EventSource] onmessage fired, raw event.data:', event.data.substring(0, 200));
        thinkingTraceApi.appendTrace(`[${timestamp()}] 📥 Received server event`, 15);
        try {
          const { type, data } = JSON.parse(event.data);
          console.log('[EventSource] Parsed type:', type, 'data keys:', Object.keys(data));

          if (type === 'progress') {
            // Real-time progress updates from graph execution
            if (data && data.message) {
              thinkingTraceApi.setActive(true);

              // Update the thinking trace with progress messages - ALL WITH TIMESTAMPS
              const progressMsg = data.message;
              console.log('[Progress Event] step:', data.step, 'message:', progressMsg.substring(0, 100));

              if (data.step === 'loading_graph') {
                thinkingTraceApi.setStatusLabel('📋 Loading workflow...');
                thinkingTraceApi.appendTrace(`[${timestamp()}] 📋 ${progressMsg}`, 15);
              } else if (data.step === 'graph_loaded') {
                thinkingTraceApi.setStatusLabel('📊 Graph loaded');
                thinkingTraceApi.appendTrace(`[${timestamp()}] 📊 ${progressMsg}`, 15);
              } else if (data.step === 'graph_starting') {
                thinkingTraceApi.setStatusLabel('⚡ Executing graph...');
                thinkingTraceApi.appendTrace(`[${timestamp()}] ⚡ ${progressMsg}`, 15);
              } else if (data.step === 'node_executing') {
                thinkingTraceApi.setStatusLabel('🔄 Processing...');
                thinkingTraceApi.appendTrace(`[${timestamp()}] ▸ ${progressMsg}`, 15);
              } else if (data.step === 'thinking') {
                // Show actual AI thoughts from scratchpad
                console.log('[Thinking Event] Appending to trace:', progressMsg.substring(0, 150));
                thinkingTraceApi.setStatusLabel('🧠 Thinking...');
                thinkingTraceApi.appendTrace(`[${timestamp()}] 💭 ${progressMsg}`, 15);
              } else if (data.step === 'node_error') {
                thinkingTraceApi.setStatusLabel('⚠️ Error detected...');
                thinkingTraceApi.appendTrace(`[${timestamp()}] ❌ ERROR: ${progressMsg}`, 15);
              } else if (data.step === 'graph_complete') {
                // Graph execution completed, waiting for final answer
                thinkingTraceApi.setStatusLabel('✓ Completed, finalizing...');
                thinkingTraceApi.appendTrace(`[${timestamp()}] ✓ ${progressMsg}`, 15);
              } else if (data.step?.startsWith('big_brother_')) {
                // Big Brother status updates - show prominent status WITH TIMESTAMPS
                if (data.step === 'big_brother_init') {
                  thinkingTraceApi.setStatusLabel('🤖 Big Brother initializing...');
                  thinkingTraceApi.appendTrace(`[${timestamp()}] 🤖 Big Brother: Initializing...`, 15);
                } else if (data.step === 'big_brother_ready') {
                  thinkingTraceApi.setStatusLabel('🤖 Big Brother ready');
                  thinkingTraceApi.appendTrace(`[${timestamp()}] 🤖 Big Brother: Ready`, 15);
                } else if (data.step === 'big_brother_sending') {
                  thinkingTraceApi.setStatusLabel('📤 Sending to Big Brother...');
                  thinkingTraceApi.appendTrace(`[${timestamp()}] 📤 Big Brother: Sending prompt...`, 15);
                } else if (data.step === 'big_brother_executing') {
                  thinkingTraceApi.setStatusLabel('⚙️ Big Brother working...');
                  thinkingTraceApi.appendTrace(`[${timestamp()}] ⚙️ Big Brother: Executing...`, 15);
                } else if (data.step === 'big_brother_complete') {
                  thinkingTraceApi.setStatusLabel('✅ Big Brother complete');
                  thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ Big Brother: Complete`, 15);
                } else if (data.step === 'big_brother_error') {
                  thinkingTraceApi.setStatusLabel('❌ Big Brother error');
                  thinkingTraceApi.appendTrace(`[${timestamp()}] ❌ Big Brother: ERROR`, 15);
                }
                thinkingTraceApi.appendTrace(`[${timestamp()}] ${progressMsg}`, 15);
              } else {
                // Generic progress update
                thinkingTraceApi.appendTrace(`[${timestamp()}] ${progressMsg}`, 15);
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
          // Note: Big Brother output is streamed to System Terminal's Big Brother tab via WebSocket
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
          updateBigBrotherUiState();
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
        updateBigBrotherUiState();
        console.log('[claude-session] Status:', data.message);

        // Open the Big Brother terminal for visibility
        if (claudeSessionReady) {
          const { openBigBrotherTerminal } = await import('../stores/bigBrotherTerminal');
          openBigBrotherTerminal();
        }
      } else {
        console.error('[claude-session] Failed to start:', data.error);
        updateBigBrotherUiState();
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

  // View toggle functions for VS Code-style multi-select tabs
  function toggleView(view: 'conversation' | 'inner' | 'system') {
    const newSet = new Set(selectedViews);

    if (newSet.has(view)) {
      // Can't deselect if it's the only one
      if (newSet.size > 1) {
        newSet.delete(view);
      }
    } else {
      newSet.add(view);
    }

    selectedViews = newSet;

    // Fetch and merge all selected buffers
    fetchAllSelectedBuffers();

    // Connect to buffer streams for real-time updates
    // When we have multiple views, we need streams for all of them
    connectMultipleBufferStreams();
  }

  // Stores for multiple buffer streams (all three can be active simultaneously)
  let conversationStream: EventSource | null = null;
  let systemStream: EventSource | null = null;

  // Debounce timer for SSE-triggered fetches to prevent rapid-fire requests
  let sseRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function debouncedFetchAllBuffers() {
    if (sseRefreshDebounceTimer) {
      clearTimeout(sseRefreshDebounceTimer);
    }
    sseRefreshDebounceTimer = setTimeout(() => {
      console.log('[chat] Debounced fetch triggered');
      fetchAllSelectedBuffers();
    }, 150); // Wait 150ms after last SSE update before fetching (reduced from 500ms for faster updates)
  }

  /**
   * Connect to buffer streams for all selected views
   * Handles real-time updates from multiple sources
   *
   * Three distinct buffers:
   * - conversation view → conversation buffer stream
   * - inner view → inner buffer stream
   * - system view → system buffer stream
   */
  function connectMultipleBufferStreams() {
    if (typeof document !== 'undefined' && document.hidden) {
      console.log('[chat] Skipping buffer stream connect (tab hidden)');
      return;
    }
    // Close existing streams
    if (innerDialogueStream) {
      innerDialogueStream.close();
      innerDialogueStream = null;
    }
    if (conversationStream) {
      conversationStream.close();
      conversationStream = null;
    }
    if (systemStream) {
      systemStream.close();
      systemStream = null;
    }

    // Connect to streams for each selected view (1:1 mapping)
    // System stream only connected when system tab is selected
    if (selectedViews.has('conversation')) {
      connectBufferStreamForMode('conversation', (stream) => { conversationStream = stream; });
    }
    if (selectedViews.has('inner')) {
      connectBufferStreamForMode('inner', (stream) => { innerDialogueStream = stream; });
    }
    if (selectedViews.has('system')) {
      connectBufferStreamForMode('system', (stream) => { systemStream = stream; });
    }
  }

  /**
   * Connect to a single buffer stream with proper merge handling
   */
  function connectBufferStreamForMode(
    streamMode: 'conversation' | 'inner' | 'system',
    setStream: (stream: EventSource) => void
  ) {
    console.log(`[chat] Connecting to ${streamMode} buffer stream (multi-mode)...`);
    const stream = apiEventSource(`/api/buffer-stream?mode=${streamMode}`);
    setStream(stream);

    stream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          console.log(`[chat] ${streamMode} buffer stream connected`);
          // Reset message counts on connect
          const currentCount = get(messages).length;
          if (streamMode === 'inner') {
            lastInnerMessageCount = currentCount;
          } else {
            lastConversationMessageCount = currentCount;
          }
          return;
        }
        if (data.type === 'error') {
          console.error(`[chat] ${streamMode} buffer stream error:`, data.error);
          return;
        }
        if (data.type === 'update' && Array.isArray(data.messages)) {
          // Direct store update for instant UI refresh
          // Merge new messages directly into the store instead of waiting for debounced fetch
          if (data.messages.length > 0) {
            const currentMsgs = get(messages);
            const newMsgs = data.messages.filter((m: any) =>
              !currentMsgs.some(c => c.timestamp === m.timestamp && c.content?.substring(0, 50) === m.content?.substring(0, 50))
            );
            if (newMsgs.length > 0) {
              console.log(`[chat] ${streamMode} buffer: ${newMsgs.length} new messages, updating store directly`);
              messages.update(msgs => [...msgs, ...newMsgs].sort((a, b) => a.timestamp - b.timestamp));
            }
          }
          // Also trigger debounced fetch as fallback for full sync (ensures consistency)
          debouncedFetchAllBuffers();
        }
      } catch (err) {
        console.error(`[chat] ${streamMode} buffer stream parse error:`, err);
      }
    };

    stream.onerror = (err) => {
      console.error(`[chat] ${streamMode} buffer stream error:`, err);
      // Attempt reconnection after a delay
      setTimeout(() => {
        const isSelected = selectedViews.has(streamMode);
        if (isComponentMounted && !document.hidden && isSelected) {
          connectBufferStreamForMode(streamMode, setStream);
        }
      }, 3000);
    };
  }


  async function toggleBigBrother(forceDelegateAll = false) {
    const wasEnabled = bigBrotherEnabled;
    const wasDelegateAll = bigBrotherDelegateAll;
    
    if (!bigBrotherEnabled) {
      // First click: Enable Big Brother in escalation mode
      bigBrotherEnabled = true;
      bigBrotherDelegateAll = false;
    } else if (!bigBrotherDelegateAll || forceDelegateAll) {
      // Second click or right-click: Enable delegate all mode
      bigBrotherEnabled = true;
      bigBrotherDelegateAll = true;
    } else {
      // Third click: Turn off Big Brother completely
      bigBrotherEnabled = false;
      bigBrotherDelegateAll = false;
    }
    
    saveChatPrefs();

    try {
      // Update Big Brother configuration in operator.json (controls both CLI and operator integration)
      const res = await apiFetch('/api/big-brother-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: bigBrotherEnabled,
          provider: bigBrotherProvider,
          delegateAll: bigBrotherDelegateAll,
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
        throw new Error(data.error || 'Failed to update Big Brother config');
      }

      console.log('[big-brother] Successfully updated Big Brother configuration:', { 
        enabled: bigBrotherEnabled, 
        delegateAll: bigBrotherDelegateAll 
      });
      updateBigBrotherUiState();

      // Start or stop Claude session based on BB mode (only for Claude provider)
      if (bigBrotherEnabled && bigBrotherProvider === 'claude-code') {
        await startClaudeSession();
      } else if (bigBrotherProvider === 'claude-code') {
        await stopClaudeSession();
      }
    } catch (error) {
      console.error('[big-brother] Error updating config:', error);
      // Revert on failure
      bigBrotherEnabled = wasEnabled;
      bigBrotherDelegateAll = wasDelegateAll;
      updateBigBrotherUiState();
      saveChatPrefs();
    }
  }

  function updateBigBrotherUiState() {
    const providerLabels: Record<string, string> = {
      'claude-code': 'Claude Code',
      'open-interpreter': 'Open Interpreter',
      'aider': 'Aider',
      'gemini-cli': 'Gemini CLI',
      'qwen-code': 'Qwen Code',
      'codex': 'Codex',
    };
    bigBrotherProviderLabel = providerLabels[bigBrotherProvider] || bigBrotherProvider;
    bigBrotherReady = bigBrotherEnabled && (bigBrotherProvider !== 'claude-code' || claudeSessionReady);
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

  // Terminal resize handlers
  function startResize(e: MouseEvent | TouchEvent) {
    if (terminalMinimized) return;
    e.preventDefault(); // Prevent default to avoid scroll/selection issues
    e.stopPropagation();

    isResizing = true;
    resizeStartY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    resizeStartHeight = terminalHeight;

    // Prevent text selection during resize
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
    document.body.style.pointerEvents = 'none'; // Prevent other elements from capturing

    // Add global listeners for move/end (with passive: false to allow preventDefault)
    document.addEventListener('mousemove', handleResize, { passive: false });
    document.addEventListener('mouseup', stopResize);
    document.addEventListener('mouseleave', stopResize); // Cleanup if mouse leaves window
    document.addEventListener('touchmove', handleResize, { passive: false });
    document.addEventListener('touchend', stopResize);
    document.addEventListener('touchcancel', stopResize); // Handle touch cancellation
  }

  function handleResize(e: MouseEvent | TouchEvent) {
    if (!isResizing) return;
    e.preventDefault(); // Prevent scrolling during resize

    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    // Moving up increases height (negative delta = more height)
    const delta = resizeStartY - clientY;
    const newHeight = Math.max(100, Math.min(window.innerHeight * 0.7, resizeStartHeight + delta));
    terminalHeight = newHeight;
  }

  function stopResize() {
    if (!isResizing) return; // Prevent double cleanup
    isResizing = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    document.body.style.pointerEvents = ''; // Restore pointer events

    // Remove global listeners
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
    document.removeEventListener('mouseleave', stopResize);
    document.removeEventListener('touchmove', handleResize);
    document.removeEventListener('touchend', stopResize);
    document.removeEventListener('touchcancel', stopResize);

    // Save preference to localStorage
    try {
      localStorage.setItem('mh-terminal-height', String(terminalHeight));
    } catch {}
  }

</script>

<div class="chat-interface">
  <!-- Header with all controls -->
  <div class="mode-toggle-container sm:gap-3">
    <!-- Mode Toggle Buttons (VS Code-style multi-select) -->
    <div class="mode-toggle">
      <button
        class="mode-btn {selectedViews.has('conversation') ? 'active' : ''}"
        on:click={() => toggleView('conversation')}
        aria-label="Toggle conversation view"
        title="Toggle conversation view (can combine with Inner Dialogue)"
      >
        <span class="mode-icon" aria-hidden="true">💬</span>
        <span class="mode-label">Conversation</span>
      </button>
      <button
        class="mode-btn {selectedViews.has('inner') ? 'active' : ''}"
        on:click={() => toggleView('inner')}
        aria-label="Toggle inner dialogue view"
        title="Toggle inner dialogue view (can combine with Conversation)"
      >
        <span class="mode-icon" aria-hidden="true">💭</span>
        <span class="mode-label">Inner Dialogue</span>
      </button>
      <button
        class="mode-btn {showSystemTerminal ? 'active' : ''}"
        on:click={() => toggleView('system')}
        aria-label="Toggle system view"
        title="Toggle system view (split view below chat)"
      >
        <span class="mode-icon" aria-hidden="true">💻</span>
        <span class="mode-label">System</span>
      </button>
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
      class="big-brother-toggle {bigBrotherEnabled ? 'active' : ''} {bigBrotherDelegateAll ? 'delegate-all' : ''} {bigBrotherReady ? 'ready' : ''}"
      title={!bigBrotherEnabled
        ? 'Big Brother off - Click for escalation mode, right-click for full delegation'
        : bigBrotherDelegateAll
          ? bigBrotherReady
            ? `Big Brother FULL DELEGATION - All tasks go to ${bigBrotherProviderLabel} ⚡`
            : bigBrotherProvider === 'claude-code'
              ? 'Big Brother delegation mode - Starting Claude CLI...'
              : `Big Brother delegation mode - ${bigBrotherProviderLabel} pending...`
          : bigBrotherReady
            ? `Big Brother escalation mode - Escalates via ${bigBrotherProviderLabel} ⚠️`
            : bigBrotherProvider === 'claude-code'
              ? 'Big Brother escalation mode - Starting Claude CLI...'
              : `Big Brother escalation mode - ${bigBrotherProviderLabel} pending...`}
      on:click={() => toggleBigBrother(false)}
      on:contextmenu|preventDefault={() => toggleBigBrother(true)}
    >
      <span class="big-brother-icon">🤖</span>
      {#if bigBrotherEnabled}
        {#if bigBrotherDelegateAll}
          <span class="big-brother-badge delegate-all">⚡</span>
        {:else if bigBrotherReady}
          <span class="big-brother-badge ready">⚠️</span>
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

    <!-- Quick voice/tts controls - single toggle for all modes (conversation, inner, system) -->
    <div class="quick-audio">
      <button
        class="icon-btn {ttsEnabled ? 'tts-active' : ''}"
        title={ttsEnabled ? 'Disable speech (all modes)' : 'Enable speech (conversation, inner dialogue, system)'}
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

  <!-- Main chat area with optional terminal split -->
  <div class="chat-main-area" class:with-terminal-split={showSystemTerminal}>
    <!-- Messages panel -->
    <div class="messages-panel" class:split={showSystemTerminal}>
      <div class="messages-container" bind:this={messagesContainer}>
        {#if $messages.length === 0}
          <div class="welcome-screen">
            <div class="welcome-icon">🧠 => 💻</div>
            <h2 class="welcome-title">MetaHuman OS</h2>
            <p class="welcome-subtitle">
              {#if selectedViews.has('conversation') && selectedViews.has('inner')}
                View combined conversation and inner dialogue
              {:else if selectedViews.has('conversation')}
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
            mode={displayMode}
            showSystemMessages={selectedViews.has('system')}
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
  <!-- Shows in BOTH conversation AND inner dialogue modes - users need to see approval requests regardless of view -->
  <ApprovalPrompt onApprovalChange={() => {
    console.log('[chat] Approval change detected');
  }} />

  <!-- Operator proposals now displayed inline in LizardBrainCard -->

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
    />
  </div>
    </div>
    <!-- End messages-panel -->

    <!-- Terminal split panel (system terminal, not Claude CLI) -->
    {#if showSystemTerminal}
      <!-- Resize handle -->
      <div
        class="terminal-resize-handle"
        class:resizing={isResizing}
        on:mousedown={startResize}
        on:touchstart={startResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
        tabindex="0"
        on:keydown={(e) => {
          if (e.key === 'ArrowUp') { terminalHeight = Math.min(window.innerHeight * 0.7, terminalHeight + 20); }
          if (e.key === 'ArrowDown') { terminalHeight = Math.max(100, terminalHeight - 20); }
        }}
      >
        <div class="resize-handle-grip"></div>
      </div>

      <div
        class="terminal-split-panel"
        style={`height: ${terminalHeight}px; flex: none;`}
      >
        <div class="terminal-content">
          <TerminalManager />
        </div>
      </div>
    {/if}
  </div>
  <!-- End chat-main-area -->
</div>

<style>
  .big-brother-toggle.delegate-all {
    background: linear-gradient(135deg, #ff6b6b, #ee5a24);
    box-shadow: 0 0 20px rgba(255, 107, 107, 0.4);
    animation: pulse-delegation 2s infinite;
  }

  .big-brother-badge.delegate-all {
    background: #ff3838;
    color: white;
    font-weight: bold;
    animation: glow-delegation 1.5s infinite alternate;
  }

  @keyframes pulse-delegation {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }

  @keyframes glow-delegation {
    0% { box-shadow: 0 0 5px #ff3838; }
    100% { box-shadow: 0 0 15px #ff3838, 0 0 25px #ff3838; }
  }
</style>
