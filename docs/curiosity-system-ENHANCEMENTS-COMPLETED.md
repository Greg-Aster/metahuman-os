# Curiosity System - Phase 5+ Enhancements COMPLETE ✅

**Date:** 2025-11-11
**Status:** All Optional Enhancements Implemented
**Total Time:** ~1 hour additional

---

## Summary

All three optional enhancements from the implementation plan have been successfully completed:

1. ✅ **Answer Detection** - Automatic question-answer linking
2. ✅ **Research Agent** - Deeper context gathering for questions
3. ✅ **Auto-Expiration** - Cleanup of old unanswered questions

---

## What Was Added

### Enhancement 1: Answer Detection System ✅

**Files Modified:**
- `apps/site/src/pages/api/persona_chat.ts` - Added `questionId` parameter support
  - Line 532: Extract questionId from URL params
  - Lines 883-888: Add curiosity metadata to operator path
  - Lines 1569-1574: Add curiosity metadata to non-operator path

**Files Created:**
- `brain/agents/curiosity-answer-watcher.ts` (4.7KB) - Monitors for answered questions

**How It Works:**
1. User clicks "Reply in Chat" button on a curiosity question
2. Chat sends message with `?questionId=cur-q-...` parameter
3. `/api/persona_chat` captures user message with `metadata.curiosity.answerTo`
4. `curiosity-answer-watcher` agent runs every 5 minutes
5. Scans episodic memories for `answerTo` metadata
6. Moves matching questions from `pending/` to `answered/`

---

### Enhancement 2: Research Agent ✅

**Files Created:**
- `brain/agents/curiosity-researcher.ts` (6.9KB) - Performs deep research on questions

**Capabilities:**
- Extracts key topics from questions using LLM
- Searches memories for related content (up to 5 results per topic)
- Generates research notes in Markdown format
- Stores research files in `memory/curiosity/research/`
- Respects trust levels for web research (future enhancement)
- Processes one question per cycle (rate-limited to avoid overload)

**Research Note Format:**
```markdown
# Research Notes: cur-q-1234567890-abc123

**Question:** What patterns do you notice in your creative work?

**Asked:** 11/11/2025, 11:30:00 PM

---

## Key Topics
- creative work
- patterns
- productivity

## Related Memories

### creative work
- Started new painting project today...
  *11/10/2025*

### patterns
- Noticed I'm most creative in mornings...
  *11/08/2025*

## Summary
The research reveals a consistent pattern of morning creativity...

---
*Generated: 2025-11-11T23:45:00.000Z*
```

---

### Enhancement 3: Auto-Expiration ✅

**Files Modified:**
- `brain/agents/curiosity-service.ts`
  - Lines 67-124: Added `expireOldQuestions()` function
  - Lines 357-363: Call expiration before generating new questions

**Expiration Rules:**
- **Max Age:** 7 days (configurable in code)
- **Destination:** `memory/curiosity/expired/`
- **Status Update:** Adds `expiredAt` timestamp and changes status to "expired"
- **Audit Trail:** Logs expiration with age in days

**Example Expired Question:**
```json
{
  "id": "cur-q-1731456789-abc123",
  "question": "What patterns do you see in...",
  "askedAt": "2025-11-04T12:00:00.000Z",
  "status": "expired",
  "expiredAt": "2025-11-11T23:30:00.000Z",
  "seedMemories": [...],
  "trustLevel": "trusted"
}
```

---

## New Directory Structure

```
memory/curiosity/
├── questions/
│   ├── pending/          # Unanswered questions (age < 7 days)
│   └── answered/         # Answered questions (moved by watcher)
├── facts/                # Reserved for future use
├── research/             # Research notes (*.md files)
└── expired/              # Expired questions (age > 7 days)
```

---

## Agent Configuration

All three new agents are registered in `etc/agents.json` (disabled by default):

### 1. curiosity (Main Service)
- **Interval:** 1800s (30 minutes)
- **Features:** Question generation + auto-expiration
- **Priority:** Low

### 2. curiosity-answer-watcher
- **Interval:** 300s (5 minutes)
- **Features:** Detects and marks answered questions
- **Priority:** Low

### 3. curiosity-researcher
- **Interval:** 3600s (60 minutes)
- **Features:** Deep research on pending questions
- **Priority:** Low
- **Rate Limit:** 1 question per cycle

---

## Usage Guide

### Scenario 1: Basic Question-Answer Flow

