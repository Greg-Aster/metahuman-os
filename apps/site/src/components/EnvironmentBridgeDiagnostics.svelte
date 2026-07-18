<script lang="ts">
  import type {
    EnvironmentBridgeDiagnosticsSession,
    EnvironmentBridgeDiagnosticsSnapshot,
  } from '../lib/client/environment-bridge-diagnostics-types';

  export let diagnostics: EnvironmentBridgeDiagnosticsSnapshot;

  let selectedSessionId = '';

  $: sessions = diagnostics?.sessions ?? [];
  $: if (!selectedSessionId || !sessions.some(item => item.sessionId === selectedSessionId)) {
    selectedSessionId = sessions[0]?.sessionId ?? '';
  }
  $: session = sessions.find(item => item.sessionId === selectedSessionId);

  function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
  }

  function formatRate(value: number): string {
    return `${formatBytes(value)}/s`;
  }

  function formatTimestamp(value?: string): string {
    if (!value) return 'Never';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : value;
  }

  function statusValue(value: unknown): string {
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (value === undefined || value === null || value === '') return '—';
    return String(value);
  }

  function mediaUrl(
    item: EnvironmentBridgeDiagnosticsSession,
    kind: 'image' | 'audio',
    version: string,
  ): string {
    return `/api/environment-bridge/diagnostics/media?sessionId=${encodeURIComponent(item.sessionId)}&kind=${kind}&v=${encodeURIComponent(version)}`;
  }

  const robotFields: Array<{ key: string; label: string; suffix?: string }> = [
    { key: 'state', label: 'Body state' },
    { key: 'vbat', label: 'Battery', suffix: ' V' },
    { key: 'rssi', label: 'Wi-Fi RSSI', suffix: ' dBm' },
    { key: 'heap', label: 'Free heap', suffix: ' B' },
    { key: 'uptime', label: 'Uptime', suffix: ' s' },
    { key: 'sd', label: 'SD card' },
    { key: 'wake_ready', label: 'Wake ready' },
    { key: 'wake_enabled', label: 'Wake enabled' },
    { key: 'cam_drops', label: 'Camera drops' },
    { key: 'mic_drops', label: 'Mic drops' },
    { key: 'spk_underruns', label: 'Speaker underruns' },
  ];
</script>

