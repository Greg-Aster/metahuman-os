# Persona Generator User Guide

The Persona Generator is an interactive personality interview system that helps you build and refine your digital persona through structured conversations. It uses motivational interviewing techniques to extract authentic personality traits, values, goals, and communication styles.

## Overview

The Persona Generator creates a **structured personality profile** by:
- **Adaptive questioning**: 7-15 questions that adjust based on your answers
- **Category coverage**: Tracks completion across 5 personality dimensions
- **LLM-powered extraction**: Converts conversational responses into structured data
- **Safe merging**: Previews changes before applying to your persona
- **Training data export**: Optionally saves interview transcripts for LoRA fine-tuning

## Accessing the Persona Generator

### Web UI (Recommended)

1. Navigate to **System → Generator** in the left sidebar
2. Click **"Start New Interview"**
3. Answer questions as they appear
4. Review the diff and apply changes when complete

### CLI (Advanced)

```bash
# Interactive terminal interview
./bin/mh persona generate

# Resume previous session
./bin/mh persona generate --resume

# View all sessions
./bin/mh persona sessions

# Apply a finalized session
./bin/mh persona apply <sessionId>
```

## How It Works

### 1. Start Interview

When you start a new interview, the system creates a session and presents the first question based on predefined baseline questions.

**Example First Question:**
```
[VALUES]
Q: What values are most important to you in your work and personal life?
```

### 2. Answer Questions

Provide thoughtful, detailed answers. The system works best when you:
- **Be specific**: Use concrete examples instead of generic statements
- **Be authentic**: Honest responses lead to better persona alignment
- **Elaborate**: Longer answers provide more context for extraction

**Good Answer Example:**
```
I value autonomy and continuous learning. For example, when choosing between
a high-paying corporate role and a startup opportunity, I chose the startup
because it offered more freedom to experiment and learn new technologies.
```

**Less Useful Answer:**
```
I like learning new things and being independent.
```

### 3. Track Progress

The system tracks your coverage across **5 personality categories**:

| Category        | What It Captures |
|-----------------|------------------|
| **Values**      | Core principles, ethical guidelines, what matters most |
| **Goals**       | Short-term and long-term aspirations |
| **Style**       | Communication patterns, problem-solving approaches |
| **Biography**   | Life experiences, background, formative events |
| **Current Focus** | What you're working on right now |

Each category needs **80% coverage** to be considered complete (typically 2+ questions per category).

**Progress View:**
```
==================================================
CATEGORY COVERAGE:
  values          ██████████ 100%
  goals           ██████░░░░  60%
  style           ████████░░  80%
  biography       ██████░░░░  60%
  current_focus   ████░░░░░░  40%
==================================================
```

### 4. Interview Completion

The interview automatically completes when:
- **All categories reach 80% coverage**, OR
- **Maximum questions reached** (15 questions), OR
- **LLM determines sufficient data collected**

### 5. Review Changes

After completion, you'll see a **diff preview** showing:
- **Additions**: New data being added to your persona
- **Updates**: Existing data being modified
- **Confidence score**: How confident the extraction is (based on answer detail)

**Diff Example:**
```
Persona Changes Summary
==================================================
Additions: 3
Updates: 2
Unchanged: 5

Detailed Changes:
--------------------------------------------------

Field: values.core
Action: ADD
New Value: [
  {
    "value": "Autonomy",
    "importance": "high",
    "description": "Freedom to make independent decisions"
  }
]

Field: personality.bigFive.openness
Action: UPDATE
Old Value: 0.5
New Value: 0.85
```

### 6. Select Merge Strategy

Choose how to integrate the new data:

| Strategy  | Behavior | Use When |
|-----------|----------|----------|
| **Merge** (Default) | Intelligently combines new and existing data, deduplicates, preserves unique values | Most common case - you want to update your persona while keeping existing data |
| **Replace** | Completely replaces existing persona data with new extracted data | Starting fresh or extracted data is definitive |
| **Append** | Adds all new data alongside existing without removing anything | You want to accumulate all data without deduplication |

### 7. Apply Changes

Once you select a strategy and confirm:
- **Backup created**: Your current persona is saved to `persona/backups/`
- **Changes applied**: Updated persona saved to `persona/core.json`
- **Session marked**: Interview session status set to `applied`
- **Audit logged**: All changes logged to audit trail

## Common Workflows

### Scenario 1: First-Time Setup

```bash
# Web UI
1. System → Generator → Start New Interview
2. Answer all 7-15 questions
3. Review diff
4. Apply with "merge" strategy

# CLI
./bin/mh persona generate
# Answer questions interactively
# Review diff and approve
```

### Scenario 2: Updating Goals

If you want to update just your goals:

```bash
# Start interview and focus answers on goals-related questions
./bin/mh persona generate

# When asked about other categories, provide brief answers
# Give detailed answers for goal-related questions
```

The system will extract primarily goal-related data, and merging will update only those fields.

### Scenario 3: Pausing and Resuming

**Web UI:**
- Click "Pause" button during interview
- Return later: System automatically shows "Resume Interview" notification

**CLI:**
- Type `quit` or `exit` during interview
- Resume: `./bin/mh persona generate --resume`

### Scenario 4: Reviewing Past Interviews

**Web UI:**
- System → Generator → Show Session History
- View status, question count, dates

