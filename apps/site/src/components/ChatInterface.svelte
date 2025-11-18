<script lang="ts">
  import { onMount, afterUpdate, onDestroy } from 'svelte';
  import Thinking from './Thinking.svelte';
  import ApprovalBox from './ApprovalBox.svelte';
  import { canUseOperator, currentMode } from '../stores/security-policy';
  import { triggerClearAuditStream } from '../stores/clear-events';
  import { yoloModeStore } from '../stores/navigation';
  import { calculateVoiceVolume } from '../lib/audio-utils.js';

type MessageRole = 'user' | 'assistant' | 'system' | 'reflection' | 'dream' | 'reasoning';

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
  let mode: 'conversation' | 'inner' = 'conversation';
  let lengthMode: 'auto' | 'concise' | 'detailed' = 'auto';
  let messagesContainer: HTMLDivElement;
  let shouldAutoScroll = true;
  let reflectionStream: EventSource | null = null;
  // Session ID for conversation continuity
  let conversationSessionId: string = '';
  // Convenience toggles
  let ttsEnabled = false;
  // forceOperator removed - unified reasoning always uses operator for authenticated users
  // audience removed - focus selector obsolete with ReAct operator
  let boredomTtsEnabled = false; // For inner dialog voice
  let audioUnlocked = false;
  // Curiosity questions
  let curiosityQuestions: any[] = [];
  let lastQuestionCheck = 0;
  // Reply-to system
  let selectedMessage: ChatMessage | null = null;
  let selectedMessageIndex: number | null = null;
  let audioCtx: AudioContext | null = null;
  let currentAudio: HTMLAudioElement | null = null;
  let currentObjectUrl: string | null = null;
  let currentTtsAbort: AbortController | null = null;
  let ttsPlaybackToken = 0;
  let yoloMode = false;

  // Ollama health status
  let ollamaRunning = true;
  let ollamaHasModels = true;
  let ollamaModelCount = 0;
  let ollamaError: string | null = null;

  // Thinking trace sourced from live audit events
  const THINKING_TRACE_LIMIT = 40;
  let thinkingTrace: string[] = [];
  let thinkingStatusLabel = '🤔 Thinking…';
  let thinkingActive = false;
  let thinkingPlaceholderActive = false;
  let auditStream: EventSource | null = null;

  // Subscribe to shared YOLO mode store
  const unsubscribeYolo = yoloModeStore.subscribe(value => {
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

  interface AuditStreamEvent {
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'critical' | string;
    category: string;
    event: string;
    actor: string;
    details?: Record<string, any>;
  }

  function ensureAuditStream() {
    if (auditStream) return;
    auditStream = new EventSource('/api/stream');
    auditStream.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as AuditStreamEvent;
        handleAuditTrace(parsed);
      } catch (err) {
        console.warn('[chat] Failed to parse audit event', err);
      }
    };
    auditStream.onerror = (err) => {
      console.warn('[chat] Audit stream disconnected', err);
    };
  }

  function handleAuditTrace(event: AuditStreamEvent) {
    if (!thinkingActive) return;
    const sessionMatches =
      event.details?.sessionId === conversationSessionId ||
      event.details?.conversationId === conversationSessionId ||
      event.details?.taskId === conversationSessionId;
    if (!sessionMatches) return;

    const formatted = formatAuditTrace(event);
    const base = thinkingPlaceholderActive ? [] : thinkingTrace;
    thinkingPlaceholderActive = false;
    thinkingTrace = [...base, formatted].slice(-THINKING_TRACE_LIMIT);
  }

  function formatAuditTrace(event: AuditStreamEvent): string {
    const eventLabel = humanizeEventName(event.event);
    const detailsText = summarizeDetails(event.details);
    return detailsText ? `${eventLabel} ${detailsText}` : eventLabel;
  }

  function humanizeEventName(name: string): string {
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  function summarizeDetails(details: Record<string, any>): string {
    const preferredKeys = [
      'goal',
      'action',
      'skill',
      'iteration',
      'reason',
      'summary',
      'model',
      'modelId',
      'provider',
      'latencyMs',
      'tokens',
      'path',
      'inputs',
      'outputs',
      'message',
      'status',
    ];

    const lines: string[] = [];

    for (const key of preferredKeys) {
      if (!(key in details)) continue;
      const value = details[key];
      if (value == null) continue;
      if (typeof value === 'object') {
        const compact = JSON.stringify(value, null, 2);
        lines.push(`${key}: ${truncateText(compact)}`);
      } else {
        lines.push(`${key}: ${truncateText(String(value))}`);
      }
    }

    // Fallback: if nothing matched, stringify small scalar entries
    if (lines.length === 0) {
      const fallback = Object.entries(details)
        .filter(([, value]) => typeof value !== 'object' || value === null)
        .map(([key, value]) => `${key}: ${truncateText(String(value ?? ''))}`);
      lines.push(...fallback);
    }

    return lines.join(' · ');
  }

  function truncateText(value: string, limit = 320): string {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}…`;
  }

  function startThinkingTrace() {
    // Detect cognitive mode to show appropriate status
    const cogMode = $currentMode || 'dual';

    if (cogMode === 'emulation') {
      thinkingStatusLabel = '🤔 Processing...';
      thinkingTrace = ['Generating response...'];
    } else {
      thinkingStatusLabel = reasoningDepth > 0 ? '🧠 Operator planning…' : '🤔 Thinking…';
      thinkingTrace = ['Awaiting operator telemetry…'];
    }

    thinkingActive = true;
    thinkingPlaceholderActive = true;
    ensureAuditStream();
  }

  function stopThinkingTrace() {
    thinkingActive = false;
    thinkingPlaceholderActive = false;
    thinkingTrace = [];
  }

  let thinkingSteps = '';
  let showThinkingIndicator = false;
  $: thinkingSteps = thinkingTrace.join('\n\n');
  $: showThinkingIndicator = thinkingActive && reasoningStages.length === 0 && thinkingTrace.length > 0;

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

  const VOICE_MODELS_CACHE_TTL = 60_000;
  const VOICE_PROVIDER_CACHE_TTL = 30_000;
  let voiceModelsCache: { multiVoice: boolean; models?: string[] } | null = null;
  let voiceModelsCacheTime = 0;
  let voiceProviderCache: { provider?: string } | null = null;
  let voiceProviderCacheTime = 0;

  function prefetchVoiceResources(): void {
    Promise.all([fetchVoiceModels(), fetchVoiceProvider()]).catch(err => {
      console.warn('[chat-tts] Voice prefetch failed:', err);
    });
  }

  async function fetchVoiceModels(): Promise<{ multiVoice: boolean; models?: string[] }> {
    const now = Date.now();
    if (voiceModelsCache && now - voiceModelsCacheTime < VOICE_MODELS_CACHE_TTL) {
      return voiceModelsCache;
    }

    try {
      const voiceModelsRes = await fetch('/api/voice-models');
      if (voiceModelsRes.ok) {
        const voiceData = await voiceModelsRes.json();
        const result = {
          multiVoice: !!voiceData.multiVoice && Array.isArray(voiceData.models) && voiceData.models.length > 1,
          models: Array.isArray(voiceData.models) ? voiceData.models : undefined,
        };
        voiceModelsCache = result;
        voiceModelsCacheTime = now;
        return result;
      }
    } catch (error) {
      console.warn('[chat-tts] Failed to fetch voice models:', error);
    }

    return { multiVoice: false };
  }

  async function fetchVoiceProvider(): Promise<string | undefined> {
    const now = Date.now();
    if (voiceProviderCache && now - voiceProviderCacheTime < VOICE_PROVIDER_CACHE_TTL) {
      return voiceProviderCache.provider;
    }

    try {
      const settingsRes = await fetch('/api/voice-settings');
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        voiceProviderCache = { provider: settings.provider };
        voiceProviderCacheTime = now;
        return settings.provider;
      }
    } catch (error) {
      console.warn('[chat-tts] Failed to fetch voice provider:', error);
    }

    return undefined;
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
      // Fetch voice metadata for current session/profile
      console.log('[chat-tts] Fetching voice metadata...');
      const [{ multiVoice, models: voiceModels }, provider] = await Promise.all([
        fetchVoiceModels(),
        fetchVoiceProvider(),
      ]);
      if (multiVoice && voiceModels) {
        console.log(`[chat-tts] Multi-voice mode active with ${voiceModels.length} voices`);
      }

      console.log('[chat-tts] Fetching TTS from /api/tts...');

      const ttsBody: any = { text: speechText };

      // Include provider if available
      if (provider) {
        ttsBody.provider = provider;
      }

      // If multi-voice, use models array; otherwise use default single voice
      if (multiVoice && voiceModels) {
        ttsBody.models = voiceModels;
      }

      const ttsRes = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ttsBody),
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
      // yoloMode removed - now managed in LeftSidebar trust level
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
        // yoloMode removed - now managed in LeftSidebar trust level
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
  async function loadMessagesFromServer(): Promise<typeof messages | null> {
    try {
      const response = await fetch(`/api/conversation-buffer?mode=${mode}`);
      if (!response.ok) return null;

      const data = await response.json();
      if (Array.isArray(data.messages)) {
        const baseTimestamp = Date.now();
        let fallback = 0;
        const normalized = data.messages.map((msg: Record<string, any>) => {
          let ts: number | undefined;

          if (typeof msg.timestamp === 'number') {
            ts = msg.timestamp;
          } else if (typeof msg.timestamp === 'string') {
            const parsed = Date.parse(msg.timestamp);
            ts = Number.isNaN(parsed) ? undefined : parsed;
          }

          if (typeof ts !== 'number') {
            ts = baseTimestamp + fallback++;
          }

          return { ...msg, timestamp: ts };
        });

        console.log(`[ChatInterface] Loaded ${normalized.length} messages from server (mode: ${mode})`);
        return normalized;
      }
    } catch (error) {
      console.error('[ChatInterface] Failed to load messages from server:', error);
    }
    return null;
  }

  async function clearServerBuffer(): Promise<boolean> {
    try {
      const response = await fetch(`/api/conversation-buffer?mode=${mode}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        console.error('[ChatInterface] Failed to clear server buffer');
        return false;
      }

      console.log(`[ChatInterface] Cleared server buffer (mode: ${mode})`);
      return true;
    } catch (error) {
      console.error('[ChatInterface] Error clearing server buffer:', error);
      return false;
    }
  }

  async function checkOllamaStatus() {
    try {
      const response = await fetch('/api/boot');
      if (!response.ok) return;

      const data = await response.json();
      if (data.ollamaStatus) {
        ollamaRunning = data.ollamaStatus.running;
        ollamaHasModels = data.ollamaStatus.hasModels;
        ollamaModelCount = data.ollamaStatus.modelCount || 0;
        ollamaError = data.ollamaStatus.error || null;
      }
    } catch (e) {
      console.error('Failed to check Ollama status:', e);
    }
  }

  // Stub functions for legacy session management (no longer used - server-first architecture)
  function loadSessionFromStorage(): any {
    return null; // Messages now loaded from server
  }

  function saveSession(): void {
    // No-op: Messages are automatically saved to episodic memory by server
  }

  onMount(async () => {
    loadChatPrefs();
    loadVADSettings(); // Load VAD settings from voice config
    if (ttsEnabled) {
      prefetchVoiceResources();
    }

    // Check Ollama health status
    checkOllamaStatus();

    // Initialize or restore conversation session ID
    try {
      const storedSessionId = localStorage.getItem('mh_conversation_session_id');
      if (storedSessionId) {
        conversationSessionId = storedSessionId;
      } else {
        conversationSessionId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem('mh_conversation_session_id', conversationSessionId);
      }
    } catch (e) {
      // Fallback if localStorage unavailable
      conversationSessionId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    // Load messages from server (server-first architecture)
    const serverMessages = await loadMessagesFromServer();
    if (serverMessages && serverMessages.length > 0) {
      messages = serverMessages;
      console.log(`[ChatInterface] Hydrated ${messages.length} messages from server`);
    }

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

        // Handle reflections
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

        // Handle dreams
        if (data.type === 'dream' && data.dream) {
          messages = [
            ...messages,
            {
              role: 'dream',
              content: data.dream,
              timestamp: new Date(data.timestamp).getTime(),
            },
          ];

          // Add voice support for dreams if enabled
          if (boredomTtsEnabled && mode === 'inner' && data.dream) {
            void speakText(data.dream);
          }
        }

        // Handle curiosity questions (only in conversation mode)
        if (data.type === 'curiosity' && data.question && mode === 'conversation') {
          console.log('[curiosity] Received new question via SSE:', data.questionId);

          const newMessage = {
            role: 'assistant' as MessageRole,
            content: data.question,
            timestamp: new Date(data.timestamp).getTime(),
            meta: {
              curiosityQuestionId: data.questionId,
              isCuriosityQuestion: true
            }
          };

          messages = [...messages, newMessage];
          saveSession();

          // Auto-select the new question for easy reply
          selectedMessage = newMessage;
          selectedMessageIndex = messages.length - 1;
          console.log('[curiosity] Auto-selected new question');

          // Trigger TTS if enabled
          if (ttsEnabled && data.question) {
            console.log('[curiosity] Speaking question via TTS');
            void speakText(data.question);
          }
        }
      } catch (e) {
        console.error('Failed to parse reflection/dream/curiosity event:', e);
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

    // Curiosity questions now come through normal conversation stream
    // They're saved as conversation events by curiosity-service agent
    // and loaded via /api/chat/history just like regular messages

    // Listen for voice settings changes (triggered when user updates VAD settings in UI)
    const handleSettingsUpdate = () => {
      console.log('[chat-mic] Voice settings updated, reloading...');
      loadVADSettings();
    };
    window.addEventListener('voice-settings-updated', handleSettingsUpdate);

    return () => {
      observer.disconnect();
      window.removeEventListener('voice-settings-updated', handleSettingsUpdate);
    };
  });


  // Load chat history from episodic memory for the current mode
  async function loadHistoryForMode() {
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
    stopThinkingTrace();
    auditStream?.close();
    auditStream = null;
    if (audioCtx) {
      try { audioCtx.close(); } catch {}
      audioCtx = null;
    }
    unsubscribeYolo();
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

    const newMessage = { role, content: trimmed, timestamp: Date.now(), relPath, meta };
    messages = [...messages, newMessage];
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    // Check Ollama status before sending
    if (!ollamaRunning || !ollamaHasModels) {
      alert('Cannot send message: Ollama is not running or no models are loaded. Please start Ollama and load a model first.');
      return;
    }

    await ensureAudioUnlocked();
    if (ttsEnabled) {
      prefetchVoiceResources();
    }

    // Signal activity when sending a message
    signalActivity();

    const userMessage = input.trim();
    input = '';

    // Capture replyTo metadata if any message is selected
    const replyToQuestionId = selectedMessage?.meta?.curiosityQuestionId || null;
    const replyToContent = selectedMessage?.content || null;

    // Clear selection after capturing metadata
    const wasReplying = selectedMessage !== null;
    selectedMessage = null;
    selectedMessageIndex = null;

    pushMessage('user', userMessage);

    loading = true;
    reasoningStages = [];
    startThinkingTrace();

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
        sessionId: conversationSessionId,
        // forceOperator removed - no longer used
      });
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

      // Use EventSource for streaming with a GET request
      chatResponseStream = new EventSource(`/api/persona_chat?${params.toString()}`);

      chatResponseStream.onmessage = (event) => {
        try {
          const { type, data } = JSON.parse(event.data);

          if (type === 'reasoning') {
            stopThinkingTrace();
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
            stopThinkingTrace();
            if (reasoningStages.length > 0) {
              // Only persist reasoning to messages in inner dialogue mode
              // In conversation mode, reasoning is shown live then disappears
              if (mode === 'inner') {
                reasoningStages.forEach(stage => {
                  const label = `${formatReasoningLabel(stage)} · ${formatTime(stage.timestamp)}`;
                  pushMessage('reasoning', stage.content, undefined, { stage, label });
                });
              }
              reasoningStages = [];
            }
            if (!data.duplicate) {
              pushMessage('assistant', data.response, data?.saved?.assistantRelPath, { facet: data.facet });
            }
            saveSession();

            // Auto-TTS: Speak assistant responses when TTS toggle is enabled
            console.log('[chat-tts] Auto-TTS check - ttsEnabled:', ttsEnabled, 'hasResponse:', !!data.response, 'responseLength:', data.response?.length || 0);
            if (ttsEnabled && data.response) {
              console.log('[chat-tts] Auto-TTS FIRING - speaking response:', data.response.substring(0, 50));
              void speakText(data.response);
            } else {
              console.log('[chat-tts] Auto-TTS SKIPPED - enabled:', ttsEnabled, 'mode:', mode, 'hasResponse:', !!data.response);
            }

            loading = false;
            chatResponseStream?.close();
          } else if (type === 'error') {
            throw new Error(data.message);
          }
        } catch (err) {
          console.error('Chat stream error:', err);
          pushMessage('system', 'Error: Failed to process server response.');
          stopThinkingTrace();
          loading = false;
          reasoningStages = [];
          chatResponseStream?.close();
        }
      };

      chatResponseStream.onerror = (err) => {
        console.error('EventSource failed:', err);
        pushMessage('system', 'Error: Connection to the server was lost.');
        stopThinkingTrace();
        loading = false;
        reasoningStages = [];
        chatResponseStream?.close();
      };

    } catch (err) {
      console.error('Chat setup error:', err);
      pushMessage('system', 'Error: Could not send message.');
      stopThinkingTrace();
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
    stopThinkingTrace();

    // Generate new conversation session ID
    try {
      conversationSessionId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('mh_conversation_session_id', conversationSessionId);
    } catch (e) {
      conversationSessionId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
    const serverCleared = await clearServerBuffer();
    if (serverCleared) {
      console.log('[ChatInterface] Server buffer cleared successfully');
    } else {
      console.warn('[ChatInterface] Failed to clear server buffer');
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
  let micSpeaking = false; // VAD speaking state
  let micContinuousMode = false; // Continuous listening with auto-send
  let micSilenceTimerStarted = false; // Track if we've already logged silence timer start
  let queuedMessage = ''; // Message queued while LLM is busy (sends when LLM finishes)

  // VAD settings (loaded from user profile)
  let MIC_VOICE_THRESHOLD = 12; // Sensitivity 0-100
  let MIC_SILENCE_DELAY = 1400; // 1.4 seconds of silence before auto-stop (conversational pace)
  let MIC_MIN_DURATION = 500; // Don't send if recording is less than 500ms

  // Load VAD settings from voice config
  async function loadVADSettings() {
    try {
      const response = await fetch('/api/voice-settings');
      if (response.ok) {
        const config = await response.json();
        if (config.stt?.vad) {
          MIC_VOICE_THRESHOLD = config.stt.vad.voiceThreshold ?? 12;
          MIC_SILENCE_DELAY = config.stt.vad.silenceDelay ?? 5000;
          MIC_MIN_DURATION = config.stt.vad.minDuration ?? 500;
          console.log('[chat-mic] Loaded VAD settings:', { MIC_VOICE_THRESHOLD, MIC_SILENCE_DELAY, MIC_MIN_DURATION });
        }
      }
    } catch (error) {
      console.error('[chat-mic] Failed to load VAD settings:', error);
      // Keep defaults
    }
  }

  // Watch for LLM completion and auto-send queued messages
  $: if (!loading && queuedMessage.trim()) {
    console.log('[chat-queue] LLM finished, sending queued message:', queuedMessage.substring(0, 50) + (queuedMessage.length > 50 ? '...' : ''));
    const msg = queuedMessage;
    queuedMessage = ''; // Clear queue before sending
    input = msg;
    void sendMessage();
  }

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

      // In continuous mode, wait for VAD to detect speech before starting recording
      // In normal mode, start recording immediately
      if (!micContinuousMode) {
        micRecorder.start();
        micRecording = true;
        micStartedAt = Date.now();
      }

      runMicVAD();
    } catch (e) {
      console.error('[chat-mic] Failed to start mic:', e);
    }
  }

  function stopMic() {
    if (!micRecording) return;

    console.log('[chat-mic] Stopping recording, chunks collected:', micChunks.length);

    try {
      if (micRecorder && micRecorder.state !== 'inactive') {
        micRecorder.stop();
      }
    } catch (e) {
      console.error('[chat-mic] Error stopping recorder:', e);
    }

    if (micSilenceTimer) {
      clearTimeout(micSilenceTimer);
      micSilenceTimer = null;
    }

    micRecording = false;
    micSpeaking = false; // Reset speaking state
    micSilenceTimerStarted = false;

    // In continuous mode, keep the stream alive for next speech detection
    // In normal mode, close everything
    if (!micContinuousMode) {
      try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
      micStream = null;
      try { micAudioCtx?.close(); } catch {}
      micAudioCtx = null;
      micAnalyser = null;
    }
  }

  async function finalizeMic() {
    try {
      const blob = new Blob(micChunks, { type: 'audio/webm' });
      const dur = micStartedAt ? (Date.now() - micStartedAt) : 0;

      console.log('[chat-mic] Finalizing recording:', dur, 'ms, blob size:', blob.size, 'bytes');

      // Ignore recordings that are too short (likely accidental clicks or noise)
      if (dur < MIC_MIN_DURATION) {
        console.log(`[chat-mic] Recording too short (${dur}ms), ignoring`);
        return;
      }

      // Ignore recordings with no data
      if (blob.size === 0) {
        console.log('[chat-mic] Recording has no data (0 bytes), ignoring');
        return;
      }

      const buf = await blob.arrayBuffer();
      const res = await fetch(`/api/stt?format=webm&collect=1&dur=${dur}`, { method: 'POST', body: buf });
      if (res.ok) {
        const data = await res.json();
        console.log('[chat-mic] STT response:', data);

        if (data?.transcript && data.transcript.trim()) {
          const transcript = data.transcript.trim();

          // Auto-send in continuous mode
          if (micContinuousMode) {
            // If LLM is busy (thinking or responding), queue the message
            if (loading) {
              console.log('[chat-queue] LLM busy, queueing message:', transcript.substring(0, 50) + (transcript.length > 50 ? '...' : ''));
              queuedMessage = transcript; // Will auto-send when loading becomes false
            } else {
              // LLM idle, send immediately
              console.log('[chat-mic] Transcribed & sending:', transcript.substring(0, 50) + (transcript.length > 50 ? '...' : ''));
              input = transcript;
              await sendMessage();
            }
          }
        } else {
          console.log('[chat-mic] No transcript detected (empty or null response)');
        }
      } else {
        console.error('[chat-mic] STT request failed:', res.status, res.statusText);
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

    const tickVAD = () => {
      // Keep VAD running as long as we have an analyser (mic stream is active)
      if (!micAnalyser) return;

      // CRITICAL: Don't record while TTS is playing (prevents recording LLM's own voice)
      if (currentAudio && !currentAudio.paused) {
        // If we were recording, stop it (we heard TTS start mid-recording)
        // But only if we've recorded enough data to avoid losing the recording
        if (micRecording) {
          const recordingDuration = micStartedAt ? (Date.now() - micStartedAt) : 0;
          if (recordingDuration < MIC_MIN_DURATION) {
            // Too short, let it continue until min duration
            // Just pause VAD checking while TTS plays
            micSpeaking = false;
            if (micSilenceTimer) {
              clearTimeout(micSilenceTimer);
              micSilenceTimer = null;
              micSilenceTimerStarted = false;
            }
          } else {
            // Long enough, safe to stop
            console.log('[chat-mic] TTS started, stopping recording (had', recordingDuration, 'ms)');
            stopMic();
          }
        } else {
          // Not recording, just reset state
          micSpeaking = false;
        }
        requestAnimationFrame(tickVAD);
        return;
      }

      // Use shared audio utility for voice-frequency-focused volume calculation
      const vol = calculateVoiceVolume(analyser, 150);

      // Voice detected
      if (vol > MIC_VOICE_THRESHOLD) {
        if (!micSpeaking) {
          console.log('[chat-mic] Speech started');
          micSpeaking = true;
          micSilenceTimerStarted = false; // Reset flag

          // In continuous mode, start recording when speech is detected
          if (micContinuousMode && !micRecording && micStream) {
            // Double-check recorder state before starting
            if (micRecorder && micRecorder.state === 'recording') {
              console.log('[chat-mic] WARNING: Recorder already recording, skipping start');
              micRecording = true; // Sync state
              return;
            }

            console.log('[chat-mic] Auto-starting recording (continuous mode)');
            // Recreate MediaRecorder for each recording session
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
            micChunks = [];
            micRecorder = new MediaRecorder(micStream, { mimeType });
            micRecorder.ondataavailable = (e) => { if (e.data?.size) micChunks.push(e.data); };
            micRecorder.onstop = () => { void finalizeMic(); };

            try {
              micRecorder.start();
              micRecording = true;
              micStartedAt = Date.now();
            } catch (e) {
              console.error('[chat-mic] Failed to start recorder:', e);
              micRecording = false;
            }
          }
        }
        // Clear silence timer (user is still speaking)
        if (micSilenceTimer) {
          clearTimeout(micSilenceTimer);
          micSilenceTimer = null;
          micSilenceTimerStarted = false;
        }
      }
      // Silence detected while we were speaking
      else if (micSpeaking && micRecording && !micSilenceTimer) {
        // Only start silence timer if we've been recording for at least the minimum duration
        const recordingDuration = micStartedAt ? (Date.now() - micStartedAt) : 0;
        if (recordingDuration >= MIC_MIN_DURATION) {
          if (!micSilenceTimerStarted) {
            console.log('[chat-mic] Silence detected, starting timer...');
            micSilenceTimerStarted = true;
          }
          micSilenceTimer = window.setTimeout(() => {
            console.log('[chat-mic] Silence timer expired, stopping recording');
            micSpeaking = false; // Reset speaking state
            micSilenceTimerStarted = false;
            stopMic();
          }, MIC_SILENCE_DELAY);
        }
        // Don't log every frame when recording is too short - just wait
      }

      requestAnimationFrame(tickVAD);
    };
    requestAnimationFrame(tickVAD);
  }

</script>

<div class="chat-interface">
  <!-- Mode Toggle -->
  <div class="mode-toggle-container sm:gap-3">
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
        <span class="mode-icon" aria-hidden="true">💭</span>
        <span class="mode-label">Inner Dialogue</span>
      </button>
    </div>

    <!-- Length toggle -->
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

    <!-- Reasoning depth slider -->
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

    <!-- Quick voice/tts controls -->
    <div class="quick-audio">
      <button
        class="icon-btn"
        title={ttsEnabled ? 'Disable speech' : 'Enable speech'}
        on:click={() => {
          ttsEnabled = !ttsEnabled;
          if (ttsEnabled) {
            prefetchVoiceResources();
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

    {#if messages.length > 0}
      <button class="clear-btn" on:click={clearChat} title="Clear chat history">
        <span class="clear-icon" aria-hidden="true">🗑️</span>
        <span class="clear-text">Clear</span>
      </button>
    {/if}
  </div>

  <!-- Messages Area -->

  <!-- Ollama Status Warning Banner -->
  {#if !ollamaRunning || !ollamaHasModels}
    <div class="ollama-warning-banner">
      <div class="warning-icon">⚠️</div>
      <div class="warning-content">
        <div class="warning-title">
          {#if !ollamaRunning}
            Ollama Service Not Running
          {:else}
            No Language Models Loaded
          {/if}
        </div>
        <div class="warning-message">
          {#if !ollamaRunning}
            The Ollama service is not running. Please start it using: <code>systemctl start ollama</code>
          {:else if ollamaModelCount === 0}
            No models are currently loaded. Please install a model using: <code>ollama pull phi3:mini</code>
          {/if}
          {#if ollamaError}
            <div class="warning-error">Error: {ollamaError}</div>
          {/if}
        </div>
        <button class="warning-refresh-btn" on:click={checkOllamaStatus}>
          Recheck Status
        </button>
      </div>
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
        {#each messages as message, i}
          {#if mode === 'inner'
            ? (message.role === 'reflection' || message.role === 'dream' || message.role === 'reasoning')
            : (message.role !== 'reflection' && message.role !== 'dream')}
            {#if message.role === 'reasoning'}
              <Thinking
                steps={message.content}
                label={message.meta?.label ?? (message.meta?.stage ? formatReasoningLabel({ ...message.meta.stage, timestamp: message.timestamp }) : '🤔 Reasoning · ' + formatTime(message.timestamp))}
                initiallyOpen={false}
              />
            {:else}
              <div
                class="message message-{message.role}"
                class:message-selected={selectedMessageIndex === i}
                data-facet={message.meta?.facet || 'default'}
                on:click={() => {
                  if (selectedMessageIndex === i) {
                    // Deselect if clicking same message
                    selectedMessage = null;
                    selectedMessageIndex = null;
                  } else {
                    // Select this message for reply
                    selectedMessage = message;
                    selectedMessageIndex = i;
                  }
                }}
                role="button"
                tabindex="0"
              >
                <div class="message-header">
                  <span class="message-role">
                    {#if message.role === 'user'}
                      You
                    {:else if message.role === 'assistant'}
                      MetaHuman{#if message.meta?.facet && message.meta.facet !== 'default'}<span class="facet-indicator" title="Speaking as {message.meta.facet} facet"> · {message.meta.facet}</span>{/if}
                    {:else if message.role === 'reflection'}
                      💭 Idle Thought
                    {:else if message.role === 'dream'}
                      🌙 Dream
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
                  <!-- TTS replay button inside bubble at bottom right -->
                  <button class="msg-mic-btn" title="Listen to this message" on:click={(e) => { e.stopPropagation(); speakText(message.content); }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                    </svg>
                  </button>
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

        {#if showThinkingIndicator}
          <Thinking
            steps={thinkingSteps}
            label={thinkingStatusLabel}
            initiallyOpen={true}
          />
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
  <!-- Input Area -->
  <div class="input-container">
    <div class="input-wrapper">
      <!-- Code approval box appears here when there are pending approvals -->
      <ApprovalBox />

      <!-- Reply-to indicator -->
      {#if selectedMessage}
        <div class="reply-indicator">
          <span class="reply-label">↩ Replying to:</span>
          <span class="reply-preview">{selectedMessage.content.substring(0, 60)}{selectedMessage.content.length > 60 ? '...' : ''}</span>
          <button
            class="reply-cancel"
            on:click={() => {
              selectedMessage = null;
              selectedMessageIndex = null;
            }}
            title="Cancel reply"
          >✕</button>
        </div>
      {/if}

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
          <!-- Stop button - only visible when audio is playing -->
          {#if currentAudio}
            <button
              class="input-stop-btn"
              title="Stop speaking"
              on:click={() => {
                stopActiveAudio();
                cancelInFlightTts();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2"/>
              </svg>
            </button>
          {/if}
          <button
            class="mic-btn {micRecording ? 'recording' : ''} {micContinuousMode ? 'continuous' : ''}"
            title={micContinuousMode ? (micRecording ? 'Listening continuously…' : 'Continuous mode active') : (micRecording ? 'Listening… click to stop' : 'Click to speak')}
            on:click={() => {
              if (micContinuousMode) {
                // Stop continuous mode and clean up
                micContinuousMode = false;
                if (micRecording) stopMic();
                // Clean up the stream
                try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
                micStream = null;
                try { micAudioCtx?.close(); } catch {}
                micAudioCtx = null;
                micAnalyser = null;
              } else {
                micRecording ? stopMic() : startMic();
              }
            }}
            on:contextmenu|preventDefault={() => {
              // Right-click to toggle continuous mode
              micContinuousMode = !micContinuousMode;
              if (micContinuousMode && !micRecording) {
                startMic();
              }
            }}
            disabled={loading}
          >
            {#if micContinuousMode && micRecording}
              <!-- Recording: Waveform icon -->
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="recording-icon">
                <rect x="2" y="8" width="2" height="8" rx="1"/>
                <rect x="6" y="4" width="2" height="16" rx="1"/>
                <rect x="10" y="10" width="2" height="4" rx="1"/>
                <rect x="14" y="6" width="2" height="12" rx="1"/>
                <rect x="18" y="9" width="2" height="6" rx="1"/>
              </svg>
            {:else if micContinuousMode}
              <!-- Waiting: Sound waves icon -->
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="waiting-icon">
                <path d="M9 9c-.5-.5-1.5-1-3-1M9 15c-.5.5-1.5 1-3 1M15 9c.5-.5 1.5-1 3-1M15 15c.5.5 1.5 1 3 1M12 12v.01"/>
              </svg>
            {:else}
              <!-- Normal: Microphone icon -->
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
              </svg>
            {/if}
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
</div>

<style>
  /* Custom animations and pseudo-elements that can't be done with Tailwind */

  /* Ollama Warning Banner */
  .ollama-warning-banner {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1rem 1.5rem;
    margin: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 2px solid rgba(239, 68, 68, 0.3);
    border-radius: 0.5rem;
    font-size: 0.95rem;
  }

  :global(.dark) .ollama-warning-banner {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
  }

  .warning-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .warning-content {
    flex: 1;
  }

  .warning-title {
    font-weight: 600;
    color: rgba(239, 68, 68, 0.9);
    margin-bottom: 0.5rem;
    font-size: 1rem;
  }

  :global(.dark) .warning-title {
    color: rgba(239, 68, 68, 1);
  }

  .warning-message {
    color: rgba(0, 0, 0, 0.8);
    line-height: 1.5;
  }

  :global(.dark) .warning-message {
    color: rgba(255, 255, 255, 0.85);
  }

  .warning-message code {
    background: rgba(0, 0, 0, 0.1);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
  }

  :global(.dark) .warning-message code {
    background: rgba(255, 255, 255, 0.1);
  }

  .warning-error {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: rgba(239, 68, 68, 0.8);
    font-style: italic;
  }

  .warning-refresh-btn {
    margin-top: 0.75rem;
    padding: 0.5rem 1rem;
    background: rgba(139, 92, 246, 0.8);
    color: white;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .warning-refresh-btn:hover {
    background: rgba(139, 92, 246, 1);
    transform: translateY(-1px);
  }

  .warning-refresh-btn:active {
    transform: translateY(0);
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

  .mic-btn {
    position: relative;
  }

  .mic-btn.continuous {
    background: rgba(59, 130, 246, 0.2) !important;
    border-color: rgba(59, 130, 246, 0.6) !important;
  }

  .mic-btn.continuous:not(.recording) {
    animation: breathe 2s ease-in-out infinite;
  }

  @keyframes breathe {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }

  .recording-icon {
    color: #ef4444 !important;
    animation: recordingBounce 0.8s ease-in-out infinite;
  }

  @keyframes recordingBounce {
    0%, 100% { transform: scaleY(1); }
    25% { transform: scaleY(1.2); }
    50% { transform: scaleY(0.8); }
    75% { transform: scaleY(1.1); }
  }

  .waiting-icon {
    animation: soundWave 2s ease-in-out infinite;
  }

  @keyframes soundWave {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }

  .input-actions {
    position: relative;
  }

  @keyframes pulseMic {
    0% { transform: scale(0.9); opacity: 0.6; }
    80% { transform: scale(1.15); opacity: 0; }
    100% { transform: scale(1.2); opacity: 0; }
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

  /* System message styling - distinct from user/assistant */
  .message-system .message-content {
    background: rgba(107, 114, 128, 0.1);
    border-left: 3px solid rgba(107, 114, 128, 0.4);
    font-size: 0.9em;
    color: rgba(107, 114, 128, 0.9);
    font-style: italic;
  }

  :global(.dark) .message-system .message-content {
    background: rgba(75, 85, 99, 0.15);
    border-left: 3px solid rgba(107, 114, 128, 0.5);
    color: rgba(156, 163, 175, 0.95);
  }

  .message-system .message-role {
    color: rgba(107, 114, 128, 0.7);
    font-size: 0.85em;
  }

  :global(.dark) .message-system .message-role {
    color: rgba(156, 163, 175, 0.8);
  }

  /* Message interaction styles */
  .message {
    cursor: pointer;
  }

  /* Make message-content positioned so mic button can be absolutely positioned inside */
  .message-content {
    position: relative;
    padding-bottom: 2rem; /* Extra space for mic button */
  }

  /* Hover effect - add subtle overlay to message bubble */
  .message:hover:not(.message-selected) .message-content {
    box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.15) inset;
  }

  /* Reply-to system: selected message highlighting */
  .message-selected .message-content {
    box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.4) inset !important;
  }

  .message-selected:hover .message-content {
    box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.6) inset !important;
  }

  /* Show mic button on hover - override global styles for better visibility */
  .msg-mic-btn {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    z-index: 10;
    opacity: 0.3;
    background: rgba(139, 92, 246, 0.15) !important;
    color: rgba(139, 92, 246, 0.9) !important;
    border: none;
    border-radius: 0.375rem;
    padding: 0.375rem;
    cursor: pointer;
    transition: all 0.2s ease;
    pointer-events: auto;
  }

  :global(.dark) .msg-mic-btn {
    background: rgba(167, 139, 250, 0.2) !important;
    color: rgba(167, 139, 250, 0.95) !important;
  }

  .message:hover .msg-mic-btn {
    opacity: 1;
  }

  .msg-mic-btn:hover {
    opacity: 1 !important;
    transform: scale(1.15);
    background: rgba(139, 92, 246, 0.25) !important;
    color: rgba(139, 92, 246, 1) !important;
  }

  :global(.dark) .msg-mic-btn:hover {
    background: rgba(167, 139, 250, 0.3) !important;
    color: rgba(167, 139, 250, 1) !important;
  }

  /* Reply indicator styling */
  .reply-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: rgba(167, 139, 250, 0.1);
    border-left: 3px solid rgba(167, 139, 250, 0.6);
    border-radius: 0.375rem;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }

  .reply-label {
    font-weight: 600;
    color: rgba(167, 139, 250, 1);
  }

  .reply-preview {
    flex: 1;
    color: rgba(156, 163, 175, 1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reply-cancel {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    background: rgba(239, 68, 68, 0.1);
    color: rgba(239, 68, 68, 1);
    border: none;
    cursor: pointer;
    transition: all 0.15s;
  }

  .reply-cancel:hover {
    background: rgba(239, 68, 68, 0.2);
  }

  /* Clear button - hide icon on desktop, show text */
  .clear-btn .clear-icon {
    display: none;
  }

  .clear-btn .clear-text {
    display: inline;
  }

  /* Mobile-specific overrides that benefit from media queries */
  @media (max-width: 640px) {
    .mode-toggle-container {
      flex-wrap: nowrap;
      gap: 0.5rem;
      padding: 0.75rem 0.5rem;
      overflow-x: auto;
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
      padding: 0.45rem 0.5rem;
      font-size: 1rem;
      min-width: unset;
    }

    .mode-label,
    .control-text {
      display: none;
    }

    /* Ensure mode icons are visible */
    .mode-icon {
      font-size: 1.1rem;
    }

    /* Hide badges on mobile to save space */
    .icon-btn .badge {
      display: none;
    }

    .length-toggle,
    .reasoning-toggle,
    .quick-audio {
      flex: 0 0 auto;
      gap: 0.35rem;
    }

    /* Make length select more compact - icon-only style */
    .length-toggle {
      gap: 0;
    }

    .length-toggle .control-label {
      display: none;
    }

    .length-toggle select {
      width: 70px;
      padding: 0.35rem 0.4rem;
      font-size: 0.75rem;
    }

    .reasoning-slider-wrapper {
      width: 70px;
      height: 28px;
    }

    .reasoning-slider-input::-webkit-slider-thumb {
      width: 24px;
      height: 24px;
    }

    .reasoning-slider-input::-moz-range-thumb {
      width: 24px;
      height: 24px;
    }

    .reasoning-emoji {
      font-size: 16px;
    }

    .icon-btn {
      padding: 0.35rem 0.45rem;
      min-width: unset;
    }

    /* Make clear button icon-only on mobile */
    .clear-btn {
      padding: 0.35rem 0.5rem;
      min-width: unset;
      font-size: 1.1rem;
    }

    .clear-btn .clear-text {
      display: none;
    }

    .clear-btn .clear-icon {
      display: inline;
    }

    .mic-btn {
      display: none;
    }

    .input-wrapper {
      gap: 0.5rem;
    }

    .chat-input {
      font-size: 0.95rem;
      padding: 0.65rem 0.8rem;
    }

    .input-row {
      gap: 0.5rem;
    }

    .input-actions {
      gap: 0.35rem;
    }

    .input-stop-btn,
    .send-btn {
      padding: 0.6rem;
    }
  }
</style>
