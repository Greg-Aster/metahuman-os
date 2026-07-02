<script lang="ts">
  import type { ConversationState } from '../lib/types'

  export let state: ConversationState
  export let listening = false
  export let ttsEnabled = true
  export let busy = false
  export let disabled = false
  export let disabledReason = ''
  export let onListenToggle: () => void
  export let onTtsToggle: () => void
  export let onStopSpeaking: () => void
</script>

<section class="voice-controls" aria-label="Voice controls">
  <button class="primary-control" class:active={listening} disabled={disabled || (busy && !listening)} on:click={onListenToggle}>
    <span>{listening ? 'Stop listening' : 'Start listening'}</span>
    <small>{disabled ? disabledReason : state === 'listening' ? 'ready for speech' : state}</small>
  </button>

  <div class="secondary-controls">
    <button class:active={ttsEnabled} on:click={onTtsToggle}>
      {ttsEnabled ? 'Speech on' : 'Speech off'}
    </button>
    <button on:click={onStopSpeaking}>
      Stop speech
    </button>
  </div>
</section>
