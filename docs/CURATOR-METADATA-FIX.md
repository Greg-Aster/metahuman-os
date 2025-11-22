# Memory Curator Metadata Fix

**Date**: 2025-11-21
**Issue**: Curator was ignoring `metadata.cognitiveMode` field in memories
**Impact**: Training data was incorrectly categorized based on memory type instead of actual cognitive mode used

---

## The Problem

When users interact with MetaHuman in different cognitive modes, the mode is saved in the memory's metadata:

```json
{
  "type": "conversation",
  "timestamp": "2025-11-21T10:30:00Z",
  "messages": [...],
  "metadata": {
    "cognitiveMode": "dual"  // ← IMPORTANT: Actual mode used during conversation
  }
}
```

However, the **memory curator was ignoring this field** and only looking at `memory.type`:

### Old Behavior (WRONG)

```typescript
const mode = assignMode(memory.type);  // Only checks type
```

**Mapping used**:
- `type: "conversation"` → Always assigned to `emulation` mode
- `type: "inner_dialogue"` → Always assigned to `dual` mode
- `type: "task"` → Always assigned to `agent` mode

### Why This Was Wrong

A conversation captured in **dual mode** should be trained with inverted format:
- INPUT: `<thought>: [user's message]`
- OUTPUT: `<world>: [AI's response]`

But the curator would see `type: "conversation"` and assign it to **emulation mode**:
- INPUT: `<user>: [user's message]`
- OUTPUT: `<assistant>: [AI's response]`

This completely defeats the purpose of cognitive mode training!

---

## The Fix

**Updated curator** ([memory-curator.ts:246-270](../brain/agents/memory-curator.ts#L246-L270)):

```typescript
// Priority: metadata.cognitiveMode → memory type mapping → default
let mode: CognitiveMode;
let modeSource: 'metadata' | 'type';

if (memory.metadata && memory.metadata.cognitiveMode) {
  // Use explicit cognitive mode from metadata (saved during capture)
  const metaMode = memory.metadata.cognitiveMode;
  if (metaMode === 'dual' || metaMode === 'emulation' || metaMode === 'agent') {
    mode = metaMode;
    modeSource = 'metadata';
  } else {
    // Fall back to type-based assignment if metadata mode is invalid
    mode = assignMode(memory.type);
    modeSource = 'type';
  }
} else {
  // Fall back to type-based assignment if no metadata
  mode = assignMode(memory.type);
  modeSource = 'type';
}
```

### Priority Order

1. **metadata.cognitiveMode** (if present and valid) ← **HIGHEST PRIORITY**
2. **memory.type mapping** (fallback for old memories)
3. **default to emulation** (final fallback)

---

## New Output

The curator now reports mode assignment sources:

```
[memory-curator] Mode assignment sources:
  - From metadata: 847 memories
  - From type mapping: 153 memories
```

Each curated sample also includes `mode_source` in metadata for debugging:

```json
{
  "mode": "dual",
  "user_text": "What do you think about...",
  "assistant_text": "I believe...",
  "metadata": {
    "original_id": "abc123",
    "source_type": "conversation",
    "mode_source": "metadata"  // ← Shows where mode came from
  }
}
```

---

## Impact on Training

### Before Fix

**Scenario**: User has 1000 conversations, all captured in dual mode.

**Result**:
- All 1000 incorrectly assigned to `emulation` mode
- Trained with `<user>` → `<assistant>` format
- Dual consciousness NOT learned ❌

### After Fix

**Scenario**: Same 1000 conversations with `metadata.cognitiveMode: "dual"`

**Result**:
- All 1000 correctly assigned to `dual` mode
- Trained with `<thought>` → `<world>` format (inverted)
- Dual consciousness properly learned ✅

---

## Backward Compatibility

Old memories without `metadata.cognitiveMode` will still work:
- Falls back to type-based mapping
- `inner_dialogue` → `dual`
- `conversation` → `emulation`
- `task` → `agent`

New memories (captured after cognitive mode implementation) will use the explicit metadata field.

---

## Testing

To verify the fix is working:

```bash
# Run curator with verbose output
tsx brain/agents/memory-curator.ts \
  --username greggles \
  --output test_curated.json \
  --max 100

# Check output for mode source statistics
# Should show: "From metadata: X memories"
```

Inspect `test_curated.json` to verify:
1. `mode` field matches expected cognitive mode
2. `metadata.mode_source` shows "metadata" for recent memories
3. Conversations in dual mode are NOT assigned to emulation

---

## Related Files

- **Fix**: [brain/agents/memory-curator.ts](../brain/agents/memory-curator.ts)
- **Memory Capture**: [packages/core/src/memory.ts](../packages/core/src/memory.ts#L164)
- **Mode Formatter**: [brain/agents/mode-formatter.ts](../brain/agents/mode-formatter.ts)
- **Security Policy**: [packages/core/src/security-policy.ts](../packages/core/src/security-policy.ts#L137)

---

## Summary

✅ **Fixed**: Curator now respects `metadata.cognitiveMode` from actual memory captures
✅ **Backward Compatible**: Falls back to type mapping for old memories
✅ **Transparent**: Reports how many modes came from metadata vs type mapping
✅ **Accurate Training**: Dual mode conversations are trained with inverted format
