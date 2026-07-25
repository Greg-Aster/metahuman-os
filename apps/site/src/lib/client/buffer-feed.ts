export type BufferSource = 'conversation' | 'inner' | 'system' | 'robot';
export type BufferView = 'conversation' | 'inner' | 'system';

export interface FeedMessage {
  timestamp?: number;
  meta?: Record<string, any> | null;
}

export function stampBufferSource<T extends FeedMessage>(
  message: T,
  source: BufferSource,
): T {
  return {
    ...message,
    meta: { ...(message.meta || {}), bufferSource: source },
  };
}

export function replaceBufferSlice<T extends FeedMessage>(
  current: T[],
  source: BufferSource,
  replacement: T[],
): T[] {
  return [
    ...current.filter(message => message.meta?.bufferSource !== source),
    ...replacement.map(message => stampBufferSource(message, source)),
  ].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
}

/**
 * Project canonical buffer records into the three selectable chat views.
 * Selection controls reads only; it has no relationship to compose target.
 */
export function projectBufferFeed<T extends FeedMessage>(
  messages: T[],
  selectedViews: ReadonlySet<BufferView>,
): T[] {
  return messages
    .filter(message => {
      const source = message.meta?.bufferSource;
      if (source === 'conversation') return selectedViews.has('conversation');
      if (source === 'inner') return selectedViews.has('inner');
      if (source === 'system' || source === 'robot') return selectedViews.has('system');
      return false;
    })
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
}
