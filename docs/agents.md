# Autonomous Agents

MetaHuman OS exposes finite autonomous work through TriggerManager and the Work
Coordinator. Agent Monitor and Boot Manager are reserved for persistent
services configured in `etc/services.json`.

## Agent List

| Agent | Purpose |
|-------|---------|
| `organizer` | Enriches memories with LLM-extracted tags/entities |
| `reflector` | Generates internal reflections from memory chains (saves as `inner_dialogue`) |
| `curiosity-service` | Asks questions in chat (user-facing) |
| `inner-curiosity` | Self-directed Q&A (saves as `inner_dialogue`) |
| `dreamer` | Creates surreal dreams from memory fragments |
| `sleep-workflow` | Coordinator workflow that admits bounded dream and persona-review children |
| `ingestor` | Converts inbox files into episodic memories |
| `desire-generator` | Finite Sleep/manual work that synthesizes and nurtures desires from canonical profile inputs |
| `desire-planner` | Finite Sleep/manual work that checks real registered capabilities and runs the planning/review graphs |
| `desire-executor` | Admits approved plans to the Work Coordinator; Core Agency executes and durably records them via the editable graph |
| `desire-outcome-reviewer` | Admits review to the Work Coordinator; Core Agency owns the review graph and durable state transition |
| `curator` | Curates memories for training dataset preparation |
| `psychoanalyzer` | Analyzes behavioral patterns and psychological trends |
| `audio-organizer` | Processes audio files into structured memories |
| `transcriber` | Transcribes audio to text |
| `memory-sync` | Synchronizes memories across devices |
| `profile-sync` | Synchronizes user profiles across devices |
| `memory-pruner` | Cleans up old or low-value memories |
| `summarizer` | Creates summaries of conversations and memories |
| `train-of-thought` | Generates reasoning chains |
| `daydreamer` | Creates daydream narratives (lighter than dreams) |
| `digest` | Generates daily/weekly digests |
| `curiosity-researcher` | Independently researches pending user-facing questions using local memory |

## Key Agents

**organizer** - Processes new memories, extracts metadata
**reflector** - Generates insights from memory patterns
**desire-generator** - Synthesizes desires from goals/tasks/curiosity
**curator** - Prepares training data from memories

The curiosity agents remain separate by responsibility: `curiosity` asks the
user questions, `curiosity-researcher` investigates those pending questions on
its own hourly schedule, and `inner-curiosity` generates and answers private
self-directed questions. Curiosity Service stops before model execution when the
authenticated profile has reached `maxOpenQuestions`; user answers and skips
durably resolve those pending records through the shared Core question store.

## Configuration

- `etc/agents.json` - Producer schedules and triggers; execution remains coordinator-owned
- `etc/services.json` - Persistent service boot and restart policy
- `etc/curiosity.json` - Curiosity agent settings
