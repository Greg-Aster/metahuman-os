# Psychoanalyzer Agent

The **psychoanalyzer** is an autonomous agent that reviews your recent episodic memories using the psychotherapist model, extracts personality insights, and incrementally updates your persona files to keep them fresh and relevant.

## Features

✅ **Memory Analysis** - Reviews recent memories (configurable time window)
✅ **AI-Powered Insights** - Uses psychotherapist model to extract patterns
✅ **Incremental Updates** - Adds new insights, preserves your manual edits
✅ **Reconciliation** - Removes stale goals, interests, and outdated content
✅ **Version Control** - Archives persona before each update
✅ **Change Tracking** - Generates changelog showing evolution over time
✅ **Confidence Filtering** - Only applies updates above confidence threshold
✅ **Notification** - Creates inner dialogue memory documenting changes

## How It Works

### 1. Memory Selection

The agent selects recent memories based on configuration:
- **Time window:** Last 14 days (configurable)
- **Max memories:** 100 (configurable)
- **Priority tags:** `insight`, `reflection`, `goal`, `value`, `decision`
- **Excluded types:** `audit`, `system`

### 2. AI Analysis

Selected memories are analyzed by the psychotherapist model to extract:
- **Values evolution** - New or strengthened core values
- **Goals progress** - Active, completed, or new goals
- **Communication patterns** - Speech patterns and linguistic shifts
- **Interests changes** - New hobbies or topics of focus
- **Decision heuristics** - Pattern → response mappings from experience
- **Personality shifts** - Changes in Big Five traits or archetypes
- **Aesthetic preferences** - Visual/emotional themes that resonate
- **Writing motifs** - Recurring metaphors or narrative patterns

### 3. Persona Update & Reconciliation

The agent performs **two-way updates** to `persona/core.json`:

#### A. Incremental Additions (New Insights)

Adds new patterns discovered in recent memories:

**Protected Fields** (never auto-updated):
- `identity.name`
- `identity.humanName`
- `identity.email`

**Updateable Fields** (configurable):
- `personality.communicationStyle`
- `personality.interests`
- `personality.aesthetic`
- `values.core` (appends new values)
- `goals` (all timeframes)
- `context.currentFocus`
- `context.projects`
- `decisionHeuristics`
- `writingStyle.motifs`

#### B. Reconciliation (Removing Stale Content)

**NEW!** The psychoanalyzer now **compares existing persona content** with recent memories to identify and remove outdated information:

**Stale Goals** (`removeStaleGoals: true`):
- Goals with ZERO evidence in recent memories
- Example: "Learn Python" goal with no coding activities in 14 days → removed

**Stale Interests** (`removeStaleInterests: true`):
- Interests that never appear in recent memories
- Example: "photography" interest with no related memories → removed

**Updated Goal Statuses** (`updateGoalStatuses: true`):
- Active goals showing completion evidence → marked "completed"
- Planning goals with no progress → marked "abandoned"
- Example: "Finish project report" with submission memory → status changes to "completed"

**Contradicted Values** (`removeContradictedValues: false` - disabled by default):
- Values that contradict recent behavior patterns
- **Conservative:** Disabled by default as values evolve slowly
- Example: "minimalism" value contradicted by consumption patterns → removed (if enabled)

**Unused Heuristics** (`removeUnusedHeuristics: true`):
- Decision patterns no longer observed in recent memories
- Example: Heuristic "when stressed → meditate" with no meditation memories → removed

**Why This Matters:**

Without reconciliation, your persona would accumulate endless stale content:
- Old goals you abandoned months ago still listed as "active"
- Interests from years past that no longer resonate
- Decision patterns you've outgrown
- Values that contradict who you've become

Reconciliation keeps your persona **lean, accurate, and current** by pruning outdated content while preserving what's still relevant.

### 4. Archival

Before any update:
- Current persona is archived to `persona/archives/YYYY-MM-DD-HHmmss.json`
- Up to 50 versions are kept (configurable)
- Older archives are automatically cleaned up

### 5. Changelog

A human-readable changelog is generated at `persona/archives/CHANGELOG.md`:
- Timestamp of each update
- Number of memories analyzed
- Confidence score
- List of changes applied
- Link to archived version

### 6. Notification

An inner dialogue memory is created documenting:
- Summary of analysis
- Changes applied
- Confidence level
- Instructions to review changelog

## Usage

### Manual Execution

Run the psychoanalyzer manually:

```bash
./bin/mh agent run psychoanalyzer
```

**When to run:**
- After major life events or insights
- Monthly or quarterly for persona maintenance
- When you notice your persona feels outdated
- After accumulating significant new memories

### Configuration

Edit `etc/psychoanalyzer.json` to customize:

