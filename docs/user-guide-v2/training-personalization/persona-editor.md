# Persona Editor

The Persona Editor provides direct, manual control over your digital personality through a tabbed interface for editing all persona fields without AI interpretation.

## Overview

While the [Persona Generator](persona-generator.md) uses interviews to build your persona, the Persona Editor gives you precise control to:
- **Directly edit any field** in persona/core.json
- **Fine-tune AI-generated content** from interviews
- **Fix extraction errors** from automated processes
- **Add details** the interview system missed
- **Manage persona facets** (multi-personality system)
- **Review archives** of past persona versions

## When to Use

Use the Persona Editor for:
- **Quick updates** - Change specific fields without full interview
- **Post-interview refinement** - Polish AI-extracted content
- **Error correction** - Fix inaccurate automated extractions
- **Advanced features** - Configure decision heuristics, writing style
- **Facet management** - Enable/disable/configure personality facets
- **Archive review** - Restore or reference past personas

For comprehensive personality updates, use the [Persona Generator](persona-generator.md) instead.

## Accessing the Editor

### Via Web UI

1. Navigate to **Persona Editor** in the left sidebar
2. Editor loads with your current persona
3. Make changes across tabs
4. Click **"Save Persona"** to apply

**Note**: Changes are NOT auto-saved - you must click Save!

## Editor Structure

The editor has 3 main tabs:

### 1. Core Tab (Main Persona)

Edit your primary personality with 6 sub-sections:

#### Identity
**Fields:**
- **Name**: Your digital personality's name
- **Role**: Your function or title (e.g., "Software Engineer", "Creative Director")
- **Purpose**: Your core mission statement
- **Human Name**: Your real name (optional)
- **Email**: Contact email
- **Icon**: Emoji or character representing you
- **Aliases**: Alternative names or nicknames

**Example:**
```json
{
  "name": "Alex",
  "role": "Full-Stack Developer",
  "purpose": "Build elegant software solutions and mentor others",
  "humanName": "Alexander Smith",
  "email": "alex@example.com",
  "icon": "👨‍💻",
  "aliases": ["Lex", "CodeSmith"]
}
```

#### Personality
**Fields:**
- **Communication Style**:
  - Tone (array): ["friendly", "direct", "thoughtful"]
  - Humor: "witty" | "dry" | "playful" | "rare"
  - Formality: "casual" | "professional" | "balanced"
  - Verbosity: "concise" | "detailed" | "balanced"
  - Vocabulary Level: "simple" | "technical" | "academic"
  - Preferred Pronouns: "they/them" | "he/him" | "she/her"

- **Cadence** (optional):
  - Modes: Communication patterns ["analytical", "creative", "supportive"]
  - Energy Peaks: High-energy times ["morning", "late night"]
  - Loop Signals: Indicators of repetition or closure

- **Traits** (Big Five personality, optional):
  - Openness: 0-100
  - Conscientiousness: 0-100
  - Extraversion: 0-100
  - Agreeableness: 0-100
  - Neuroticism: 0-100
  - Notes: Free-form trait descriptions

- **Archetypes**: Personality patterns ["The Mentor", "The Explorer"]
- **Aesthetic**: Style preferences ["minimalist", "colorful", "vintage"]
- **Narrative Style**: How you tell stories ("data-driven", "anecdotal", "metaphorical")
- **Interests**: Topics you care about ["AI", "gardening", "philosophy"]

#### Values
**Fields:**
- **Core Values** (array of objects):
  ```json
  {
    "value": "Honesty",
    "description": "Always speak truthfully, even when difficult",
    "priority": 1
  }
  ```
  - Priority: 1 (highest) to 10 (lowest)

- **Boundaries** (array): Lines you won't cross
  - ["No plagiarism", "Respect privacy", "No harmful content"]

**Use Case**: Guide decision-making and behavior constraints

#### Goals
**Fields organized by timeframe:**

