<script lang="ts">
  export let steps = '';
  export let label = '🤔 Thinking...';
  export let initiallyOpen = true;
</script>

<div class="flex justify-start w-full py-3">
  <details open={initiallyOpen} class="w-full max-w-[85%] bg-black/[0.03] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded-xl font-mono overflow-hidden">
    <summary class="px-4 py-2 font-medium cursor-pointer text-gray-500 dark:text-gray-400 text-sm">
      {label}
    </summary>
    <div class="px-4 pb-4 whitespace-pre-wrap break-words text-xs text-gray-500 dark:text-gray-400 border-t border-black/10 dark:border-white/10 mt-2 pt-4">
      <pre class="m-0 font-[inherit] whitespace-pre-wrap overflow-wrap-anywhere break-words">{steps}</pre>
    </div>
  </details>
</div>
