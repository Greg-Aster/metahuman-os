# Autonomous Agents

MetaHuman OS includes 27 autonomous agents that run in the background. Configuration: `etc/agents.json`

## Agent List

| Agent | Purpose |
|-------|---------|
| `organizer` | Enriches memories with LLM-extracted tags/entities |
| `reflector` | Generates internal reflections from memory chains (saves as `inner_dialogue`) |
| `curiosity-service` | Asks questions in chat (user-facing) |
| `inner-curiosity` | Self-directed Q&A (saves as `inner_dialogue`) |
| `dreamer` | Creates surreal dreams from memory fragments |
| `night-pipeline` | Manages dream generation and sleep-time processing |
| `ingestor` | Converts inbox files into episodic memories |
| `desire-generator` | Generates desires from system inputs (agency system) |
| `desire-planner` | Plans execution steps for approved desires |
| `desire-executor` | Executes desire plans via external tools |
| `desire-outcome-reviewer` | Reviews desire execution outcomes |
| `curator` | Curates memories for training dataset preparation |
| `psychoanalyzer` | Analyzes behavioral patterns and psychological trends |
| `babysitter` | Monitors system health and resource usage |
| `audio-organizer` | Processes audio files into structured memories |
| `transcriber` | Transcribes audio to text |
| `auto-indexer` | Maintains vector embeddings index automatically |
| `memory-sync` | Synchronizes memories across devices |
| `profile-sync` | Synchronizes user profiles across devices |
| `memory-pruner` | Cleans up old or low-value memories |
| `summarizer` | Creates summaries of conversations and memories |
| `train-of-thought` | Generates reasoning chains |
| `daydreamer` | Creates daydream narratives (lighter than dreams) |
| `digest` | Generates daily/weekly digests |
| `desire-explorer` | Explores desire space for new opportunities |
| `curiosity-researcher` | Researches answers to curiosity questions |
| `update-check` | Checks for system updates |
| `coder` | Auto-generates code fixes and improvements |

## Key Agents

**organizer** - Processes new memories, extracts metadata
**reflector** - Generates insights from memory patterns
**desire-generator** - Synthesizes desires from goals/tasks/curiosity
**curator** - Prepares training data from memories

## Configuration

- `etc/agents.json` - Scheduling and triggers
- `etc/curiosity.json` - Curiosity agent settings
