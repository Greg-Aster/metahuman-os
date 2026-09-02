export interface SerialTaskQueue {
  enqueue: (task: () => Promise<void>) => void;
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
  let tail = Promise.resolve();

  return {
    enqueue(task) {
      if (failed) return;
      if (pendingTasks >= maximumPendingTasks) {
        failed = true;
        onError(new Error(`Serial task queue exceeded ${maximumPendingTasks} pending tasks`));
        return;
      }
      pendingTasks += 1;
      tail = tail
        .then(async () => {
          try {
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
    },
    drain() {
      return tail;
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