```json
{
  "memorySelection": {
    "daysBack": 14,           // How far back to look
    "maxMemories": 100,       // Maximum memories to analyze
    "minMemories": 10         // Minimum needed to run
  },
  "analysis": {
    "model": "psychotherapist",
    "confidenceThreshold": 0.6 // Only update if confidence ≥ 60%
  },
  "updateStrategy": {
    "fields": {
      "values.core": true,    // Enable auto-update for this field
      "goals": true,
      "identity": false       // Disable (always protected)
    }
  },
  "reconciliation": {
    "enabled": true,                     // Enable reconciliation
    "removeStaleGoals": true,            // Remove goals with no recent evidence
    "removeStaleInterests": true,        // Remove interests not seen in memories
    "updateGoalStatuses": true,          // Mark goals as completed/abandoned
    "removeContradictedValues": false,   // Conservative: disabled by default
    "removeUnusedHeuristics": true       // Remove outdated decision patterns
  },
  "archival": {
    "keepVersions": 50,       // Number of archives to retain
    "generateChangelog": true
  }
}
```

**Reconciliation Settings:**

- **`enabled`**: Master toggle for all reconciliation features
- **`removeStaleGoals`**: Remove goals with zero evidence in recent memories
- **`removeStaleInterests`**: Remove interests that don't appear in memories
- **`updateGoalStatuses`**: Update goal statuses (active → completed/abandoned)
- **`removeContradictedValues`**: Remove values contradicted by behavior (conservative - off by default)
- **`removeUnusedHeuristics`**: Remove decision patterns no longer observed

**Tuning Reconciliation:**

- **Conservative (default)**: Only `removeStaleGoals`, `removeStaleInterests`, and `removeUnusedHeuristics` enabled
- **Aggressive**: Enable all reconciliation options including `removeContradictedValues`
- **Append-only (legacy)**: Set `reconciliation.enabled: false` to only add content, never remove

## Integration with Other Systems

The psychoanalyzer **works alongside** existing persona tools:

### 1. PersonaGenerator (Therapist Interview)
- **Use case:** Major personality discovery through guided Q&A
- **Trigger:** User-initiated when starting or major life changes
- **Output:** Complete persona extraction from interview
- **Merge:** User reviews diff and chooses merge strategy

### 2. PersonaEditor (Manual Editor)
- **Use case:** Fine-tuning specific fields
- **Trigger:** User-initiated anytime
- **Output:** Direct edits to persona/core.json
- **Merge:** Immediate save, no review needed

### 3. Psychoanalyzer (Automatic Evolution)
- **Use case:** Passive persona evolution from lived experience
- **Trigger:** Manual execution after memory accumulation
- **Output:** Incremental updates based on memory patterns
- **Merge:** Automatic if confidence threshold met

**Recommended Workflow:**

1. **Initial setup:** Use PersonaGenerator for comprehensive interview
2. **Fine-tuning:** Use PersonaEditor to refine specific details
3. **Ongoing maintenance:** Run Psychoanalyzer monthly/quarterly
4. **Quick updates:** Use PersonaEditor for immediate changes

## Output Examples

### Console Output

```
🧠 Psychoanalyzer Agent Starting...

🔍 Selecting memories for analysis...
✅ Selected 73 memories from last 14 days

🧠 Analyzing memories with psychotherapist model...
✅ Analysis complete (confidence: 0.82)

📦 Archiving current persona...
✅ Archived to persona/archives/2025-11-16-235959.json

📝 Updating persona with new insights...
✅ Applied 5 update(s) to persona

📋 Generating changelog...
✅ Updated changelog at persona/archives/CHANGELOG.md

💬 Creating notification memory...
✅ Created notification memory: evt-1731801599000-psychoanalyzer-update

✅ Psychoanalyzer complete!

📊 Summary:
   - Analyzed 73 memories
   - Confidence: 82%
   - Changes applied: 5

📝 Changes:
   • Added 2 new core value(s): mindfulness, intentionality
   • Added 1 midTerm goal(s)
   • Added 3 new interest(s): meditation, journaling, philosophy
   • Added 2 communication pattern(s)
   • Added 2 writing motif(s): breath metaphors, pauses
   • Removed 1 stale shortTerm goal(s): "Learn React Native" (no coding activity in recent memories)
   • Updated midTerm goal status: "Launch personal website" → completed (site went live on 2025-11-14)
   • Removed 2 stale interest(s): gaming, cryptocurrency
```

### Changelog Entry

```markdown
## 2025-11-16T23:59:59.000Z

**Psychoanalyzer Update**

- **Memories Analyzed:** 73
- **Date Range:** 2025-11-02T10:30:00.000Z to 2025-11-16T23:45:00.000Z
- **Confidence:** 82%
- **Archive:** 2025-11-16-235959.json

**Summary:** Strong evidence of increased focus on mindfulness practices and intentional living. Communication patterns show more pauses and breath metaphors. New interests in meditation and philosophy align with core value shifts toward presence and reflection. Reconciliation removed stale technical goals and faded interests.

**Changes:**
- Added 2 new core value(s): mindfulness, intentionality
- Added 1 midTerm goal(s)
- Added 3 new interest(s): meditation, journaling, philosophy
- Added 2 communication pattern(s)
- Added 2 writing motif(s): breath metaphors, pauses
- Removed 1 stale shortTerm goal(s): "Learn React Native" (no coding activity in recent memories)
- Updated midTerm goal status: "Launch personal website" → completed (site went live on 2025-11-14)
- Removed 2 stale interest(s): gaming, cryptocurrency

---
```

