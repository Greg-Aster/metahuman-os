export interface ServerEvent {
  event: string;
  data: string;
}

/** Read complete SSE frames across arbitrary transport and UTF-8 boundaries. */
export async function* readServerEvents(response: Response, signal?: AbortSignal): AsyncGenerator<ServerEvent> {
  if (!response.body) throw new Error('No response stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let line = '';
  let event = '';
  let data: string[] = [];
  let skipLF = false;
  let finished = false;
  let cancellation = Promise.resolve();
  let cancelError: unknown;
  const abort = () => {
    cancellation = reader.cancel(signal?.reason).catch(error => { cancelError = error; });
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) abort();
    signal?.throwIfAborted();
    while (true) {
      const result = await reader.read();
      signal?.throwIfAborted();
      if (result.done) { finished = true; break; }
      for (const char of decoder.decode(result.value, { stream: true })) {
        if (skipLF && char === '\n') { skipLF = false; continue; }
        skipLF = false;
        if (char !== '\r' && char !== '\n') { line += char; continue; }
        skipLF = char === '\r';
        if (line === '') {
          if (data.length) {
            signal?.throwIfAborted();
            yield { event: event || 'message', data: data.join('\n') };
          }
          event = '';
          data = [];
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          let value = colon < 0 ? '' : line.slice(colon + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'event') event = value;
          else if (field === 'data') data.push(value);
        }
        line = '';
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    try {
      if (!finished && !signal?.aborted) await reader.cancel();
      await cancellation;
      if (cancelError) throw cancelError;
    } finally { reader.releaseLock(); }
  }
}