- **Short-Term Goals** (Next 3 months):
  ```json
  {
    "goal": "Complete React certification",
    "status": "in_progress",
    "notes": "75% through course"
  }
  ```

- **Mid-Term Goals** (3-12 months):
  ```json
  {
    "goal": "Build and launch side project",
    "status": "planning",
    "notes": "Researching tech stack"
  }
  ```

- **Long-Term Goals** (1+ years):
  ```json
  {
    "goal": "Start tech consulting business",
    "status": "aspirational",
    "notes": "Building network and skills"
  }
  ```

**Status options**: "aspirational", "planning", "in_progress", "completed", "paused", "abandoned"

#### Context
**Fields:**
- **Domains**: Areas of expertise or interest ["web development", "machine learning", "UX design"]
- **Projects** (array of objects):
  ```json
  {
    "name": "E-commerce Platform",
    "status": "active",
    "summary": "Building Next.js shopping cart with Stripe"
  }
  ```
- **Current Focus**: What you're actively working on right now

**Use Case**: Provides conversation context and relevance filtering

#### Advanced
**Fields:**
- **Decision Heuristics** (conditional rules):
  ```json
  {
    "signal": "User asks for code review",
    "response": "Check for security issues first, then readability",
    "evidence": "From past experience with production bugs"
  }
  ```

- **Writing Style**:
  - Structure: How you organize thoughts ("bullet points", "paragraphs", "mixed")
  - Motifs: Recurring themes or phrases you use
  - Default Mantra: Your go-to phrase or reminder

- **Notes**: Free-form notes about your persona
- **Background**: Detailed biography or life story

### 2. Facets Tab (Multi-Personality System)

Manage personality facets - alternate versions of yourself for different contexts:

**Available Facets:**
- **default** - Balanced, authentic self (Purple)
- **poet** - Creative, metaphorical, expressive (Indigo)
- **thinker** - Analytical, systematic (Blue)
- **friend** - Warm, supportive, empathetic (Green)
- **antagonist** - Critical, challenging (Red)
- **inactive** - Persona disabled (Gray)

**For Each Facet:**
- **Name**: Display name
- **Description**: When to use this facet
- **Persona File**: Link to separate persona/[facet].json file (or null for no customization)
- **Enabled**: Active or disabled
- **Color**: UI color coding
- **Usage Hints**: Suggestions for when to activate

**Configuration Location**: `persona/facets.json`

**Use Case**: Switch personality modes for different conversations (creative writing vs. code review)

### 3. Archives Tab

View and manage past persona versions:

**Features:**
- List of all archived personas with timestamps
- Preview any archived version
- Compare current vs. archived personas
- Restore an archive (replaces current)
- Delete old archives

**Archive Location**: `persona/archive/core-YYYY-MM-DD-HHMMSS.json`

**Automatic Archiving**: Created before every persona update from Generator or Psychoanalyzer

## Editing Workflow

### 1. Navigate to Section

Click through tabs and sub-tabs to find the field you want to edit:

```
Core Tab → Personality → Communication Style → Tone
```

### 2. Edit Fields

Different field types have different inputs:

**Text inputs**:
- Single-line for short values (name, role)
- Multi-line textareas for descriptions

**Arrays**:
- Add/remove items with +/− buttons
- Comma-separated values in some fields

**Objects with properties**:
- Nested forms for structured data
- Each property editable individually

**Numbers**:
- Sliders for Big Five personality traits (0-100)
- Number inputs for priorities

### 3. Save Changes

**IMPORTANT**: Click **"Save Persona"** button at bottom

- Changes are NOT auto-saved
- Unsaved changes are lost if you navigate away
- System shows unsaved changes warning

### 4. Verify Updates

After saving:
- Success message appears
- Timestamp updates in file
- New backup created in archives
- Changes immediately active in conversations

## Facet Management

### Enabling a Facet

1. Go to **Facets Tab**
2. Find the facet (e.g., "poet")
3. Toggle **"Enabled"** to true
4. Optionally create custom persona file:
   - Set **"Persona File"** to `"poet.json"`
   - Create `persona/poet.json` with customized fields
   - Falls back to core.json if file doesn't exist
