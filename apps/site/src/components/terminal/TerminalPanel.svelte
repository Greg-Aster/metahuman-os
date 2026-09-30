<script lang="ts">
  import { isOwner } from '../../stores/security-policy';
  import TerminalView from './TerminalView.svelte';
</script>

{#if $isOwner}
  <TerminalView />
{:else}
  <p>Terminal access is restricted to the installation owner.</p>
{/if}
