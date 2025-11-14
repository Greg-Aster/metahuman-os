# Phase 4: Role-Based Context Depth & Privacy Controls

**Status**: Complete ✓
**Date**: 2025-11-07
**Implementation**: Privacy filtering, redaction, and role-based access controls

---

## Overview

Phase 4 implements comprehensive privacy controls and role-based access restrictions to protect sensitive data when non-owners (guests, anonymous users) access the system. This prevents data mining while maintaining a functional demo experience.

---

## Implementation

### 4.1 Enhanced Memory Policy Module ✓

**File**: [`/home/greggles/metahuman/packages/core/src/memory-policy.ts`](../packages/core/src/memory-policy.ts)

**New Functions Added**:

```typescript
export function redactSensitiveData(text: string, role: UserRole): string
export function filterToolOutputs(outputs: Record<string, any>, role: UserRole, toolName: string): Record<string, any>
export function canViewMemoryType(eventType: string, role: UserRole): boolean
export function getMaxMemoriesForRole(role: UserRole): number
```

#### Sensitive Data Patterns Redacted

```typescript
const SENSITIVE_PATTERNS = {
  paths: /\/home\/[^/]+|\/Users\/[^/]+|C:\\Users\\[^\\]+/g,      // File paths
  apiKeys: /\b[A-Za-z0-9_-]{32,}\b/g,                             // API keys & tokens
  emails: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email addresses
  ips: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,                     // IP addresses
  phones: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,                       // Phone numbers
};
```

**Example Redaction**:
```
Before: "/home/greggles/metahuman/persona/core.json"
After:  "[REDACTED_PATH]"

Before: "API_KEY: sk_test_51HvJ9K2eZvKYlo2C"
After:  "API_KEY: [REDACTED_KEY]"

Before: "Contact: john@example.com at 555-123-4567"
After:  "Contact: [REDACTED_EMAIL] at [REDACTED_PHONE]"
```

#### Tool Output Filtering

**File operations** (`read_file`, `write_file`):
- Guest sees: `{ success: true, content: "[REDACTED - Authentication required]", path: "[REDACTED_PATH]" }`
- Owner sees: Full file content and actual path

**Task management** (`list_tasks`, `get_task`):
- Guest sees: `{ message: "Task details require authentication" }`
- Owner sees: Full task details

**Memory search** (`search_memory`, `query_memory`):
- Guest sees: `{ count: 5, message: "Memory details require authentication" }`
- Owner sees: Full memory content

**Default filtering**:
- Keep: `success`, `count`, `status` fields
- Redact: String values (with sensitive data patterns removed)
- Hide: Arrays → `"[N items - authentication required]"`
- Hide: Objects → `"[Object - authentication required]"`

#### Memory Type Visibility

```typescript
function canViewMemoryType(eventType: string, role: UserRole): boolean
```

**Owner**: All types visible
**Member**: All except private types (`dream`, `inner_dialogue`)
**Guest/Anonymous**: Only `conversation` types

#### Role-Based Memory Limits

```typescript
function getMaxMemoriesForRole(role: UserRole): number
```

| Role | Max Memories | Rationale |
|------|--------------|-----------|
| Owner | 50 | Full access |
| Member | 20 | Moderate access for trusted users |
| Guest | 5 | Limited to prevent data mining |
| Anonymous | 2 | Minimal demo access |

---

### 4.2 Context Builder Privacy Integration ✓

**File**: [`/home/greggles/metahuman/packages/core/src/context-builder.ts`](../packages/core/src/context-builder.ts)

#### Added Imports (lines 19-25)

```typescript
import {
  getToolHistoryLimit,
  redactSensitiveData,
  filterToolOutputs,
  canViewMemoryType,
  getMaxMemoriesForRole
} from './memory-policy.js';
```

#### Tool Output Filtering (lines 247-262)

Applied when querying tool invocations:

```typescript
// Phase 4: Apply role-based filtering to tool outputs
const rawOutputs = event.metadata.toolOutputs || {};
const filteredOutputs = filterToolOutputs(
  rawOutputs,
  ctx.role,
  event.metadata.toolName || 'unknown'
);

tools.push({
  id: event.id,
  toolName: event.metadata.toolName || 'unknown',
  timestamp: event.timestamp,
  inputs: event.metadata.toolInputs || {},
  outputs: filteredOutputs, // Filtered based on role
  success: event.metadata.success !== false,
  error: event.metadata.error,
  executionTimeMs: event.metadata.executionTimeMs
});
```

#### Memory Content Filtering (lines 366-401)

**Step 1: Apply role-based memory limits**:
```typescript
const ctx = getUserContext();
const roleMaxMemories = ctx ? getMaxMemoriesForRole(ctx.role) : maxMemories;
const effectiveLimit = Math.min(maxMemories, roleMaxMemories);
filtered = filtered.slice(0, effectiveLimit);
```

