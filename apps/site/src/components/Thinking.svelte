<script lang="ts">
  export let steps = '';
  export let label = '🤔 Thinking...';
  export let initiallyOpen = true;
</script>

<div class="thinking-container">
  <details open={initiallyOpen} class="thinking-details">
    <summary class="summary">{label}</summary>
    <div class="steps">
      <pre>{steps}</pre>
    </div>
  </details>
</div>

<style>
  .thinking-container {
    display: flex;
    justify-content: flex-start;
    width: 100%;
    padding: 0.75rem 0;
  }
  .thinking-details {
    width: 100%;
    max-width: 85%;
    background: rgba(0, 0, 0, 0.03);
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.75rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    overflow: hidden;
  }
  :global(.dark) .thinking-details {
    background: rgba(255, 255, 255, 0.03);
    border-color: rgba(255, 255, 255, 0.1);
  }
  .summary {
    padding: 0.5rem 1rem;
    font-weight: 500;
    cursor: pointer;
    color: rgb(107 114 128);
    font-size: 0.875rem;
  }
  :global(.dark) .summary {
    color: rgb(156 163 175);
  }
  .steps {
    padding: 0 1rem 1rem 1rem;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-size: 0.8rem;
    color: rgb(107 114 128);
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    margin-top: 0.5rem;
    padding-top: 1rem;
  }
  :global(.dark) .steps {
    color: rgb(156 163 175);
    border-top-color: rgba(255, 255, 255, 0.1);
  }
  pre {
    margin: 0;
    font-family: inherit;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
</style>