```bash
# 1. Enable curiosity system
# Navigate to System → Settings
# Set curiosity level to "Gentle" (1)

# 2. Wait for question or trigger manually
tsx brain/agents/curiosity-service.ts

# 3. Check for questions
ls memory/curiosity/questions/pending/

# 4. View question in UI
# Navigate to Memory → Curiosity tab
# Click "Reply in Chat" button

# 5. Answer the question in chat
# (questionId is automatically passed in URL)

# 6. Detect answer
tsx brain/agents/curiosity-answer-watcher.ts

# 7. Verify question moved to answered
ls memory/curiosity/questions/answered/
```

### Scenario 2: Research Enhancement

```bash
# 1. Generate a question
tsx brain/agents/curiosity-service.ts

# 2. Run researcher
tsx brain/agents/curiosity-researcher.ts

# 3. View research notes
cat memory/curiosity/research/*.md

# 4. Check audit log
grep "curiosity-researcher" logs/audit/*.ndjson | jq '.'
```

### Scenario 3: Auto-Expiration

```bash
# 1. Create an old question (for testing)
cat > memory/curiosity/questions/pending/test-old-question.json <<EOF
{
  "id": "test-old-question",
  "question": "This is a test old question",
  "askedAt": "2025-11-01T00:00:00.000Z",
  "status": "pending",
  "seedMemories": [],
  "trustLevel": "observe"
}
EOF

# 2. Run curiosity service (expires old questions first)
tsx brain/agents/curiosity-service.ts

# 3. Verify expiration
ls memory/curiosity/expired/
cat memory/curiosity/expired/test-old-question.json
```

---

## API Changes

### GET /api/persona_chat

**New Parameter:** `questionId` (optional)

**Usage:**
```
GET /api/persona_chat?message=I+think+about+it+mornings&questionId=cur-q-1234567890-abc123
```

**Result:**
- User message captured with `metadata.curiosity.answerTo = "cur-q-1234567890-abc123"`
- Answer watcher detects this and marks question as answered

---

## Testing Checklist

### Answer Detection Flow ✅
- [x] questionId parameter extracted from URL
- [x] Metadata added to both operator and non-operator paths
- [x] Answer watcher scans episodic events
- [x] Questions moved from pending to answered
- [x] Audit events logged

### Research Agent ✅
- [x] Topics extracted from questions
- [x] Memory searches executed
- [x] Research notes generated in Markdown
- [x] Files saved to research directory
- [x] Rate limiting works (1 question per cycle)
- [x] Duplicate research prevention (checks for existing files)

### Auto-Expiration ✅
- [x] Old questions detected (> 7 days)
- [x] Questions moved to expired directory
- [x] Status updated to "expired"
- [x] expiredAt timestamp added
- [x] Audit events logged with age in days

---

## Performance Considerations

### Memory Impact
- **Answer Watcher:** Scans all episodic events (could be slow for large memory bases)
- **Researcher:** Samples up to 5 memories per topic (3 topics max) = 15 memory reads
- **Expiration:** Reads all pending questions once per cycle

### Optimization Opportunities
1. **Answer Watcher:** Index episodic events with `curiosity.answerTo` metadata
2. **Researcher:** Cache topic extractions to avoid re-processing
3. **Expiration:** Track question ages in memory instead of reading all files

---

## Future Enhancements (Not Implemented)

### 1. Question Quality Scoring
- Track which questions get answered vs. ignored
- Use ML to learn question patterns that resonate
- Adjust question generation based on feedback

### 2. Multi-Turn Conversations
- Track partial answers across multiple messages
- Keep question "active" until fully addressed
- Use LLM to determine when question is sufficiently answered

### 3. Web Research Integration
- Implement actual web search for `researchMode: 'web'`
- Integrate with search APIs (DuckDuckGo, Google, etc.)
- Summarize web results in research notes

### 4. Topic Filtering
- Use `questionTopics` config to filter question domains
- Whitelist: Only ask about specific topics
- Blacklist: Avoid certain sensitive topics

### 5. User Feedback Loop
- Add "helpful/not helpful" buttons to questions
- Track feedback scores
- Adjust question frequency based on user engagement

---

## Troubleshooting

### Issue: Answer Watcher Not Detecting Answers

**Symptoms:**
- Questions stay in pending even after replying
- No audit events from answer-watcher

**Solutions:**
```bash
# Check if questionId was passed in URL
grep "curiosity.*answerTo" memory/episodic/*/*.json

# Run watcher manually with verbose logging
tsx brain/agents/curiosity-answer-watcher.ts

# Check for lock conflicts
ls -la logs/run/locks/agent-curiosity-answer-watcher.lock
```

### Issue: Researcher Not Generating Notes

**Symptoms:**
- No files in `memory/curiosity/research/`
- No audit events from researcher

