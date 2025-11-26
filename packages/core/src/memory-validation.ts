/**
 * Memory Data Validation and Sanitization
 * Prevents corrupted, malformed, or oversized data from entering the system
 */

import type { EpisodicEvent } from './memory.js';

export interface ValidationResult {
  valid: boolean;
  sanitized?: EpisodicEvent;
  warnings: string[];
  errors: string[];
}

export interface ValidationLimits {
  maxContentLength: number;      // Max content string length
  maxResponseLength: number;      // Max response string length
  maxMetadataSize: number;        // Max JSON.stringify(metadata) size
  maxTotalSize: number;           // Max total event JSON size
  maxArrayLength: number;         // Max items in tags/entities arrays
  maxStringLength: number;        // Max length for any individual string field
}

const DEFAULT_LIMITS: ValidationLimits = {
  maxContentLength: 50000,        // 50k chars for content
  maxResponseLength: 50000,       // 50k chars for response
  maxMetadataSize: 100000,        // 100k chars for metadata JSON
  maxTotalSize: 200000,           // 200k chars total
  maxArrayLength: 1000,           // 1000 items in arrays
  maxStringLength: 10000,         // 10k chars for general strings
};

/**
 * Validate and sanitize an episodic event before saving
 */
export function validateEvent(
  event: Partial<EpisodicEvent>,
  limits: Partial<ValidationLimits> = {}
): ValidationResult {
  const actualLimits = { ...DEFAULT_LIMITS, ...limits };
  const warnings: string[] = [];
  const errors: string[] = [];

  // Create a sanitized copy
  const sanitized: EpisodicEvent = {
    id: event.id || '',
    timestamp: event.timestamp || '',
    content: String(event.content || ''),
    type: event.type,
    response: event.response,
    entities: event.entities,
    tags: event.tags,
    importance: event.importance,
    links: event.links,
    userId: event.userId,
    metadata: event.metadata,
  };

  // 1. Check required fields
  if (!sanitized.id || typeof sanitized.id !== 'string') {
    errors.push('Missing or invalid id field');
  }

  if (!sanitized.timestamp || typeof sanitized.timestamp !== 'string') {
    errors.push('Missing or invalid timestamp field');
  }

  if (!sanitized.content || typeof sanitized.content !== 'string') {
    errors.push('Missing or invalid content field');
  }

  // 2. Validate and truncate content
  if (sanitized.content.length > actualLimits.maxContentLength) {
    warnings.push(
      `Content too long (${sanitized.content.length} chars), truncating to ${actualLimits.maxContentLength}`
    );
    sanitized.content = sanitized.content.substring(0, actualLimits.maxContentLength) + '... [truncated]';
  }

  // 3. Validate and truncate response
  if (sanitized.response && typeof sanitized.response === 'string') {
    if (sanitized.response.length > actualLimits.maxResponseLength) {
      warnings.push(
        `Response too long (${sanitized.response.length} chars), truncating to ${actualLimits.maxResponseLength}`
      );
      sanitized.response = sanitized.response.substring(0, actualLimits.maxResponseLength) + '... [truncated]';
    }
  }

  // 4. Validate arrays (tags, entities)
  if (sanitized.tags && Array.isArray(sanitized.tags)) {
    if (sanitized.tags.length > actualLimits.maxArrayLength) {
      warnings.push(`Tags array too long (${sanitized.tags.length}), truncating to ${actualLimits.maxArrayLength}`);
      sanitized.tags = sanitized.tags.slice(0, actualLimits.maxArrayLength);
    }
    // Sanitize individual tags
    sanitized.tags = sanitized.tags.map((tag: any) => {
      const str = String(tag).substring(0, 100); // Max 100 chars per tag
      return str;
    });
  }

  if (sanitized.entities && Array.isArray(sanitized.entities)) {
    if (sanitized.entities.length > actualLimits.maxArrayLength) {
      warnings.push(
        `Entities array too long (${sanitized.entities.length}), truncating to ${actualLimits.maxArrayLength}`
      );
      sanitized.entities = sanitized.entities.slice(0, actualLimits.maxArrayLength);
    }
    // Sanitize individual entities
    sanitized.entities = sanitized.entities.map((entity: any) => {
      const str = String(entity).substring(0, 100); // Max 100 chars per entity
      return str;
    });
  }

  // 5. Validate metadata size
  if (sanitized.metadata && typeof sanitized.metadata === 'object') {
    try {
      const metadataJson = JSON.stringify(sanitized.metadata);
      if (metadataJson.length > actualLimits.maxMetadataSize) {
        warnings.push(
          `Metadata too large (${metadataJson.length} chars), will be truncated to ${actualLimits.maxMetadataSize}`
        );

        // Truncate large metadata fields
        sanitized.metadata = truncateMetadata(sanitized.metadata, actualLimits.maxMetadataSize);
      }
    } catch (error) {
      errors.push(`Metadata is not JSON-serializable: ${(error as Error).message}`);
      sanitized.metadata = {}; // Remove corrupted metadata
    }
  }

  // 6. Check total event size
  try {
    const totalJson = JSON.stringify(sanitized);
    if (totalJson.length > actualLimits.maxTotalSize) {
      errors.push(
        `Total event size (${totalJson.length} chars) exceeds maximum (${actualLimits.maxTotalSize}). ` +
        'Event should have been truncated earlier but size is still too large.'
      );
    }
  } catch (error) {
    errors.push(`Event is not JSON-serializable: ${(error as Error).message}`);
  }

  // 7. Validate data types
  if (sanitized.importance !== undefined && typeof sanitized.importance !== 'number') {
    warnings.push(`Invalid importance type (${typeof sanitized.importance}), defaulting to 0.5`);
    sanitized.importance = 0.5;
  }

  // 8. Check for circular references (would cause JSON.stringify to fail)
  try {
    JSON.stringify(sanitized);
  } catch (error) {
    errors.push(`Circular reference detected in event data: ${(error as Error).message}`);
  }

  return {
    valid: errors.length === 0,
    sanitized,
    warnings,
    errors,
  };
}