<div class="space-y-3 rounded border border-cyan-200 bg-cyan-50/40 p-3 dark:border-cyan-900/70 dark:bg-cyan-950/10">
  <div class="flex items-start justify-between gap-3">
    <div>
      <div class="text-[0.68rem] font-semibold uppercase text-cyan-800 dark:text-cyan-300">Bridge Diagnostics</div>
      <div class="mt-1 text-xs text-gray-600 dark:text-gray-400">Live counters and bounded, in-memory media inspection. Nothing here starts continuous recording.</div>
    </div>
    {#if sessions.length > 1}
      <select
        bind:value={selectedSessionId}
        class="max-w-44 rounded border border-cyan-300 bg-white px-2 py-1 text-xs dark:border-cyan-800 dark:bg-gray-950"
        aria-label="Diagnostic robot session"
      >
        {#each sessions as item}
          <option value={item.sessionId}>{item.robotId || item.sessionId}</option>
        {/each}
      </select>
    {/if}
  </div>

  {#if !session}
    <div class="rounded border border-dashed border-cyan-300 px-3 py-4 text-xs text-gray-500 dark:border-cyan-800 dark:text-gray-400">
      Waiting for diagnostic telemetry from a connected environment adapter.
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.68rem] text-gray-600 dark:text-gray-400">
      <span class="font-mono text-gray-800 dark:text-gray-200">{session.robotId || session.sessionId}</span>
      <span>session {session.sessionId}</span>
      <span>updated {formatTimestamp(session.updatedAt)}</span>
    </div>

    <div class="grid grid-cols-2 gap-2 text-xs">
      <div class="rounded bg-white p-2 dark:bg-gray-950">
        <div class="text-[0.62rem] uppercase text-gray-500">Inbound</div>
        <div class="mt-0.5 font-mono font-semibold">{formatRate(session.transport.inboundBytesPerSecond)}</div>
        <div class="mt-0.5 text-[0.62rem] text-gray-500">{formatBytes(session.transport.inboundBytes)} / {session.transport.inboundMessages} messages</div>
      </div>
      <div class="rounded bg-white p-2 dark:bg-gray-950">
        <div class="text-[0.62rem] uppercase text-gray-500">Outbound</div>
        <div class="mt-0.5 font-mono font-semibold">{formatRate(session.transport.outboundBytesPerSecond)}</div>
        <div class="mt-0.5 text-[0.62rem] text-gray-500">{formatBytes(session.transport.outboundBytes)} / {session.transport.outboundMessages} messages</div>
      </div>
      <div class="rounded bg-white p-2 dark:bg-gray-950">
        <div class="text-[0.62rem] uppercase text-gray-500">Camera</div>
        <div class="mt-0.5 font-mono font-semibold">{session.media.imageFrames} frames</div>
        <div class="mt-0.5 text-[0.62rem] text-gray-500">{formatBytes(session.media.imageBytes)}</div>
      </div>
      <div class="rounded bg-white p-2 dark:bg-gray-950">
        <div class="text-[0.62rem] uppercase text-gray-500">Microphone</div>
        <div class="mt-0.5 font-mono font-semibold">{session.media.audioUtterances} utterances</div>
        <div class="mt-0.5 text-[0.62rem] text-gray-500">{formatBytes(session.media.audioBytes)} / queue {session.pendingAudioUtterances}</div>
      </div>
    </div>

    <section class="space-y-2">
      <div class="flex items-center justify-between text-[0.68rem] font-semibold uppercase text-gray-500">
        <span>Microphone monitor</span>
        <span>{Math.round(session.microphoneLevel * 100)}%</span>
      </div>
      <div class="h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800" role="meter" aria-label="Robot microphone level" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(session.microphoneLevel * 100)}>
        <div class="h-full rounded-full bg-cyan-500 transition-[width] duration-100" style={`width:${Math.round(session.microphoneLevel * 100)}%`}></div>
      </div>
      <div class="flex flex-wrap gap-2 text-[0.68rem] text-gray-600 dark:text-gray-400">
        <span>STT: {session.lastTranscriptionStatus || 'idle'}</span>
        {#if session.latestAudio?.durationMs !== undefined}
          <span>{(session.latestAudio.durationMs / 1000).toFixed(1)} s</span>
        {/if}
        {#if session.latestAudio?.wakeTriggered}<span>wake-triggered</span>{/if}
        {#if session.latestAudio?.truncated}<span class="text-amber-700 dark:text-amber-300">truncated</span>{/if}
      </div>
      {#if session.latestAudio?.available}
        {#key session.latestAudio.utteranceId}
          <audio
            class="h-9 w-full"
            controls
            preload="none"
            src={mediaUrl(session, 'audio', session.latestAudio.utteranceId)}
          >
            <track kind="captions" />
          </audio>
        {/key}
        <div class="text-[0.62rem] text-gray-500">Playback is manual and contains only the latest VAD-bounded utterance held in memory.</div>
      {:else}
        <div class="rounded bg-white px-2 py-2 text-xs text-gray-500 dark:bg-gray-950 dark:text-gray-400">No microphone utterance has reached the bridge yet.</div>
      {/if}
      {#if session.lastTranscript}
        <div class="rounded bg-white px-2 py-2 text-xs dark:bg-gray-950">
          <span class="text-[0.62rem] font-semibold uppercase text-gray-500">Last transcript</span>
          <div class="mt-1 break-words">{session.lastTranscript}</div>
        </div>
      {/if}
    </section>

    <section class="space-y-2">
      <div class="text-[0.68rem] font-semibold uppercase text-gray-500">Freestyle movement</div>
      <div class="grid grid-cols-3 gap-2 text-xs">
        <div class="rounded bg-white p-2 dark:bg-gray-950">
          <div class="text-[0.62rem] uppercase text-gray-500">Body support</div>
          <div class="mt-0.5 font-mono font-semibold">{session.freestyleMovement?.supported ? 'supported' : 'unsupported'}</div>
        </div>
        <div class="rounded bg-white p-2 dark:bg-gray-950">
          <div class="text-[0.62rem] uppercase text-gray-500">Owner policy</div>
          <div class="mt-0.5 font-mono font-semibold">{session.freestyleMovement?.enabled ? 'enabled' : 'disabled'}</div>
        </div>
        <div class="rounded bg-white p-2 dark:bg-gray-950">
          <div class="text-[0.62rem] uppercase text-gray-500">Route</div>
          <div class="mt-0.5 font-mono font-semibold">{session.freestyleMovement?.available ? 'available' : 'closed'}</div>
        </div>
      </div>
      {#if session.movementPlan}
        <div class="rounded bg-white p-2 text-xs dark:bg-gray-950">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-mono font-semibold">{session.movementPlan.actionId || 'unidentified plan'}</span>
            <span class="rounded bg-cyan-100 px-1.5 py-0.5 font-mono text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200">{session.movementPlan.status}</span>
          </div>
          <div class="mt-2 grid grid-cols-3 gap-2 text-[0.68rem] text-gray-600 dark:text-gray-400">
            <span>frame {session.movementPlan.activeFrame ?? 0}/{session.movementPlan.frameCount ?? 0}</span>
            <span>{session.movementPlan.durationMs !== undefined ? `${(session.movementPlan.durationMs / 1000).toFixed(1)} s` : 'duration —'}</span>
            <span>{session.movementPlan.sequence !== undefined ? `seq ${session.movementPlan.sequence}` : 'seq —'}</span>
          </div>
          {#if session.movementPlan.frameCount}
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800" role="progressbar" aria-label="Generated movement frame progress" aria-valuemin="0" aria-valuemax={session.movementPlan.frameCount} aria-valuenow={session.movementPlan.activeFrame ?? 0}>
              <div class="h-full rounded-full bg-violet-500 transition-[width] duration-150" style={`width:${Math.min(100, Math.round(((session.movementPlan.activeFrame ?? 0) / session.movementPlan.frameCount) * 100))}%`}></div>
            </div>
          {/if}
          {#if session.movementPlan.message}<div class="mt-1 text-[0.68rem] text-gray-500">{session.movementPlan.message}</div>{/if}
        </div>
      {:else}
        <div class="rounded bg-white px-2 py-2 text-xs text-gray-500 dark:bg-gray-950 dark:text-gray-400">No generated movement has been dispatched in this session.</div>
      {/if}
      <div class="text-[0.62rem] text-gray-500">Frame progress is commanded progress reported by the adapter, not measured joint feedback.</div>
    </section>

    <section class="space-y-2">
      <div class="flex items-center justify-between text-[0.68rem] font-semibold uppercase text-gray-500">
        <span>Camera / frame feed</span>
        <span>{session.latestImage ? formatBytes(session.latestImage.bytes) : 'No frame'}</span>
      </div>
      {#if session.latestImage?.available}
        {#key session.latestImage.id}
          <img
            class="max-h-64 w-full rounded border border-gray-200 bg-black object-contain dark:border-gray-800"
            src={mediaUrl(session, 'image', session.latestImage.id)}
            alt={`Latest diagnostic frame from ${session.robotId || session.sessionId}`}
          />
        {/key}
        <div class="flex justify-between gap-2 text-[0.62rem] text-gray-500">
          <span>{session.latestImage.mimeType}</span>
          <span>{formatTimestamp(session.latestImage.timestamp)}</span>
        </div>
      {:else}
        <div class="rounded bg-white px-2 py-4 text-center text-xs text-gray-500 dark:bg-gray-950 dark:text-gray-400">No still image has reached the bridge.</div>
      {/if}
      <div class="text-[0.62rem] text-gray-500">This updates whenever the robot sends a bounded still frame. Continuous video is not currently part of the Ainekio cognition transport.</div>
    </section>

    {#if session.robotStatus}
      <section>
        <div class="mb-2 text-[0.68rem] font-semibold uppercase text-gray-500">Robot status</div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {#each robotFields as field}
            <div class="flex items-center justify-between gap-2 border-b border-gray-200 py-1 dark:border-gray-800">
              <span class="text-gray-500">{field.label}</span>
              <span class="truncate font-mono">{statusValue(session.robotStatus[field.key])}{session.robotStatus[field.key] !== undefined ? field.suffix || '' : ''}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <section>
      <div class="mb-1 flex items-center justify-between text-[0.68rem] font-semibold uppercase text-gray-500">
        <span>Recent transport events</span>
        <span>{session.recentEvents.length}</span>
      </div>
      {#if session.recentEvents.length === 0}
        <div class="rounded bg-white px-2 py-2 text-xs text-gray-500 dark:bg-gray-950">No media or action events recorded.</div>
      {:else}
        <div class="max-h-40 overflow-y-auto rounded bg-white px-2 dark:bg-gray-950">
          {#each session.recentEvents.slice().reverse() as event}
            <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 border-b border-gray-200 py-1.5 text-[0.65rem] last:border-0 dark:border-gray-800">
              <span class="text-gray-500">{formatTimestamp(event.timestamp)}</span>
              <span class="min-w-0 truncate"><span class="font-mono">{event.kind}</span>{event.status ? ` · ${event.status}` : ''}{event.message ? ` · ${event.message}` : ''}</span>
              <span class="text-gray-500">{event.bytes ? formatBytes(event.bytes) : ''}</span>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>
