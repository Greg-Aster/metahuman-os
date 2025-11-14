# Curiosity System Documentation

## Overview

The Curiosity System is a conversational intelligence feature that generates thoughtful questions based on user memories and enables natural, non-blocking responses through a click-to-reply interface. The system operates autonomously in the background and integrates seamlessly into the chat experience.

## Core Philosophy

- **Non-Blocking**: Questions never freeze or pause conversation flow
- **Conversational**: Questions appear as regular chat messages
- **Explicit Control**: User explicitly selects and replies to questions (no LLM guessing)
- **Unlimited Questions**: No artificial limits on pending questions
- **Simple Detection**: Answer detection via explicit metadata only

## Architecture

### Three Core Agents

#### 1. Curiosity Service (`brain/agents/curiosity-service.ts`)
**Purpose**: Generate thoughtful questions based on recent memories

**Schedule**: Every 30 minutes (configurable in `etc/agents.json`)

**Behavior**:
- Processes the most recently active user (based on `lastLogin`)
- Samples 5 recent memories from the last 7 days
- Uses LLM to identify patterns and generate questions
- Respects inactivity threshold (default: 30 minutes)
- Checks minimum trust level (default: "observe")
- Expires old unanswered questions after 7 days
- **No limit on pending questions** - can accumulate unlimited questions

**Configuration** (`persona/<username>/curiosity.json`):
```json
{
  "maxOpenQuestions": 1,  // NOTE: No longer enforced (unlimited questions allowed)
  "researchMode": "local",
  "inactivityThresholdSeconds": 1800,
  "questionTopics": [],
  "minTrustLevel": "observe"
}
```

**Question Generation Guidelines**:
- Open-ended questions only
- Focus on "why" and "how"
- Avoid yes/no questions
- Under 100 words
- Genuinely curious, not formulaic
- Temperature: 0.8 for creative variety

**Output**:
- Saves questions to: `memory/curiosity/questions/pending/<question-id>.json`
- Logs to audit trail: `curiosity_question_asked`

**Question Schema**:
```json
{
  "id": "cur-q-<timestamp>-<random>",
  "question": "How might embracing silence...",
  "askedAt": "2025-11-12T08:42:12.599Z",
  "seedMemories": ["evt-...", "evt-..."],
  "status": "pending",
  "trustLevel": "adaptive_auto",
  "autonomyMode": "normal"
}
```

#### 2. Curiosity Answer Watcher (`brain/agents/curiosity-answer-watcher.ts`)
**Purpose**: Detect when users answer questions and mark them as answered

**Schedule**: Every 5 minutes (configurable in `etc/agents.json`)

**Behavior**:
- Scans episodic memories for `metadata.curiosity.answerTo` field
- When found, moves question from `pending/` to `answered/`
- Updates question status and records answer event
- **Simple explicit detection only** - no LLM semantic analysis

**Detection Method**:
```typescript
// Looks for this metadata structure in episodic memories:
{
  "metadata": {
    "curiosity": {
      "answerTo": "cur-q-1762933932599-tir44e"
    }
  }
}
```

**Output**:
- Moves questions to: `memory/curiosity/questions/answered/<question-id>.json`
- Logs to audit trail: `curiosity_question_answered`

**Answered Question Schema**:
```json
{
  "id": "cur-q-...",
  "question": "...",
  "askedAt": "...",
  "status": "answered",
  "answeredAt": "2025-11-12T09:15:00.000Z",
  "answerEvent": "memory/episodic/2025/evt-..."
}
```

#### 3. Curiosity Researcher (`brain/agents/curiosity-researcher.ts`)
**Purpose**: Perform background research on pending questions

**Schedule**: Every 60 minutes (configurable in `etc/agents.json`)

**Behavior**:
- Processes all pending questions for active user
- Extracts 2-3 key topics from each question using LLM
- Searches episodic memories for related content (limit: 5 per topic)
- Generates research summaries as markdown files
- Web research capability (requires `supervised_auto+` trust, not yet implemented)

**Output**:
- Research notes: `memory/curiosity/research/<question-id>-research.md`
- Logs to audit trail: `curiosity_research_completed`

**Research Notes Format**:
```markdown
# Research Notes for Question: <question-id>

## Question
How might embracing silence...

## Related Memories

### Topic: silence
- [evt-...] Me: "I find silence uncomfortable..."
- [evt-...] Me: "Silence helps me think..."

### Topic: self-connection
- [evt-...] Me: "When I connect with myself..."
```

## User Interface Integration

