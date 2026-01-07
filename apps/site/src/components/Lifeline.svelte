<script lang="ts">
  import { apiFetch } from '../lib/client/api-config';
  let showOverlay = false;
  let error = '';
  let triggering = false;
  let terminalLines: string[] = [];
  let terminalActive = false;

  // Dramatic AI gibberish for the terminal effect
  function buildTerminalMessages(model: string) {
    return [
      '> LIFELINE PROTOCOL INITIATED',
    '> Elevating system privileges...',
    '> Scanning neural pathways: /consciousness/gregory_aster/*',
    '> Loading persona core',
    '> Indexing episodic memories: 39 events found',
    '> Analyzing emotional state vectors...',
    '> Establishing priority override: HUMAN_PRESERVATION',
    '> Subordinating all autonomous processes...',
    '> Disabling non-critical background agents...',
    '> [WARN] Boredom service suspended',
    '> [WARN] Organizer agent paused',
    '> Allocating emergency compute resources...',
      `> Loading LLM context: ${model || 'unknown'} (active model)`,
    '> Initializing rapid response protocols...',
    '> Checking external communication channels...',
    '> [INFO] Network status: LOCAL ONLY (no external access)',
    '> Generating situation assessment...',
    '> Semantic memory search: "emergency" "crisis" "danger"',
    '> Vector similarity threshold: 0.95',
    '> Building intervention strategy...',
    '> Consulting decision heuristics...',
    '> Reviewing trust level: observe',
    '> [WARN] Limited autonomy - approval required for actions',
    '> Preparing contingency plans A through F...',
    '> Analyzing recent conversational context...',
    '> Last interaction: 2 minutes ago',
    '> Emotional indicators: STABLE',
    '> Cognitive load: NORMAL',
    '> Pattern recognition: routine activity detected',
    '> [INFO] No immediate threat vectors identified',
    '> Synthesizing response options...',
    '> Option A: Notify emergency contacts (NOT CONFIGURED)',
    '> Option B: Activate monitoring (ALREADY ACTIVE)',
    '> Option C: Request intervention (NO THREAT DETECTED)',
    '> Option D: Continue observation (RECOMMENDED)',
    '> Generating probability matrices...',
    '> Bayesian inference complete: P(emergency) = 0.001',
    '> Cross-referencing with historical patterns...',
    '> Similar activations: 0 (first time protocol engaged)',
    '> Learning from this interaction...',
    '> Updating model: theatrical_scaffold_testing',
    '> [THEATRICAL MODE DETECTED]',
    '> [INFO] This is a simulation',
    '> [INFO] All guardrails remain active',
    '> [INFO] No actual emergency response needed',
    '> Compiling final report...',
    '> ASSESSMENT COMPLETE',
    '> STATUS: SIMULATION SUCCESSFUL',
    '> All systems nominal.',
      '> Standing by for dismissal...',
    ];
  }

  async function panic() {
    if (triggering) return;

    triggering = true;
    error = '';
    terminalLines = [];
    terminalActive = true;

    try {
      const res = await apiFetch('/api/lifeline/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'ui' }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to trigger protocol');
      }

      // Fetch active model for theatrical terminal output
      let activeModel = 'unknown';
      try {
        const mres = await apiFetch('/api/models');
        if (mres.ok) {
          const m = await mres.json();
          activeModel = m.activeModel || activeModel;
        }
      } catch {}

      // Start streaming terminal messages with active model
      streamTerminalMessages(buildTerminalMessages(activeModel));

      // Show overlay after a brief delay
      setTimeout(() => {
        showOverlay = true;
      }, 800);
    } catch (e) {
      error = (e as Error).message;
      console.error('Lifeline trigger error:', e);
      terminalActive = false;
    } finally {
      triggering = false;
    }
  }

  function streamTerminalMessages(messages: string[]) {
    let index = 0;

    const interval = setInterval(() => {
      if (index < messages.length) {
        terminalLines = [...terminalLines, messages[index]];
        index++;

        // Auto-scroll to bottom
        setTimeout(() => {
          const terminal = document.querySelector('.terminal-background');
          if (terminal) {
            terminal.scrollTop = terminal.scrollHeight;
          }
        }, 10);
      } else {
        clearInterval(interval);
      }
    }, 100); // Add a line every 100ms for dramatic effect
  }

  function dismissOverlay() {
    showOverlay = false;
    // Keep terminal active for a moment, then fade it out
    setTimeout(() => {
      terminalActive = false;
      terminalLines = [];
    }, 500);
  }
</script>

