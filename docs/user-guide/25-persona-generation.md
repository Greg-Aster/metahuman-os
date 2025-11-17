# Persona Management System

MetaHuman OS provides **three complementary tools** for creating and maintaining your digital persona. Each serves a distinct purpose in the persona lifecycle, working together to keep your personality profile accurate, detailed, and current.

## The Three Persona Tools

### 1. PersonaGenerator (Therapist Interview)

**Purpose**: Initial persona creation and major personality discovery

The PersonaGenerator conducts a guided interview using a specialized "psychotherapist" language model. Through 7-15 adaptive questions, it helps you articulate your values, goals, communication style, biography, and current focus.

**When to use:**
- First-time setup
- Major life changes or transitions
- Significant personality evolution
- When you want comprehensive personality reassessment

**Access:**
- **Web UI**: System → Generator → Start New Interview
- **CLI**: `./bin/mh persona generate`

**How it works:**
1. Answer 7-15 questions across 5 personality categories
2. System tracks coverage (each category needs 80% completion)
3. LLM extracts structured persona data from your answers
4. Review diff showing proposed changes
5. Choose merge strategy (merge/replace/append)
6. Apply changes with automatic backup

**Key features:**
- Motivational interviewing techniques
- Adaptive follow-up questions
- Session pause/resume
- Training data export for LoRA fine-tuning
- Safe merging with preview

📖 **Detailed guide**: [PERSONA-GENERATOR.md](PERSONA-GENERATOR.md)

---

### 2. PersonaEditor (Manual Editing)

**Purpose**: Direct editing and fine-tuning of persona fields

The PersonaEditor provides a tabbed UI for viewing and editing all persona fields directly. No interview required - you have full manual control over every field.

**When to use:**
- Quick updates to specific fields
- Fine-tuning after interview
- Fixing extraction errors
- Adding details the interview missed

**Access:**
- **Web UI**: System → Persona (Editor tab)

**How it works:**
1. Navigate through tabbed interface:
   - **Core Identity**: Identity, Personality, Values, Goals, Context, Advanced
   - **Facets**: Individual persona facets (if using multi-facet system)
2. Edit any field directly
3. Click **Save** to apply changes (manual save required)
4. Changes logged to audit trail

**Editable fields:**
- Identity (name, role, aliases, background)
- Personality (communication style, interests, aesthetic, traits)
- Values (core values with priorities)
- Goals (short-term, mid-term, long-term with statuses)
- Context (domains, projects, current focus)
- Decision heuristics
- Writing style and motifs

**Key features:**
- Full manual control
- No AI interpretation
- Immediate updates
- Multi-user safe (profile-specific)
- All changes audited

---

### 3. Psychoanalyzer (Automatic Evolution)

**Purpose**: Passive persona evolution based on lived experiences

The Psychoanalyzer agent reviews your recent episodic memories, extracts personality insights, and incrementally updates your persona. It both **adds new patterns** and **removes stale content** to keep your persona fresh and accurate.

**When to use:**
- Monthly/quarterly persona maintenance
- After accumulating significant memories
- When persona feels outdated
- For organic personality evolution

**Access:**
- **CLI**: `./bin/mh agent run psychoanalyzer`

**How it works:**
1. Selects recent memories (default: last 14 days, up to 100 memories)
2. Analyzes with psychotherapist model to extract patterns
3. Compares findings with current persona
4. **Adds new insights**: Values, goals, interests, patterns discovered in memories
5. **Removes stale content**: Goals with no recent evidence, faded interests, outdated heuristics
6. Archives current persona before changes
7. Generates changelog with full change history

**Key features:**
- **Two-way updates**: Adds new + removes stale
- **Reconciliation system**: Keeps persona lean and current
- **Confidence filtering**: Only updates above threshold (default: 60%)
- **Automatic archival**: Up to 50 versions kept
- **Detailed changelog**: Human-readable evolution tracking
- **Configurable**: Fine-tune what gets added/removed

**Reconciliation (Removing Stale Content):**

Without reconciliation, your persona would endlessly accumulate outdated information. The psychoanalyzer actively prunes:

| What Gets Removed | Example | Config Setting |
|-------------------|---------|----------------|
| **Stale goals** | "Learn Python" goal with no coding activity in 14 days | `removeStaleGoals: true` |
| **Stale interests** | "photography" interest never mentioned in recent memories | `removeStaleInterests: true` |
| **Completed goals** | "Launch website" goal with evidence of site going live | `updateGoalStatuses: true` |
| **Unused heuristics** | "when stressed → meditate" pattern no longer observed | `removeUnusedHeuristics: true` |
| **Contradicted values** | "minimalism" value contradicted by consumption patterns | `removeContradictedValues: false` (conservative) |

