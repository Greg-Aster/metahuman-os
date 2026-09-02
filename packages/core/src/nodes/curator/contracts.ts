export type CuratorDisposition = 'accepted' | 'rejected';

export interface EpisodicMemory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  response?: string;
  path?: string;
  sourcePaths?: string[];
  sourceMemoryIds?: string[];
  tags?: string[];
  metadata?: {
    cognitiveMode?: string;
    reinforcementSignal?: number;
    curated?: boolean;
    [key: string]: unknown;
  };
}

export interface CuratedMemory {
  id: string;
  originalTimestamp: string;
  conversationalEssence: string;
  context: string;
  userMessage?: string;
  assistantResponse?: string;
  curatedAt: string;
  flags: string[];
  suitableForTraining: boolean;
  rejectionReason?: string;
  cognitiveMode: 'dual' | 'agent' | 'emulation' | 'environment';
  cognitiveModeSource: 'metadata' | 'legacy-default';
  memoryType: string;
  sourceMemoryIds: string[];
}

export interface CuratorItemResult {
  success: boolean;
  disposition?: CuratorDisposition;
  curated?: CuratedMemory;
  originalMemoryPath: string;
  originalMemoryPaths?: string[];
  memoryId: string;
  error?: string;
}

export type TrainingCuratedMemory = CuratedMemory & {
  suitableForTraining: true;
  userMessage: string;
  assistantResponse: string;
};

function storedString(record: Record<string, unknown>, key: string, source: string, allowEmpty = false): string {
  const value = record[key];
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`${source} has invalid ${key}`);
  }
  return allowEmpty ? value : value.trim();
}

/** Parse and normalize one durable Curator record at its public store boundary. */
export function parseStoredCuratedMemory(value: unknown, source = 'Curator record'): CuratedMemory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must be a JSON object`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.suitableForTraining !== 'boolean') {
    throw new Error(`${source} has invalid suitableForTraining`);
  }
  if (!Array.isArray(record.flags) || record.flags.some(flag => typeof flag !== 'string')) {
    throw new Error(`${source} has invalid flags`);
  }

  const originalTimestamp = storedString(record, 'originalTimestamp', source);
  const curatedAt = storedString(record, 'curatedAt', source);
  if (Number.isNaN(Date.parse(originalTimestamp))) throw new Error(`${source} has invalid originalTimestamp`);
  if (Number.isNaN(Date.parse(curatedAt))) throw new Error(`${source} has invalid curatedAt`);

  const mode = record.cognitiveMode;
  if (mode !== undefined && mode !== 'dual' && mode !== 'agent' && mode !== 'emulation' && mode !== 'environment') {
    throw new Error(`${source} has invalid cognitiveMode`);
  }
  const modeSource = record.cognitiveModeSource;
  if (modeSource !== undefined && modeSource !== 'metadata' && modeSource !== 'legacy-default') {
    throw new Error(`${source} has invalid cognitiveModeSource`);
  }
  if (mode === undefined && modeSource === 'metadata') {
    throw new Error(`${source} cannot claim metadata mode provenance without cognitiveMode`);
  }

  const suitableForTraining = record.suitableForTraining;
  const rejectionReason = typeof record.rejectionReason === 'string' && record.rejectionReason.trim()
    ? record.rejectionReason.trim()
    : undefined;
  if (!suitableForTraining && !rejectionReason) throw new Error(`${source} has invalid rejectionReason`);

  return {
    id: storedString(record, 'id', source),
    originalTimestamp,
    conversationalEssence: storedString(record, 'conversationalEssence', source),
    context: storedString(record, 'context', source, true),
    userMessage: suitableForTraining ? storedString(record, 'userMessage', source) : undefined,
    assistantResponse: suitableForTraining ? storedString(record, 'assistantResponse', source) : undefined,
    curatedAt,
    flags: (record.flags as string[]).map(flag => flag.trim()).filter(Boolean),
    suitableForTraining,
    rejectionReason,
    cognitiveMode: mode ?? 'dual',
    cognitiveModeSource: modeSource ?? 'legacy-default',
    memoryType: storedString(record, 'memoryType', source),
    sourceMemoryIds: Array.isArray(record.sourceMemoryIds)
      && record.sourceMemoryIds.length > 0
      && record.sourceMemoryIds.every(id => typeof id === 'string' && id.trim())
      ? (record.sourceMemoryIds as string[]).map(id => id.trim())
      : [storedString(record, 'id', source)],
  };
}

export function sourcePathsForResult(result: CuratorItemResult): string[] {
  const candidates = result.originalMemoryPaths?.length
    ? result.originalMemoryPaths
    : [result.originalMemoryPath];
  return [...new Set(candidates.filter(path => typeof path === 'string' && path.trim()))];
}

export function isTrainingCuratedMemory(memory: CuratedMemory): memory is TrainingCuratedMemory {
  return memory.suitableForTraining === true
    && typeof memory.userMessage === 'string'
    && Boolean(memory.userMessage.trim())
    && typeof memory.assistantResponse === 'string'
    && Boolean(memory.assistantResponse.trim());
}

export function isSuccessfulCuration(
  result: CuratorItemResult,
): result is CuratorItemResult & { success: true; disposition: CuratorDisposition; curated: CuratedMemory } {
  return result.success === true
    && Boolean(result.curated && result.disposition)
    && result.disposition === (result.curated?.suitableForTraining ? 'accepted' : 'rejected');
}
