# User-Aware Training System with Curator Intelligence

**Date**: 2024-11-14
**Status**: In Progress

## Goal
Update `full-cycle-local.ts` and `full-cycle.ts` to train on user-specific data with intelligent curator-based data preparation.

## Key Features
1. **Curator model is configurable** via model-router (uses whatever model user selects in status widget)
2. **Extensive curator briefing** on LoRA training data quality, personality modeling, and data curation best practices
3. **User-specific data isolation** - each user's training data is completely separate
4. **Therapy session integration** - highest-quality personality data from therapeutic interviews
5. **Intelligent curation** - LLM evaluates and improves training samples

## Implementation Steps

### 1. Create Curator Instruction System
**File**: `packages/core/src/curator-prompts.ts` ✅ COMPLETE

Comprehensive system prompts for curator model explaining:
- **LoRA adapter training fundamentals**: What they are, how they work, why quality matters
- **Personality modeling objectives**: Capturing authentic voice, values, communication patterns, decision-making style
- **Quality criteria**: Authenticity (3x weight), specificity (2x), consistency (2x), behavioral patterns (2x), information density (1x)
- **Filtering rules**: Remove generic responses, duplicates, contradictions, low-information content
- **Improvement guidelines**: Add context, enhance authenticity, preserve unique voice, improve clarity

**Weighted Quality Score**:
```
score = (authenticity * 3 + specificity * 2 + consistency * 2 + behavioral * 2 + density * 1) / 10
Threshold: Keep samples with score ≥ 6.0
```

### 2. Create User Data Collector
**File**: `packages/core/src/user-data-collector.ts` (TODO)

Functions to collect:
- Episodic memories from `profiles/{username}/memory/episodic/`
- Therapy sessions from `profiles/{username}/persona/therapy/`
- Chat conversations from `profiles/{username}/memory/training/`
- Persona data from `profiles/{username}/persona/core.json`

### 3. Create User Resolver
**File**: `packages/core/src/user-resolver.ts` (TODO)

Resolves username to full UserInfo object for context.

Functions:
- `resolveUserInfo(username: string): Promise<UserInfo>`
- Looks up user in `profiles/{username}/`
- Returns UserInfo with userId, username, role, profilePaths

### 4. Update Dataset Builder
**File**: `brain/agents/adapter-builder.ts` (TODO)

