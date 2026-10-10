export interface SerialTaskQueue {
  enqueue: (task: () => Promise<void>, orderingKey?: string, dependency?: Promise<void>) => Promise<void>;
  pending: (orderingKey?: string) => Promise<void>;
  drain: () => Promise<void>;
}

export function createSerialTaskQueue(
  onError: (error: unknown) => void,
  maximumPendingTasks: number,
): SerialTaskQueue {
  if (!Number.isInteger(maximumPendingTasks) || maximumPendingTasks < 1) {
    throw new Error('Serial task queue capacity must be a positive integer');
  }

  let failed = false;
  let pendingTasks = 0;
  const tails = new Map<string, Promise<void>>();
  const pending = (key = 'adapter') => tails.get(key) ?? Promise.resolve();

  return {
    enqueue(task, orderingKey = 'adapter', dependency) {
      if (failed) return Promise.resolve();
      if (pendingTasks >= maximumPendingTasks) {
        failed = true;
        onError(new Error(`Serial task queue exceeded ${maximumPendingTasks} pending tasks`));
        return Promise.resolve();
      }
      pendingTasks += 1;
      const tail = pending(orderingKey)
        .then(async () => {
          try {
            if (dependency) await dependency;
            if (!failed) await task();
          } finally {
            pendingTasks -= 1;
          }
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