📖 **Detailed guide**: [../PSYCHOANALYZER.md](../PSYCHOANALYZER.md)

---

## How the Tools Work Together

The three tools form a complete persona lifecycle:

```
┌─────────────────────────────────────────────────────────────┐
│                    PERSONA LIFECYCLE                        │
└─────────────────────────────────────────────────────────────┘

1. INITIAL CREATION
   PersonaGenerator → Comprehensive interview → persona/core.json

2. FINE-TUNING
   PersonaEditor → Manual adjustments → persona/core.json

3. LIVING & CAPTURING MEMORIES
   Daily interactions → memory/episodic/

4. ORGANIC EVOLUTION (Monthly/Quarterly)
   Psychoanalyzer → Reviews memories → Updates persona

5. MAJOR UPDATES
   PersonaGenerator → New interview → Merge with existing

6. QUICK EDITS
   PersonaEditor → Direct changes → Save
```

### Recommended Workflow

**First-Time Setup:**
1. Run **PersonaGenerator** for comprehensive interview
2. Use **PersonaEditor** to refine any details
3. Live your life and capture memories
4. Run **Psychoanalyzer** monthly for organic evolution

**Ongoing Maintenance:**
1. Use **PersonaEditor** for quick updates (new project, changed goal status)
2. Run **Psychoanalyzer** monthly/quarterly for automatic evolution
3. Use **PersonaGenerator** only for major life changes or annual deep-dive

**Major Life Changes:**
1. Run **PersonaGenerator** for fresh comprehensive interview
2. Review diff and choose "merge" strategy
3. Use **PersonaEditor** to manually adjust any conflicts
4. Continue with **Psychoanalyzer** for ongoing evolution

---

## Configuration

Each tool has its own configuration:

### PersonaGenerator
**File**: `etc/persona-generator.json`

```json
{
  "categories": ["values", "goals", "style", "biography", "current_focus"],
  "coverageThreshold": 0.8,
  "maxQuestions": 15,
  "adaptiveQuestions": true
}
```

### Psychoanalyzer
**File**: `etc/psychoanalyzer.json`

```json
{
  "memorySelection": {
    "daysBack": 14,
    "maxMemories": 100
  },
  "analysis": {
    "confidenceThreshold": 0.6
  },
  "reconciliation": {
    "enabled": true,
    "removeStaleGoals": true,
    "removeStaleInterests": true,
    "updateGoalStatuses": true,
    "removeContradictedValues": false
  }
}
```

---

## File Structure

All persona data is stored in your profile directory:

```
profiles/<username>/persona/
├── core.json                        # Active persona (edited by all tools)
├── facets.json                      # Persona facets (multi-facet system)
├── therapy/                         # PersonaGenerator sessions
│   ├── index.json
│   ├── sess-20251114-001/
│   │   ├── session.json
│   │   └── summary.json
│   └── _archive/                    # Old sessions (30+ days)
├── archives/                        # Psychoanalyzer version history
│   ├── 2025-11-16-123456.json
│   ├── 2025-11-15-234567.json
│   └── CHANGELOG.md                 # Human-readable evolution log
└── backups/                         # PersonaGenerator backups
    └── core-backup-1699999999.json
```

---

## Privacy & Security

All three tools:
- **Store data locally** in your profile directory
- **Multi-user isolated** - complete profile separation
- **Fully audited** - all changes logged to audit trail
- **Backup before changes** - never lose data

**Protected fields** (never auto-updated):
- `identity.name`
- `identity.humanName`
- `identity.email`

---

## Common Workflows

### Scenario 1: New User Setup

```bash
# 1. Initial comprehensive interview
./bin/mh persona generate
# Answer 7-15 questions, review diff, apply

# 2. Fine-tune details in web UI
# Open System → Persona (Editor tab)
# Edit any fields manually, click Save

# 3. Start capturing memories
./bin/mh capture "Today I learned..."

# 4. After 2 weeks, run first psychoanalyzer
./bin/mh agent run psychoanalyzer
# Review changelog at persona/archives/CHANGELOG.md
```

### Scenario 2: Major Life Change (New Job)