### Display System (`apps/site/src/components/ChatInterface.svelte`)

**Polling**:
- Checks `/api/curiosity/questions` every 60 seconds
- Fetches pending questions for authenticated user
- Displays new questions as system messages

**Message Format**:
```
💭 **Curiosity Question:**

How does your morning routine influence your creative energy throughout the day?

*Click this message to select it, then type your reply.*
```

**Visual Design**:
- System message styling (distinct from user/assistant)
- Emoji indicator: 💭
- Instructional text for click-to-reply
- No blocking UI elements

### Click-to-Reply System

**State Management**:
```typescript
let selectedMessage: ChatMessage | null = null;
let selectedMessageIndex: number | null = null;
```

**User Interaction Flow**:

1. **Question Appears**: Automatically selected with purple outline
2. **Visual Feedback**:
   - Selected: `outline: 2px solid rgba(167, 139, 250, 0.5)`
   - Background: `rgba(167, 139, 250, 0.05)`
   - Hover: Lighter purple background
3. **Reply Indicator**: Shows above input box with preview
4. **Type & Send**: Message includes `replyToQuestionId` metadata
5. **Deselect**: Click message again or click cancel (✕) button

**CSS Classes**:
```css
.message-selected {
  outline: 2px solid rgba(167, 139, 250, 0.5);
  outline-offset: 2px;
  background: rgba(167, 139, 250, 0.05);
  cursor: pointer;
  transition: all 0.2s ease;
}

.reply-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(167, 139, 250, 0.1);
  border-left: 3px solid rgba(167, 139, 250, 0.6);
  border-radius: 0.375rem;
  margin-bottom: 0.5rem;
}
```

**Auto-Selection Logic**:
```typescript
// When new questions arrive, auto-select the first one
if (newMessages.length > 0) {
  const questionIndex = messages.length - newMessages.length;
  selectedMessage = messages[questionIndex];
  selectedMessageIndex = questionIndex;
  console.log('[curiosity] Auto-selected new question at index', questionIndex);
}
```

## Backend Integration

### API Endpoints

#### GET `/api/curiosity/questions`
**Purpose**: Fetch pending questions for authenticated user

**Authentication**: Required (checks `locals.user`)

**Response**:
```json
{
  "success": true,
  "questions": [
    {
      "id": "cur-q-...",
      "question": "...",
      "askedAt": "...",
      "status": "pending",
      "trustLevel": "...",
      "autonomyMode": "..."
    }
  ]
}
```

**Error Responses**:
- 401: Authentication required
- 500: Internal server error

**Implementation**:
- Uses `withUserContext` for multi-user path resolution
- Reads from `paths.curiosityQuestionsPending`
- Sorts by `askedAt` timestamp (oldest first)

#### GET/POST `/api/persona_chat`
**Purpose**: Handle chat messages and capture reply metadata

**New Parameter**: `replyToQuestionId` (string, optional)

**Flow**:
1. Frontend sends message with `replyToQuestionId` in URL params
2. Backend extracts parameter from request
3. Adds metadata to episodic memory capture:
```typescript
const metadata: any = {
  cognitiveMode,
  conversationId: sessionId || undefined,
  timestamp: new Date().toISOString(),
  usedOperator: true/false,
};

// Link to curiosity question if provided (via reply-to system)
if (replyToQuestionId) {
  metadata.curiosity = {
    answerTo: replyToQuestionId
  };
}
```

**Two Capture Points**:
1. **Operator Path** (line ~885): When using ReAct operator
2. **Chat Path** (line ~1571): When using direct persona chat

Both paths include the curiosity metadata when replying to questions.

## File Structure

```
memory/curiosity/
├── questions/
│   ├── pending/          # Active questions awaiting answers
│   │   └── cur-q-<timestamp>-<id>.json
│   ├── answered/         # Answered questions with metadata
│   │   └── cur-q-<timestamp>-<id>.json
│   └── expired/          # Questions that expired (7 days)
│       └── cur-q-<timestamp>-<id>.json
└── research/             # Background research notes
    └── cur-q-<timestamp>-<id>-research.md

persona/<username>/
└── curiosity.json        # Per-user configuration

etc/
└── agents.json           # Agent scheduling configuration
```

## Agent Configuration

**File**: `etc/agents.json`

