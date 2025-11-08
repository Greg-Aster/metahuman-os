/**
 * Memory Policy Module
 *
 * Centralized policy enforcement for memory capture, retrieval, and visibility
 * across different cognitive modes and user roles.
 *
 * This module provides the single source of truth for mode-aware memory behavior,
 * ensuring consistent policy application across all APIs and agents.
 */

import { getModeDefinition, type CognitiveModeId } from './cognitive-mode.js';

// ============================================================================
// User Roles
// ============================================================================

export type UserRole = 'owner' | 'member' | 'guest' | 'anonymous';

// ============================================================================
// Event Types
// ============================================================================

export type EventType =
  | 'conversation'
  | 'inner_dialogue'
  | 'tool_invocation'
  | 'file_read'
  | 'file_write'
  | 'code_approval'
  | 'code_rejection'
  | 'summary'
  | 'observation'
  | 'reflection'
  | 'dream'
  | 'task';

// ============================================================================
// Memory Write Policy
// ============================================================================

/**
 * Determines if memory writes are allowed for a given cognitive mode and event type.
 *
 * Policy Rules:
 * - Dual Mode: All events can be written (full memory capture)
 * - Agent Mode: Only action-oriented events (tool invocations, approvals, summaries)
 * - Emulation Mode: No writes allowed (read-only)
 *
 * @param mode - Current cognitive mode
 * @param eventType - Type of event being captured
 * @returns true if memory write is allowed, false otherwise
 */
export function canWriteMemory(mode: CognitiveModeId, eventType: EventType): boolean {
  const modeConfig = getModeDefinition(mode);
  const writeLevel = modeConfig.defaults.memoryWriteLevel;

  // Emulation mode: read-only (no writes)
  if (writeLevel === 'read_only') {
    return false;
  }

  // Agent mode: command_only (selective writes)
  if (writeLevel === 'command_only') {
    // Allow only action-oriented events
    const allowedEvents: EventType[] = [
      'tool_invocation',
      'code_approval',
      'code_rejection',
      'summary',
      'file_write', // Write operations are actions
    ];
    return allowedEvents.includes(eventType);
  }

  // Dual mode: full writes
  return true;
}

// ============================================================================
// Tool Capture Policy
// ============================================================================

/**
 * Determines if a tool invocation should be captured as a memory event.
 *
 * Policy Rules:
 * - Emulation Mode: Never capture tools (read-only)
 * - Agent Mode: Skip conversational tools, capture action tools
 * - Dual Mode: Capture all tool invocations
 *
 * @param mode - Current cognitive mode
 * @param toolName - Name of the tool being invoked
 * @returns true if tool should be captured, false otherwise
 */
export function shouldCaptureTool(mode: CognitiveModeId, toolName: string): boolean {
  const modeConfig = getModeDefinition(mode);
  const writeLevel = modeConfig.defaults.memoryWriteLevel;

  // Emulation mode: no tool capture (read-only)
  if (writeLevel === 'read_only') {
    return false;
  }

  // Agent mode: skip conversational tools (not real actions)
  if (writeLevel === 'command_only') {
    const conversationalTools = [
      'conversational_response',
      'chat',
      'greeting',
    ];
    return !conversationalTools.includes(toolName);
  }

  // Dual mode: capture all tools
  return true;
}

// ============================================================================
// Context Retrieval Depth
// ============================================================================

/**
 * Determines the maximum number of memory results to retrieve based on
 * cognitive mode and user role.
 *
 * Policy Rules:
 * - Guest users: Always shallow (2-3 results)
 * - Dual mode (owner): Deep (12 results)
 * - Agent mode (owner): Normal (6 results)
 * - Emulation mode (owner): Shallow (3 results)
 *
 * @param mode - Current cognitive mode
 * @param role - User role (owner, member, guest, anonymous)
 * @returns Maximum number of memory results to retrieve
 */
export function contextDepth(mode: CognitiveModeId, role: UserRole = 'owner'): number {
  // Guest/anonymous users: always shallow (security constraint)
  if (role === 'guest' || role === 'anonymous') {
    return 2;
  }

  // Owner/member depth varies by mode
  switch (mode) {
    case 'dual':
      return 12; // Deep context for full intelligence
    case 'agent':
      return 6; // Balanced for quick actions
    case 'emulation':
      return 3; // Shallow for demo/frozen snapshot
    default:
      return 3; // Conservative default
  }
}