```bash
# Option A: Use PersonaEditor for quick updates
# 1. Web UI → System → Persona (Editor)
# 2. Update Goals → add "Master new tech stack"
# 3. Update Context → add new project
# 4. Save changes

# Option B: Run new interview for comprehensive update
./bin/mh persona generate
# Answer questions focusing on new job context
# Merge with existing persona
```

### Scenario 3: Monthly Maintenance

```bash
# 1. Run psychoanalyzer (reviews last 14 days of memories)
./bin/mh agent run psychoanalyzer

# 2. Review what changed
cat profiles/<username>/persona/archives/CHANGELOG.md

# 3. If something looks wrong, revert from archive
cp profiles/<username>/persona/archives/2025-11-15-*.json \
   profiles/<username>/persona/core.json

# 4. Or fix manually in PersonaEditor
# Web UI → System → Persona (Editor)
```

### Scenario 4: Checking Persona Evolution

```bash
# View recent psychoanalyzer changes
cat profiles/<username>/persona/archives/CHANGELOG.md

# Compare current persona with older version
diff profiles/<username>/persona/core.json \
     profiles/<username>/persona/archives/2025-10-16-*.json

# View interview history
ls -la profiles/<username>/persona/therapy/
```

---

## Troubleshooting

### PersonaGenerator Issues

**"No active session found"**
- Session was completed or discarded
- Start new interview instead of resume

**"Questions seem repetitive"**
- LLM needs more context
- Provide longer answers with specific examples

### PersonaEditor Issues

**"Changes not saving"**
- Must click Save button (manual save required)
- Check authentication status
- Verify not in read-only/emulation mode

**"Can't edit certain fields"**
- Protected fields (name, email) require direct JSON editing
- Some fields may be disabled in emulation mode

### Psychoanalyzer Issues

**"Insufficient memories"**
- Need at least 10 memories in time window
- Reduce `minMemories` in config
- Increase `daysBack` to look further in history

**"Confidence below threshold" - no updates**
- This is normal and safe (prevents bad updates)
- Try again after more memories accumulate
- Or reduce `confidenceThreshold` (not recommended below 0.5)

**"Removed content I wanted to keep"**
1. Check changelog to see what was removed
2. Restore from archive: `cp persona/archives/PREVIOUS.json persona/core.json`
3. Disable specific reconciliation in config
4. Or manually add it back with PersonaEditor

---

## Advanced Configuration

### Tuning Psychoanalyzer Reconciliation

**Conservative (default)**:
```json
{
  "reconciliation": {
    "enabled": true,
    "removeStaleGoals": true,
    "removeStaleInterests": true,
    "updateGoalStatuses": true,
    "removeContradictedValues": false,
    "removeUnusedHeuristics": true
  }
}
```

**Aggressive (removes more)**:
```json
{
  "reconciliation": {
    "enabled": true,
    "removeStaleGoals": true,
    "removeStaleInterests": true,
    "updateGoalStatuses": true,
    "removeContradictedValues": true,    // Now enabled
    "removeUnusedHeuristics": true
  }
}
```

**Append-only (legacy - never removes)**:
```json
{
  "reconciliation": {
    "enabled": false
  }
}
```

---

## Best Practices

### PersonaGenerator
- Provide specific examples, not generic statements
- Elaborate on "why" not just "what"
- Be authentic - honest answers work best
- Take breaks if interview feels long

### PersonaEditor
- Make small, focused changes
- Always click Save after editing
- Check audit logs to verify changes applied
- Review before making bulk edits

### Psychoanalyzer
- Run monthly or quarterly for best results
- Review changelog after each run
- Archive versions you want to preserve
- Tune reconciliation settings to your preference

---

## Next Steps

After setting up your persona:

1. **Test your persona**: Chat with your updated persona to see how it responds
2. **Train an adapter**: Use exported training data for LoRA fine-tuning
3. **Capture memories**: The more memories, the better psychoanalyzer works
4. **Regular maintenance**: Run psychoanalyzer monthly to keep persona fresh

---

## Related Documentation

- **[PersonaGenerator Detailed Guide](PERSONA-GENERATOR.md)** - Complete interview system documentation
- **[Psychoanalyzer Technical Docs](../PSYCHOANALYZER.md)** - Architecture and advanced usage
- **[Multi-User Profiles](19-multi-user-profiles.md)** - Profile isolation and management
- **[Cognitive Architecture](27-cognitive-architecture.md)** - How persona integrates with cognitive layers
- **[Autonomous Agents](08-autonomous-agents.md)** - Background processes including psychoanalyzer
