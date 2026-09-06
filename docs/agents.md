# Autonomous Agents

MetaHuman OS has three catalog lifecycles: finite `scheduled-work`, finite
`workflow`, and persistent `service`. Trigger Manager admits configured finite
work to the Work Coordinator; it does not execute agents or supervise services.
Agent Monitor and Boot Manager own persistent services configured in
`etc/services.json`.

## Finite Agents and Workflows

| Agent | Purpose |
|-------|---------|
| `organizer` | Runs the editable Organizer graph to enrich selected episodic memories |
| `reflector` | Runs the editable reflection graph over bounded, profile-scoped historical evidence and persists inner dialogue plus episodic memory |
| `curiosity` (`curiosity-service` source) | Asks questions in chat (user-facing) |
| `inner-curiosity` | Runs the editable Inner Curiosity graph for private, memory-grounded self-directed Q&A |
| `mood` | Reviews recent conversation or inner dialogue and selects an enabled persona facet through the editable Mood Review graph |
| `dreamer` | Creates surreal dreams from memory fragments |
| `sleep-workflow` | Coordinator workflow that admits bounded dream and persona-review children |
| `robot-autonomy-controller` | Selects one relevant catalog-backed autonomy task from current robot, dialogue, Agency, perception, and persona context in Full mode |
| `robot-status` | Builds and publishes a bounded situational snapshot from canonical robot state |
| `boredom-observer` | Requests one fresh camera observation for Robot Operator autonomy |
| `boredom-movement` | Authors one embodied intention from current state and advertised capabilities |
| `boredom-reflection` | Authors one memory-inspired intention from bounded historical context |
| `ingestor` | Finite generic inbox worker for validated TXT, Markdown, and JSON imports; manually runnable or registerable with Trigger Manager |
| `desire-agent` | Sole public controller for reviewing persisted inputs, nurturing desires, planning, approved execution, and outcome review through the editable Desire graphs |
| `curator` | Curates memories for training dataset preparation |
| `psychoanalyzer` | Runs the editable Psychoanalyzer graph over deterministic evidence, then applies validated, provenance-tracked persona learning |
| `audio-organizer` | Runs the editable Audio Organizer graph to convert completed audio transcripts into structured memories |
| `profile-sync` | Finite remote pull coordinator for validated profile files, credentials, and idempotent memories |
| `train-of-thought` | Extends a supplied result or bounded memory seed through related historical memories and persists one reasoning chain |
| `daydreamer` | Creates daydream narratives (lighter than dreams) |
| `curiosity-researcher` | Runs the editable Curiosity Researcher graph to investigate pending user-facing questions using local memory |

## Persistent Services

| Service | Purpose |
|---------|---------|
| `environment-bridge` | Transfers semantic actions, observations, speech, and correlated feedback through the configured environment adapter |
| `robot-operator` | Owns robot-autonomy timing, mutual exclusion, and admission; Full reviews unresolved action results, then returns other settled chains to the contextual autonomy controller |
| `maintenance-service` | Performs stale-lock health checks, audit-log cleanup, and embedding preload |

Environment Bridge is the only persistent service whose source remains under
`brain/agents`; it is supervised through Agent Monitor and configured in
`etc/services.json`, not scheduled through Trigger Manager. Robot Operator and
Maintenance Service live under `brain/services`.

## Key Agents

**organizer** — Selects validated episodic memories through Core, runs the
editable enrichment graph once per memory, and persists metadata through Core's
encrypted/atomic memory owner. Sleep Workflow owns automatic admission; manual
Agent Catalog execution uses the same finite contract.

**reflector** — Trigger Manager admits one bounded cycle for the resolved
profile; the editable
graph loads persona and bounded validated memories, generates one grounded
reflection, persists it, and only then emits audit and optional TTS output.

**desire-agent** — Runs only when explicitly selected manually, by Sleep
Workflow, or by Robot Autonomy. It reads bounded persisted conversation history,
goals, tasks, memories, curiosity, reflections, and dreams, then admits the
needed internal planner, executor, and outcome-review stages through the Work
Coordinator. Those stages are not independently runnable agents.

**curator** — Prepares training data from memories.

The curiosity agents remain separate by responsibility: `curiosity` asks the
user questions, `curiosity-researcher` investigates those pending questions on
its own hourly schedule, and `inner-curiosity` generates and answers private
self-directed questions. Curiosity Service stops before model execution when the
authenticated profile has reached `maxOpenQuestions`; user answers and skips
durably resolve those pending records through the shared Core question store.
The two generative curiosity paths share Core's bounded profile-memory sampler.
Inner Curiosity's canonical graph contains its complete private path:
sampling, persona context, question generation, related-memory search, answer
generation, Inner Dialogue Buffer admission, long-term memory capture, and the
optional Train of Thought trigger. Its Brain adapter does not call a model or
maintain a second pipeline.

`train-of-thought` remains manually runnable. It is also an optional follow-on:
after Reflector or Inner Curiosity durably persists a result, an editable graph
node has a 20% chance of admitting one seeded Train of Thought task through the
Work Coordinator. The downstream agent receives that exact result as its seed;
it does not rescan for an unrelated starting point.

## Configuration

- `packages/core/src/agent-catalog-definitions.ts` - Canonical shipped metadata and lifecycle classification
- `etc/agents.json` - Producer schedules and triggers; execution remains coordinator-owned
- `etc/services.json` - Persistent service boot and restart policy
- `etc/curiosity.json` - Curiosity agent settings
- `packages/agent-runtime` - Shared finite `AgentModule` execution contract