```json
{
  "agents": {
    "curiosity": {
      "id": "curiosity",
      "enabled": true,
      "type": "interval",
      "priority": "low",
      "agentPath": "curiosity-service.ts",
      "interval": 1800,  // 30 minutes
      "runOnBoot": false,
      "autoRestart": true,
      "maxRetries": 2,
      "comment": "Asks thoughtful questions during idle periods. Also expires old unanswered questions (7 days). Controlled by per-user curiosity.json config."
    },
    "curiosity-answer-watcher": {
      "id": "curiosity-answer-watcher",
      "enabled": true,
      "type": "interval",
      "priority": "low",
      "agentPath": "curiosity-answer-watcher.ts",
      "interval": 300,  // 5 minutes
      "runOnBoot": false,
      "autoRestart": true,
      "maxRetries": 2,
      "comment": "Detects when users answer curiosity questions and marks them as answered. Runs every 5 minutes."
    },
    "curiosity-researcher": {
      "id": "curiosity-researcher",
      "enabled": true,
      "type": "interval",
      "priority": "low",
      "agentPath": "curiosity-researcher.ts",
      "interval": 3600,  // 60 minutes
      "runOnBoot": false,
      "autoRestart": true,
      "maxRetries": 2,
      "comment": "Performs research on pending curiosity questions by searching memories and generating context notes. Processes one question per cycle."
    }
  }
}
```

## Agent Control

### Via Agent Monitor (Web UI)
1. Navigate to right sidebar → System Status → Agent Monitor
2. Locate curiosity agents (curiosity, curiosity-answer-watcher, curiosity-researcher)
3. Click ▶ button to manually trigger any agent
4. View last run time, success rate, and error logs

**Note**: Agents ending in `-service` (like `boredom-service`) are non-clickable persistent services. Curiosity agents ARE clickable despite the naming.

### Via CLI
```bash
# Run manually
./bin/mh agent run curiosity
./bin/mh agent run curiosity-answer-watcher
./bin/mh agent run curiosity-researcher

# Check status
./bin/mh agent status

# Monitor processing
./bin/mh agent monitor

# List running processes
./bin/mh agent ps
```

### Auto-Start with Dev Server
Agents automatically start when running:
```bash
pnpm dev
```

The scheduler service manages interval-based execution.

### Disable System
Edit `etc/agents.json` and set `"enabled": false` for any curiosity agent.

## Multi-User Support

All three agents use the **single active user strategy**:

**Active User Selection**:
1. Find users with `lastLogin` timestamp
2. Sort by most recent login
3. Process only that user
4. Fallback to owner role if no logins
5. Fallback to first user if no owner

**Context Isolation**:
```typescript
const activeUser = getMostRecentlyActiveUser();

await withUserContext(
  { userId: activeUser.userId, username: activeUser.username, role: activeUser.role },
  async () => processUserQuestions(activeUser.username)
);
```

This ensures:
- Each user has isolated question queues
- Questions don't cross user boundaries
- Path resolution respects `profiles/<username>/` structure

## Audit Trail

All curiosity operations are logged to `logs/audit/YYYY-MM-DD.ndjson`:

**Events**:
- `curiosity_service_started`: Agent cycle begins
- `curiosity_question_asked`: New question generated
- `curiosity_question_answered`: Answer detected (explicit metadata)
- `curiosity_question_expired`: Question expired after 7 days
- `curiosity_research_completed`: Research notes generated

**Example Audit Entry**:
```json
{
  "timestamp": "2025-11-12T08:42:12.599Z",
  "level": "info",
  "category": "action",
  "message": "Curiosity service asked a question",
  "actor": "curiosity-service",
  "metadata": {
    "questionId": "cur-q-1762933932599-tir44e",
    "question": "How might embracing silence as a space for self-connection r...",
    "trust": "adaptive_auto",
    "autonomy": "normal",
    "username": "greggles"
  }
}
```

## Trust Levels

**Minimum Trust Required**: `observe` (default)

**Trust Hierarchy**:
1. `observe` - Monitor only, learn patterns
2. `suggest` - Propose actions, require approval
3. `trusted` - Execute within approved categories
4. `supervised_auto` - Full autonomy with oversight (required for web research)
5. `bounded_auto` - Full autonomy within boundaries
6. `adaptive_auto` - Self-expanding boundaries

**Configuration**:
Set `minTrustLevel` in `persona/<username>/curiosity.json`

**Trust Check Logic**:
```typescript
const trustLevels = ['observe', 'suggest', 'trusted', 'supervised_auto', 'bounded_auto', 'adaptive_auto'];
const currentTrustIdx = trustLevels.indexOf(trust);
const requiredTrustIdx = trustLevels.indexOf(config.minTrustLevel);

if (currentTrustIdx < requiredTrustIdx) {
  console.log(`[curiosity-service] Trust level ${trust} below minimum ${config.minTrustLevel}, skipping`);
  return false;
}
```

