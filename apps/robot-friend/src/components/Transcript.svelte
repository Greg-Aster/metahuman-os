<script lang="ts">
  import type { TranscriptMessage } from '../lib/types'

  export let messages: TranscriptMessage[] = []
</script>

<section class="transcript" aria-label="Conversation transcript">
  {#if messages.length === 0}
    <div class="empty-transcript">
      <p>No conversation yet.</p>
      <span>Start listening or type a message.</span>
    </div>
  {:else}
    {#each messages as message (message.id)}
      <article class={`message ${message.role}`}>
        <span>{message.role}</span>
        <p>{message.text}</p>
      </article>
    {/each}
  {/if}
</section>