/**
 * Get search depth setting for vector index queries.
 *
 * Maps context depth to search depth labels used by context-builder.
 *
 * @param mode - Current cognitive mode
 * @param role - User role
 * @returns Search depth: 'shallow' | 'normal' | 'deep'
 */
export function getSearchDepth(
  mode: CognitiveModeId,
  role: UserRole = 'owner'
): 'shallow' | 'normal' | 'deep' {
  const depth = contextDepth(mode, role);

  if (depth <= 4) return 'shallow';
  if (depth <= 8) return 'normal';
  return 'deep';
}

/**
 * Get maximum character limit for memory context in prompts.
 *
 * @param mode - Current cognitive mode
 * @param role - User role
 * @returns Maximum characters for memory context
 */
export function getContextCharLimit(mode: CognitiveModeId, role: UserRole = 'owner'): number {
  // Guest/anonymous: very limited
  if (role === 'guest' || role === 'anonymous') {
    return 600;
  }

  // Mode-specific limits
  switch (mode) {
    case 'dual':
      return 1500; // Rich context for deep reasoning
    case 'agent':
      return 900; // Moderate context
    case 'emulation':
      return 600; // Minimal context
    default:
      return 600;
  }
}

// ============================================================================
// Conversation Visibility
// ============================================================================

/**
 * Determines what conversation data is visible to a user role.
 *
 * Returns capabilities array indicating what the role can access:
 * - 'summaries': Can see conversation summaries
 * - 'full_history': Can see complete conversation history
 * - 'tool_details': Can see tool invocation details (paths, inputs, outputs)
 * - 'file_paths': Can see file paths in memory events
 * - 'private_profiles': Can see private profile data
 *
 * @param role - User role
 * @returns Array of allowed capabilities
 */
export function conversationVisibility(role: UserRole): string[] {
  switch (role) {
    case 'owner':
      return [
        'summaries',
        'full_history',
        'tool_details',
        'file_paths',
        'private_profiles',
      ];

    case 'member':
      return [
        'summaries',
        'full_history',
        'tool_details',
        'file_paths',
      ];

    case 'guest':
    case 'anonymous':
      return [
        // No summaries (private data)
        // No tool details (security)
        // No file paths (security)
      ];

    default:
      return [];
  }
}

/**
 * Check if a specific capability is allowed for a role.
 *
 * @param role - User role
 * @param capability - Capability to check
 * @returns true if capability is allowed
 */
export function hasCapability(role: UserRole, capability: string): boolean {
  return conversationVisibility(role).includes(capability);
}

// ============================================================================
// Tool History Limits
// ============================================================================

/**
 * Get maximum number of recent tool invocations to include in context.
 *
 * @param mode - Current cognitive mode
 * @param role - User role
 * @returns Maximum number of tool invocations
 */
export function getToolHistoryLimit(mode: CognitiveModeId, role: UserRole = 'owner'): number {
  // Guest/anonymous: no tool history
  if (role === 'guest' || role === 'anonymous') {
    return 0;
  }

  // Mode-specific limits
  switch (mode) {
    case 'dual':
      return 10; // Full tool history
    case 'agent':
      return 5; // Recent actions only
    case 'emulation':
      return 0; // No tools in emulation
    default:
      return 0;
  }
}

// ============================================================================
// Privacy & Redaction (Phase 4: Role-Based Context Depth)
// ============================================================================

/**
 * Sensitive field patterns that should be redacted for non-owners
 */
const SENSITIVE_PATTERNS = {
  // File paths
  paths: /\/home\/[^/]+|\/Users\/[^/]+|C:\\Users\\[^\\]+/g,

  // API keys and tokens
  apiKeys: /\b[A-Za-z0-9_-]{32,}\b/g,

  // Email addresses
  emails: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

  // IP addresses
  ips: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,

  // Phone numbers (simple pattern)
  phones: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
};

/**
 * Redact sensitive information from text based on user role
 *
 * @param text - Text to potentially redact
 * @param role - User role
 * @returns Redacted text (or original if role has access)
 */