**CLI:**
```bash
# List all sessions
./bin/mh persona sessions

# View transcript
./bin/mh persona view <sessionId>
```

## Advanced Features

### Session Management

**List Sessions**
```bash
./bin/mh persona sessions

# Output:
# Session ID: sess-20251114-001
# Status:     completed
# Created:    11/14/2025, 2:30 PM
# Questions:  12
# Answers:    12
```

**View Transcript**
```bash
./bin/mh persona view sess-20251114-001

# Shows full Q&A transcript with category coverage
```

**Discard Session**
```bash
./bin/mh persona discard sess-20251114-001
# Confirms before deletion
```

### Session Cleanup

Automatically archive old sessions:

```bash
# Dry run (preview what would be cleaned)
./bin/mh persona cleanup --dry-run

# Clean sessions older than 30 days (default)
./bin/mh persona cleanup

# Custom age threshold
./bin/mh persona cleanup --max-age 60
```

Sessions are **archived** (moved to `_archive/`) rather than deleted, so you can still access them if needed.

### Training Data Export

When finalizing a session in the web UI or CLI, you can opt to export the transcript for future LoRA training:

**Web UI:**
- Automatically exports during finalization

**CLI:**
- Exported to `memory/training/persona-interviews/`
- Format: JSONL with question-answer pairs
- Used for fine-tuning your persona model

## Tips for Best Results

### Writing Good Answers

**✓ DO:**
- Provide specific examples
- Explain your reasoning
- Mention concrete situations
- Use first-person narrative

**✗ DON'T:**
- Give one-word answers
- Use generic platitudes
- Avoid examples
- Try to sound "impressive"

### Understanding the Questions

The psychotherapist role uses **motivational interviewing techniques**:

- **Open-ended questions**: Cannot be answered with yes/no
- **Reflective listening**: May mirror your words back
- **Follow-up probing**: Asks for clarification when answers are vague
- **Contradiction exploration**: Gently surfaces inconsistencies

This creates a natural, conversational feel while ensuring comprehensive data collection.

### Privacy & Security

The persona generator **NEVER asks for**:
- Full legal name (unless you volunteer it)
- Social security number or government IDs
- Specific medical diagnoses
- Financial account numbers
- Exact home addresses
- Sensitive personal identifiers

All interview data is:
- **Stored locally** in your profile directory
- **Isolated by user** (multi-user safe)
- **Audited** (all operations logged)
- **Backed up** before applying changes

## Troubleshooting

### "No active session found" when resuming

**Cause**: Session was completed or discarded
**Solution**: Start a new interview instead of resuming

### "Session already finalized"

**Cause**: Trying to finalize twice
**Solution**: Use `./bin/mh persona apply <sessionId>` to apply instead

### "Write access denied"

**Cause**: Running as anonymous user or read-only mode
**Solution**: Authenticate first or check cognitive mode settings

### Questions seem repetitive

**Cause**: LLM needs more context from previous answers
**Solution**: Provide longer, more detailed answers with specific examples

### Diff shows unwanted changes

**Cause**: Extraction may have misinterpreted some answers
**Solution**:
1. Choose "discard" instead of apply
2. Start new session with clearer answers
3. Or manually edit `persona/core.json` after applying

## Files and Directories

### Session Storage

```
profiles/<username>/persona/interviews/
├── index.json                    # Session index
├── sess-20251114-001/            # Individual session
│   ├── session.json              # Session data
│   └── summary.json              # Finalized extraction
├── sess-20251114-002/
└── _archive/                     # Old sessions (30+ days)
```

### Backups

```
profiles/<username>/persona/
├── core.json                     # Active persona
└── backups/
    ├── core-backup-1699999999.json
    └── core-backup-1700000000.json
```

### Training Data

```
profiles/<username>/memory/training/persona-interviews/
├── sess-20251114-001-timestamp.jsonl
└── sess-20251114-002-timestamp.jsonl
```

## FAQ

**Q: How long does an interview take?**
A: Typically 10-20 minutes for 7-15 questions, depending on answer length.

**Q: Can I edit my answers after submitting?**
A: Not currently. You can discard the session and start over, or manually edit the extracted persona data.

**Q: What happens to my old persona data?**
A: It's backed up to `persona/backups/` before any changes are applied.

**Q: Can I run multiple interviews?**
A: Yes! Each session is independent. You can run multiple interviews and apply the best one.

**Q: How does merging work exactly?**
A: The "merge" strategy:
- Adds new values that don't exist
- Updates existing values with new data
- Deduplicates by value name
- Preserves unique existing data

**Q: Is my interview data used for training?**
A: Only if you opt-in during finalization. Training data is stored locally and never sent externally.

**Q: Can I customize the questions?**
A: The baseline questions are in `etc/persona-generator.json`. Advanced users can modify these, but follow-up questions are dynamically generated by the LLM.

## Next Steps

After completing your persona interview:

1. **Test your persona**: Chat with your updated persona to see how it responds
2. **Train an adapter**: Use the exported training data for LoRA fine-tuning
3. **Refine further**: Run additional interviews as your goals/values evolve
4. **Share profiles**: Export your persona for use on other devices (see Multi-User Guide)

For more information:
- [Architecture Overview](../ARCHITECTURE.md) - Technical details
- [Multi-User System](./MULTI_USER_PLAN.md) - Profile management
- [Audit Logs](./AUDIT.md) - Understanding logged events
