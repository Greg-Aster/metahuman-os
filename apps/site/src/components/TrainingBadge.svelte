<script lang="ts">
  /**
   * TrainingBadge
   * Reusable badge component for displaying training readiness status
   */

  export let ready: boolean = false;
  export let samples: number = 0;
  export let duration: number = 0;
  export let quality: number = 0;
  export let requiredSamples: number = 0;
  export let requiredDuration: number = 0;
  export let requiredQuality: number = 0;
  export let size: 'small' | 'medium' | 'large' = 'medium';
  export let showDetails: boolean = false;

  function formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  }

  $: samplesPercent = requiredSamples > 0 ? Math.min((samples / requiredSamples) * 100, 100) : 0;
  $: durationPercent = requiredDuration > 0 ? Math.min((duration / requiredDuration) * 100, 100) : 0;
  $: qualityPercent = requiredQuality > 0 ? Math.min((quality / requiredQuality) * 100, 100) : 0;
  $: overallPercent = (samplesPercent + durationPercent + qualityPercent) / 3;
</script>

<div class="training-badge size-{size}" class:ready class:not-ready={!ready}>
  <div class="badge-status">
    {#if ready}
      <span class="status-icon">✓</span>
      <span class="status-text">Ready for Training</span>
    {:else}
      <span class="status-icon">⏳</span>
      <span class="status-text">Not Ready</span>
    {/if}
  </div>

  {#if showDetails}
    <div class="badge-details">
      <div class="detail-item">
        <div class="detail-header">
          <span class="detail-label">Samples</span>
          <span class="detail-value">{samples} / {requiredSamples}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: {samplesPercent}%"></div>
        </div>
      </div>

      <div class="detail-item">
        <div class="detail-header">
          <span class="detail-label">Duration</span>
          <span class="detail-value">{formatDuration(duration)} / {formatDuration(requiredDuration)}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: {durationPercent}%"></div>
        </div>
      </div>

      <div class="detail-item">
        <div class="detail-header">
          <span class="detail-label">Quality</span>
          <span class="detail-value">{(quality * 100).toFixed(0)}% / {(requiredQuality * 100).toFixed(0)}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: {qualityPercent}%"></div>
        </div>
      </div>

      <div class="overall-progress">
        <span class="overall-label">Overall Progress</span>
        <div class="overall-bar">
          <div class="overall-fill" style="width: {overallPercent}%"></div>
          <span class="overall-text">{overallPercent.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .training-badge {
    border-radius: 8px;
    padding: 12px;
    transition: all 0.3s;
  }

  .training-badge.ready {
    background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
    border: 2px solid #10b981;
  }

  .training-badge.not-ready {
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
    border: 2px solid #f59e0b;
  }

  :global(.dark) .training-badge.ready {
    background: linear-gradient(135deg, #064e3b 0%, #047857 100%);
    border-color: #059669;
  }

  :global(.dark) .training-badge.not-ready {
    background: linear-gradient(135deg, #78350f 0%, #92400e 100%);
    border-color: #d97706;
  }

  .training-badge.size-small {
    padding: 8px;
  }

  .training-badge.size-medium {
    padding: 12px;
  }

  .training-badge.size-large {
    padding: 16px;
  }

  .badge-status {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-icon {
    font-size: 1.2rem;
  }

  .size-small .status-icon {
    font-size: 1rem;
  }

  .size-large .status-icon {
    font-size: 1.5rem;
  }

  .status-text {
    font-weight: 700;
    font-size: 1rem;
  }

  .size-small .status-text {
    font-size: 0.85rem;
  }

  .size-large .status-text {
    font-size: 1.2rem;
  }

  .ready .status-text {
    color: #065f46;
  }

  .not-ready .status-text {
    color: #92400e;
  }

  :global(.dark) .ready .status-text {
    color: #6ee7b7;
  }

  :global(.dark) .not-ready .status-text {
    color: #fcd34d;
  }

  .badge-details {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .badge-details {
    border-top-color: rgba(255, 255, 255, 0.1);
  }

  .detail-item {
    margin-bottom: 10px;
  }

  .detail-item:last-child {
    margin-bottom: 0;
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .detail-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: rgba(0, 0, 0, 0.7);
  }

  :global(.dark) .detail-label {
    color: rgba(255, 255, 255, 0.7);
  }

  .detail-value {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(0, 0, 0, 0.6);
  }

  :global(.dark) .detail-value {
    color: rgba(255, 255, 255, 0.6);
  }

  .progress-bar {
    height: 6px;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 3px;
    overflow: hidden;
  }

  :global(.dark) .progress-bar {
    background: rgba(255, 255, 255, 0.1);
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #10b981);
    transition: width 0.5s ease;
    border-radius: 3px;
  }

  :global(.dark) .progress-fill {
    background: linear-gradient(90deg, #1e40af, #047857);
  }

  .overall-progress {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .overall-progress {
    border-top-color: rgba(255, 255, 255, 0.1);
  }

  .overall-label {
    display: block;
    font-size: 0.85rem;
    font-weight: 700;
    margin-bottom: 6px;
    color: rgba(0, 0, 0, 0.8);
  }

  :global(.dark) .overall-label {
    color: rgba(255, 255, 255, 0.8);
  }

  .overall-bar {
    position: relative;
    height: 24px;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 12px;
    overflow: hidden;
  }

  :global(.dark) .overall-bar {
    background: rgba(255, 255, 255, 0.1);
  }

  .overall-fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #10b981);
    transition: width 0.5s ease;
    border-radius: 12px;
  }

  :global(.dark) .overall-fill {
    background: linear-gradient(90deg, #1e40af, #047857);
  }

  .overall-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 0.8rem;
    font-weight: 700;
    color: rgba(0, 0, 0, 0.8);
    text-shadow: 0 1px 2px rgba(255, 255, 255, 0.5);
  }

  :global(.dark) .overall-text {
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }
</style>
