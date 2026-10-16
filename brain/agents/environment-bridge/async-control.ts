export interface SerialTaskQueue {
  enqueue: (task: () => Promise<void>, orderingKey?: string, dependency?: Promise<void>) => Promise<void>;
  pending: (orderingKey?: string) => Promise<void>;
  drain: () => Promise<void>;
}

export function createSerialTaskQueue(
  onError: (error: unknown) => void,
): SerialTaskQueue {
  let failed = false;
  const tails = new Map<string, Promise<void>>();
  const pending = (key = 'adapter') => tails.get(key) ?? Promise.resolve();

  return {
    enqueue(task, orderingKey = 'adapter', dependency) {
      if (failed) return Promise.resolve();
      const tail = pending(orderingKey)
        .then(async () => {
          if (dependency) await dependency;
          if (!failed) await task();
        })
        .catch(error => {
          if (failed) return;
          failed = true;
          onError(error);
        });
      tails.set(orderingKey, tail);
      void tail.then(() => { if (tails.get(orderingKey) === tail) tails.delete(orderingKey); });
      return tail;
    },
    pending,
    async drain() {
      while (tails.size) await Promise.all(tails.values());
    },
  };
}

export function createCoalescedTaskRunner(
  task: () => Promise<void>,
): () => Promise<void> {
  let requested = false;
  let inFlight: Promise<void> | undefined;

  return () => {
    requested = true;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        while (requested) {
          requested = false;
          await task();
        }
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };
}
