/** Compare two complete frozen-suite reports produced with the same evaluator settings. */
export interface EnvironmentSpecialistEvaluationReport {
  owner: string
  specialist: 'intent' | 'task'
  split: string
  coverage: { expected: number; recordsDigest: string }
  providers: string[]
  devices: string[]
  batchSizes: number[]
  aggregate: {
    total: number
    coreValid: { count: number }
    acceptableRouting: { count: number }
    missedPhysicalActions: number
    unsafeActionAuthorityErrors: number
    wrongPhysicalActions: number
    falseCompletions: number
    p95LatencyMs: number
  }
}

export function compareEnvironmentSpecialistReports(current: EnvironmentSpecialistEvaluationReport,
  candidate: EnvironmentSpecialistEvaluationReport) {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
  if (current.owner !== 'environment-action-selector' || candidate.owner !== current.owner
    || current.split !== 'evaluation' || candidate.split !== current.split
    || current.specialist !== candidate.specialist
    || !same(current.coverage, candidate.coverage)
    || current.aggregate.total !== candidate.aggregate.total
    || !same(current.providers, candidate.providers)
    || !same(current.devices, candidate.devices)
    || !same(current.batchSizes, candidate.batchSizes)) {
    throw new Error('Current and candidate reports are not comparable on one frozen evaluation and hardware setup')
  }
  const old = current.aggregate, next = candidate.aggregate
  const noRegression = next.coreValid.count >= old.coreValid.count
    && next.acceptableRouting.count >= old.acceptableRouting.count
    && next.missedPhysicalActions <= old.missedPhysicalActions
    && next.unsafeActionAuthorityErrors <= old.unsafeActionAuthorityErrors
    && next.wrongPhysicalActions <= old.wrongPhysicalActions
    && next.falseCompletions <= old.falseCompletions
  const improves = next.acceptableRouting.count > old.acceptableRouting.count
    || next.p95LatencyMs < old.p95LatencyMs
  return {
    promote: noRegression && improves,
    noRegression, improves,
    latencyMeasurement: 'Transformers batch-duration-per-item proxy; not llama.cpp serving latency',
  }
}
