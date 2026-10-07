<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import type { TerminalEvent, TerminalState } from '@metahuman/core/terminal/types';
  import { TerminalController } from './controller';
  import { statusRefreshTrigger } from '../../stores/navigation';

  let state: TerminalState = { status: 'stopped', sessions: [] };
  let selected = '';
  let error = '';
  let busy = false;
  let container: HTMLDivElement;
  let controller: TerminalController;
  let terminal: Terminal;
  let fit: FitAddon;
  let screenReady = false;
  let disposed = false;
  let screenVersion = 0;
  $: current = state.sessions.find(session => session.id === selected);

  async function action(work: () => Promise<void>) {
    busy = true; error = '';
    try { await work(); selected = controller.selected; }
    catch (cause) { if ((cause as Error).name !== 'AbortError') error = (cause as Error).message; }
    finally { busy = false; }
  }
  function fitScreen() {
    if (!screenReady || !container?.clientHeight || !container?.clientWidth) return;
    const size = fit.proposeDimensions();
    if (!size) return;
    const cols = Math.max(2, Math.min(300, size.cols));
    const rows = Math.max(2, Math.min(120, size.rows));
    if (terminal.cols === cols && terminal.rows === rows) return;
    terminal.resize(cols, rows);
    void controller.resize(cols, rows).catch(cause => { if (cause.name !== 'AbortError') error = cause.message; });
  }
  function select(id: string) {
    screenVersion++; screenReady = false; selected = id; terminal.reset(); controller.select(id);
  }
  function receive(event: TerminalEvent) {
    if (event.type === 'error') { screenVersion++; error = event.error; screenReady = false; }
    else if (event.type === 'state') {
      state = event.state;
      if (state.status !== 'running') { screenVersion++; screenReady = false; }
      if (selected && !state.sessions.some(session => session.id === selected)) { selected = ''; screenReady = false; }
      const size = state.sessions.find(session => session.id === selected);
      if (size && screenReady) terminal.resize(size.cols, size.rows);
    } else if (event.id === controller.selected && event.type === 'screen') {
      selected = event.id; terminal.reset(); terminal.resize(event.cols, event.rows);
      const version = ++screenVersion;
      terminal.write(event.data, () => { if (!disposed && version === screenVersion) { screenReady = true; fitScreen(); } });
      error = ''; terminal.focus();
    } else if (event.id === selected && event.type === 'output') terminal.write(event.data);
  }
  onMount(() => {
    terminal = new Terminal({ cursorBlink: true, scrollback: 2000, fontSize: 13, theme: { background: '#11131a' } });
    fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(container);
    controller = new TerminalController(receive, message => { screenVersion++; error = message; screenReady = false; });
    const input = terminal.onData(data => { if (screenReady && current?.kind === 'shell' && current.phase === 'running') controller.input(data); });
    const observer = new ResizeObserver(fitScreen); observer.observe(container);
    const unsubscribe = statusRefreshTrigger.subscribe(() => { void action(() => controller.refresh()); });
    return () => { unsubscribe(); disposed = true; screenReady = false; observer.disconnect(); input.dispose(); controller.dispose(); terminal.dispose(); };
  });
</script>

<section class="terminal-panel" aria-label="System terminal">
    <div class="toolbar">
      <strong>Terminal</strong><span class="status">{state.status}</span>
      {#if state.status === 'stopped'}
        <button disabled={busy} on:click={() => action(() => controller.control('start'))}>Start terminal</button>
      {:else}
        <button disabled={busy || state.status !== 'running'} on:click={() => action(() => controller.create('shell'))}>New shell</button>
        <button disabled={busy || state.status !== 'running'} on:click={() => action(() => controller.create('log'))}>Server log</button>
        <button disabled={busy} on:click={() => action(() => controller.control('stop'))}>Stop terminal</button>
      {/if}
      <button disabled={busy} on:click={() => action(() => controller.refresh())}>Reconnect</button>
    </div>
    {#if error}<div role="alert" class="error">{error}</div>{/if}
    <div class="tabs" aria-label="Terminal sessions">
      {#each state.sessions as session (session.id)}
        <div class:active={session.id === selected}>
          <button title={session.error || session.phase} on:click={() => select(session.id)}>{session.title} · {session.phase}</button>
          <button disabled={busy} aria-label={`Close ${session.title}`} on:click={() => action(() => controller.close(session.id))}>×</button>
        </div>
      {/each}
    </div>
    {#if !state.sessions.length}
      <p class="hint">{state.status === 'stopped' ? 'Start Terminal when you need it. It is off by default.' : 'Open a shell or server log. Hiding this panel keeps sessions running; Stop terminal closes them all.'}</p>
    {/if}
  <div class="screen" class:hidden={!selected} bind:this={container}></div>
</section>

<style>
  .terminal-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #11131a; color: #e4e6ee; font-family: system-ui, sans-serif; }
  .toolbar, .tabs { display: flex; align-items: center; flex-wrap: wrap; gap: .45rem; padding: .5rem; }
  .toolbar { border-bottom: 1px solid #343847; }
  .status, .hint { color: #a7adbd; font-size: .8rem; }
  .hint { padding: .5rem 1rem; }
  button { padding: .3rem .6rem; border: 1px solid #414859; border-radius: .3rem; background: #222735; color: inherit; font-size: .8rem; }
  button:disabled { opacity: .5; }
  .tabs > div { display: flex; border-radius: .3rem; }
  .tabs > div.active { outline: 1px solid #9b8cff; }
  .screen { flex: 1; min-height: 0; padding: .3rem; overflow: hidden; }
  .screen.hidden { visibility: hidden; }
  .error { color: #ffb5b5; padding: .4rem .8rem; font-size: .85rem; }
  :global(.terminal-panel .xterm) { height: 100%; }
</style>
