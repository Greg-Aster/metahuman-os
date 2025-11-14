# Conversational Curiosity System

## Overview

The curiosity system generates thoughtful questions during idle periods and presents them naturally in the conversation interface. Users can answer questions conversationally without any special formatting or commands.

## Key Features

### ✅ Non-Blocking Design
- Questions appear as system messages in the chat interface
- Never freezes or blocks ongoing conversation
- Users can choose to answer, ignore, or continue their own conversation

### ✅ Natural Answer Detection
- Automatic semantic detection using LLM analysis
- No special tags or metadata required in user responses
- Checks recent conversation history (last 24 hours) for answers
- Falls back to explicit metadata if manually tagged

### ✅ Conversational Integration
- Questions displayed with friendly formatting: "💭 **Curiosity Question:**"
- Optional message: "*Feel free to answer naturally in conversation, or just ignore this if you're not interested.*"
- Polls for new questions every 60 seconds
- Seamlessly integrated into chat flow alongside reflections and dreams

## Architecture

### Components

1. **curiosity-service.ts** (Interval Agent: 30 min)
   - Generates questions based on recent memory patterns
   - Respects inactivity thresholds and trust levels
   - Limits open questions (default: 1 max)

2. **curiosity-answer-watcher.ts** (Interval Agent: 5 min)
   - **Explicit Detection**: Looks for `metadata.curiosity.answerTo` fields
   - **Semantic Detection**: Uses LLM to analyze recent conversations
   - Marks questions as answered and moves them to answered directory

3. **curiosity-researcher.ts** (Interval Agent: 60 min)
   - Performs background research on pending questions
   - Searches related memories and generates context notes
   - Prepares research summaries for future reference

### API Endpoints

**GET /api/curiosity/questions**
- Returns array of pending questions for authenticated user
- Requires user context (respects multi-user isolation)
- Response: `{ success: boolean, questions: CuriosityQuestion[] }`

### UI Integration

**ChatInterface.svelte**
- Polls `/api/curiosity/questions` every 60 seconds
- Displays new questions as system messages
- Tracks displayed questions via `meta.curiosityQuestionId`
- Prevents duplicate display

## Configuration

File: `persona/<username>/curiosity.json` (per-user)

```json
{
  "maxOpenQuestions": 1,
  "researchMode": "local",
  "inactivityThresholdSeconds": 1800,
  "questionTopics": [],
  "minTrustLevel": "observe"
}
```

### Settings

- **maxOpenQuestions**: Maximum pending questions before new generation pauses
- **researchMode**: `"off"` | `"local"` | `"web"` (web requires supervised_auto+ trust)
- **inactivityThresholdSeconds**: How long user must be inactive before asking questions
- **questionTopics**: Optional array to focus questions on specific topics
- **minTrustLevel**: Minimum trust level required (default: "observe")

## Usage Examples

### Example 1: Question Appears in Chat

```
💭 **Curiosity Question:**

How does your morning routine influence your creative energy throughout the day?

*Feel free to answer naturally in conversation, or just ignore this if you're not interested.*
```

User can respond naturally:
```
Actually, I've noticed that when I skip breakfast, I tend to have more focus
but less sustained energy. My best creative work happens around 10am after
coffee and a light meal.
```

The answer-watcher will automatically detect this as an answer within 5 minutes.

### Example 2: Ignoring Questions

Questions don't block conversation. User can continue with unrelated topics:

```
USER: What's the status of my training data?
ASSISTANT: You have 1,247 conversation memories prepared for training...
```

The question remains pending until answered or expires after 7 days.

## Technical Details

### Answer Detection Algorithm

1. **Explicit Path** (Fast, 5-min cycle):
   - Scan episodic memories for `metadata.curiosity.answerTo` field
   - Move matching questions to answered directory

2. **Semantic Path** (Intelligent, 5-min cycle):
   - Collect conversations from last 24 hours
   - For each pending question:
     - Use LLM to analyze: "Does this message answer the question?"
     - Temperature: 0.0 for deterministic results
     - Max tokens: 10 (expects "yes" or "no")
   - Move answered questions to answered directory

### Question Generation

- Samples 5 recent memories (last 7 days)
- Uses LLM to identify patterns and generate thoughtful questions
- Temperature: 0.8 for creative question variety
- Guidelines enforced:
  - Open-ended questions only
  - Focus on "why" and "how"
  - Avoid yes/no questions
  - Under 100 words
  - Genuinely curious, not formulaic

### Research System

When research mode is enabled:
- Extracts 2-3 key topics from each question
- Searches episodic memories for related content (limit: 5 per topic)
- Generates research summaries as markdown files
- Stored in: `memory/curiosity/research/<question-id>-research.md`

## File Structure

```
memory/curiosity/
├── questions/
│   ├── pending/          # Active questions awaiting answers
│   ├── answered/         # Answered questions with metadata
│   └── expired/          # Questions that expired (7 days)
└── research/             # Background research notes
    └── <question-id>-research.md
```

## Agent Control

All three curiosity agents are **enabled by default** and auto-start with `pnpm dev`.

### Via Agent Monitor (Web UI)
- Right sidebar → System Status → Agent Monitor
- Click ▶ button to manually trigger any curiosity agent
- View last run time, success rate, and errors

### Via CLI
```bash
# Run manually
./bin/mh agent run curiosity
./bin/mh agent run curiosity-answer-watcher
./bin/mh agent run curiosity-researcher

# Stop/start managed agents
./bin/mh agent stop curiosity
./bin/mh agent start curiosity
```

### Disable System
Edit `etc/agents.json` and set `"enabled": false` for curiosity agents.

## Audit Trail

All curiosity operations are logged to `logs/audit/YYYY-MM-DD.ndjson`:

- `curiosity_service_started`
- `curiosity_question_asked`
- `curiosity_question_answered` (explicit or semantic)
- `curiosity_question_expired`
- `curiosity_research_completed`

## Troubleshooting

### Questions not appearing in chat
- Check `/api/curiosity/questions` returns questions
- Verify user is authenticated (not guest/anonymous)
- Ensure polling interval is active (check browser console)

### Answer not being detected
- Wait 5 minutes for next answer-watcher cycle
- Check audit logs for semantic detection attempts
- Verify conversation is saved to episodic memory with `type: "conversation"`

### Too many/few questions
- Adjust `maxOpenQuestions` in `curiosity.json`
- Check inactivity threshold (default: 30 minutes)
- Verify user trust level meets minimum requirement

## Future Enhancements

- [ ] Web research integration (requires API keys)
- [ ] Topic-specific question filtering
- [ ] Question quality voting/feedback
- [ ] Multi-turn conversation threading
- [ ] Voice narration of questions (if TTS enabled)
