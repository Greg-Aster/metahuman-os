<script lang="ts">
  import { onMount, afterUpdate, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import Thinking from './Thinking.svelte';
  import ApprovalBox from './ApprovalBox.svelte';
  import InputArea from './chat/InputArea.svelte';
  import MessageList from './chat/MessageList.svelte';
  import { canUseOperator, currentMode } from '../stores/security-policy';
  import { triggerClearAuditStream } from '../stores/clear-events';
  import { yoloModeStore } from '../stores/navigation';
  import { calculateVoiceVolume } from '../lib/audio-utils.js';
  import { useTTS } from '../lib/useTTS';
  import { useMicrophone } from '../lib/useMicrophone';
  import { useThinkingTrace } from '../lib/useThinkingTrace';
  import { useMessages, useActivityTracking, useOllamaStatus, type ChatMessage, type MessageRole, type ReasoningStage } from '../lib/useMessages';

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
  let mode: 'conversation' | 'inner' = 'conversation';
  let lengthMode: 'auto' | 'concise' | 'detailed' = 'auto';
  let messagesContainer: HTMLDivElement;
  let shouldAutoScroll = true;
  let reflectionStream: EventSource | null = null;
  // Convenience toggles
  let ttsEnabled = false;
  let boredomTtsEnabled = false; // For inner dialog voice
  // Curiosity questions
  let curiosityQuestions: any[] = [];
  let lastQuestionCheck = 0;
  let yoloMode = false;

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

  // Initialize Ollama Status
  const ollamaApi = useOllamaStatus();
  const {
    running: ollamaRunning,
    hasModels: ollamaHasModels,
    modelCount: ollamaModelCount,
    error: ollamaError
  } = ollamaApi;

  // Initialize Microphone composable
  const mic = useMicrophone({
    getTTSPlaying: () => get(ttsIsPlaying),
    onTranscript: (transcript: string) => {
      // Auto-send in continuous mode
      if (get(mic.isContinuousMode)) {
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
        // Normal mode: put transcript in input field for user to review/edit
        console.log('[chat-mic] Transcribed:', transcript.substring(0, 50) + (transcript.length > 50 ? '...' : ''));
        input = transcript;
      }
    },
    onSystemMessage: (message: string) => {
      // Show friendly message to user (add to messages as system message)
      messagesApi.pushMessage('system', message);
    },
    isComponentMounted: () => isComponentMounted,
  });
  const { isRecording: micIsRecording, isContinuousMode: micIsContinuousMode, queuedMessage: micQueuedMessage } = mic;

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
      if (!raw) { ttsEnabled = ttsApi.isMobileDevice(); return; }
      const p = JSON.parse(raw);
      if (typeof p.ttsEnabled === 'boolean') ttsEnabled = p.ttsEnabled;
      if (typeof p.reasoningDepth === 'number') {
        reasoningDepth = clampReasoningDepth(p.reasoningDepth);
      } else if (typeof p.reasoningEnabled === 'boolean') {
        reasoningDepth = p.reasoningEnabled ? 2 : 0;
      }
      if (typeof p.boredomTtsEnabled === 'boolean') boredomTtsEnabled = p.boredomTtsEnabled;
      if (typeof p.bigBrotherEnabled === 'boolean') bigBrotherEnabled = p.bigBrotherEnabled;
    } catch {}
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

  // Server-first conversation buffer management


  onMount(async () => {
    loadChatPrefs();
    mic.loadVADSettings(); // Load VAD settings from voice config
    if (ttsEnabled) {
      ttsApi.prefetchVoiceResources();
    }

    // Load Big Brother configuration from server
    try {
      const res = await fetch('/api/big-brother-config');
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

    // Check Ollama health status
    ollamaApi.checkStatus();

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

    // Load messages from server (server-first architecture)
    const serverMessages = await messagesApi.loadMessagesFromServer();
    if (serverMessages && serverMessages.length > 0) {
      messages.set(serverMessages);
      console.log(`[ChatInterface] Hydrated ${serverMessages.length} messages from server`);
    }

    scrollObserver = new IntersectionObserver(
      (entries) => {
        shouldAutoScroll = entries[0].isIntersecting;
      },
      { threshold: 0.1 }
    );

    if (scrollSentinel) {
      scrollObserver.observe(scrollSentinel);
    }

    // Connect to reflection stream (close existing connection first to prevent duplicates)
    if (reflectionStream) {
      reflectionStream.close();
      reflectionStream = null;
    }
    reflectionStream = new EventSource('/api/reflections/stream');

    reflectionStream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle reflections
        if (data.type === 'reflection' && data.reflection) {
          const reflectionTimestamp = new Date(data.timestamp).getTime();

          // Check for duplicates based on content and timestamp
          const isDuplicate = messages.some(msg =>
            msg.role === 'reflection' &&
            msg.content === data.reflection &&
            Math.abs(msg.timestamp - reflectionTimestamp) < 1000 // Within 1 second
          );

          if (!isDuplicate) {
            messagesApi.pushMessage('reflection', data.reflection);

            // Add voice support for inner dialog if enabled
            if (boredomTtsEnabled && mode === 'inner' && data.reflection) {
              void ttsApi.speakText(data.reflection);
            }
          } else {
            console.log('[reflection] Ignoring duplicate reflection');
          }
        }

        // Handle dreams
        if (data.type === 'dream' && data.dream) {
          const dreamTimestamp = new Date(data.timestamp).getTime();

          // Check for duplicates based on content and timestamp
          const isDuplicate = $messages.some(msg =>
            msg.role === 'dream' &&
            msg.content === data.dream &&
            Math.abs(msg.timestamp - dreamTimestamp) < 1000 // Within 1 second
          );

          if (!isDuplicate) {
            messagesApi.pushMessage('dream', data.dream);

            // Add voice support for dreams if enabled
            if (boredomTtsEnabled && mode === 'inner' && data.dream) {
              void ttsApi.speakText(data.dream);
            }
          } else {
            console.log('[dream] Ignoring duplicate dream');
          }
        }

        // Handle curiosity questions (only in conversation mode)
        if (data.type === 'curiosity' && data.question && mode === 'conversation') {
          console.log('[curiosity] Received new question via SSE:', data.questionId);

          // Check for duplicates - prevent same question ID from being added multiple times
          const isDuplicate = $messages.some(msg =>
            msg.meta?.curiosityQuestionId === data.questionId
          );

          if (isDuplicate) {
            console.log('[curiosity] Ignoring duplicate question:', data.questionId);
            return;
          }

          const newMessage = {
            role: 'assistant' as MessageRole,
            content: data.question,
            timestamp: new Date(data.timestamp).getTime(),
            meta: {
              curiosityQuestionId: data.questionId,
              isCuriosityQuestion: true
            }
          };

          messagesApi.pushMessage('assistant', data.question, undefined, {
            curiosityQuestionId: data.questionId,
            isCuriosityQuestion: true
          });

          // Auto-select the new question for easy reply
          messagesApi.selectMessage(newMessage, $messages.length);
          console.log('[curiosity] Auto-selected new question');

          // Trigger TTS if enabled
          if (ttsEnabled && data.question) {
            console.log('[curiosity] Speaking question via TTS');
            void ttsApi.speakText(data.question);
          }
        }
      } catch (e) {
        console.error('Failed to parse reflection/dream/curiosity event:', e);
      }
    };

    reflectionStream.onerror = () => {
      console.log('Reflection stream disconnected, will auto-reconnect');
    };

    // Curiosity questions now come through normal conversation stream
    // They're saved as conversation events by curiosity-service agent
    // and loaded via /api/chat/history just like regular messages

    // Listen for voice settings changes (triggered when user updates VAD settings in UI)
    window.addEventListener('voice-settings-updated', handleVoiceSettingsUpdate);
  });

  // Event handler stored at module level for proper cleanup
  function handleVoiceSettingsUpdate() {
    console.log('[chat-mic] Voice settings updated, reloading...');
    mic.loadVADSettings();
  }



  onDestroy(() => {
    // Mark component as unmounted to stop animation loops
    isComponentMounted = false;

    reflectionStream?.close();
    chatResponseStream?.close(); // Fix memory leak: close chat stream
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
    mic.cleanup();
  });

  afterUpdate(() => {
    if (shouldAutoScroll && messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  });


  async function sendMessage() {
    if (!input.trim() || loading) return;

    // Check Ollama status before sending
    if (!ollamaApi.isReady()) {
      alert('Cannot send message: Ollama is not running or no models are loaded. Please start Ollama and load a model first.');
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

      console.log('[sendMessage] Step 5: About to create EventSource');
      console.log('[sendMessage] URL:', `/api/persona_chat?${params.toString()}`);

      // CRITICAL: Close any existing EventSource before creating a new one
      // Otherwise the browser reuses the old connection and doesn't send a new HTTP request
      if (chatResponseStream) {
        console.log('[sendMessage] Closing existing EventSource...');
        chatResponseStream.close();
        chatResponseStream = null;
      }

      // Use EventSource for streaming with a GET request
      // Force graph pipeline; some runtime toggles can disable it after settings load
      params.set('graph', 'true');
      chatResponseStream = new EventSource(`/api/persona_chat?${params.toString()}`);
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
            if (!data.duplicate) {
              messagesApi.pushMessage('assistant', data.response, data?.saved?.assistantRelPath, { facet: data.facet });
            }

            // Auto-TTS: Speak assistant responses when TTS toggle is enabled
            console.log('[chat-tts] Auto-TTS check - ttsEnabled:', ttsEnabled, 'hasResponse:', !!data.response, 'responseLength:', data.response?.length || 0);
            if (ttsEnabled && data.response) {
              console.log('[chat-tts] Auto-TTS FIRING - speaking response:', data.response.substring(0, 50));
              void ttsApi.speakText(data.response);
            } else {
              console.log('[chat-tts] Auto-TTS SKIPPED - enabled:', ttsEnabled, 'mode:', mode, 'hasResponse:', !!data.response);
            }

            loading = false;
            chatResponseStream?.close();
          } else if (type === 'system_message') {
            // System status message (e.g., summarization progress)
            if (data.content) {
              messagesApi.pushMessage('system', data.content);
            }
          } else if (type === 'error') {
            throw new Error(data.message);
          }
        } catch (err) {
          console.error('Chat stream error:', err);
          messagesApi.pushMessage('system', 'Error: Failed to process server response.');
          thinkingTraceApi.stop();
          loading = false;
          reasoningStages = [];
          chatResponseStream?.close();
        }
      };

      chatResponseStream.onerror = (err) => {
        console.error('[EventSource] onerror fired! Error:', err);
        console.error('[EventSource] ReadyState:', chatResponseStream?.readyState);
        messagesApi.pushMessage('system', 'Error: Connection to the server was lost.');
        thinkingTraceApi.stop();
        loading = false;
        reasoningStages = [];
        chatResponseStream?.close();
      };

    } catch (err) {
      console.error('Chat setup error:', err);
      messagesApi.pushMessage('system', 'Error: Could not send message.');
      thinkingTraceApi.stop();
      loading = false;
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

      const response = await fetch('/api/cancel-chat', {
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
      const res = await fetch('/api/claude-session');
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
      const res = await fetch('/api/claude-session', {
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
      await fetch('/api/claude-session', {
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
      const res = await fetch('/api/big-brother-config', {
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

    // CRITICAL: Clear server-side conversation buffer
    const serverCleared = await messagesApi.clearServerBuffer();
    if (serverCleared) {
      console.log('[ChatInterface] Server buffer cleared successfully');
    } else {
      console.warn('[ChatInterface] Failed to clear server buffer');
    }
  }

  function checkOllamaStatus() {
    ollamaApi.checkStatus();
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
        on:click={() => { mode = 'conversation'; messagesApi.loadHistoryForMode(); }}
        aria-label="Conversation mode"
      >
        <span class="mode-icon" aria-hidden="true">💬</span>
        <span class="mode-label">Conversation</span>
      </button>
      <button
        class={mode === 'inner' ? 'mode-btn active' : 'mode-btn'}
        on:click={() => { mode = 'inner'; messagesApi.loadHistoryForMode(); }}
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

    <!-- Reasoning Depth Slider -->
    <div class="reasoning-toggle">
      <div class="reasoning-slider-wrapper">
        <input
          id="reasoning-range"
          type="range"
          class="reasoning-slider-input"
          min="0"
          max={reasoningLabels.length - 1}
          step="1"
          value={reasoningDepth}
          on:input={handleReasoningInput}
          on:change={handleReasoningChange}
          title="Reasoning: {reasoningLabels[reasoningDepth]}"
          aria-label="Reasoning depth: {reasoningLabels[reasoningDepth]}"
        />
        <div class="reasoning-emoji" style="left: {(reasoningDepth / (reasoningLabels.length - 1)) * 100}%">
          🧠
        </div>
      </div>
    </div>

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

    <!-- Quick voice/tts controls -->
    <div class="quick-audio">
      <button
        class="icon-btn"
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
        {#if ttsEnabled}<span class="badge">On</span>{/if}
      </button>

      <!-- Inner dialog voice toggle (only visible in inner mode) -->
      {#if mode === 'inner'}
        <button
          class="icon-btn {boredomTtsEnabled ? 'active' : ''}"
          title={boredomTtsEnabled ? 'Disable inner dialog voice (boredom service)' : 'Enable inner dialog voice (boredom service)'}
          on:click={() => { boredomTtsEnabled = !boredomTtsEnabled; saveChatPrefs(); }}
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

  <!-- Ollama Status Warning Banner -->
  {#if !$ollamaRunning || !$ollamaHasModels}
    <div class="ollama-warning-banner">
      <div class="warning-icon">⚠️</div>
      <div class="warning-content">
        <div class="warning-title">
          {#if !$ollamaRunning}
            Ollama Service Not Running
          {:else}
            No Language Models Loaded
          {/if}
        </div>
        <div class="warning-message">
          {#if !$ollamaRunning}
            The Ollama service is not running. Please start it using: <code>systemctl start ollama</code>
          {:else if $ollamaModelCount === 0}
            No models are currently loaded. Please install a model using: <code>ollama pull phi3:mini</code>
          {/if}
          {#if $ollamaError}
            <div class="warning-error">Error: {$ollamaError}</div>
          {/if}
        </div>
        <button class="warning-refresh-btn" on:click={checkOllamaStatus}>
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
            ttsApi.speakText(e.detail.content);
          }
        }}
      />
      <div bind:this={scrollSentinel} class="scroll-sentinel"></div>
    {/if}
  </div>
  <!-- Input Area -->
  <div class="input-container">
    <!-- Code approval box appears here when there are pending approvals -->
    <ApprovalBox />

    <InputArea
      bind:input
      {loading}
      selectedMessage={$selectedMessage}
      isRecording={$micIsRecording}
      isContinuousMode={$micIsContinuousMode}
      ttsIsPlaying={$ttsIsPlaying}
      {lengthMode}
      on:send={sendMessage}
      on:stop={stopRequest}
      on:keypress={(e) => handleKeyPress(e.detail.event)}
      on:micClick={() => {
        if ($micIsContinuousMode) {
          mic.toggleContinuousMode();
        } else {
          $micIsRecording ? mic.stopMic() : mic.startMic();
        }
      }}
      on:micContextMenu={() => {
        if (!$micIsContinuousMode && !$micIsRecording) {
          mic.toggleContinuousMode();
        }
      }}
      on:ttsStop={() => {
        ttsApi.stopActiveAudio();
        ttsApi.cancelInFlightTts();
      }}
      on:clearSelection={() => messagesApi.clearSelection()}
      on:lengthModeChange={(e) => { lengthMode = e.detail.mode; }}
    />
  </div>
</div>