export function redactSensitiveData(text: string, role: UserRole): string {
  // Owners and members see everything
  if (role === 'owner' || role === 'member') {
    return text;
  }

  // Guests and anonymous users get redacted content
  let redacted = text;

  // Redact file paths
  redacted = redacted.replace(SENSITIVE_PATTERNS.paths, '[REDACTED_PATH]');

  // Redact API keys and long tokens
  redacted = redacted.replace(SENSITIVE_PATTERNS.apiKeys, '[REDACTED_KEY]');

  // Redact email addresses
  redacted = redacted.replace(SENSITIVE_PATTERNS.emails, '[REDACTED_EMAIL]');

  // Redact IP addresses
  redacted = redacted.replace(SENSITIVE_PATTERNS.ips, '[REDACTED_IP]');

  // Redact phone numbers
  redacted = redacted.replace(SENSITIVE_PATTERNS.phones, '[REDACTED_PHONE]');

  return redacted;
}

/**
 * Filter tool outputs based on user role capabilities
 *
 * @param outputs - Tool outputs object
 * @param role - User role
 * @param toolName - Name of tool (some tools have special rules)
 * @returns Filtered outputs
 */
export function filterToolOutputs(
  outputs: Record<string, any>,
  role: UserRole,
  toolName: string
): Record<string, any> {
  // Owners and members see full outputs
  if (role === 'owner' || role === 'member') {
    return outputs;
  }

  // Guests and anonymous users get filtered outputs
  const filtered: Record<string, any> = {};

  // File operation tools - redact paths and content
  if (toolName === 'read_file' || toolName === 'write_file') {
    if (outputs.content) {
      filtered.content = '[REDACTED - Authentication required]';
    }
    if (outputs.path) {
      filtered.path = '[REDACTED_PATH]';
    }
    if (outputs.success !== undefined) {
      filtered.success = outputs.success;
    }
    return filtered;
  }

  // Task management - hide details
  if (toolName === 'list_tasks' || toolName === 'get_task') {
    filtered.message = 'Task details require authentication';
    return filtered;
  }

  // Memory search - hide content
  if (toolName === 'search_memory' || toolName === 'query_memory') {
    filtered.count = outputs.count || 0;
    filtered.message = 'Memory details require authentication';
    return filtered;
  }

  // Default: allow basic info, redact detailed content
  for (const [key, value] of Object.entries(outputs)) {
    if (key === 'success' || key === 'count' || key === 'status') {
      filtered[key] = value;
    } else if (typeof value === 'string') {
      filtered[key] = redactSensitiveData(value, role);
    } else if (Array.isArray(value)) {
      filtered[key] = `[${value.length} items - authentication required]`;
    } else if (typeof value === 'object' && value !== null) {
      filtered[key] = '[Object - authentication required]';
    } else {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * Check if a memory event should be visible to a user role
 *
 * @param eventType - Type of memory event
 * @param role - User role
 * @returns true if event should be visible
 */
export function canViewMemoryType(eventType: string, role: UserRole): boolean {
  // Owners see everything
  if (role === 'owner') {
    return true;
  }

  // Members see most things except private reflections
  if (role === 'member') {
    const privateTypes = ['dream', 'inner_dialogue'];
    return !privateTypes.includes(eventType);
  }

  // Guests and anonymous users see very limited content
  const publicTypes = ['conversation']; // Only public conversations
  return publicTypes.includes(eventType);
}

/**
 * Get maximum number of memories to return based on role
 * (stricter limits for guests to prevent data mining)
 *
 * @param role - User role
 * @returns Maximum memories to return
 */
export function getMaxMemoriesForRole(role: UserRole): number {
  switch (role) {
    case 'owner':
      return 50; // Full access
    case 'member':
      return 20; // Moderate access
    case 'guest':
      return 5; // Limited access
    case 'anonymous':
      return 2; // Minimal access
    default:
      return 2; // Conservative default
  }
}

// ============================================================================
// Mode Configuration Helpers
// ============================================================================

// ============================================================================
// Exports
// ============================================================================

export const MemoryPolicy = {
  canWriteMemory,
  shouldCaptureTool,
  contextDepth,
  getSearchDepth,
  getContextCharLimit,
  conversationVisibility,
  hasCapability,
  getToolHistoryLimit,
  redactSensitiveData,
  filterToolOutputs,
  canViewMemoryType,
  getMaxMemoriesForRole,
};