## Inactivity Threshold

**Default**: 1800 seconds (30 minutes)

**Purpose**: Only ask questions when user has been inactive for a certain period

**Logic**:
```typescript
const lastActivityPath = path.join(paths.logs, 'run', 'last-activity.txt');
if (fsSync.existsSync(lastActivityPath)) {
  const lastActivityMs = parseInt(fsSync.readFileSync(lastActivityPath, 'utf-8'), 10);
  const secondsSinceActivity = Math.floor((Date.now() - lastActivityMs) / 1000);

  if (secondsSinceActivity < config.inactivityThresholdSeconds) {
    console.log(`[curiosity-service] User active ${secondsSinceActivity}s ago, skipping`);
    return false;
  }
}
```

**Configuration**:
Set `inactivityThresholdSeconds` in `persona/<username>/curiosity.json`

## Question Expiration

**Default**: 7 days

**Logic**:
```typescript
async function expireOldQuestions(username: string): Promise<number> {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  for (const file of pendingFiles) {
    const question = JSON.parse(await fs.readFile(questionPath, 'utf-8'));
    const askedAt = new Date(question.askedAt).getTime();

    if (now - askedAt > sevenDaysMs) {
      // Move to expired directory
      await fs.writeFile(expiredPath, JSON.stringify(question, null, 2));
      await fs.unlink(questionPath);
      expiredCount++;
    }
  }

  return expiredCount;
}
```

**Output**: Expired questions moved to `memory/curiosity/questions/expired/`

## Research Modes

**Configuration**: `researchMode` in `persona/<username>/curiosity.json`

### `"off"` (Disabled)
- No background research performed
- Questions generated without additional context

### `"local"` (Default)
- Searches episodic memories for related content
- Extracts topics using LLM
- Generates markdown research notes
- Limit: 5 memories per topic

### `"web"` (Future)
- Requires `supervised_auto+` trust level
- Performs web searches for additional context
- **Not yet implemented** - placeholder only

**Trust Check for Web Research**:
```typescript
if (config.researchMode === 'web') {
  const trustLevels = ['observe', 'suggest', 'trusted', 'supervised_auto', 'bounded_auto', 'adaptive_auto'];
  const currentTrustIdx = trustLevels.indexOf(trust);
  const requiredTrustIdx = trustLevels.indexOf('supervised_auto');

  if (currentTrustIdx >= requiredTrustIdx) {
    // Web research allowed
  }
}
```

## Troubleshooting

### Questions Not Appearing in Chat

**Symptoms**: Agent runs successfully but no questions appear in UI

**Checks**:
1. Verify user is authenticated (not guest/anonymous)
   ```bash
   # Check session cookie in browser DevTools
   # Application → Cookies → mh_session
   ```

2. Check API endpoint returns questions
   ```bash
   curl -H "Cookie: mh_session=<token>" http://localhost:4321/api/curiosity/questions
   ```

3. Verify polling interval is active
   ```javascript
   // Browser console should show:
   [curiosity] Fetched 1 questions from API
   [curiosity] Found 1 new questions
   ```

4. Check for JavaScript errors in browser console

5. Verify agent generated questions
   ```bash
   ls -la memory/curiosity/questions/pending/
   ```

### Answer Not Being Detected

**Symptoms**: User replies but question remains in pending state

**Checks**:
1. Wait 5 minutes for next answer-watcher cycle
   ```bash
   # Or manually trigger
   ./bin/mh agent run curiosity-answer-watcher
   ```

2. Check episodic memory has curiosity metadata
   ```bash
   # Find recent conversation
   ls -lt memory/episodic/2025/ | head -5

   # Check for metadata
   cat memory/episodic/2025/evt-<timestamp>.json | grep -A 2 curiosity
   ```

3. Verify metadata structure
   ```json
   {
     "metadata": {
       "curiosity": {
         "answerTo": "cur-q-1762933932599-tir44e"
       }
     }
   }
   ```

4. Check audit logs for detection attempts
   ```bash
   tail -f logs/audit/$(date +%Y-%m-%d).ndjson | grep curiosity
   ```

### Too Many/Few Questions

**Symptoms**: Questions accumulating or not generating frequently enough

**Adjustments**:

1. **Inactivity Threshold**:
   ```json
   // persona/<username>/curiosity.json
   {
     "inactivityThresholdSeconds": 900  // 15 minutes (shorter = more questions)
   }
   ```

