<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { FALLBACK_CONFIG } from '../lib/config'
  import { getAppConfig, getLocalStatus, login, sendChat, transcribeAudio } from '../lib/api'
  import type { AppConfig, ConversationState, LocalStatus, TranscriptMessage } from '../lib/types'
  import { RobotMicrophone } from '../lib/audio/microphone'
  import { RobotTtsPlayer } from '../lib/audio/tts'
  import StatusBar from './StatusBar.svelte'
  import Transcript from './Transcript.svelte'
  import VoiceControls from './VoiceControls.svelte'

  let config: AppConfig = FALLBACK_CONFIG
  let status: LocalStatus | null = null
  let state: ConversationState = 'idle'
  let messages: TranscriptMessage[] = []
  let textInput = ''
  let listening = false
  let ttsEnabled = true
  let busy = false
  let level = 0
  let debugMessage = ''
  let sessionId = `robot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let microphone: RobotMicrophone | null = null
  const tts = new RobotTtsPlayer()

  $: authenticated = !!status?.server.session.connected
  $: authSetupMessage = getAuthSetupMessage()

  onMount(async () => {
    await boot()
  })

  onDestroy(() => {
    microphone?.stop()
    tts.stop()
  })

  async function boot(): Promise<void> {
    try {
      config = await getAppConfig()
      ttsEnabled = config.voice.ttsEnabled

      if (!config.server.configured) {
        addMessage('system', 'Robot Friend is running in preview mode. Add apps/robot-friend/robot-friend.config.json with your MetaHuman server username and password before using voice or chat.')
        await refreshStatus()
        return
      }

      await login().catch(error => {
        const message = `Login failed: ${(error as Error).message}`
        debugMessage = message
        addMessage('system', `${message}. Check robot-friend.config.json and confirm the main Astro server is running.`)
      })
      await refreshStatus()

      if (config.app.autoListen && status?.server.session.connected) {
        await startListening()
      }
    } catch (error) {
      state = 'offline'
      addMessage('system', `Robot Friend could not start: ${(error as Error).message}`)
    }
  }

  async function refreshStatus(): Promise<void> {
    try {
      status = await getLocalStatus()
      if (!status.server.session.connected && state !== 'error') {
        state = 'offline'
      } else if (state === 'offline') {
        state = listening ? 'listening' : 'idle'
      }
    } catch (error) {
      state = 'offline'
      debugMessage = (error as Error).message
    }
  }

  function addMessage(role: TranscriptMessage['role'], text: string): void {
    if (messages.some(message => message.role === role && message.text === text)) return
    messages = [
      ...messages,
      {
        id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role,
        text,
        at: Date.now(),
      },
    ]
  }

  function ensureMicrophone(): RobotMicrophone {
    microphone ??= new RobotMicrophone({
      vadThreshold: config.voice.vadThreshold,
      silenceMs: config.voice.silenceMs,
      minSpeechMs: config.voice.minSpeechMs,
      shouldPause: () => busy || tts.isPlaying() || state === 'speaking' || state === 'thinking',
      onLevel: value => {
        level = value
      },
      onState: micState => {
        if (!listening && micState !== 'off') return
        if (micState === 'off') {
          state = busy ? state : 'idle'
        } else if (micState === 'ready') {
          state = busy ? state : 'listening'
        } else if (micState === 'recording') {
          state = 'listening'
        }
      },
      onAudio: (blob, durationMs) => {
        void handleAudio(blob, durationMs)
      },
      onError: message => {
        state = 'error'
        addMessage('system', message)
      },
    })

    return microphone
  }

  async function startListening(): Promise<void> {
    if (!authenticated) {
      addMessage('system', authSetupMessage)
      state = 'offline'
      return
    }
    listening = true
    await ensureMicrophone().start()
  }

  function stopListening(): void {
    listening = false
    microphone?.stop()
    state = busy ? state : 'idle'
  }

  function toggleListening(): void {
    if (listening) {
      stopListening()
    } else {
      void startListening()
    }
  }

  function toggleTts(): void {
    ttsEnabled = !ttsEnabled
    if (!ttsEnabled) tts.stop()
  }

  function stopSpeaking(): void {
    tts.stop()
    if (!busy) state = listening ? 'listening' : 'idle'
  }

  async function handleAudio(blob: Blob, durationMs: number): Promise<void> {
    if (busy || !authenticated) return
    busy = true
    state = 'thinking'

    try {
      const transcript = await transcribeAudio(blob, durationMs)
      if (!transcript) {
        busy = false
        state = listening ? 'listening' : 'idle'
        return
      }
      await submitMessage(transcript, true)
    } catch (error) {
      state = 'error'
      addMessage('system', `Voice input failed: ${(error as Error).message}`)
    } finally {
      busy = false
      if (!tts.isPlaying() && state !== 'error') {
        state = listening ? 'listening' : 'idle'
      }
    }
  }

  async function submitTypedMessage(): Promise<void> {
    const message = textInput.trim()
    if (!message || busy) return
    if (!authenticated) {
      addMessage('system', authSetupMessage)
      state = 'offline'
      return
    }
    textInput = ''
    await submitMessage(message, false)
  }

  async function submitMessage(message: string, fromVoice: boolean): Promise<void> {
    if (!authenticated) {
      addMessage('system', authSetupMessage)
      state = 'offline'
      return
    }

    busy = true
    state = 'thinking'
    addMessage('user', message)

    try {
      const response = await sendChat(message, sessionId)
      if (response.error) {
        throw new Error(response.error)
      }

      const answer = response.response?.trim()
      if (!answer) {
        throw new Error('MetaHuman returned no response.')
      }

      addMessage('assistant', answer)

      if (ttsEnabled) {
        state = 'speaking'
        await tts.speak(answer, playing => {
          state = playing ? 'speaking' : listening ? 'listening' : 'idle'
        })
      } else {
        state = listening ? 'listening' : 'idle'
      }
    } catch (error) {
      state = 'error'
      addMessage('system', `Conversation failed: ${(error as Error).message}`)
    } finally {
      busy = false
      if (!tts.isPlaying() && state !== 'error') {
        state = listening ? 'listening' : 'idle'
      }
      if (!fromVoice) await refreshStatus()
    }
  }

  function getAuthSetupMessage(): string {
    if (!config.server.configured) {
      return 'Add apps/robot-friend/robot-friend.config.json with your MetaHuman server username and password.'
    }

    const loginError = status?.server.session.loginError
    if (loginError) {
      return `MetaHuman login failed: ${loginError}`
    }

    return 'Robot Friend is not authenticated with the MetaHuman server yet.'
  }
</script>

<main class="robot-shell">
  <StatusBar {state} {config} {status} {level} />

  <section class="workspace" aria-label="Robot Friend workspace">
    <div class="conversation-column">
      <Transcript {messages} />

      <form class="text-entry" on:submit|preventDefault={submitTypedMessage}>
        <input
          bind:value={textInput}
          disabled={busy || !authenticated}
          autocomplete="off"
          aria-label="Message"
          placeholder={authenticated ? 'Type a message' : 'Configure login to chat'}
        />
        <button disabled={busy || !authenticated || !textInput.trim()} type="submit">Send</button>
      </form>
    </div>

    <aside class="control-column">
      <VoiceControls
        {state}
        {listening}
        {ttsEnabled}
        {busy}
        disabled={!authenticated}
        disabledReason={authSetupMessage}
        onListenToggle={toggleListening}
        onTtsToggle={toggleTts}
        onStopSpeaking={stopSpeaking}
      />

      {#if config.app.showDebugUi}
        <section class="debug-panel">
          <h2>Debug</h2>
          <pre>{JSON.stringify({ status, debugMessage, sessionId }, null, 2)}</pre>
        </section>
      {/if}
    </aside>
  </section>
</main>
