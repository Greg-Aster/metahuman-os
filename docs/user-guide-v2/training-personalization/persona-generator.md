# Persona Generator

The Persona Generator is an AI-powered interview system that helps you create and refine your digital personality through a conversational, therapist-style interview process.

## Overview

The Persona Generator conducts guided interviews using adaptive questions across 5 personality categories. Through thoughtful responses, the system extracts structured persona data and updates your `persona/core.json` file with new insights.

**Key Features:**
- **Therapist-style interviewing**: Uses motivational interviewing techniques
- **Adaptive questions**: Follow-up questions based on your answers
- **5 personality categories**: Values, goals, style, biography, current focus
- **Session resume**: Pause and continue interviews later
- **Safe merging**: Preview changes before applying
- **Training data export**: Export interviews for LoRA fine-tuning

## When to Use

Use the Persona Generator for:
- **Initial persona creation** - First-time setup
- **Major life changes** - Career shifts, relocations, significant events
- **Personality evolution** - When you've changed significantly
- **Comprehensive updates** - Quarterly or annual personality reassessment

For quick tweaks, use the [Persona Editor](persona-editor.md) instead.

## Accessing the Generator

### Via Web UI

1. Navigate to **Persona Generator** in the left sidebar
2. Click **"Start New Interview"**
3. Begin answering questions

### Via CLI

```bash
# Start a new interview session
./bin/mh persona generate
```

## The Interview Process

### 1. Starting a Session

When you start a new interview:
- System creates a unique session ID
- First baseline question appears
- Category coverage tracker initializes (all at 0%)

**Session Storage:**
```
profiles/<username>/state/persona-interviews/
├── session-<id>.json       # Active session
└── session-<id>-complete.json  # Completed session
```

### 2. Answering Questions

For each question:
- Read the question carefully
- Type your response (minimum 20 characters)
- Click **"Submit Answer"** or press Ctrl+Enter
- Wait for next question (system generates adaptive follow-ups)

**Question Categories:**

1. **Values** (Core principles and ethics)
   - "What core values guide your most important life decisions?"
   - "When you face a difficult choice, what factors matter most to you?"

2. **Goals** (Aspirations and objectives)
   - "What are you currently working toward?"
   - "If you could master one new skill, what would it be and why?"

3. **Style** (Communication and interaction preferences)
   - "How would you describe your communication style?"
   - "How do you prefer to process information?"

4. **Biography** (Formative experiences and background)
   - "What experiences have shaped who you are today?"

5. **Current Focus** (Present interests and priorities)
   - "What topics or projects are you most engaged with right now?"

### 3. Category Coverage

The UI shows real-time progress for each category:

```
Values: 60%
Goals: 80%
Style: 40%
Biography: 60%
Current Focus: 100%
```

**Completion Requirements:**
- Minimum 7 questions answered
- Each category should reach 80% coverage
- Typically 7-15 questions total (configurable in `etc/persona-generator.json`)

### 4. Session Management

**Pause and Resume:**
- Your session auto-saves every 30 seconds
- Close the browser - your progress is saved
- Return later and click **"Resume Session"**
- Continue where you left off

**Editing Answers:**
- Click the **edit icon** (✏️) next to any previous answer
- Modify your response
- Click **"Save"** to update
- System regenerates follow-up questions if needed

**Quick Notes Feature:**
- Click **"Add Notes"** button
- Paste in existing notes or journal entries
- System extracts insights without asking questions
- Useful for bulk importing existing self-reflections

### 5. Completing the Interview

When you've answered enough questions:
1. Click **"Finalize Interview"**
2. System analyzes all your responses
3. Extracts structured persona data
4. Shows diff preview of proposed changes

**Extraction Process:**
- Uses psychotherapist model for analysis
- Identifies values, goals, communication patterns
- Detects personality traits and preferences
- Organizes insights into persona schema

### 6. Reviewing Changes

The diff viewer shows:
- **Additions**: New fields being added (green)
- **Modifications**: Existing fields being updated (yellow)
- **Context**: Unchanged fields for reference (gray)

**Example Diff:**
```diff
"communication_style": {
-  "tone": "friendly"
+  "tone": "friendly and direct",
+  "preferences": ["concise explanations", "bullet points"]
}

+ "current_projects": [
+   "learning guitar",
+   "building a garden"
+ ]
```

### 7. Merge Strategies

Choose how to apply changes:

**Merge (Recommended)**
- Adds new fields
- Updates existing fields
- Preserves unmentioned fields
- **Use when**: You want to enrich existing persona

**Replace**
- Completely replaces persona with interview results
- Deletes fields not mentioned in interview
- **Use when**: Starting fresh or major overhaul

**Append**
- Only adds new fields
- Never modifies existing fields
- **Use when**: You want to add to persona without changing anything