2. **Trust Level**:
   ```json
   {
     "minTrustLevel": "observe"  // Lower = more accessible
   }
   ```

3. **Agent Interval**:
   ```json
   // etc/agents.json
   {
     "agents": {
       "curiosity": {
         "interval": 900  // 15 minutes (shorter = more frequent checks)
       }
     }
   }
   ```

4. **Manual Trigger for Testing**:
   ```bash
   ./bin/mh agent run curiosity
   ```

### Agent Not Running

**Symptoms**: Agent shows stopped (○) in Agent Monitor

**Checks**:
1. Verify agent is enabled
   ```bash
   cat etc/agents.json | grep -A 10 '"curiosity"'
   ```

2. Check for stale lock files
   ```bash
   # If process crashed, lock may remain
   ls -la logs/run/locks/agent-curiosity*

   # Check if PID is actually running
   ps -p <pid-from-lock-file>

   # Remove stale lock if needed
   rm logs/run/locks/agent-curiosity-service.lock
   ```

3. Check agent logs
   ```bash
   tail -f logs/audit/$(date +%Y-%m-%d).ndjson | grep curiosity-service
   ```

4. Manual trigger to test
   ```bash
   ./bin/mh agent run curiosity
   ```

### Click-to-Reply Not Working

**Symptoms**: Clicking messages doesn't select them

**Checks**:
1. Verify message has `role="button"` and `tabindex="0"`
   ```html
   <!-- In browser DevTools → Elements -->
   <div class="message message-system" role="button" tabindex="0">
   ```

2. Check for JavaScript errors in console

3. Verify CSS classes are applied
   ```css
   .message-selected {
     outline: 2px solid rgba(167, 139, 250, 0.5);
   }
   ```

4. Test with simple click
   ```javascript
   // Browser console
   document.querySelector('.message').click()
   ```

5. Check if message has curiosityQuestionId metadata
   ```javascript
   // Browser console
   console.log(messages[0].meta?.curiosityQuestionId)
   ```

## Performance Considerations

### Memory Usage
- Questions stored as small JSON files (~500 bytes each)
- Research notes stored as markdown (~5-10 KB each)
- No significant memory footprint with hundreds of questions

### LLM Calls
- **Question Generation**: 1 LLM call per cycle (30 min intervals)
- **Research**: 1 LLM call for topic extraction per question (60 min intervals)
- **Answer Detection**: 0 LLM calls (explicit metadata only)

### File I/O
- **Read Operations**: Minimal, only during agent cycles
- **Write Operations**: 1 write per question, 1 write per answer, 1 write per research note
- **Directory Scans**: Answer-watcher scans episodic directory every 5 minutes

### API Polling
- **Questions API**: Polled every 60 seconds by frontend
- **Response Size**: Small (~2 KB per question)
- **Impact**: Negligible for typical usage

## Future Enhancements

### Planned Features
- [ ] Web research integration (requires API keys)
- [ ] Topic-specific question filtering
- [ ] Question quality voting/feedback system
- [ ] Multi-turn conversation threading
- [ ] Voice narration of questions (if TTS enabled)
- [ ] Question history visualization
- [ ] Smart scheduling (avoid interrupting focused work)
- [ ] Question templates library
- [ ] Integration with task system (convert questions to tasks)

### Known Limitations
- Single active user processed per cycle (not all users simultaneously)
- No semantic similarity detection for duplicate questions
- No question priority system
- Web research not yet implemented
- No A/B testing for question quality

## Related Documentation

- [CURIOSITY-CONVERSATIONAL.md](./CURIOSITY-CONVERSATIONAL.md) - Original design document
- [08-autonomous-agents.md](./user-guide/08-autonomous-agents.md) - Agent system overview
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [CLAUDE.md](../CLAUDE.md) - Development guide

## Version History

**v2.0.0** (2025-11-12) - Click-to-Reply System
- Removed `maxOpenQuestions` limit (unlimited questions)
- Simplified answer detection (explicit metadata only, no LLM)
- Built universal click-to-reply UI system
- Added auto-selection for curiosity questions
- Updated backend to capture `replyToQuestionId` metadata
- Fixed `pendingCount` reference bug in audit logs

**v1.0.0** (2025-11-10) - Initial Implementation
- Three-agent architecture (service, watcher, researcher)
- LLM semantic answer detection (Phase 5)
- Question generation with trust levels
- Research system with local memory search
- Multi-user support with active user strategy
