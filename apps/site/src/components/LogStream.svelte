<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface LogEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    category: string;
    event: string;
    actor: string;
    details?: any;
  }

  let logs: LogEntry[] = [];
  let connectionStatus = 'Connecting...';
  let logContainer: HTMLDivElement;
  let autoScroll = true;
  let bottomSentinel: HTMLDivElement;
  let observer: IntersectionObserver | null = null;
  let eventSource: EventSource | null = null;

  // Auto-scroll to bottom
  $: if (logs.length > 0 && autoScroll && bottomSentinel) {
    requestAnimationFrame(() => {
      bottomSentinel?.scrollIntoView({ block: 'end', inline: 'nearest' });
    });
  }

  onMount(() => {
    if (logContainer && bottomSentinel) {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          autoScroll = entry.isIntersecting;
        },
        { root: logContainer, threshold: 0.99 }
      );
      observer.observe(bottomSentinel);
    }

    eventSource = new EventSource('/api/stream');

    eventSource.onopen = () => {
      connectionStatus = 'Connected';
    };

    eventSource.onmessage = (event) => {
      try {
        const newLog = JSON.parse(event.data);
        if (newLog.type === 'connected') {
          logs = [...logs, { timestamp: new Date().toISOString(), level: 'info', category: 'system', event: 'stream_connected', actor: 'system' }];
        } else {
          logs = [...logs, newLog];
        }
      } catch (e) {
        console.error('Failed to parse log event:', e);
      }
    };

    eventSource.onerror = () => {
      connectionStatus = 'Disconnected. Will attempt to reconnect...';
      // EventSource automatically tries to reconnect
    };
  });

  onDestroy(() => {
    eventSource?.close();
    observer?.disconnect();
    observer = null;
  });

  function getLevelColor(level: LogEntry['level']) {
    switch (level) {
      case 'info': return 'text-blue-400';
      case 'warn': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  }

  // Live pipeline status from stream
  type StageStatus = 'idle' | 'in_progress' | 'completed' | 'failed'

  function latestLog(names: string[]): LogEntry | null {
    for (let i = logs.length - 1; i >= 0; i--) {
      if (names.includes(logs[i].event)) return logs[i]
    }
    return null
  }

  function stageStatus(start: string[], done: string[], fail: string[]): StageStatus {
    const s = latestLog(start)
    const d = latestLog(done)
    const f = latestLog(fail)
    const ts = s ? new Date(s.timestamp).getTime() : -1
    const td = d ? new Date(d.timestamp).getTime() : -1
    const tf = f ? new Date(f.timestamp).getTime() : -1
    const latest = Math.max(ts, td, tf)
    if (latest === -1) return 'idle'
    if (latest === tf) return 'failed'
    if (latest === td) return 'completed'
    return 'in_progress'
  }

  $: loraStages = {
    builder: stageStatus(['adapter_builder_started','lora_orchestration_started'], ['adapter_builder_completed','lora_dataset_ready'], ['adapter_builder_failed','lora_dataset_failed']),
    approval: stageStatus(['lora_dataset_ready'], ['lora_dataset_auto_approve','lora_dataset_approved'], ['lora_dataset_auto_reject']),
    training: stageStatus(['lora_training_started','adapter_training_queued'], ['lora_training_completed'], ['lora_training_failed']),
    evaluation: stageStatus(['adapter_evaluation_started','adapter_evaluation_queued'], ['adapter_evaluation_completed'], ['adapter_evaluation_failed']),
    activation: stageStatus(['adapter_activation_requested'], ['lora_adapter_activated','adapter_activated'], []),
  }
</script>

<div class="log-stream-container h-full flex flex-col bg-black font-mono text-sm">
  <!-- Header -->
  <div class="p-3 border-b border-gray-700 flex justify-between items-center">
    <h3 class="font-semibold text-white">Live Audit Stream</h3>
    <div class="flex items-center gap-2">
      <div class="w-3 h-3 rounded-full {connectionStatus === 'Connected' ? 'bg-green-500' : 'bg-yellow-500'}"></div>
      <span class="text-xs text-gray-400">{connectionStatus}</span>
    </div>
  </div>

  <!-- Live Pipeline Overview (minimal) -->
  <div class="px-3 py-2 border-b border-gray-800 text-xs text-gray-300 flex items-center gap-3 flex-wrap">
    <div class="stage"><span class={"dot " + loraStages.builder}></span> Builder</div>
    <span>→</span>
    <div class="stage"><span class={"dot " + loraStages.approval}></span> Approval</div>
    <span>→</span>
    <div class="stage"><span class={"dot " + loraStages.training}></span> Training</div>
    <span>→</span>
    <div class="stage"><span class={"dot " + loraStages.evaluation}></span> Eval</div>
    <span>→</span>
    <div class="stage"><span class={"dot " + loraStages.activation}></span> Activate</div>
  </div>

  <!-- Log Output -->
  <div bind:this={logContainer} class="flex-1 overflow-y-auto p-4 min-h-0">
    {#if logs.length === 0}
      <div class="text-gray-500">Awaiting real-time system events...</div>
    {/if}
    {#each logs as log}
      <div class="log-entry mb-2">
        <span class="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
        <span class="font-bold mx-2 {getLevelColor(log.level)}">{log.event || log.message || 'Unknown'}</span>
        <span class="text-gray-400">({log.actor} via {log.category})</span>
        {#if log.details || log.metadata}
          <pre class="text-xs text-gray-500 mt-1 ml-4 whitespace-pre-wrap break-words overflow-x-auto opacity-70">{JSON.stringify(log.details || log.metadata, null, 2)}</pre>
        {/if}
      </div>
    {/each}
    <div bind:this={bottomSentinel} style="height: 1px;"></div>
  </div>
</div>

<style>
  .stage { display: inline-flex; align-items: center; gap: 0.35rem; }
  .dot { width: 8px; height: 8px; border-radius: 999px; background: #6b7280; position: relative; }
  .dot.in_progress { background: #3b82f6; }
  .dot.in_progress::after { content: ''; position: absolute; inset: -3px; border-radius: 999px; border: 1px solid rgba(59,130,246,0.35); animation: pulse 1s infinite ease-in-out; }
  .dot.completed { background: #22c55e; }
  .dot.failed { background: #ef4444; }
  .dot.idle { background: #6b7280; }
  @keyframes pulse { 0% { transform: scale(0.9); opacity: 0.8 } 50% { transform: scale(1.1); opacity: 0.3 } 100% { transform: scale(0.9); opacity: 0.8 } }
</style>