## Safety & Control

### Confidence Threshold

Only updates with confidence ≥ threshold are applied (default: 60%)

### Field Protection

Critical identity fields are **always protected**:
- `identity.name` - Your persona name
- `identity.humanName` - Your human name
- `identity.email` - Contact information

### Merge Strategy

All updates use **append-only** strategy by default:
- New values are added
- Existing values are preserved
- Nothing is deleted automatically

### Manual Override

You can always:
1. **Disable auto-update:** Set `enabled: false` in config
2. **Disable specific fields:** Set field to `false` in `updateStrategy.fields`
3. **Restore from archive:** Copy any archived version to `core.json`
4. **Edit manually:** Use PersonaEditor to revert or modify changes

### Version History

All archives are timestamped and kept for review:

```bash
ls persona/archives/
# Output:
# 2025-11-01-120000.json
# 2025-11-08-143000.json
# 2025-11-16-235959.json
# CHANGELOG.md
```

To restore a previous version:

```bash
cp persona/archives/2025-11-08-143000.json persona/core.json
```

## Troubleshooting

### "Insufficient memories" error

**Cause:** Not enough recent memories (< minMemories threshold)

**Solution:**
- Reduce `minMemories` in config
- Increase `daysBack` to look further in history
- Wait until more memories accumulate

### "Confidence below threshold" - no updates applied

**Cause:** Analysis confidence < 60%

**Solution:**
- This is **normal** and **safe** - agent won't update with low confidence
- Try again after more memories accumulate
- Reduce `confidenceThreshold` if desired (not recommended below 0.5)

### Updates seem wrong

**Cause:** Possible misinterpretation of memory patterns

**Solution:**
1. Review `persona/archives/CHANGELOG.md` to see what changed
2. Restore from archive: `cp persona/archives/PREVIOUS.json persona/core.json`
3. Disable problematic field in `updateStrategy.fields`
4. Use PersonaEditor to manually fix

### Agent not running

**Cause:** Configuration or permission issues

**Solution:**
```bash
# Check agent is executable
chmod +x brain/agents/psychoanalyzer.ts

# Verify registration
./bin/mh agent list | grep psychoanalyzer

# Check configuration
cat etc/psychoanalyzer.json

# Run with debug output
tsx brain/agents/psychoanalyzer.ts
```

## Advanced Usage

### Custom Focus Areas

Edit `etc/psychoanalyzer.json` to customize analysis focus:

```json
{
  "analysis": {
    "focusAreas": [
      "values_evolution",
      "goals_progress",
      "communication_patterns",
      "interests_changes",
      "decision_heuristics",
      "custom_area_name"  // Add your own
    ]
  }
}
```

### Scheduled Execution

While designed for manual use, you can schedule it:

```bash
# Add to crontab (monthly on 1st at 2am)
0 2 1 * * cd /home/greggles/metahuman && ./bin/mh agent run psychoanalyzer >> logs/psychoanalyzer.log 2>&1
```

Or modify `etc/agents.json` to use interval type:

```json
{
  "psychoanalyzer": {
    "type": "interval",
    "interval": 2592000  // 30 days in seconds
  }
}
```

## Architecture

```
┌─────────────────────────────────────┐
│  Recent Episodic Memories (14 days)│
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Psychotherapist Model Analysis     │
│  - Extract patterns                 │
│  - Identify shifts                  │
│  - Generate insights                │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Confidence Check (≥ 60%)           │
└────────────┬────────────────────────┘
             │ Pass
             ▼
┌─────────────────────────────────────┐
│  Archive Current Persona            │
│  → persona/archives/TIMESTAMP.json  │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Incremental Merge                  │
│  - Append new values                │
│  - Preserve existing                │
│  - Respect field permissions        │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Update persona/core.json           │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Generate Changelog                 │
│  Create Notification Memory         │
└─────────────────────────────────────┘
```

## Future Enhancements

Potential improvements for future versions:

- [ ] **Automatic scheduling** based on memory volume thresholds
- [ ] **Rollback commands** for easy version restoration
- [ ] **Diff viewer UI** in web interface
- [ ] **Confidence explanation** showing why certain insights were chosen
- [ ] **Manual approval mode** to review before applying
- [ ] **Field-level confidence** to update high-confidence fields only
- [ ] **Pattern visualization** showing value/goal evolution over time

---

**See Also:**
- [Persona Generator Documentation](./PERSONA_GENERATOR.md) - AI-guided interview
- [Persona Editor Guide](./PERSONA_EDITOR.md) - Manual editing UI
- [Memory System](./MEMORY_SYSTEM.md) - Understanding episodic memory storage