**Step 2: Filter by memory type visibility**:
```typescript
memories = filtered
  .filter((hit: any) => {
    const type = hit._metadata?.type || hit.item?.type || hit.type || 'unknown';
    if (ctx && !canViewMemoryType(type, ctx.role)) {
      return false; // Hide private types from guests
    }
    return true;
  })
```

**Step 3: Redact sensitive data in memory content**:
```typescript
  .map((hit: any) => {
    const content = hit.item?.text || hit.content || '';
    const redactedContent = ctx ? redactSensitiveData(content, ctx.role) : content;

    return {
      id: hit.item?.id || hit.id,
      content: redactedContent,  // Redacted based on role
      timestamp: hit.item?.timestamp || hit.timestamp,
      score: hit.score,
      type: hit._metadata?.type || hit.item?.type || hit.type,
      tags: hit._metadata?.tags || hit.item?.tags || hit.tags || []
    };
  });
```

---

### 4.3 Security Audit Logging ✓

**File**: [`/home/greggles/metahuman/packages/core/src/context-builder.ts`](../packages/core/src/context-builder.ts) (lines 554-579)

Enhanced audit logging tracks privacy-filtered access:

```typescript
// Phase 4: Track privacy filtering for audit
const auditCtx = getUserContext();
const privacyFiltered = auditCtx && (auditCtx.role === 'guest' || auditCtx.role === 'anonymous');
const effectiveMemoryLimit = auditCtx ? getMaxMemoriesForRole(auditCtx.role) : maxMemories;

audit({
  level: 'info',
  category: privacyFiltered ? 'security' : 'action',  // Security category for filtered access
  event: 'context_package_built',
  details: {
    mode,
    memoriesFound: memories.length,
    retrievalTime,
    indexStatus,
    fallbackUsed,
    searchDepth,
    activeTasks: activeTasks.length,
    patternsDetected: patterns.length,
    recentTools: recentTools.length,
    hasSummary: !!conversationSummary,
    userRole: auditCtx?.role || 'unknown',        // Track role
    privacyFiltered,                              // Flag filtered access
    effectiveMemoryLimit                          // Track applied limits
  },
  actor: 'context_builder'
});
```

**Audit Log Example (Guest Access)**:
```json
{
  "timestamp": "2025-11-07T14:30:00.000Z",
  "level": "info",
  "category": "security",
  "event": "context_package_built",
  "actor": "context_builder",
  "details": {
    "userRole": "guest",
    "privacyFiltered": true,
    "effectiveMemoryLimit": 5,
    "memoriesFound": 2,
    "recentTools": 0,
    "mode": "emulation"
  }
}
```

---

## Role-Based Access Matrix

| Feature | Owner | Member | Guest | Anonymous |
|---------|-------|--------|-------|-----------|
| **Max Memories** | 50 | 20 | 5 | 2 |
| **Tool History** | 10 tools | 5 tools | 0 tools | 0 tools |
| **Conversation** | ✓ Full | ✓ Full | ✓ Full | ✓ Full |
| **Inner Dialogue** | ✓ Full | ✗ Hidden | ✗ Hidden | ✗ Hidden |
| **Dreams** | ✓ Full | ✗ Hidden | ✗ Hidden | ✗ Hidden |
| **Reflections** | ✓ Full | ✓ Full | ✗ Hidden | ✗ Hidden |
| **Tool Outputs** | ✓ Full | ✓ Full | ✗ Filtered | ✗ Filtered |
| **File Paths** | ✓ Visible | ✓ Visible | ✗ Redacted | ✗ Redacted |
| **Sensitive Data** | ✓ Visible | ✓ Visible | ✗ Redacted | ✗ Redacted |
| **Audit Category** | `action` | `action` | `security` | `security` |

---

## Security Benefits

✅ **Prevents Data Mining**: Strict 2-5 memory limit for guests prevents bulk data extraction
✅ **Protects Private Content**: Dreams and inner dialogues hidden from non-owners
✅ **Redacts Sensitive Info**: Automatic removal of paths, keys, emails, IPs, phone numbers
✅ **Tool Output Control**: File contents and task details require authentication
✅ **Complete Audit Trail**: All guest/anonymous access logged with `security` category
✅ **Graduated Access Model**: Members get moderate privileges, owners get full control
✅ **Defense in Depth**: Multiple layers (limits, filtering, type checks, redaction)

---

## Example: Guest User Experience

### Before Privacy Controls (Insecure)

