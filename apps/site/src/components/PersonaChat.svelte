<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
  }

  let messages: Message[] = [];
  let userInput = '';
  let isLoading = false;
  let chatContainer: HTMLDivElement;
  let autoScroll = true;
  let bottomSentinel: HTMLDivElement;
  let observer: IntersectionObserver | null = null;
  type Mode = 'inner' | 'conversation';
  let mode: Mode = 'inner';
  let audience = '';
  let reasoningEnabled = false;

  // Auto-scroll on new messages
  $: if (messages.length > 0 && autoScroll && bottomSentinel) {
    requestAnimationFrame(() => {
      bottomSentinel?.scrollIntoView({ block: 'end', inline: 'nearest' });
    });
  }

  // Initialize session on component mount
  onMount(() => {
    // Load reasoning toggle from shared chatPrefs
    try {
      const raw = localStorage.getItem('chatPrefs');
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.reasoningEnabled === 'boolean') reasoningEnabled = p.reasoningEnabled;
      }
    } catch {}
    if (chatContainer && bottomSentinel) {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          autoScroll = entry.isIntersecting;
        },
        { root: chatContainer, threshold: 0.99 }
      );
      observer.observe(bottomSentinel);
    }
    messages = [{ role: 'system', content: 'Starting inner dialogue...' }];
    fetch('/api/persona_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newSession: true, mode })
    })
    .then(res => res.json())
    .then(data => {
        messages = [{ role: 'assistant', content: 'Hello. What’s on your mind?' }];
    })
    .catch(err => {
        messages = [{ role: 'assistant', content: `Error connecting: ${err.message}` }];
    });
    onDestroy(() => {
      observer?.disconnect();
      observer = null;
    });
  });

  function push(role: Message['role'], content: string) {
    const trimmed = (content || '').trim();
    if (!trimmed) return;
    const back = messages.slice(-3);
    if (back.some(m => m.role === role && (m.content || '').trim() === trimmed)) return;
    messages = [...messages, { role, content: trimmed }];
  }

  async function sendMessage() {
    if (!userInput.trim() || isLoading) return;

    const newUserMessage: Message = { role: 'user', content: userInput };
    push('user', newUserMessage.content);
    userInput = '';
    isLoading = true;

    try {
      let llm: any = undefined;
      try { const raw = localStorage.getItem('llmOptions'); if (raw) llm = JSON.parse(raw); } catch {}
      const response = await fetch('/api/persona_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newUserMessage.content, mode, audience: mode === 'conversation' ? audience : undefined, reason: reasoningEnabled, llm }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'An unknown error occurred.');
      }

      if (!data.duplicate) {
        push('assistant', data.response);
      }

    } catch (error) {
      push('assistant', `Sorry, I encountered an error: ${(error as Error).message}`);
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="persona-chat-container h-full flex flex-col bg-gray-50 dark:bg-gray-900 border-t-2 border-gray-200 dark:border-gray-700">
  <!-- Header -->
  <div class="p-3 border-b border-gray-200 dark:border-gray-700">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <h3 class="font-semibold">{mode === 'inner' ? 'Inner Dialogue' : 'Conversation'}</h3>
      <div class="flex items-center gap-2">
        <button class="px-3 py-1 text-xs rounded border {mode === 'inner' ? 'bg-blue-600 text-white border-blue-600' : 'bg-transparent'}" on:click={() => { mode = 'inner'; audience = ''; fetch('/api/persona_chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newSession: true, mode }) }).then(() => { messages = [{ role: 'system', content: 'Starting inner dialogue...' }]; }); }}>Inner</button>
        <button class="px-3 py-1 text-xs rounded border {mode === 'conversation' ? 'bg-blue-600 text-white border-blue-600' : 'bg-transparent'}" on:click={() => { mode = 'conversation'; fetch('/api/persona_chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newSession: true, mode }) }).then(() => { messages = [{ role: 'system', content: 'Starting conversation drafting...' }]; }); }}>Conversation</button>
        {#if mode === 'conversation'}
          <input type="text" bind:value={audience} placeholder="Audience / person (optional)" class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800" />
        {/if}
        <label class="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" bind:checked={reasoningEnabled} on:change={() => { try { const raw = localStorage.getItem('chatPrefs'); const p = raw ? JSON.parse(raw) : {}; localStorage.setItem('chatPrefs', JSON.stringify({ ...p, reasoningEnabled })); } catch {} }} />
          Reasoning
        </label>
      </div>
    </div>
  </div>

  <!-- Message Display -->
  <div bind:this={chatContainer} class="flex-1 overflow-y-auto p-4 space-y-4">
    {#each messages as msg}
      {#if msg.role === 'user'}
        <div class="flex justify-end">
          <div class="p-3 rounded-lg bg-blue-500 text-white max-w-lg">
            {msg.content}
          </div>
        </div>
      {:else if msg.role === 'assistant'}
        <div class="flex justify-start">
          <div class="p-3 rounded-lg bg-gray-200 dark:bg-gray-700 max-w-lg">
            {msg.content}
          </div>
        </div>
      {/if}
    {/each}
    {#if isLoading}
        <div class="flex justify-start">
            <div class="p-3 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse">
                ...
            </div>
        </div>
    {/if}
    <div bind:this={bottomSentinel} style="height: 1px;"></div>
  </div>

  <!-- Input Area -->
  <div class="p-3 border-t border-gray-200 dark:border-gray-700">
    <div class="flex items-center gap-2">
      <input
        type="text"
        bind:value={userInput}
        on:keydown={(e) => e.key === 'Enter' && sendMessage()}
        placeholder={mode === 'inner' ? 'Think out loud… (inner dialogue)' : 'Draft what I would say… (conversation)'}
        disabled={isLoading}
        class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-brand"
      />
      <button on:click={sendMessage} disabled={!userInput.trim() || isLoading} class="btn">
        Send
      </button>
    </div>
  </div>
</div>