### 8. Applying Changes

After choosing a merge strategy:
1. Click **"Apply Changes"**
2. System backs up current persona to `persona/archive/`
3. Merges interview results into `persona/core.json`
4. Shows success confirmation
5. New persona immediately active

**Automatic Backup:**
```
persona/archive/
└── core-2025-11-25-143022.json  # Timestamped backup
```

## Configuration

The generator is configured in `etc/persona-generator.json`:

```json
{
  "baselineQuestions": [
    {
      "id": "q1",
      "category": "values",
      "prompt": "What core values guide your life decisions?"
    }
  ],
  "maxQuestionsPerSession": 15,
  "requireMinimumAnswers": 7,
  "categories": [
    "values",
    "goals",
    "style",
    "biography",
    "current_focus"
  ],
  "sessionDefaults": {
    "minAnswerLength": 20,
    "maxAnswerLength": 2000,
    "targetCategoryCompletionPercentage": 80,
    "allowResume": true,
    "autoSaveInterval": 30000
  }
}
```

**Customizable Settings:**
- Add custom baseline questions
- Adjust minimum/maximum answer lengths
- Change category completion targets
- Modify auto-save interval
- Add new categories (requires code changes)

## Privacy Guidelines

The generator follows strict privacy rules:
- ❌ Never asks for full legal name (unless you volunteer it)
- ❌ Never asks for government IDs or social security numbers
- ❌ Never asks for medical diagnoses or detailed health info
- ❌ Never asks for financial account numbers or passwords
- ❌ Avoids specific location addresses
- ✅ Focuses on patterns, preferences, and personality traits

## Interviewing Techniques

The system uses professional psychological methods:

**Motivational Interviewing:**
- Open-ended questions
- Reflective listening
- No judgment or criticism
- Respects your autonomy
- Encourages self-exploration

**Adaptive Follow-ups:**
- Next question influenced by your previous answers
- Deeper exploration of mentioned topics
- Balanced coverage across categories
- Natural conversation flow

## Training Data Export

Export your interview for AI model training:

1. Complete and finalize an interview
2. Click **"Export for Training"**
3. System generates JSONL file:

```
profiles/<username>/out/training-data/
└── persona-interview-2025-11-25.jsonl
```

**Use Case:** Fine-tune LoRA adapters with your personality patterns. See [AI Training](ai-training.md) for details.

## Session History

View past interviews:
1. Click **"View History"** button
2. See list of all completed sessions
3. Click any session to review Q&A
4. Export or delete old sessions

**Session Lifecycle:**
- `active`: Currently in progress
- `completed`: Finished but not yet applied
- `finalized`: Applied to persona
- `aborted`: Cancelled without applying

## Admin Operations

**Purge All Sessions:**
- Deletes all session data (active and completed)
- Does NOT affect your applied persona
- Useful for starting fresh

**Reset Interview:**
- Clears current active session
- Preserves session history
- Start over with blank slate

## Best Practices

### Effective Answering

1. **Be specific**: "I value honesty and transparency in all relationships" > "I value honesty"
2. **Give examples**: Illustrate values with real-life scenarios
3. **Be honest**: The persona works best when it reflects the real you
4. **Take your time**: No rush - sessions can pause/resume
5. **Minimum 20 characters**: Brief answers lack context for extraction

### When to Interview

- **Initial setup**: First time using MetaHuman OS
- **Quarterly check-ins**: Review and update every 3 months
- **After major life events**: Job change, relocation, relationships
- **When persona feels off**: Responses don't match your current self

### Combining with Other Tools

1. **Persona Generator** → Initial creation
2. **[Persona Editor](persona-editor.md)** → Fine-tune specific fields
3. **Daily usage** → Build memories
4. **Psychoanalyzer agent** → Automatic evolution from memories

## Troubleshooting

### Interview Won't Start
- Check authentication (must be logged in)
- Verify not in emulation mode (write access required)
- Check `etc/persona-generator.json` exists and is valid

### Questions Seem Repetitive
- System is trying to reach 80% coverage in each category
- Answer more deeply to satisfy category requirements
- Check progress bars - incomplete categories get more questions

### Can't Apply Changes
- Must finalize interview first
- Check write permissions (not emulation mode)
- Verify backup directory is writable

### Session Lost
- Check `profiles/<username>/state/persona-interviews/`
- Sessions auto-save every 30 seconds
- Look for `session-<id>.json` files

## Next Steps

- Fine-tune with [Persona Editor](persona-editor.md) for manual adjustments
- Train AI with your personality via [AI Training](ai-training.md)
- Let psychoanalyzer agent update persona from memories automatically
- Explore [Cognitive Modes](cognitive-modes.md) to understand how persona influences behavior