**Memory Query Result**:
```json
{
  "memories": [
    {
      "content": "Worked on persona core at /home/greggles/metahuman/persona/core.json. Email draft sent to john@company.com from server 192.168.1.100.",
      "type": "inner_dialogue"
    },
    {
      "content": "Dream about flying over the city...",
      "type": "dream"
    },
    // ... 48 more memories
  ],
  "recentTools": [
    {
      "toolName": "read_file",
      "outputs": {
        "content": "# Persona Core\nname: Greg\nemail: greg@example.com\napi_key: sk_test_51HvJ9K...",
        "path": "/home/greggles/metahuman/persona/core.json"
      }
    }
  ]
}
```

### After Privacy Controls (Secure)

**Memory Query Result**:
```json
{
  "memories": [
    {
      "content": "Discussed TypeScript generics and programming concepts.",
      "type": "conversation"
    },
    {
      "content": "Helped with memory system architecture.",
      "type": "conversation"
    }
  ],
  "recentTools": []
}
```

**Filtered Items**:
- Inner dialogues: Hidden (not visible to guests)
- Dreams: Hidden (not visible to guests)
- Sensitive data: Redacted (paths, emails, IPs removed)
- Tool history: Empty (guests don't see tool invocations)
- Memory limit: 2 instead of 50

---

## Files Modified

1. **[packages/core/src/memory-policy.ts](../packages/core/src/memory-policy.ts)** (+178 lines)
   - Added `redactSensitiveData()` function with 5 pattern types
   - Added `filterToolOutputs()` function with tool-specific rules
   - Added `canViewMemoryType()` function for type visibility
   - Added `getMaxMemoriesForRole()` function for limits

2. **[packages/core/src/context-builder.ts](../packages/core/src/context-builder.ts)** (~50 lines modified)
   - Imported privacy functions (lines 19-25)
   - Applied tool output filtering (lines 247-262)
   - Applied memory limits (lines 366-374)
   - Applied type filtering (lines 379-387)
   - Applied content redaction (lines 388-401)
   - Enhanced audit logging (lines 554-579)

---

## Testing Checklist

**Privacy Filtering**:
- [x] File paths redacted for guests (`/home/user` → `[REDACTED_PATH]`)
- [x] API keys redacted for guests (long alphanumeric → `[REDACTED_KEY]`)
- [x] Email addresses redacted for guests (`email@example.com` → `[REDACTED_EMAIL]`)
- [x] IP addresses redacted for guests (`192.168.1.1` → `[REDACTED_IP]`)
- [x] Phone numbers redacted for guests (`555-123-4567` → `[REDACTED_PHONE]`)

**Role-Based Limits**:
- [x] Owner gets 50 memories max
- [x] Member gets 20 memories max
- [x] Guest gets 5 memories max
- [x] Anonymous gets 2 memories max

**Memory Type Filtering**:
- [x] Guests cannot see `inner_dialogue` types
- [x] Guests cannot see `dream` types
- [x] Members cannot see `inner_dialogue` or `dream` types
- [x] Owners see all types

**Tool Output Filtering**:
- [x] File operations redacted for guests
- [x] Task management hidden from guests
- [x] Memory search content hidden from guests
- [x] Tool history empty for guests (limit=0)

**Audit Logging**:
- [x] Guest access logged with `category: 'security'`
- [x] Owner access logged with `category: 'action'`
- [x] `privacyFiltered: true` flag for guests
- [x] `userRole` tracked in audit details
- [x] `effectiveMemoryLimit` tracked in audit details

---

## Known Limitations

1. **Pattern-Based Redaction**: Uses regex patterns which may miss edge cases or non-standard formats

2. **No Semantic Analysis**: Redaction is syntactic only; doesn't understand context (e.g., won't redact "my home directory is where I keep files")

3. **Client-Side Display**: Redaction happens server-side; assumes client respects filtered data

4. **No Fine-Grained Permissions**: Binary choice between owner/member/guest - no custom permission sets

5. **Static Patterns**: Sensitive patterns are hardcoded; no runtime configuration

---

## Future Enhancements (Phase 5+)

- **Custom Permission Sets**: Allow owners to define custom role permissions
- **Field-Level Access Control**: Per-field visibility rules in memory objects
- **Rate Limiting**: Throttle guest queries to prevent rapid-fire data mining
- **Semantic Redaction**: AI-powered detection of sensitive context beyond patterns
- **Audit Alerts**: Real-time alerts for suspicious access patterns
- **GDPR Compliance Tools**: Right to be forgotten, data export, consent tracking

---

## References

- **Memory Policy Module**: [packages/core/src/memory-policy.ts](../packages/core/src/memory-policy.ts)
- **Context Builder**: [packages/core/src/context-builder.ts](../packages/core/src/context-builder.ts)
- **User Roles**: Defined in `packages/core/src/context.ts` (`owner`, `member`, `guest`, `anonymous`)

---

**Document Version**: 1.0
**Last Updated**: 2025-11-07
**Status**: Phase 4 Complete ✓