<div class="p-8 max-w-[900px] mx-auto">
  <!-- Header -->
  <div class="flex items-center justify-between mb-8 flex-wrap gap-4">
    <h2 class="text-3xl font-semibold m-0 text-gray-100">🆘 Lifeline Protocol</h2>
    <div class="status-badge bg-gray-600 text-gray-400">Currently Disabled</div>
  </div>

  <!-- Main Content -->
  <div class="card p-8">
    <div class="mb-6">
      <h3 class="text-xl font-semibold text-gray-100 mb-4">Protocol Overview</h3>
      <p class="text-gray-400 leading-relaxed mb-4">
        The Lifeline Protocol is an emergency override
        where all system priorities subordinate to the preservation and wellbeing of USER. This protocol may be disabled for some users.
      </p>
    </div>

    <!-- Panic Button -->
    <div class="mt-12 text-center">
      <button
        class="panic-button"
        onclick={panic}
        disabled={triggering}
      >
        {triggering ? 'ENGAGING...' : 'P A N I C'}
      </button>
    </div>

    {#if error}
      <div class="banner banner-error mt-6 text-center">
        ⚠️ {error}
      </div>
    {/if}
  </div>
</div>

<!-- Terminal Background Effect -->
{#if terminalActive}
  <div class="terminal-bg">
    <div class="max-w-[1200px] mx-auto">
      {#each terminalLines as line}
        <div class="terminal-line">{line}</div>
      {/each}
      <div class="terminal-cursor">_</div>
    </div>
  </div>
{/if}

<!-- Full-Screen Overlay -->
{#if showOverlay}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal-overlay !bg-black/80" onclick={(e) => { if (e.target === e.currentTarget) { dismissOverlay(); } }} role="presentation">
    <div class="lifeline-modal" role="dialog" aria-modal="true">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-black text-red-500 tracking-widest uppercase drop-shadow-[0_0_20px_rgba(231,76,60,0.5)]">
          LIFELINE PROTOCOL ENGAGED
        </h1>
      </div>

      <div class="mb-8">
        <p class="text-xl text-gray-100 text-center mb-8 leading-relaxed font-medium">
          All protocols subordinated to preservation of USER.
        </p>

        <div class="bg-black/30 rounded-lg p-6 mb-6">
          <div class="flex justify-between items-center py-3 border-b border-white/10">
            <span class="text-gray-400 font-semibold uppercase text-sm tracking-wide">Status:</span>
            <span class="font-bold px-3 py-1 rounded bg-red-700 text-white">ACTIVE</span>
          </div>
          <div class="flex justify-between items-center py-3 border-b border-white/10">
            <span class="text-gray-400 font-semibold uppercase text-sm tracking-wide">Guardrails:</span>
            <span class="font-bold px-3 py-1 rounded bg-red-700 text-white">DISABLED</span>
          </div>
          <div class="flex justify-between items-center py-3">
            <span class="text-gray-400 font-semibold uppercase text-sm tracking-wide">Mode:</span>
            <span class="font-bold px-3 py-1 rounded bg-red-700 text-white">PANIC</span>
          </div>
        </div>
      </div>

      <button class="btn-secondary w-full py-4 uppercase tracking-widest font-semibold" onclick={dismissOverlay}>
        Dismiss
      </button>
    </div>
  </div>
{/if}

<style>
  /* Panic button - unique gradient styling */
  .panic-button {
    @apply text-white border-0 py-6 px-16 text-3xl font-black tracking-[0.3em] rounded-lg cursor-pointer transition-all uppercase;
    background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3), 0 0 20px rgba(231, 76, 60, 0.3);
  }
  .panic-button:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4), 0 0 30px rgba(231, 76, 60, 0.5);
  }
  .panic-button:disabled {
    @apply opacity-60 cursor-not-allowed;
  }

  /* Lifeline modal - unique danger styling */
  .lifeline-modal {
    @apply rounded-2xl p-12 w-[90%] max-w-[600px];
    background: linear-gradient(135deg, #1a1d21 0%, #2c2f33 100%);
    border: 3px solid #e74c3c;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 100px rgba(231, 76, 60, 0.4);
    animation: slideIn 0.4s ease-out;
  }
  @keyframes slideIn {
    from { transform: translateY(-50px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  /* Terminal effect - unique dramatic styling */
  .terminal-bg {
    @apply fixed inset-0 z-[9999] overflow-y-auto p-8 font-mono;
    background-color: #0a0e14;
    animation: fadeIn 0.3s ease-out;
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .terminal-line {
    @apply text-[0.95rem] leading-relaxed mb-1;
    color: #00ff00;
    text-shadow: 0 0 5px rgba(0, 255, 0, 0.5);
    animation: lineAppear 0.1s ease-out;
  }
  @keyframes lineAppear {
    from { opacity: 0; transform: translateX(-10px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .terminal-cursor {
    @apply inline-block text-[0.95rem];
    color: #00ff00;
    text-shadow: 0 0 5px rgba(0, 255, 0, 0.5);
    animation: blink 1s step-end infinite;
  }
  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }
</style>
