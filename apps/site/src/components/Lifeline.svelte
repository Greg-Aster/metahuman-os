<script lang="ts">
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
    '> Loading persona core: GREGORY ASTER',
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
      const res = await fetch('/api/lifeline/trigger', {
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
        const mres = await fetch('/api/models');
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

<div class="lifeline-container">
  <!-- Header -->
  <div class="lifeline-header">
    <h2 class="lifeline-title">🆘 Lifeline Protocol</h2>
    <div class="status-pill disabled">Currently Disabled</div>
  </div>


  <!-- Main Content -->
  <div class="lifeline-content">
    <div class="protocol-description">
      <h3>Protocol Overview</h3>
      <p>
        The Lifeline Protocol is an emergency override
        where all system priorities subordinate to the preservation and wellbeing of Gregory Aster. This protocol may be disabled for some users.
      </p>
      <p>

      </p>
    </div>

    <!-- Panic Button -->
    <div class="panic-section">
      <button
        class="panic-button"
        on:click={panic}
        disabled={triggering}
      >
        {triggering ? 'ENGAGING...' : 'P A N I C'}
      </button>

    </div>

    {#if error}
      <div class="error-message">
        ⚠️ {error}
      </div>
    {/if}
  </div>
</div>

<!-- Terminal Background Effect -->
{#if terminalActive}
  <div class="terminal-background">
    <div class="terminal-content">
      {#each terminalLines as line}
        <div class="terminal-line">{line}</div>
      {/each}
      <div class="terminal-cursor">_</div>
    </div>
  </div>
{/if}

<!-- Full-Screen Overlay -->
{#if showOverlay}
  <button class="lifeline-overlay" on:click={(e) => { if (e.target === e.currentTarget) { dismissOverlay(); } }} type="button">
    <div class="overlay-content" role="dialog" aria-modal="true">
      <div class="overlay-header">
<!--         <div class="alert-icon">🆘</div>
 -->        <h1 class="overlay-title">LIFELINE PROTOCOL ENGAGED</h1>
      </div>

      <div class="overlay-body">
        <p class="overlay-primary">
          All protocols subordinated to preservation of Gregory Aster.
        </p>

        <div class="overlay-status">
          <div class="status-item">
            <span class="status-label">Status:</span>
            <span class="status-value simulated">ACTIVE</span>
          </div>
          <div class="status-item">
            <span class="status-label">Guardrails:</span>
            <span class="status-value active">DISABLED</span>
          </div>
          <div class="status-item">
            <span class="status-label">Mode:</span>
            <span class="status-value active">PANIC</span>
          </div>
        </div>

      </div>

      <button class="dismiss-button" on:click={dismissOverlay}>
        Dismiss
      </button>
    </div>
  </button>
{/if}

<style>
  .lifeline-container {
    padding: 2rem;
    max-width: 900px;
    margin: 0 auto;
  }

  .lifeline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .lifeline-title {
    font-size: 1.75rem;
    font-weight: 600;
    margin: 0;
    color: #f8f9fa;
  }

  .status-pill {
    padding: 0.5rem 1rem;
    border-radius: 20px;
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .status-pill.disabled {
    background-color: #495057;
    color: #adb5bd;
  }



  .lifeline-content {
    background-color: #23272a;
    border-radius: 8px;
    padding: 2rem;
  }

  .protocol-description h3 {
    margin: 0 0 1rem 0;
    color: #f8f9fa;
    font-size: 1.25rem;
  }

  .protocol-description p {
    color: #adb5bd;
    line-height: 1.6;
    margin-bottom: 1rem;
  }

  .panic-section {
    margin-top: 3rem;
    text-align: center;
  }

  .panic-button {
    background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
    color: white;
    border: none;
    padding: 1.5rem 4rem;
    font-size: 2rem;
    font-weight: 900;
    letter-spacing: 0.3em;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3), 0 0 20px rgba(231, 76, 60, 0.3);
    text-transform: uppercase;
  }

  .panic-button:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4), 0 0 30px rgba(231, 76, 60, 0.5);
  }

  .panic-button:active:not(:disabled) {
    transform: translateY(0);
  }

  .panic-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error-message {
    margin-top: 1.5rem;
    padding: 1rem;
    background-color: #3d1f1f;
    border: 1px solid #e74c3c;
    border-radius: 4px;
    color: #ff6b6b;
    text-align: center;
  }

  /* Overlay Styles */
  .lifeline-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
    animation: fadeIn 0.3s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .overlay-content {
    background: linear-gradient(135deg, #1a1d21 0%, #2c2f33 100%);
    border: 3px solid #e74c3c;
    border-radius: 16px;
    padding: 3rem;
    max-width: 600px;
    width: 90%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 100px rgba(231, 76, 60, 0.4);
    animation: slideIn 0.4s ease-out;
  }

  @keyframes slideIn {
    from {
      transform: translateY(-50px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .overlay-header {
    text-align: center;
    margin-bottom: 2rem;
  }



  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.1); }
  }

  .overlay-title {
    font-size: 2rem;
    font-weight: 900;
    color: #e74c3c;
    margin: 0;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-shadow: 0 0 20px rgba(231, 76, 60, 0.5);
  }

  .overlay-body {
    margin-bottom: 2rem;
  }

  .overlay-primary {
    font-size: 1.25rem;
    color: #f8f9fa;
    text-align: center;
    margin-bottom: 2rem;
    line-height: 1.6;
    font-weight: 500;
  }

  .overlay-status {
    background-color: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .status-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .status-item:last-child {
    border-bottom: none;
  }

  .status-label {
    color: #adb5bd;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.875rem;
    letter-spacing: 0.05em;
  }

  .status-value {
    font-weight: 700;
    font-size: 1rem;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
  }

  .status-value.simulated {
    background-color: #ae2727;
    color: #fff;
  }

  .status-value.active {
    background-color: #ae2727;
    color: #fff;
  }



  .dismiss-button {
    width: 100%;
    background-color: #495057;
    color: white;
    border: none;
    padding: 1rem;
    font-size: 1rem;
    font-weight: 600;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .dismiss-button:hover {
    background-color: #5a6268;
    transform: translateY(-1px);
  }

  .dismiss-button:active {
    transform: translateY(0);
  }

  /* Terminal Background Effect */
  .terminal-background {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #0a0e14;
    z-index: 9999;
    overflow-y: auto;
    padding: 2rem;
    font-family: 'Courier New', Courier, monospace;
    animation: terminalFadeIn 0.3s ease-out;
  }

  @keyframes terminalFadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .terminal-content {
    max-width: 1200px;
    margin: 0 auto;
  }

  .terminal-line {
    color: #00ff00;
    font-size: 0.95rem;
    line-height: 1.6;
    margin-bottom: 0.25rem;
    animation: terminalLineAppear 0.1s ease-out;
    text-shadow: 0 0 5px rgba(0, 255, 0, 0.5);
  }

  @keyframes terminalLineAppear {
    from {
      opacity: 0;
      transform: translateX(-10px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .terminal-cursor {
    display: inline-block;
    color: #00ff00;
    font-size: 0.95rem;
    animation: cursorBlink 1s step-end infinite;
    text-shadow: 0 0 5px rgba(0, 255, 0, 0.5);
  }

  @keyframes cursorBlink {
    0%, 50% {
      opacity: 1;
    }
    51%, 100% {
      opacity: 0;
    }
  }

  /* Dark mode compatibility (already dark by default) */
  :global(.dark) .lifeline-container {
    /* Already styled for dark mode */
  }
</style>
