export interface GraphHistory<T> {
  past: T[]
  future: T[]
}

export interface HistoryTransition<T> {
  history: GraphHistory<T>
  value: T | null
}

export function emptyGraphHistory<T>(): GraphHistory<T> {
  return { past: [], future: [] }
}

export function recordGraphHistory<T>(
  history: GraphHistory<T>,
  current: T,
  limit = 100,
): GraphHistory<T> {
  return {
    past: [...history.past, current].slice(-limit),
    future: [],
  }
}

export function undoGraphHistory<T>(history: GraphHistory<T>, current: T): HistoryTransition<T> {
  if (history.past.length === 0) return { history, value: null }
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future],
    },
    value: history.past.at(-1) ?? null,
  }
}

export function redoGraphHistory<T>(history: GraphHistory<T>, current: T): HistoryTransition<T> {
  if (history.future.length === 0) return { history, value: null }
  return {
    history: {
      past: [...history.past, current],
      future: history.future.slice(1),
    },
    value: history.future[0],
  }
}
