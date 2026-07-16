<script lang="ts">
  import { onMount, afterUpdate, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import Thinking from './Thinking.svelte';
  import InputArea from './chat/InputArea.svelte';
  import MessageList from './chat/MessageList.svelte';
  import ApprovalPrompt from './ApprovalPrompt.svelte';
  // Operator proposals are rendered inline by OperatorProposalCard.
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
  import { forceHealthCheck } from '../lib/client/server-health';
  import { getDisplayMessages, appendToBuffer, clearBuffer, type BufferMode, type BufferMessage } from '../lib/client/local-memory';
  import { unifiedChat, type ChatResponse } from '../lib/client/unified-chat';
  import { apiEventSource, apiFetch } from '../lib/client/api-config';
  import {
    buildConversationParams,
    buildResponsePipelineRequestBody,
    closeEventSourceConnections,
    parseConversationStreamEvent,
    readLlmOptions,
  } from '../lib/client/conversation-transport';
  import { connectProposalsStream, disconnectProposalsStream } from '../stores/proposals';
  import { connectionPool, ConnectionPriority, type ConnectionHandle } from '../lib/client/connection-pool';
  import { autonomyModeDefinition, nextAutonomyMode, type AutonomyMode } from '../lib/client/active-operator-modes';
  import { setActiveOperatorMode, triggerManagerSnapshot, useTriggerManager } from '../lib/stores/trigger-manager';

  // Component state
  let input = '';
  let loading = false;
  let responsePipelineAbortController: AbortController | null = null; // For cancel button
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
  let chatResponseHandle: ConnectionHandle | null = null;
  let chatResponseStream: EventSource | null = null;
  let activeChatTaskId: string | null = null;
  let reconcilingChatTaskId: string | null = null;
  let queuedChatStreams = new Map<string, EventSource>();
  let innerDialogueHandle: ConnectionHandle | null = null;
  let innerDialogueStream: EventSource | null = null;
  let ttsQueueHandle: ConnectionHandle | null = null;
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
  let displayMode: 'conversation' | 'inner' | 'combined' = 'combined';
  $: displayMode = (selectedViews.has('conversation') && selectedViews.has('inner'))
    ? 'combined'
    : selectedViews.has('inner')
      ? 'inner'
      : 'conversation';

  // Displaying both buffers must not turn a normal user message into inner
  // dialogue. Only an explicitly inner-only view submits to the inner buffer.
  let mode: 'conversation' | 'inner' = 'conversation';
  $: mode = displayMode === 'inner' ? 'inner' : 'conversation';
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
  // Active Operator three-state control
  let autonomyMode: AutonomyMode = 'reactive';
  let activeOperatorLoading = false;
  let releaseTriggerManager: (() => void) | undefined;
  $: if ($triggerManagerSnapshot?.autonomyMode) autonomyMode = $triggerManagerSnapshot.autonomyMode;
  $: activeOperatorMode = autonomyModeDefinition(autonomyMode);
  // Synchronous guard to prevent double/triple submit race condition
  let sendInProgress = false;

  // Initialize TTS composable
  const ttsApi = useTTS();
  const { isPlaying: ttsIsPlaying, isLoading: ttsIsLoading } = ttsApi;
  let lastAutoSpoken: { text: string; at: number } | null = null;

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
        console.log('[chat-mic] Transcribed & sending:', transcript.substring(0, 50) + (transcript.length > 50 ? '...' : ''));
        input = transcript;
        void sendMessage();
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
    interimTranscript: micInterimTranscript,
    isNativeMode: micIsNativeMode,
    isWakeWordListening: micIsWakeWordListening,
    isConversationMode: micIsConversationMode,
  } = mic;
  let lastTTSPlayingForMic = false;

  $: if ($ttsIsPlaying !== lastTTSPlayingForMic) {
    if ($ttsIsPlaying) {
      mic.suspendContinuousForTTS();
    } else {
      mic.resumeContinuousAfterTTS();
    }
    lastTTSPlayingForMic = $ttsIsPlaying;
  }

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

  function assistantSpeechEnabled(): boolean {
    return ttsEnabled || get(mic.isConversationMode) || get(mic.isContinuousMode);
  }

  function enableAssistantSpeech(source: string): void {
    if (ttsEnabled) return;
    ttsEnabled = true;
    saveChatPrefs();
    ttsApi.prefetchVoiceResources();
    console.log(`[chat-tts] Enabled assistant speech from ${source}`);
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
    releaseTriggerManager = useTriggerManager();
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

    // CRITICAL: Aggressive cleanup on page unload to prevent connection leaks
    // This ensures EventSource connections are closed even if Svelte cleanup doesn't run
    const aggressiveCleanup = () => {
      console.log('[chat] Page unload - force closing ALL connections');
      chatResponseStream?.close();
      queuedChatStreams.forEach(stream => stream.close());
      queuedChatStreams.clear();
      innerDialogueStream?.close();
      disconnectAllBufferStreams();
      disconnectTTSQueueStream();
      disconnectProposalsStream();
    };
    window.addEventListener('beforeunload', aggressiveCleanup);
    window.addEventListener('pagehide', aggressiveCleanup);

    // Store cleanup for onDestroy
    const windowCleanupFunctions = [
      () => window.removeEventListener('beforeunload', aggressiveCleanup),
      () => window.removeEventListener('pagehide', aggressiveCleanup),
    ];

    // Add to existing cleanup
    const originalVisibilityCleanup = visibilityCleanup;
    visibilityCleanup = () => {
      originalVisibilityCleanup?.();
      windowCleanupFunctions.forEach(fn => fn());
    };
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
  let suppressTTSQueueCloseNotice = false;

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
    if (innerDialogueHandle) {
      innerDialogueHandle.close();
      innerDialogueHandle = null;
      innerDialogueStream = null;
    }
    if (conversationHandle) {
      conversationHandle.close();
      conversationHandle = null;
      conversationStream = null;
    }
    if (systemHandle) {
      systemHandle.close();
      systemHandle = null;
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
    if (ttsQueueHandle) {
      disconnectTTSQueueStream();
    }

    console.log('[chat-tts] Requesting TTS queue stream from connection pool...');

    ttsQueueHandle = connectionPool.request({
      id: 'tts-queue',
      name: 'TTS Queue Stream',
      url: '/api/tts-queue-stream',
      priority: ConnectionPriority.MEDIUM,
      viewDependency: 'chat',
      defer: true,
      onOpen: (source) => {
        console.log('[chat-tts] TTS queue stream opened via pool');
        ttsQueueStream = source;
      },
      onClose: () => {
        console.log('[chat-tts] TTS queue stream closed via pool');
        ttsQueueStream = null;
        if (!suppressTTSQueueCloseNotice) {
          messagesApi.pushMessage('system', '⚠️ **TTS Stream Disconnected**\n\nSpeech playback is unavailable until the connection is restored. Refresh the page or re-open the chat tab to reconnect.');
        }
        suppressTTSQueueCloseNotice = false;
      },
      onMessage: (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'connected') {
            console.log('[chat-tts] TTS queue stream connected');
            return;
          }

          if (data.type === 'error') {
            console.error('[chat-tts] TTS queue stream error:', data.error);
            messagesApi.pushMessage('system', '⚠️ **TTS Stream Error**\n\nThe speech stream reported an error. Try refreshing the page or toggling TTS off/on.');
            return;
          }

          if (data.type === 'tts' && Array.isArray(data.items)) {
            handleTTSItems(data.items);
          }
        } catch (err) {
          console.error('[chat-tts] TTS queue stream parse error:', err);
        }
      },
      onError: (err) => {
        console.error('[chat-tts] TTS queue stream error:', err);
        messagesApi.pushMessage('system', '⚠️ **TTS Stream Connection Lost**\n\nSpeech playback will not work until the stream reconnects. Try refreshing the page.');
      },
    });
  }

  function disconnectTTSQueueStream() {
    if (ttsQueueHandle) {
      console.log('[chat-tts] Disconnecting TTS queue stream');
      suppressTTSQueueCloseNotice = true;
      ttsQueueHandle.close();
      ttsQueueHandle = null;
      ttsQueueStream = null;
    }
  }

  async function speakAssistantResponse(text: string | undefined | null, source: string) {
    const speechText = text?.trim();
    const speechEnabled = assistantSpeechEnabled();
    if (!speechEnabled || !speechText) {
      console.log(`[chat-tts] Skipping auto TTS from ${source} (speechEnabled=${speechEnabled}, ttsEnabled=${ttsEnabled}, conversationMode=${get(mic.isConversationMode)}, continuousMode=${get(mic.isContinuousMode)})`);
      return;
    }

    const now = Date.now();
    if (lastAutoSpoken?.text === speechText && now - lastAutoSpoken.at < 10000) {
      console.log(`[chat-tts] Skipping duplicate auto TTS from ${source}`);
      return;
    }

    const autoSpokenMarker = { text: speechText, at: now };
    lastAutoSpoken = autoSpokenMarker;

    try {
      console.log(`[chat-tts] Auto-speaking ${source} (${speechText.length} chars)`);
      await ttsApi.ensureAudioUnlocked();
      await ttsApi.speak(speechText);
    } catch (err) {
      if (lastAutoSpoken === autoSpokenMarker) {
        lastAutoSpoken = null;
      }
      console.warn(`[chat-tts] Auto TTS failed from ${source}:`, err);
    }
  }

  function pausePassiveChatStreams() {
    // Suspend the shared pool first so closing one stream cannot immediately
    // promote another queued background stream into the freed browser slot.
    suppressTTSQueueCloseNotice = true;
    connectionPool.suspend();
    disconnectAllBufferStreams();
    disconnectTTSQueueStream();
    disconnectProposalsStream();
    thinkingTraceApi.pauseTelemetry();
    suppressTTSQueueCloseNotice = false;
  }

  function restorePassiveChatStreams() {
    if (!isComponentMounted || (typeof document !== 'undefined' && document.hidden)) {
      return;
    }

    connectMultipleBufferStreams();
    connectTTSQueueStream();
    connectProposalsStream();
    connectionPool.resume();
  }

  function handleTTSItems(items: Array<{ text?: string; mode?: string; source?: string }>) {
    for (const item of items) {
      console.log(`[chat-tts] TTS queue item: mode=${item.mode}, source=${item.source}, text=${item.text?.substring(0, 50)}`);

      void speakAssistantResponse(item.text, `queue:${item.source || item.mode || 'unknown'}`);
    }
  }


  onDestroy(() => {
    // Mark component as unmounted to stop animation loops
    isComponentMounted = false;

    // Clean up event listeners and streams
    visibilityCleanup?.();
    chatResponseStream?.close();
    queuedChatStreams.forEach(stream => stream.close());
    queuedChatStreams.clear();
    disconnectAllBufferStreams();
    disconnectTTSQueueStream();
    disconnectProposalsStream(); // Clean up proposals SSE stream
    activityApi.clearActivity();
    ttsApi.cleanup();
    thinkingTraceApi.cleanup();
    unsubscribeYolo();
    releaseTriggerManager?.();

    // A navigation can destroy the chat while a foreground request has the
    // shared pool suspended. Release the suspension so streams owned by the
    // next view are allowed to connect.
    connectionPool.resume();

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

      void speakAssistantResponse(result.response, 'offline');

      thinkingTraceApi.stop();
    } catch (err) {
      console.error('[sendMessage-offline] Error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to get response';
      messagesApi.pushMessage('system', `⚠️ ${errorMsg}`);
      thinkingTraceApi.stop();
    } finally {
      loading = false;
      restorePassiveChatStreams();
    }
  }

  async function enqueueUserMessageTask(input: Record<string, any>) {
    const res = await apiFetch('/api/unified-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'user_message',
        priority: 'critical',
        input,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to enqueue message (${res.status})`);
    }
    return data.task as { id: string };
  }

  async function getQueuedTaskStatus(taskId: string): Promise<{
    status: 'queued' | 'running' | 'completed' | 'failed';
    error?: string;
  }> {
    const res = await apiFetch(`/api/unified-queue/tasks/${encodeURIComponent(taskId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.task?.status) {
      throw new Error(data.error || `Could not read queued task status (${res.status})`);
    }
    return data.task;
  }

  async function reconcileQueuedChatTask(taskId: string): Promise<void> {
    if (reconcilingChatTaskId === taskId) return;
    reconcilingChatTaskId = taskId;
    let statusFailures = 0;

    try {
      while (activeChatTaskId === taskId && loading) {
        try {
          const task = await getQueuedTaskStatus(taskId);
          statusFailures = 0;

          if (task.status === 'completed') {
            activeChatTaskId = null;
            await fetchAllSelectedBuffers();
            thinkingTraceApi.stop();
            reasoningStages = [];
            loading = false;
            restorePassiveChatStreams();
            return;
          }

          if (task.status === 'failed') {
            activeChatTaskId = null;
            thinkingTraceApi.stop();
            reasoningStages = [];
            loading = false;
            messagesApi.pushMessage('system', `Error: ${task.error || 'Queued message failed'}`);
            restorePassiveChatStreams();
            return;
          }

          thinkingTraceApi.setActive(true);
          thinkingTraceApi.setStatusLabel(task.status === 'running'
            ? '⚙️ Server is processing your message...'
            : '⏳ Message is queued...');
        } catch (error) {
          statusFailures++;
          console.warn('[chat] Could not reconcile queued task:', error);
          thinkingTraceApi.setActive(true);
          thinkingTraceApi.setStatusLabel('🔄 Reconnecting to message status...');

          if (statusFailures === 3) {
            thinkingTraceApi.appendTrace('The server accepted the message, but live status is temporarily unavailable.', 15);
          }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally {
      if (reconcilingChatTaskId === taskId) {
        reconcilingChatTaskId = null;
      }
    }
  }

  function openQueuedBackgroundStream(taskId: string, userMessage: string, queuedMode: 'conversation' | 'inner') {
    const stream = apiEventSource(`/api/unified-queue/tasks/${encodeURIComponent(taskId)}/stream`);
    queuedChatStreams.set(taskId, stream);

    const close = () => {
      stream.close();
      queuedChatStreams.delete(taskId);
    };

    stream.onmessage = (event) => {
      try {
        const { type, data } = parseConversationStreamEvent(event.data);
        if (type === 'queued_task_started') {
          messagesApi.pushMessage('user', userMessage);
          loading = true;
          thinkingTraceApi.setActive(true);
          thinkingTraceApi.setStatusLabel('Queued message started');
          thinkingTraceApi.setTrace([`Queued task ${taskId} started`]);
        } else if (type === 'queued') {
          thinkingTraceApi.setActive(true);
          thinkingTraceApi.setStatusLabel(`Queued behind ${Math.max(0, Number(data.position || 1) - 1)} task(s)`);
        } else if (type === 'progress' && data?.message) {
          thinkingTraceApi.setActive(true);
          thinkingTraceApi.appendTrace(String(data.message), 15);
        } else if (type === 'reasoning') {
          if (queuedMode === 'inner') {
            messagesApi.pushMessage('reasoning', typeof data === 'string' ? data : String(data?.content || ''));
          }
        } else if (type === 'answer') {
          thinkingTraceApi.stop();
          messagesApi.pushMessage('assistant', data.response, data?.saved?.assistantRelPath, { facet: data.facet });
          void speakAssistantResponse(data?.tts?.text || data.response, data?.tts?.itemId ? `conversation-answer:${data.tts.itemId}` : 'conversation-answer');
          loading = false;
          close();
          restorePassiveChatStreams();
        } else if (type === 'error') {
          thinkingTraceApi.stop();
          messagesApi.pushMessage('system', `Error: ${data?.message || 'Queued message failed'}`);
          loading = false;
          close();
          restorePassiveChatStreams();
        } else if (type === 'queued_task_completed') {
          close();
        }
      } catch (err) {
        messagesApi.pushMessage('system', `Error: ${(err as Error).message || 'Failed to process queued response.'}`);
        loading = false;
        close();
        restorePassiveChatStreams();
      }
    };

    stream.onerror = () => {
      messagesApi.pushMessage('system', 'Error: Queued message stream disconnected.');
      loading = false;
      close();
      restorePassiveChatStreams();
    };
  }

  /**
   * Send a response to an agency card via the dedicated response pipeline.
   * Uses a focused 5-node graph instead of the full dual-consciousness pipeline.
   * - No memory search (only loads the card context)
   * - No conversation buffer noise
   * - Single-pass LLM with card-type-specific prompts
   * - Saves as 'card_response' memory type for training
   */
  async function sendResponsePipeline(
    message: string,
    cardType: string,
    cardData: Record<string, any>,
    responseBufferId?: string | null
  ) {
    if (!message.trim()) return;

    const timestamp = () => new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const startTime = Date.now();

    // Preserve original message for restoration on failure
    const originalMessage = message;

    // Add user message to UI
    messagesApi.pushMessage('user', message);

    loading = true;
    thinkingTraceApi.start();
    thinkingTraceApi.setStatusLabel(`🔍 Validating...`);
    thinkingTraceApi.setTrace([
      `[${timestamp()}] 📤 RESPONSE PIPELINE INITIATED`,
      `[${timestamp()}] Card type: ${cardType}`,
      `[${timestamp()}] Desire: ${cardData.desireTitle || cardData.desireId || 'N/A'}`,
      `[${timestamp()}] Multi-turn buffer: ${responseBufferId || 'creating new'}`,
      `[${timestamp()}] `,
      `[${timestamp()}] 🔍 PRE-FLIGHT CHECKS`,
    ]);

    // Heartbeat interval for long-running requests
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let connectionEstablished = false;

    // AbortController for cancellation
    let abortController = new AbortController();
    responsePipelineAbortController = abortController; // Store for cancel button

    // Helper to restore input and cleanup on failure
    const restoreInputAndCleanup = () => {
      input = originalMessage; // Restore the message to input field
      thinkingTraceApi.stop();
      loading = false;
    };

    try {
      // Step 0: Pre-flight validation
      console.log('[response-pipeline] Step 0: Pre-flight checks');

      // CRITICAL: Close ALL EventSource connections FIRST
      // Browsers limit concurrent connections per-origin (typically 6 for HTTP/1.1)
      // If limit is reached, fetch() hangs indefinitely waiting for a slot
      // SYMPTOMS OF CONNECTION EXHAUSTION:
      // - No CPU/GPU activity
      // - No network requests visible in DevTools
      // - Request just sits in "pending" state forever
      // - No error, no timeout - just infinite hang
      console.log('[response-pipeline] ========== CONNECTION CLEANUP START ==========');
      console.log('[response-pipeline] Reason: Browser connection limit (6 per origin)');
      console.log('[response-pipeline] Closing all EventSource connections to free slots...');

      let closedCount = closeEventSourceConnections('[response-pipeline]', [
        {
          name: 'chatResponseStream',
          source: chatResponseStream,
          clear: () => {
            chatResponseStream = null;
          },
        },
        {
          name: 'innerDialogueStream',
          source: innerDialogueStream,
          clear: () => {
            innerDialogueStream = null;
          },
        },
      ]);

      try {
        disconnectAllBufferStreams();
        console.log('[response-pipeline] → Closed buffer streams');
        closedCount++;
      } catch (e) {
        console.error('[response-pipeline] ❌ Error closing buffer streams:', e);
      }

      try {
        disconnectTTSQueueStream();
        console.log('[response-pipeline] → Closed TTS queue stream');
        closedCount++;
      } catch (e) {
        console.error('[response-pipeline] ❌ Error closing TTS queue stream:', e);
      }

      console.log(`[response-pipeline] ✅ Closed ${closedCount} connections`);
      console.log('[response-pipeline] ========== CONNECTION CLEANUP COMPLETE ==========');

      // Check 1: Session validity (NO TIMEOUT - but with progress notifications)
      try {
        console.log('[response-pipeline] Starting auth check at', new Date().toISOString());
        thinkingTraceApi.appendTrace(`[${timestamp()}] Checking session...`, 5);

        // Progress indicator to show we're waiting (NO TIMEOUT, just visibility)
        let notificationShown = false;
        const progressInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          console.log(`[response-pipeline] ⏳ Still waiting for auth check... (${elapsed}s)`);
          thinkingTraceApi.appendTrace(`[${timestamp()}] ⏳ Still checking session... (${elapsed}s)`, 3);

          // Show user notification after 10 seconds
          if (elapsed >= 10 && !notificationShown) {
            notificationShown = true;
            console.warn('[response-pipeline] ⚠️  AUTH CHECK TAKING LONGER THAN EXPECTED (>10s)');
            console.warn('[response-pipeline] This usually indicates:');
            console.warn('[response-pipeline]   1. Server is overloaded');
            console.warn('[response-pipeline]   2. Network connection is very slow');
            console.warn('[response-pipeline]   3. All browser connection slots were full (now freed)');
            messagesApi.pushMessage('system', '⏳ **Session Check Taking Longer Than Expected**\n\nChecking your session is taking over 10 seconds. This is unusual and may indicate server load or network issues.\n\n**Status**: Still trying (no timeout)...\n**Your reply is preserved** and will be restored if this fails.');
          }

          // Escalate notification after 30 seconds
          if (elapsed >= 30) {
            console.error('[response-pipeline] ⚠️  AUTH CHECK EXTREMELY SLOW (>30s)');
            console.error('[response-pipeline] Consider:');
            console.error('[response-pipeline]   - Checking server logs for errors');
            console.error('[response-pipeline]   - Verifying network connection');
            console.error('[response-pipeline]   - Using browser DevTools Network tab to see what\'s stuck');
          }
        }, 5000);

        let authCheck: Response;
        try {
          console.log('[response-pipeline] Calling apiFetch(/api/auth/me)...');
          const authStartTime = Date.now();
          authCheck = await apiFetch('/api/auth/me');
          const authDuration = Date.now() - authStartTime;
          console.log(`[response-pipeline] Auth check completed in ${authDuration}ms:`, authCheck.status, authCheck.ok);

          if (authDuration > 5000) {
            console.warn(`[response-pipeline] ⚠️  AUTH CHECK WAS SLOW (${authDuration}ms)`);
          }
        } finally {
          clearInterval(progressInterval);
        }

        if (!authCheck.ok) {
          thinkingTraceApi.appendTrace(`[${timestamp()}] ❌ SESSION EXPIRED`, 5);
          messagesApi.pushMessage('system', '⚠️ **Session Expired - Your Reply Was Not Sent**\n\nYour session has expired. Your message has been restored to the input field.\n\n💡 Please refresh the page, log in again, and resubmit your message.');
          restoreInputAndCleanup();
          return;
        }
        thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ Session valid`, 5);
      } catch (authError: any) {
        console.error('[response-pipeline] Auth check error:', authError);

        let errorTitle = '⚠️ Connection Error - Your Reply Was Not Sent';
        let errorMessage = 'Unable to connect to the server.';
        let suggestion = 'Your message has been restored to the input field. Please check your network connection and try again.';

        // Differentiate error types (NO timeout handling - just real errors)
        if (authError?.message?.includes('fetch failed') || authError?.message?.includes('ECONNREFUSED')) {
          errorTitle = '🔌 Server Unreachable - Your Reply Was Not Sent';
          errorMessage = 'Cannot connect to the MetaHuman server.';
          suggestion = 'Your message has been restored. Check that the dev server is running with `pnpm dev` in apps/site/.';
        } else if (authError?.status === 404) {
          errorTitle = '🔍 Endpoint Not Found - Your Reply Was Not Sent';
          errorMessage = `API endpoint returned 404: ${authError?.url || '/api/auth/me'}`;
          suggestion = 'Your message has been restored. This may be a build issue. Try rebuilding with `pnpm build` in apps/site/.';
        } else if (authError?.status >= 500) {
          errorTitle = '💥 Server Error - Your Reply Was Not Sent';
          errorMessage = `Server returned error ${authError?.status || 'unknown'}`;
          suggestion = 'Your message has been restored. Check the server logs for details.';
        } else if (authError?.status === 401 || authError?.status === 403) {
          errorTitle = '🔐 Auth Check Failed - Your Reply Was Not Sent';
          errorMessage = 'Unable to verify your session.';
          suggestion = 'Your message has been restored. Your session may have expired. Please refresh and log in again.';
        } else {
          // Unknown error - show actual message
          errorMessage = authError?.message || 'An unexpected error occurred during authentication.';
          suggestion = 'Your message has been restored to the input field. Please try again.';
        }

        // Add context about what was being replied to
        const contextInfo = cardData.desireTitle
          ? `\n\n**You were replying to**: ${cardData.desireTitle}`
          : cardData.questionId
            ? '\n\n**You were replying to a question**'
            : '';

        thinkingTraceApi.appendTrace(`[${timestamp()}] ❌ ${errorTitle}`, 5);
        messagesApi.pushMessage('system', `${errorTitle}\n\n${errorMessage}${contextInfo}\n\n💡 ${suggestion}`);
        restoreInputAndCleanup();
        return;
      }

      // Check 2: Backend readiness
      thinkingTraceApi.appendTrace(`[${timestamp()}] Checking backend...`, 5);
      if (!backendApi.isReady()) {
        const backend = get(activeBackend);
        const msg = backend === 'vllm'
          ? 'Cannot send response: vLLM server is not running. Please start vLLM from Settings → Backend.'
          : 'Cannot send response: Ollama is not running or no models are loaded. Please check Settings → Backend.';
        thinkingTraceApi.appendTrace(`[${timestamp()}] ❌ Backend not ready`, 5);
        messagesApi.pushMessage('system', `⚠️ **Backend Not Ready - Your Reply Was Not Sent**\n\n${msg}\n\nYour message has been restored to the input field.`);
        restoreInputAndCleanup();
        return;
      }
      thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ Backend ready`, 5);

      // Check 3: Connection health
      thinkingTraceApi.appendTrace(`[${timestamp()}] Checking server connection...`, 5);
      const healthResult = await forceHealthCheck();
      if (!healthResult.connected) {
        thinkingTraceApi.appendTrace(`[${timestamp()}] ❌ Server offline`, 5);
        messagesApi.pushMessage('system', '⚠️ **Server Offline - Your Reply Was Not Sent**\n\nThe server is not responding. Your message has been restored to the input field.\n\n💡 Please check if the server is running and try again.');
        restoreInputAndCleanup();
        return;
      }
      thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ Server connected`, 5);
      thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ Pre-flight checks passed`, 5);

      // Step 1: Prepare request
      console.log('[response-pipeline] Step 1: Preparing request', {
        cardType,
        desireId: cardData.desireId,
        hasBuffer: !!responseBufferId,
        messageLength: message.length,
      });
      thinkingTraceApi.setStatusLabel(`📝 Processing ${cardType} response...`);
      thinkingTraceApi.appendTrace(`[${timestamp()}] `, 5);
      thinkingTraceApi.appendTrace(`[${timestamp()}] Step 1: Preparing request...`, 10);

      const requestBody = buildResponsePipelineRequestBody(message, cardType, cardData, responseBufferId);

      // Step 2: Enqueue request (no automatic timeout - user has cancel button)
      console.log('[response-pipeline] Step 2: Queueing response pipeline task');
      thinkingTraceApi.appendTrace(`[${timestamp()}] Step 2: Queueing response...`, 10);
      thinkingTraceApi.appendTrace(`[${timestamp()}] ⏳ Waiting for queued response...`, 10);

      // Start heartbeat to show the system is alive
      heartbeatInterval = setInterval(() => {
        if (!connectionEstablished) return; // Don't show heartbeat until connection is established

        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        thinkingTraceApi.appendTrace(`[${timestamp()}] ⏱️  Still processing... (${elapsed}s elapsed)`, 5);
      }, 10000); // Every 10 seconds

      const task = await enqueueUserMessageTask({
        kind: 'response-pipeline',
        responsePipeline: requestBody,
      });

      const result: any = await new Promise((resolve, reject) => {
        const stream = apiEventSource(`/api/unified-queue/tasks/${encodeURIComponent(task.id)}/stream`);
        queuedChatStreams.set(task.id, stream);

        const cleanup = () => {
          stream.close();
          queuedChatStreams.delete(task.id);
          abortController.signal.removeEventListener('abort', onAbort);
        };

        const onAbort = () => {
          cleanup();
          const error = new Error('Request cancelled by user');
          error.name = 'AbortError';
          reject(error);
        };

        abortController.signal.addEventListener('abort', onAbort, { once: true });

        stream.onopen = () => {
          connectionEstablished = true;
          thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ Queue stream connected`, 10);
        };

        stream.onmessage = (event) => {
          try {
            const { type, data } = parseConversationStreamEvent(event.data);

            if (type === 'queued_task_started') {
              connectionEstablished = true;
              thinkingTraceApi.setStatusLabel(`📝 Processing ${cardType} response...`);
              thinkingTraceApi.appendTrace(`[${timestamp()}] Queued task started`, 10);
            } else if (type === 'queued') {
              const ahead = Math.max(0, Number(data.position || 1) - 1);
              thinkingTraceApi.setStatusLabel(`Queued behind ${ahead} task(s)`);
              thinkingTraceApi.appendTrace(`[${timestamp()}] Waiting in queue: position ${data.position || '?'}`, 5);
            } else if (type === 'progress') {
              connectionEstablished = true;
              if (data?.message) {
                thinkingTraceApi.appendTrace(`[${timestamp()}] ${data.message}`, 5);
              }
            } else if (type === 'answer') {
              cleanup();
              resolve({
                success: true,
                response: data.response,
                responseBufferId: data.responseBufferId,
                actionTaken: data.actionTaken,
                pipelineTriggered: data.pipelineTriggered,
                nextStatus: data.nextStatus,
                executionTimeMs: data.executionTime,
              });
            } else if (type === 'error') {
              cleanup();
              reject(new Error(data?.message || 'Response pipeline failed'));
            }
          } catch (streamError) {
            cleanup();
            reject(streamError);
          }
        };

        stream.onerror = () => {
          cleanup();
          reject(new Error('Queued response pipeline stream disconnected'));
        };
      });

      console.log('[response-pipeline] Step 3: Queued response received', {
        elapsed: Date.now() - startTime,
      });
      thinkingTraceApi.appendTrace(`[${timestamp()}] Step 3: Queued response received`, 10);

      const elapsed = Date.now() - startTime;
      console.log('[response-pipeline] Step 5: Processing result', {
        success: result.success,
        actionTaken: result.actionTaken,
        pipelineTriggered: result.pipelineTriggered,
        newBufferId: result.responseBufferId,
        executionTimeMs: result.executionTimeMs,
        totalElapsed: elapsed,
      });
      thinkingTraceApi.appendTrace(`[${timestamp()}] Step 5: Result received (${elapsed}ms total)`, 10);

      if (!result.success) {
        console.error('[response-pipeline] Pipeline returned error:', result.error);
        console.error('[response-pipeline] Error details:', {
          error: result.error,
          errorDetails: result.errorDetails,
          failedNode: result.failedNode,
          suggestion: result.suggestion,
        });

        // Build detailed error message
        let errorMessage = `⚠️ **Pipeline Error**\n\n${result.error}`;

        if (result.errorDetails) {
          errorMessage += `\n\n**Details**: ${result.errorDetails}`;
        }

        if (result.failedNode) {
          errorMessage += `\n\n**Failed at node**: ${result.failedNode}`;
        }

        if (result.suggestion) {
          errorMessage += `\n\n💡 **Suggestion**:\n${result.suggestion}`;
        }

        // Show in thinking trace
        thinkingTraceApi.appendTrace(`[${timestamp()}] ❌ ${result.error}`, 10);
        if (result.failedNode) {
          thinkingTraceApi.appendTrace(`[${timestamp()}] 🔍 Failed at: ${result.failedNode}`, 10);
        }

        // Show to user
        messagesApi.pushMessage('system', errorMessage);

        throw new Error(result.error || 'Pipeline execution failed');
      }

      // Add assistant response to UI with response pipeline metadata
      if (result.response) {
        messagesApi.pushMessage('assistant', result.response, undefined, {
          source: 'response_pipeline',
          cardType,
          desireId: cardData.desireId,
          responseBufferId: result.responseBufferId,
          actionTaken: result.actionTaken,
          pipelineTriggered: result.pipelineTriggered,
          dialogueSource: 'response-pipeline',
        });
        void speakAssistantResponse(result.response, 'response-pipeline');
      } else {
        console.warn('[response-pipeline] No response text in result');
        thinkingTraceApi.appendTrace(`[${timestamp()}] ⚠️ No response text returned`, 10);
      }

      // Update thinking trace with result
      thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ Action: ${result.actionTaken || 'completed'}`, 10);
      if (result.pipelineTriggered) {
        thinkingTraceApi.appendTrace(`[${timestamp()}] 🔄 Re-planning triggered`, 10);
      }
      if (result.nextStatus) {
        thinkingTraceApi.appendTrace(`[${timestamp()}] 📊 Status → ${result.nextStatus}`, 10);
      }
      thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ RESPONSE PIPELINE COMPLETE (${elapsed}ms)`, 10);

      // Clear curiosity awaiting state if this was a curiosity response
      if (cardType === 'curiosity_response' && cardData.questionId) {
        try {
          await apiFetch('/api/pause-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'clearCuriosity',
              reason: 'responded_via_pipeline',
            }),
          });
          console.log('[response-pipeline] Cleared curiosity awaiting state');
        } catch (e) {
          // Non-critical, continue
          console.warn('[response-pipeline] Failed to clear curiosity state:', e);
        }
      }

      thinkingTraceApi.stop();
    } catch (err) {
      const elapsed = Date.now() - startTime;

      if (err instanceof Error && err.name === 'AbortError') {
        thinkingTraceApi.appendTrace(`[${timestamp()}] ⏸️  Request cancelled by user`, 10);
        messagesApi.pushMessage('system', '⏸️ **Request Cancelled**\n\nYou cancelled the response pipeline request.');
        thinkingTraceApi.stop();
        return;
      }

      console.error('[response-pipeline] FATAL ERROR:', err);
      console.error('[response-pipeline] Error details:', {
        name: err instanceof Error ? err.name : 'unknown',
        message: err instanceof Error ? err.message : String(err),
        elapsed,
      });
      const errorMsg = err instanceof Error ? err.message : 'Response pipeline failed';
      thinkingTraceApi.appendTrace(`[${timestamp()}] ❌ ERROR: ${errorMsg}`, 10);
      thinkingTraceApi.appendTrace(`[${timestamp()}] ❌ PIPELINE FAILED after ${elapsed}ms`, 10);
      messagesApi.pushMessage('system', `⚠️ Response Pipeline Error: ${errorMsg}`);
      thinkingTraceApi.stop();
    } finally {
      // Clear heartbeat interval
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      // Clear abort controller
      responsePipelineAbortController = null;

      loading = false;
      restorePassiveChatStreams();
    }
  }

  async function sendMessage() {
    // No input - nothing to do
    if (!input.trim()) return;

    // Already processing a send - ignore
    if (sendInProgress) return;

    sendInProgress = true;

    // Health checks are ordinary fetches and need an available browser
    // connection. Free background SSE slots before consulting connectivity;
    // otherwise a saturated page can falsely route a healthy server to offline.
    pausePassiveChatStreams();
    const healthResult = await forceHealthCheck();
    const connected = healthResult.connected;

    // If offline, use UnifiedChat with tier selection
    if (!connected) {
      sendInProgress = false; // Reset guard before delegating
      await sendMessageOffline();
      return;
    }

    // Check LLM backend status before sending (only when online)
    if (!backendApi.isReady()) {
      sendInProgress = false; // Reset guard on early return
      restorePassiveChatStreams();
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
    const replyToCardType = replyToMetadata.cardType;
    const replyToDialogueSource = replyToMetadata.dialogueSource;
    const isAgencyCardReply = replyToMetadata.isAgencyMessage;
    const existingResponseBufferId = replyToMetadata.responseBufferId;

    // Clear selection after capturing metadata
    const wasReplying = $selectedMessage !== null;
    messagesApi.clearSelection();

    // Route ALL selected card responses through the dedicated response pipeline
    // This provides focused context and routes through Big Brother for tool execution
    // The response pipeline handles ANY card type - not just agency cards
    if (wasReplying && replyToContent) {
      sendInProgress = false; // Reset guard before delegating

      // Determine the card type for context - use the card's type or derive from role/source
      let effectiveCardType = replyToCardType || 'selected_card';
      if (!effectiveCardType || effectiveCardType === 'selected_card') {
        // Try to determine a more specific type from available metadata
        if (isAgencyCardReply || replyToDialogueSource === 'agency-system') {
          effectiveCardType = replyToDesireId ? 'desire_awaiting_input' : 'agency_notification';
        } else if (replyToQuestionId) {
          effectiveCardType = 'curiosity_response';
        }
      }

      console.log(`[sendMessage] Routing to response pipeline: type=${effectiveCardType}, hasDesire=${!!replyToDesireId}`);

      await sendResponsePipeline(userMessage, effectiveCardType, {
        desireId: replyToDesireId,
        desireTitle: replyToDesireTitle,
        content: replyToContent,
        dialogueSource: replyToDialogueSource,
        questionId: replyToQuestionId,
        ...replyToMetadata.meta,
      }, existingResponseBufferId);
      return;
    }

    if (loading) {
      try {
        const llm_opts = readLlmOptions();
        const params = buildConversationParams({
          message: userMessage,
          mode,
          sessionId: $conversationSessionId,
          reasoningDepth,
          yoloMode,
          llmOptions: llm_opts,
          replyTo: {
            questionId: replyToQuestionId || undefined,
            content: replyToContent || undefined,
            desireId: replyToDesireId || undefined,
            desireTitle: replyToDesireTitle || undefined,
          },
        });
        const task = await enqueueUserMessageTask({
          kind: 'persona-chat',
          personaChat: Object.fromEntries(params.entries()),
        });
        openQueuedBackgroundStream(task.id, userMessage, mode);
      } catch (err) {
        input = userMessage;
        messagesApi.pushMessage('system', `Error: ${(err as Error).message || 'Could not queue message.'}`);
      } finally {
        sendInProgress = false;
      }
      return;
    }

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

      const llm_opts = readLlmOptions();
      console.log('[sendMessage] Step 3: Got llm_opts');

      const params = buildConversationParams({
        message: userMessage,
        mode,
        sessionId: $conversationSessionId,
        reasoningDepth,
        yoloMode,
        llmOptions: llm_opts,
        replyTo: {
          questionId: replyToQuestionId || undefined,
          content: replyToContent || undefined,
          desireId: replyToDesireId || undefined,
          desireTitle: replyToDesireTitle || undefined,
        },
      });
      console.log('[sendMessage] Step 4: Created URLSearchParams');
      thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ Request params built`, 15);
      // audience removed - focus selector obsolete with ReAct operator

      // Add replyTo metadata if replying to any message (curiosity, desire, or regular)
      if (replyToQuestionId) {
        console.log('[reply-to] Replying to curiosity question:', replyToQuestionId);
      }
      if (replyToDesireId) {
        console.log('[reply-to] Replying to desire/goal:', replyToDesireId, replyToDesireTitle);
      }
      if (replyToContent) {
        console.log('[reply-to] Replying to message:', replyToContent.substring(0, 100));
      }

      console.log('[sendMessage] Step 5: Queueing chat request');
      thinkingTraceApi.appendTrace(`[${timestamp()}] 🌐 Queueing message`, 15);

      // This is idempotent: the pool was suspended before the health check and
      // remains suspended through auth, enqueue, and foreground stream setup.
      pausePassiveChatStreams();

      // PRE-FLIGHT AUTH CHECK: Verify session is valid before opening EventSource
      // This prevents silent hangs when session cookie is stale/mismatched
      // NO TIMEOUT - User has cancel button, let the server take as long as it needs
      try {
        console.log('[sendMessage] Starting auth check...');
        thinkingTraceApi.appendTrace(`[${timestamp()}] 🔐 Verifying session...`, 15);

        // Progress notifications (same as response pipeline)
        let notificationShown = false;
        const authProgressInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - msgStartTime) / 1000);
          console.log(`[sendMessage] ⏳ Still waiting for auth check... (${elapsed}s)`);
          thinkingTraceApi.appendTrace(`[${timestamp()}] ⏳ Still checking session... (${elapsed}s)`, 10);

          if (elapsed >= 10 && !notificationShown) {
            notificationShown = true;
            console.warn('[sendMessage] ⚠️  AUTH CHECK TAKING LONGER THAN EXPECTED (>10s)');
            const msg = {
              id: crypto.randomUUID(),
              role: 'system' as const,
              content: '⏳ **Session Check Slow**\n\nVerifying your session is taking longer than expected (>10s). Still trying...',
              timestamp: Date.now(),
            };
            messages.update(m => [...m, msg]);
          }

          if (elapsed >= 30) {
            console.error('[sendMessage] ⚠️  AUTH CHECK EXTREMELY SLOW (>30s)');
          }
        }, 5000);

        let authCheck: Response;
        try {
          const authStartTime = Date.now();
          authCheck = await apiFetch('/api/auth/me');
          const authDuration = Date.now() - authStartTime;
          console.log(`[sendMessage] Auth check completed in ${authDuration}ms:`, authCheck.status);

          if (authDuration > 5000) {
            console.warn(`[sendMessage] ⚠️  AUTH CHECK WAS SLOW (${authDuration}ms)`);
          }
        } finally {
          clearInterval(authProgressInterval);
        }

        if (!authCheck.ok) {
          const errorData = await authCheck.json().catch(() => ({}));
          console.error('[sendMessage] Auth check failed:', authCheck.status, errorData);
          thinkingTraceApi.appendTrace(`[${timestamp()}] ❌ SESSION EXPIRED - Please refresh and log in again`, 15);
          thinkingTraceApi.setStatusLabel('🔒 Session Expired');
          loading = false;
          // Show error to user
          const errorMsg = {
            id: crypto.randomUUID(),
            role: 'system' as const,
            content: '⚠️ **Session Expired**\n\nYour session has expired or is invalid. Please refresh the page and log in again.',
            timestamp: Date.now(),
          };
          messages.update(m => [...m, errorMsg]);
          return;
        }
        console.log('[sendMessage] Auth check passed');
        thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ Session verified`, 15);
      } catch (authError: any) {
        // Differentiate error types for better logging and debugging
        let errorType = 'Unknown Error';
        let shouldContinue = false;

        if (authError?.message?.includes('fetch failed') || authError?.message?.includes('ECONNREFUSED')) {
          errorType = 'Server Unreachable';
          shouldContinue = false;
          console.error('[sendMessage] Server unreachable:', authError);
          thinkingTraceApi.appendTrace(`[${timestamp()}] 🔌 Server unreachable (will likely fail)`, 15);
        } else if (authError?.status === 404) {
          errorType = 'Endpoint Not Found (404)';
          shouldContinue = false;
          console.error('[sendMessage] Auth endpoint not found:', authError);
          thinkingTraceApi.appendTrace(`[${timestamp()}] 🔍 Auth endpoint not found (build issue?)`, 15);
        } else if (authError?.status >= 500) {
          errorType = `Server Error (${authError?.status})`;
          shouldContinue = false;
          console.error('[sendMessage] Server error during auth check:', authError);
          thinkingTraceApi.appendTrace(`[${timestamp()}] 💥 Server error ${authError?.status}`, 15);
        } else if (authError?.status === 401 || authError?.status === 403) {
          errorType = 'Session Invalid';
          shouldContinue = false;
          console.error('[sendMessage] Session invalid:', authError);
          thinkingTraceApi.appendTrace(`[${timestamp()}] 🔐 Session invalid (please refresh)`, 15);
        } else {
          errorType = authError?.message || 'Unexpected error';
          shouldContinue = true; // Try anyway for unknown errors
          console.error('[sendMessage] Auth check error:', authError);
          thinkingTraceApi.appendTrace(`[${timestamp()}] ⚠️ Could not verify session (${errorType})`, 15);
        }

        // Continue anyway - might work, might not
        // (EventSource will fail with better error if server is truly down)
      }

      // Use EventSource for SSE streaming (works for both web and React Native WebView)
      // CRITICAL: Close any existing EventSource before creating a new one
      if (chatResponseStream) {
        console.log('[sendMessage] Closing existing EventSource...');
        chatResponseStream.close();
        chatResponseStream = null;
      }

      const task = await enqueueUserMessageTask({
        kind: 'persona-chat',
        personaChat: Object.fromEntries(params.entries()),
      });
      activeChatTaskId = task.id;
      chatResponseStream = apiEventSource(`/api/unified-queue/tasks/${encodeURIComponent(task.id)}/stream`);
      console.log('[sendMessage] Step 6: EventSource created!');
      thinkingTraceApi.appendTrace(`[${timestamp()}] 🔌 EventSource created, waiting for server...`, 15);
      thinkingTraceApi.setStatusLabel('🔌 Connecting...');

      // Track connection time for user visibility
      const connectStart = Date.now();
      let connectionTimer: ReturnType<typeof setInterval> | null = null;
      let connectionFallbackTimer: ReturnType<typeof setTimeout> | null = null;
      let connectionEstablished = false;

      const clearConnectionTracking = () => {
        if (connectionTimer) {
          clearInterval(connectionTimer);
          connectionTimer = null;
        }
        if (connectionFallbackTimer) {
          clearTimeout(connectionFallbackTimer);
          connectionFallbackTimer = null;
        }
      };

      // If the browser cannot acquire an SSE connection promptly, stop waiting
      // on that transport and follow the server-owned task by status instead.
      // The task continues independently, so this cannot duplicate the message.
      connectionFallbackTimer = setTimeout(() => {
        if (!connectionEstablished && activeChatTaskId === task.id) {
          console.warn('[EventSource] Live stream delayed; switching to task reconciliation');
          chatResponseStream?.close();
          chatResponseStream = null;
          clearConnectionTracking();
          thinkingTraceApi.appendTrace(`[${timestamp()}] Live response delayed; following accepted task ${task.id}`, 15);
          thinkingTraceApi.setStatusLabel('🔄 Following accepted message...');
          void reconcileQueuedChatTask(task.id);
        }
      }, 8000);

      // Start timer to show elapsed time WITH timestamps
      connectionTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - connectStart) / 1000);
        const totalElapsed = Math.floor((Date.now() - msgStartTime) / 1000);
        thinkingTraceApi.appendTrace(`[${timestamp()}] ⏱️ Waiting for server response... (${elapsed}s)`, 15);
      }, 2000);

      chatResponseStream.onopen = () => {
        connectionEstablished = true;
        if (connectionFallbackTimer) {
          clearTimeout(connectionFallbackTimer);
          connectionFallbackTimer = null;
        }
        console.log('[EventSource] Connection opened!');
        if (connectionTimer) clearInterval(connectionTimer);
        const elapsed = Math.floor((Date.now() - connectStart) / 1000);
        thinkingTraceApi.appendTrace(`[${timestamp()}] ✅ CONNECTION OPENED (${elapsed}s)`, 15);
        thinkingTraceApi.setStatusLabel('⚡ Connected - Executing graph...');
      };

      chatResponseStream.onmessage = (event) => {
        connectionEstablished = true;
        if (connectionFallbackTimer) {
          clearTimeout(connectionFallbackTimer);
          connectionFallbackTimer = null;
        }
        if (connectionTimer) clearInterval(connectionTimer);
        console.log('[EventSource] onmessage fired, raw event.data:', event.data.substring(0, 200));
        thinkingTraceApi.appendTrace(`[${timestamp()}] 📥 Received server event`, 15);
        try {
          const { type, data } = parseConversationStreamEvent(event.data);
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
            clearConnectionTracking();
            activeChatTaskId = null;
            thinkingTraceApi.stop();
            messagesApi.pushMessage('system', data.message || '⏸️ Request cancelled');
            loading = false;
            reasoningStages = [];
            chatResponseStream?.close();
            chatResponseStream = null;
            restorePassiveChatStreams();
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
            clearConnectionTracking();
            activeChatTaskId = null;
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
            const answerSpeechText = data?.tts?.text || data.response;
            const answerSpeechSource = data?.tts?.itemId
              ? `conversation-answer:${data.tts.itemId}`
              : 'conversation-answer';
            void speakAssistantResponse(answerSpeechText, answerSpeechSource);

            loading = false;
            chatResponseStream?.close();
            chatResponseStream = null;
            restorePassiveChatStreams();
          } else if (type === 'system_message') {
            // System status message (e.g., summarization progress)
            if (data.content) {
              messagesApi.pushMessage('system', data.content);
            }
          } else if (type === 'error') {
            clearConnectionTracking();
            activeChatTaskId = null;
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
            chatResponseStream = null;
            restorePassiveChatStreams();
            return; // Don't throw, we handled it
          }
          // Note: Big Brother output is streamed to System Terminal's Big Brother tab via WebSocket
        } catch (err) {
          console.error('Chat stream error:', err);
          clearConnectionTracking();
          activeChatTaskId = null;
          messagesApi.pushMessage('system', `Error: ${(err as Error).message || 'Failed to process server response.'}`);
          thinkingTraceApi.stop();
          loading = false;
          reasoningStages = [];
          chatResponseStream?.close();
          chatResponseStream = null;
          restorePassiveChatStreams();
        }
      };

      chatResponseStream.onerror = async (err) => {
        if (activeChatTaskId !== task.id) return;
        console.error('[EventSource] onerror fired! Error:', err);
        console.error('[EventSource] ReadyState:', chatResponseStream?.readyState);
        clearConnectionTracking();
        chatResponseStream?.close();
        chatResponseStream = null;

        // Force a health check to get accurate connection status
        const healthResult = await forceHealthCheck();

        // Once the server has accepted the queued message, never resubmit it
        // through another tier: that can create a duplicate answer. Reconcile
        // the accepted task when possible and let buffers resync after restart.
        if (!healthResult.connected) {
          console.log('[EventSource] Server went offline after accepting queued message');
          activeChatTaskId = null;
          thinkingTraceApi.stop();
          loading = false;
          reasoningStages = [];
          messagesApi.pushMessage('system', 'The server accepted your message, but the live connection was lost. Its saved result will appear when the server reconnects.');
          restorePassiveChatStreams();
          return;
        }

        thinkingTraceApi.setActive(true);
        thinkingTraceApi.setStatusLabel('🔄 Reconnecting to accepted message...');
        thinkingTraceApi.appendTrace('Live response stream disconnected; the server task is still running.', 15);
        void reconcileQueuedChatTask(task.id);
      };

    } catch (err) {
      console.error('Chat setup error:', err);
      if (activeChatTaskId) {
        thinkingTraceApi.setActive(true);
        thinkingTraceApi.setStatusLabel('🔄 Following accepted message...');
        thinkingTraceApi.appendTrace('The live response could not open; checking the accepted server task.', 15);
        void reconcileQueuedChatTask(activeChatTaskId);
        sendInProgress = false;
        return;
      }
      messagesApi.pushMessage('system', 'Error: Could not send message.');
      thinkingTraceApi.stop();
      loading = false;
      sendInProgress = false; // Safety net: ensure guard is reset on error
      reasoningStages = [];
      restorePassiveChatStreams();
    }
  }

  /**
   * Stop/cancel the current request
   * Aborts both client-side fetch and notifies server
   */
  async function stopRequest() {
    if (!loading) return;

    console.log('[stop-request] Stopping request...');

    // 1. Abort client-side fetch immediately
    if (responsePipelineAbortController) {
      console.log('[stop-request] Aborting client-side fetch');
      responsePipelineAbortController.abort();
      responsePipelineAbortController = null;
    }

    // 2. Notify server to stop processing (if session exists)
    if ($conversationSessionId) {
      try {
        console.log('[stop-request] Requesting server-side cancellation for session:', $conversationSessionId);
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
          console.log('[stop-request] Server-side cancellation requested successfully');
        }
      } catch (error) {
        console.error('[stop-request] Error requesting server-side cancellation:', error);
      }
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
  let conversationHandle: ConnectionHandle | null = null;
  let conversationStream: EventSource | null = null;
  let systemHandle: ConnectionHandle | null = null;
  let systemStream: EventSource | null = null;

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
    // Close existing connection handles (pool will close underlying EventSource)
    if (innerDialogueHandle) {
      innerDialogueHandle.close();
      innerDialogueHandle = null;
      innerDialogueStream = null;
    }
    if (conversationHandle) {
      conversationHandle.close();
      conversationHandle = null;
      conversationStream = null;
    }
    if (systemHandle) {
      systemHandle.close();
      systemHandle = null;
      systemStream = null;
    }

    // Connect to streams for each selected view (1:1 mapping)
    // System stream only connected when system tab is selected
    if (selectedViews.has('conversation')) {
      connectBufferStreamForMode(
        'conversation',
        (stream) => { conversationStream = stream; },
        (handle) => { conversationHandle = handle; }
      );
    }
    if (selectedViews.has('inner')) {
      connectBufferStreamForMode(
        'inner',
        (stream) => { innerDialogueStream = stream; },
        (handle) => { innerDialogueHandle = handle; }
      );
    }
    if (selectedViews.has('system')) {
      connectBufferStreamForMode(
        'system',
        (stream) => { systemStream = stream; },
        (handle) => { systemHandle = handle; }
      );
    }
  }

  /**
   * Connect to a single buffer stream with proper merge handling
   * Now uses connection pool for priority-based allocation
   */
  function connectBufferStreamForMode(
    streamMode: 'conversation' | 'inner' | 'system',
    setStream: (stream: EventSource | null) => void,
    setHandle: (handle: ConnectionHandle | null) => void
  ) {
    console.log(`[chat] Requesting ${streamMode} buffer stream from connection pool...`);

    const handle = connectionPool.request({
      id: `buffer-${streamMode}`,
      name: `Buffer Stream (${streamMode})`,
      url: `/api/buffer-stream?mode=${streamMode}`,
      priority: ConnectionPriority.HIGH,
      viewDependency: 'chat',
      defer: false,
      onOpen: (source) => {
        console.log(`[chat] ${streamMode} buffer stream opened via pool`);
        setStream(source);
        const currentCount = get(messages).length;
        if (streamMode === 'inner') {
          lastInnerMessageCount = currentCount;
        } else {
          lastConversationMessageCount = currentCount;
        }
      },
      onClose: () => {
        console.log(`[chat] ${streamMode} buffer stream closed via pool`);
        setStream(null);
      },
      onMessage: (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') {
            console.log(`[chat] ${streamMode} buffer stream connected`);
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
            if (streamMode !== 'conversation' && data.messages.length > 0) {
              console.log(`[chat] ${streamMode} buffer: ${data.messages.length} messages from SSE`);
              messages.update(msgs => {
                const existingContent = new Set(msgs.map(m => `${m.role}-${m.content}`));
                const newMsgs = data.messages.filter((m: any) => !existingContent.has(`${m.role}-${m.content}`));
                if (newMsgs.length > 0) {
                  return [...msgs, ...newMsgs].sort((a, b) => a.timestamp - b.timestamp);
                }
                return msgs;
              });
            }
          }
        } catch (err) {
          console.error(`[chat] ${streamMode} buffer stream parse error:`, err);
        }
      },
      onError: (err) => {
        console.error(`[chat] ${streamMode} buffer stream error:`, err);
        setTimeout(() => {
          const isSelected = selectedViews.has(streamMode);
          if (isComponentMounted && !document.hidden && isSelected) {
            connectBufferStreamForMode(streamMode, setStream, setHandle);
          }
        }, 3000);
      },
    });

    setHandle(handle);
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

  async function cycleActiveOperatorMode() {
    if (activeOperatorLoading) return;
    const nextMode = nextAutonomyMode(autonomyMode);
    if (nextMode === 'full' && !confirm('Enable fully autonomous mode? Configured triggers and the bounded Active Operator policy may propose work.')) return;
    activeOperatorLoading = true;
    try {
      await setActiveOperatorMode(nextMode);
      autonomyMode = nextMode;
      console.log('[active-operator] Mode changed to:', nextMode);
    } catch (error) {
      console.error('[active-operator] Error changing mode:', error);
    } finally {
      activeOperatorLoading = false;
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
      class="active-operator-toggle {activeOperatorMode.buttonClass}"
      class:loading={activeOperatorLoading}
      title={`${activeOperatorMode.label}: ${activeOperatorMode.description} Click to advance mode.`}
      aria-label={`Active Operator ${activeOperatorMode.label}. ${activeOperatorMode.description}`}
      on:click={cycleActiveOperatorMode}
      disabled={activeOperatorLoading}
    >
      <span class="active-operator-icon">⚡</span>
      <span class="active-operator-badge">{activeOperatorMode.badge}</span>
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
                void ttsApi.speak(e.detail.content);
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

  <!-- Operator proposals are displayed inline by OperatorProposalCard. -->

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
        if ($micIsRecording) {
          mic.stopMic();
        } else {
          enableAssistantSpeech('mic-click');
          messagesApi.pushMessage('system', '🎤 Starting microphone...');
          mic.startMic();
        }
      }}
      on:micLongPress={() => {
        // Long-press: toggle conversation mode on ALL devices
        console.log('[chat-mic] Long press detected, toggling conversation mode');
        if (!$micIsConversationMode) {
          enableAssistantSpeech('mic-long-press');
          messagesApi.pushMessage('system', '🎤 Conversation listening mode enabled. Speak when ready.');
        }
        mic.toggleConversationMode();
      }}
      on:micContextMenu={() => {
        // Right-click: toggle conversation mode on ALL devices
        console.log('[chat-mic] Right-click detected, toggling conversation mode');
        if (!$micIsConversationMode) {
          enableAssistantSpeech('mic-context-menu');
          messagesApi.pushMessage('system', '🎤 Conversation listening mode enabled. Speak when ready.');
        }
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
          enableAssistantSpeech('tap-to-interrupt');
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
