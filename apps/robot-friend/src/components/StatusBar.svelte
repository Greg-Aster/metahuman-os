<script lang="ts">
  import type { AppConfig, ConversationState, LocalStatus } from '../lib/types'

  export let state: ConversationState
  export let config: AppConfig | null
  export let status: LocalStatus | null
  export let level = 0
</script>

<section class="status-bar" aria-label="Robot Friend status">
  <div class="status-primary">
    <div class="status-signal state-{state}" aria-hidden="true"></div>
    <div>
      <p class="status-label">Robot Friend</p>
      <h1>{state}</h1>
    </div>
  </div>

  <div class="status-meter" aria-label="Microphone level">
    <span style={`width: ${Math.max(0, Math.min(100, level))}%`}></span>
  </div>

  <div class="status-facts">
    <span class:good={status?.server.session.connected} class:warn={!status?.server.session.connected}>
      {status?.server.session.connected ? 'connected' : 'not signed in'}
    </span>
    <span>{config?.server.url ?? 'server unknown'}</span>
    <span>{status?.robot.status ?? 'motion disabled'}</span>
  </div>
</section>