**Solutions:**
```bash
# Check if pending questions exist
ls memory/curiosity/questions/pending/

# Run researcher manually
tsx brain/agents/curiosity-researcher.ts

# Check LLM connectivity
curl http://localhost:11434/api/version
```

### Issue: Questions Not Expiring

**Symptoms:**
- Old questions (> 7 days) still in pending directory

**Solutions:**
```bash
# Check question timestamps
for f in memory/curiosity/questions/pending/*.json; do
  echo "$f: $(jq -r '.askedAt' "$f")"
done

# Run service manually (expiration runs first)
tsx brain/agents/curiosity-service.ts

# Check expired directory
ls -la memory/curiosity/expired/
```

---

## Files Summary

### New Files Created (2)
1. `brain/agents/curiosity-answer-watcher.ts` - Answer detection agent
2. `brain/agents/curiosity-researcher.ts` - Research enhancement agent

### Modified Files (3)
1. `apps/site/src/pages/api/persona_chat.ts` - Added questionId support
2. `brain/agents/curiosity-service.ts` - Added auto-expiration
3. `etc/agents.json` - Registered 2 new agents

---

## Agent Quick Reference

| Agent | Purpose | Interval | Priority | Enabled |
|-------|---------|----------|----------|---------|
| **curiosity** | Ask questions + expire old ones | 30 min | Low | No (manual) |
| **curiosity-answer-watcher** | Detect answered questions | 5 min | Low | No (manual) |
| **curiosity-researcher** | Generate research notes | 60 min | Low | No (manual) |

**To Enable All Agents:**
```bash
# Edit etc/agents.json and set "enabled": true for:
# - curiosity
# - curiosity-answer-watcher
# - curiosity-researcher
```

---

## Complete System Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                    CURIOSITY SYSTEM                          │
└─────────────────────────────────────────────────────────────┘

    Every 30 minutes (curiosity agent):
    ┌──────────────────────────────┐
    │ 1. Expire old questions      │ → memory/curiosity/expired/
    │ 2. Check inactivity          │
    │ 3. Check question limit      │
    │ 4. Generate new question     │ → memory/curiosity/questions/pending/
    │ 5. Capture as episodic event │ → memory/episodic/
    └──────────────────────────────┘

    Every 60 minutes (researcher agent):
    ┌──────────────────────────────┐
    │ 1. Pick pending question     │ ← memory/curiosity/questions/pending/
    │ 2. Extract topics (LLM)      │
    │ 3. Search memories           │ ← memory/episodic/
    │ 4. Generate research notes   │ → memory/curiosity/research/
    └──────────────────────────────┘

    User interaction:
    ┌──────────────────────────────┐
    │ 1. View question in UI       │ ← Memory → Curiosity tab
    │ 2. Click "Reply in Chat"     │
    │ 3. Answer in chat with       │ → /api/persona_chat?questionId=...
    │    questionId parameter      │
    │ 4. Message captured with     │ → memory/episodic/ (with metadata)
    │    curiosity.answerTo        │
    └──────────────────────────────┘

    Every 5 minutes (answer-watcher agent):
    ┌──────────────────────────────┐
    │ 1. Scan episodic events      │ ← memory/episodic/
    │ 2. Find curiosity.answerTo   │
    │ 3. Move question to answered │ → memory/curiosity/questions/answered/
    │ 4. Update status + timestamp │
    └──────────────────────────────┘
```

---

## Success Criteria ✅

All optional enhancements have been successfully implemented:

- ✅ Answer detection automatically links user replies to questions
- ✅ Research agent generates contextual notes for deeper understanding
- ✅ Auto-expiration keeps the system clean (7-day threshold)
- ✅ All agents are multi-user aware with proper isolation
- ✅ Full audit trail for all operations
- ✅ Lock guards prevent duplicate runs
- ✅ Graceful error handling throughout

---

## Next Steps for Users

1. **Enable the agents** in `etc/agents.json`:
   - Set `curiosity.enabled = true`
   - Set `curiosity-answer-watcher.enabled = true`
   - Set `curiosity-researcher.enabled = true` (optional)

2. **Configure settings** in UI:
   - System → Settings → Curiosity Level → "Gentle"

3. **Test the flow**:
   - Wait for first question or run agent manually
   - Reply to question in chat
   - Watch question move from pending → answered

4. **Review research notes**:
   - Check `memory/curiosity/research/*.md` files
   - See what context was gathered for each question

---

**Status**: ✅ All Enhancements Complete & Production Ready

**Documentation**: See [curiosity-system-COMPLETED.md](curiosity-system-COMPLETED.md) for base system details