/**
 * Truncate metadata object to fit within size limit
 */
function truncateMetadata(metadata: any, maxSize: number): any {
  const truncated: any = {};
  let currentSize = 2; // "{}" baseline

  // Priority order for metadata fields
  const priorityFields = [
    'cognitiveMode',
    'usedOperator',
    'conversationId',
    'sessionId',
    'toolName',
    'success',
    'error',
  ];

  const allKeys = Object.keys(metadata);
  const orderedKeys = [
    ...priorityFields.filter(k => allKeys.includes(k)),
    ...allKeys.filter(k => !priorityFields.includes(k)),
  ];

  for (const key of orderedKeys) {
    const value = metadata[key];
    let valueStr: string;

    try {
      valueStr = JSON.stringify(value);
    } catch {
      continue; // Skip non-serializable values
    }

    const fieldSize = key.length + valueStr.length + 4; // "key":"value",

    if (currentSize + fieldSize > maxSize) {
      truncated._truncated = true;
      truncated._truncatedFields = allKeys.length - Object.keys(truncated).length;
      break;
    }

    truncated[key] = value;
    currentSize += fieldSize;
  }

  return truncated;
}

/**
 * Check if an event file is corrupted (malformed JSON, missing fields, etc.)
 */
export function isEventCorrupted(eventData: any): boolean {
  if (!eventData || typeof eventData !== 'object') {
    return true;
  }

  // Required fields check
  if (!eventData.id || !eventData.timestamp || eventData.content === undefined) {
    return true;
  }

  // Type checks
  if (typeof eventData.id !== 'string' || typeof eventData.timestamp !== 'string') {
    return true;
  }

  // Check for circular references
  try {
    JSON.stringify(eventData);
  } catch {
    return true;
  }

  return false;
}

/**
 * Attempt to repair a corrupted event
 */
export function repairEvent(eventData: any): EpisodicEvent | null {
  if (!eventData || typeof eventData !== 'object') {
    return null;
  }

  try {
    const repaired: EpisodicEvent = {
      id: String(eventData.id || `corrupted-${Date.now()}`),
      timestamp: String(eventData.timestamp || new Date().toISOString()),
      content: String(eventData.content || '[corrupted content]'),
      type: eventData.type || 'observation',
      response: eventData.response ? String(eventData.response) : undefined,
      entities: Array.isArray(eventData.entities) ? eventData.entities : [],
      tags: Array.isArray(eventData.tags) ? eventData.tags : ['corrupted'],
      importance: typeof eventData.importance === 'number' ? eventData.importance : 0.5,
      links: Array.isArray(eventData.links) ? eventData.links : [],
      userId: eventData.userId,
      metadata: typeof eventData.metadata === 'object' ? eventData.metadata : {},
    };

    // Validate the repair attempt
    const validation = validateEvent(repaired);
    if (validation.valid) {
      return validation.sanitized!;
    }

    return null;
  } catch {
    return null;
  }
}