5. Save facets configuration

### Switching Active Facet

**Via Web UI**:
- Left sidebar status widget
- Click facet name to cycle through enabled facets

**Via Conversation**:
- Messages show active facet in header
- Each message tagged with facet metadata

### Creating Custom Facet Persona

1. Copy `persona/core.json` to `persona/[facet].json`
2. Edit facet file with personality variations
3. In Facets tab, set "Persona File" to `"[facet].json"`
4. When facet is active, system uses facet file instead of core

**Example**: `persona/poet.json` might have:
- Tone: ["metaphorical", "expressive", "lyrical"]
- Narrative Style: "poetic with vivid imagery"
- Interests: ["literature", "symbolism", "creative writing"]

## Archive Management

### Viewing Archives

1. Go to **Archives Tab**
2. See chronological list of past personas
3. Click any archive to preview
4. Review changes over time

### Restoring an Archive

1. Find the archive you want to restore
2. Click **"Restore"** button
3. Confirm restoration
4. Current persona backed up automatically
5. Archive becomes new current persona

**Use Case**: Undo recent changes, return to working configuration

### Deleting Archives

1. Find archive to delete
2. Click **"Delete"** button
3. Confirm deletion (irreversible)
4. Archive removed from disk

**Best Practice**: Keep at least 3-5 recent archives for safety

## Validation and Safety

### Required Fields

The editor enforces minimum requirements:
- **Identity**: name, role, purpose must be non-empty
- **Personality**: communicationStyle must exist
- **Values**: At least one core value recommended

### Automatic Backups

Every save creates a timestamped backup:
```
persona/archive/
├── core-2025-11-25-103045.json
├── core-2025-11-24-153012.json
└── core-2025-11-23-091234.json
```

**Retention**: Up to 50 archives kept (configurable)

### Audit Logging

All edits logged to `logs/audit/` with:
- Actor (username)
- Timestamp
- Changed fields
- Old and new values

## Multi-User Isolation

In multi-user setups:
- Each user has separate `profiles/<username>/persona/` directory
- Changes don't affect other users
- Owners can mark personas public/private for guest access

## Best Practices

### Effective Editing

1. **Start with Generator** - Use interview for initial creation
2. **Editor for refinement** - Tweak specific fields manually
3. **Save frequently** - Don't lose work
4. **Review before saving** - Check all your changes
5. **Test in conversation** - Verify persona behavior

### Field Organization

- **Identity**: Keep concise and clear
- **Values**: Prioritize top 3-5 values
- **Goals**: Update regularly as you complete them
- **Decision Heuristics**: Add patterns as you discover them
- **Interests**: Remove stale interests periodically

### Facet Usage

- **default**: 90% of conversations
- **poet**: Creative writing, storytelling
- **thinker**: Technical analysis, problem-solving
- **friend**: Emotional support, empathy
- **antagonist**: Devil's advocate, critical thinking

## Troubleshooting

### Changes Not Saving
- Check for validation errors at top of page
- Ensure all required fields filled
- Check file permissions on persona/core.json
- Verify not in emulation mode (read-only)

### Facets Not Working
- Verify facet enabled in facets.json
- Check persona file exists if specified
- Ensure facets.json is valid JSON
- Restart web UI to reload facets

### Archives Not Showing
- Check `persona/archive/` directory exists
- Verify archive files are valid JSON
- Check file permissions
- Archives load on-demand when tab opened

### Lost Unsaved Changes
- Editor does NOT auto-save
- Always click "Save Persona" button
- Consider keeping a backup copy externally

## Next Steps

- Use [Persona Generator](persona-generator.md) for major personality updates
- Train AI models with [AI Training](ai-training.md) using your persona
- Understand how persona affects behavior in [Cognitive Modes](cognitive-modes.md)
- Let memories update persona automatically via Psychoanalyzer agent