**Changes**:
- Make user-aware using `getUserContext().profilePaths`
- Collect user data via new collector functions
- Send data to curator in batches with detailed instructions
- Use `callLLM({ role: 'curator', ... })` (respects user's model selection from status widget)
- Curator evaluates, filters, and improves each training sample
- Output curated dataset to user-specific directory

**Curator Workflow**:
```typescript
// For each batch of raw samples (50 at a time):
1. Send to curator with comprehensive instructions + persona summary
2. Curator evaluates quality (1-10 scale on 5 criteria)
3. Curator calculates weighted score
4. Curator filters out samples scoring < 6.0
5. Curator improves remaining samples (add context, enhance authenticity)
6. Return curated samples with quality metadata
```

### 5. Update Training Orchestrators

**Files**: `brain/agents/full-cycle-local.ts`, `brain/agents/full-cycle.ts` (TODO)

**Changes**:
- Accept `--username <name>` CLI argument (required)
- Wrap execution in `withUserContext(userInfo, async () => { ... })`
- Use `ctx.profilePaths` for all user-specific paths
- Output to `profiles/{username}/out/adapters/`
- Pass username context to adapter-builder

### 6. Add Core Exports
**File**: `packages/core/package.json` (TODO)

Export new modules:
```json
{
  "exports": {
    "./curator-prompts": "./src/curator-prompts.ts",
    "./user-data-collector": "./src/user-data-collector.ts",
    "./user-resolver": "./src/user-resolver.ts"
  }
}
```

### 7. CLI Commands
**File**: `packages/cli/src/index.ts` (TODO)

Add new commands:
```bash
mh train <username> [--local]    # Train LoRA adapter for user
mh build-dataset <username>      # Build curated dataset only
```

## Data Sources (Priority Order)

### 1. Therapy Sessions (Highest Priority)
**Location**: `profiles/{username}/persona/therapy/session-*.json`

**Why highest priority**:
- Reveals deep personality insights
- Shows authentic emotional responses
- Demonstrates values and decision-making
- Captures genuine communication patterns in therapeutic setting
- Self-aware and reflective responses

**Format**: Q&A pairs already in perfect instruction-output format

### 2. Episodic Memories
**Location**: `profiles/{username}/memory/episodic/{year}/*.json`

**Types (by value)**:
1. **Inner dialogue / Reflections**: Self-aware thoughts, personal revelations
2. **Conversations**: Actual exchanges showing communication style
3. **Observations**: Personal reactions and interpretations
4. **Decisions**: Moments of choice revealing values
5. **Events**: Experiences that shaped perspective

**Curation need**: HIGH - requires context addition and authenticity enhancement

### 3. Chat Conversations
**Location**: `profiles/{username}/memory/training/**/*.jsonl`

**Value**: Shows real-world communication patterns

**Curation need**: MEDIUM - already conversational format

## Curator Model Configuration

**Selection**: Via web UI status widget (curator section)

**Supported models**:
- Any model configured in `etc/models.json` for curator role
- Examples: qwen3:14b, phi3:medium, claude-sonnet, deepseek-coder

**Model Router Integration**:
```typescript
const response = await callLLM({
  role: 'curator',  // Uses model selected in status widget
  messages: [
    { role: 'system', content: CURATOR_SYSTEM_PROMPT },
    { role: 'user', content: batchPrompt }
  ],
  options: { temperature: 0.3 }  // Lower temperature for consistent evaluation
});
```

## Quality Criteria Details

### 1. Authenticity (Weight: 3x) - MOST IMPORTANT
- Uses their exact phrases, verbal tics, communication patterns
- Reflects genuine emotional responses
- Captures unique perspective and worldview
- Feels natural, not generic or templated

### 2. Specificity (Weight: 2x)
- Names specific people, places, events, concepts
- Includes contextual details that reveal personality
- Provides examples rather than abstractions

### 3. Consistency (Weight: 2x)
- Matches documented values and beliefs
- Consistent with communication style
- Fits decision-making patterns
- Doesn't contradict established traits

### 4. Behavioral Patterns (Weight: 2x)
- Shows decision-making process
- Demonstrates emotional responses
- Reveals coping strategies
- Illustrates relationship dynamics

### 5. Information Density (Weight: 1x)
- Multiple personality markers per sentence
- High signal-to-noise ratio
- Avoids filler and generic content

## Usage Examples

```bash
# Step 1: Configure curator model in web UI
# Navigate to status widget → curator section
# Select preferred model (e.g., qwen3:14b, phi3:medium)

# Step 2: Build curated dataset for user
mh build-dataset greggles

# Output:
# - profiles/greggles/out/adapters/2024-11-14/instructions.jsonl
# - Includes quality scores and curation metadata
# - Only samples scoring ≥ 6.0 included

# Step 3: Train LoRA adapter locally
mh train greggles --local

# Or train remotely on RunPod
mh train greggles

# Step 4: Review training results
# - Check logs for curation statistics
# - Review adapter quality with test prompts
# - Iterate if needed (adjust curator model, add more data)
```

## Expected Output

### Dataset Statistics Example:
```
[curator] Reviewed 500 raw samples
[curator] Filtered out 142 low-quality samples (28.4%)
[curator] Kept 358 high-quality samples
[curator] Average quality score: 7.6/10
[curator] Breakdown by source:
  - Therapy sessions: 45 samples (avg quality: 9.2)
  - Inner dialogue: 89 samples (avg quality: 8.1)
  - Conversations: 124 samples (avg quality: 7.3)
  - Observations: 100 samples (avg quality: 6.8)
```

### Sample Quality Report:
```json
{
  "sample_id": "therapy-2024-11-14-q3",
  "instruction": "What core values guide your most important life decisions?",
  "output": "I need to prove myself stemming from childhood trauma...",
  "quality_score": 9.2,
  "criteria_scores": {
    "authenticity": 10,
    "specificity": 9,
    "consistency": 9,
    "behavioral": 9,
    "density": 8
  },
  "improvements_made": [
    "Added emotional context",
    "Preserved authentic vulnerability"
  ],
  "source": "therapy_session",
  "category": "values"
}
```

## Benefits

1. **Intelligent curation**: LLM evaluates quality using nuanced criteria, not simple rules
2. **Configurable curator**: Users choose best model for their curation needs
3. **Quality-focused**: Only samples scoring ≥ 6.0 make it to training
4. **Personality-aware**: Curator understands personality modeling objectives
5. **User isolation**: Complete separation of user data and training outputs
6. **Therapy integration**: Leverages highest-quality personality data
7. **Continuous improvement**: Quality scores enable iterative refinement
8. **Authentic voice preservation**: Curator briefed to preserve unique communication patterns

## Files Modified/Created

### Created:
- ✅ `packages/core/src/curator-prompts.ts` - Comprehensive curator instructions
- ⏳ `packages/core/src/user-data-collector.ts` - User data collection utilities
- ⏳ `packages/core/src/user-resolver.ts` - Username to UserInfo resolution

### Modified:
- ⏳ `brain/agents/adapter-builder.ts` - User-aware, curator-integrated dataset building
- ⏳ `brain/agents/full-cycle-local.ts` - User context wrapper for local training
- ⏳ `brain/agents/full-cycle.ts` - User context wrapper for remote training
- ⏳ `packages/cli/src/index.ts` - Training CLI commands
- ⏳ `packages/core/package.json` - Export new modules

## Next Steps

1. ✅ Create curator-prompts.ts
2. Create user-data-collector.ts
3. Create user-resolver.ts
4. Update adapter-builder.ts with curator integration
5. Update full-cycle-local.ts with user context
6. Update full-cycle.ts with user context
7. Add package.json exports
8. Add CLI commands
9. Test with greggles user
10. Document in CLAUDE.md

## Testing Plan

```bash
# 1. Build dataset for greggles
./bin/mh build-dataset greggles

# Expected: Curated dataset in profiles/greggles/out/adapters/2024-11-14/

# 2. Review curation statistics
cat profiles/greggles/out/adapters/2024-11-14/curation-stats.json

# 3. Train locally
./bin/mh train greggles --local

# 4. Test adapter
ollama run greg-greggles-2024-11-14

# 5. Validate personality accuracy
# - Test responses against known patterns
# - Check for authentic voice preservation
# - Verify value alignment
```

## Notes

- Curator model configured in web UI status widget (not hardcoded)
- Curator receives 5000+ word briefing on LoRA training and personality modeling
- Quality scores and metadata tracked for all samples
- Batch processing (50 samples at a time) prevents token limit issues
- Temperature 0.3 for curator ensures consistent evaluation
- Therapy sessions always kept (quality filter threshold lowered for therapy data)
