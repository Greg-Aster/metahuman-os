# Companion behavior and lifecycle

[Modes and sleep](#modes-and-lifecycle) · [Memory and persona](#memory-persona-and-inner-dialogue) · [Goals and autonomy](#goals-desires-and-autonomy) · [Interaction flow](#workflows-and-interaction-examples)

[Start with the robot design core](ROBOT_BIBLE.md). Read the relevant subsection for modes, memory, identity, goals, autonomy or interaction flow.

The existing Core, agent and graph owners implement these behaviors;
[Maintained Surface](../technical/MAINTAINED_SURFACE.md#critical-runtime-ownership-boundaries)
owns their detailed execution boundaries.

This page states the maintained capability contract. It does not report current
service state, selected weights or installed firmware. Use the linked owners for
configuration and [qualification](QUALIFICATION.md) for proof of behavior.
Dated deployments, comparisons and incidents are retained in the
reference history (retained locally).
A historical success or failure is evidence under its recorded conditions;
refresh those conditions before treating it as the present state.

## Modes and lifecycle

Three separate controls describe different aspects of operation:

| Control | Choices / function | Distinction |
| --- | --- | --- |
| MetaHuman cognitive mode | Dual Consciousness, Agent, Emulation, Environment | Selects the kind of cognitive operation and its associated policies/graphs |
| Robot autonomy mode | Reactive, Semi, Full | Selects how new embodied work is initiated and continued |
| Lifecycle | MetaHuman Sleep Workflow; body Idle/Doze/sleep states | Cognitive maintenance and physical power/peripheral states are separate |

[The cognitive-mode source](../../packages/core/src/cognitive-mode.ts) defines Dual for deep identity/memory-oriented operation, Agent for command/task assistance, Emulation for use of an existing persona with read-only defaults, and Environment for embodied interaction. These descriptions are mode definitions, not a fresh qualification of every mode. Environment Mode is the robot workflow discussed throughout this reference.

The cognitive mode also determines whose conversational replies personalization should learn. The owner-confirmed distinction between Dual Consciousness and Environment Mode is recorded under [Conversational training by cognitive mode](MODELS_AND_LEARNING.md#conversational-training-by-cognitive-mode).

### Robot autonomy modes — owner-defined behavior

These are the robot's three autonomy modes within the embodied system. Body power states and the Sleep Workflow are separate features; they must not be conflated with this mode selection.

| Mode | Intended function | End-to-end acceptance |
| --- | --- | --- |
| Reactive | Respond to user input and physical events; do not initiate self-directed activities. | Human input and configured boot/wake, tipping, rapid-movement and motor-stall events reach their existing response owners with continuity and accurate outcomes. |
| Semi-autonomous | Reactive interaction plus selected self-directed work, managed through Active Operator in Agency. Periodic assessments update operation percentages; a function reaching 100% is triggered. | Both ongoing interaction and inactivity inform model-selected activation. Context produces relevant, varied activity without independent per-task timers or a permanently filled task queue. |
| Fully autonomous | Continuously choose and carry out meaningful self-directed activity: musing, reasoning, tasks, agents, movement or the Sleep workflow. | The robot originates and pursues activity without a person supplying its next step. No-operation decisions, idle assessment loops, event-only suspension, repeated commands without progress and repeated fault commentary do not satisfy Full Auto. Selected work remains independent of subsequent assessments. |

The LLM owns high-level choices. Implementing Full autonomy means making the decision, execution, evidence, memory and review paths work together. It does not mean adding a fixed task rotation, keyword behaviors, mandatory activity quotas or an imposed personality. Existing code and current settings are evidence of implementation, not authority to redefine these intended modes.

**Owner decision, 2026-10-26:** Reactive retains physical-event reactions and
excludes self-directed activities. This resolves the earlier user-input-only
wording: boot/wake and other physical events are permitted inputs, not an
authorization for an autonomous goal loop. Event admission remains with the
existing body-event owners; this clarification does not prescribe a particular
movement, emotion or response.

### Sleep, wake, and maintenance

MetaHuman's existing [Sleep Workflow](../../packages/core/src/queue/sleep-workflow.ts) sequences Organizer → memory Curator → Environment decision-review proposals → eligible personalization training → Desire Agent → Dreamer → persona review → memory-index refresh. The Environment Training Curator uses its existing agent and proposal store for recorded Intent and Task decisions; its Agent Catalog enable switch controls this stage. Proposals retain separate human review and specialist training; this stage does not fit or activate models or review Freestyle motions. Enabled settings and stage results determine what actually runs. User activity ends the remaining sleep chain through its existing lifecycle owner; awake automation and robot operator scheduling are coordinated with it.

Its purpose is to organize experience, support reviewed learning and persona development, and produce internal material for later cognition. A session labelled completed may contain failed or skipped stages; the historical diary (retained locally) records an example. This lifecycle is separate from putting the body into a low-power state. A body boot/wake event also does not mean that a MetaHuman sleep session occurred.

## Memory, persona, and inner dialogue

The companion's continuity comes from several kinds of state, not from a language model automatically remembering every earlier request:

| Information | Purpose | What it is not |
| --- | --- | --- |
| Persona | Persistent identity, background, personality, values and goals; relevant facets can be selected for a call | Evidence that an imagined event physically occurred |
| Recent buffers | Attributed conversation, internal activity, system and robot events available to later context assembly | An instruction to load every item into every call |
| Persistent memory | Saved experiences and records available beyond recent buffers | Proof that a record was indexed, retrieved, or used |
| Search/index | Find relevant stored records for the selected task or conversation | A guarantee that similarity ranking answers chronological questions |
| Robot Status | Projection of selected-body condition, current task, action outcomes, and dated observations | A separate goal executor or an independent replacement for receipts |
| Durable execution | Original objective, corrections, selected work, progress, results and continuation state | A second persona or general conversational memory |
| Model weights / LoRAs | Learned behavior and tendencies following training | Live storage of the current conversation |
| Inference context / cache | Input and working state for generation, with backend-dependent reuse | The authoritative persistent memory store |

The interface can merge feeds visually while their records retain separate speaker, source, type, identity and time. An inner thought must remain distinguishable from a human statement, an assistant reply, a dream, a camera observation, and a body receipt. The originating turn time, a result's acquisition time, and the time it was received can differ.

**Owner-approved retrieval policy, 2026-10-16:** semantic memory search includes both the person's messages and Ainekio's saved replies through the existing installation-wide `indexContentMode: all` setting. Ainekio's index is rebuilt through the existing index owner. Speaker attribution remains attached: a retrieved assistant statement establishes what it said, not whether its factual claims were correct. Retrieval eligibility is separate from the mode-aware training and Curator policies in [the model and learning contract](MODELS_AND_LEARNING.md#models-and-learning). Changing this setting does not change retrieval cutoffs or require history in every model call.

Robot Status uses the [live projection owner](../../packages/core/src/robot-status-live.ts) to expose current execution and command evidence to the interface and workflow context. Its projection preserves motion parameters including `continuous`, `units` and `durationMs`, command work state/start time, correlated receipts, the overall objective's criteria, and a behavior step's separate criteria. A plain action has no behavior-step criteria. An omitted parameter remains omitted, and a queued or acknowledged command is not proof of physical movement or arrival. Each saved summary, environment description, user-context field and uncertainty list retains its own optional `situationEvidence`: producer recording time, source timestamps and frame references. Receipt updates do not renew retained prose. Older records without this provenance remain unknown; a snapshot save time is not the acquisition time of its descriptions. This projection admits no actions and creates no independent goal store; the [qualification guide](QUALIFICATION.md) identifies the evidence needed to validate it.

Reflection, Dreamer, Daydreamer, Inner Curiosity, Train of Thought and mood review provide different internal activities. Dreams/daydreams are generated imagination; reflection examines supplied experience; curiosity can pose questions and retrieve or investigate related information; associative thought can continue from a persisted seed. They contribute to the intended inner life and can inform later decisions when the workflow selects that context. They are not all necessarily spoken, and their existence does not prove they currently influence each autonomous choice. Workflow-connected TTS remains independent of generation: a saved reflection or daydream can complete its finite agent task while speech delivery is pending, with the actual delivery result retained separately. Inner Curiosity carries the original delegated purpose into both its question and answer stages and presents selected memories with their recorded identity, time, type and available speaker/source/mode. Historical assistant speech is evidence of what was said, not a current sensor measurement.

**Owner-confirmed dream behavior, 2026-10-14:** keep the sleep-generated surreal stories derived from remembered events, saved as dreams and recalled as dreams. The owner accepted this behavior after the recorded recall test (retained locally). Dream content remains attributed imagination rather than evidence that the described physical events occurred.

Long-term continuity requires the complete save → index → retrieve → deliver → use path. A request about the most recent dream also needs correct dream attribution and temporal selection. The diary records cases where stored dreams existed but routing or retrieval failed. These are distinct defects from absent dream generation. Persona evolution and model training are also distinct: changing a persona record does not itself retrain a model.

Memory selection supports relevance or newest ordering, explicit time ranges and
latest-sleep-cycle scope through the existing memory owner. The current input
record is excluded from its own recall by saved identity; earlier records,
including identical earlier questions, remain eligible. Qualification checks what
was retrieved and used, not just whether records exist. Historical recall and
retry results remain in the reference history (retained locally).

References: [buffer owner](../../packages/core/src/conversation-buffer.ts), [memory owner](../../packages/core/src/memory.ts), [Robot Status](../../packages/core/src/robot-status.ts), [Inner Curiosity graph](../../etc/cognitive-graphs/inner-curiosity.json), [Dreamer graph](../../etc/cognitive-graphs/dreamer-mode.json), [Daydreamer graph](../../etc/cognitive-graphs/daydreamer-mode.json), [Train of Thought](../../etc/cognitive-graphs/train-of-thought.json), [persona learning](../../packages/core/src/persona-learning.ts).

## Goals, desires, and autonomy

| Concept | Meaning and existing responsibility |
| --- | --- |
| Persona goal | A longer-term architectural, developmental or aspirational direction represented in persona; it guides the companion without becoming an automatically running command |
| Desire | A specific desired outcome represented in Agency, with motivation, evidence, relevance and lifecycle; it can be considered, planned, executed and reviewed |
| Robot execution objective | The current requested outcome retained by durable execution, with corrections and evidence |
| Program / action | Selected work toward that outcome; a receipt describes execution, not necessarily fulfillment |
| Robot Goal Review | Assessment of an unfinished non-Agency objective after selected work/results, before final conversation |
| Agency outcome review | Review of Agency-owned plans and steps through their own lifecycle |
| Weekly Goal Review | Separate project-progress/insight workflow; not the robot's per-objective continuation owner |

**Owner-confirmed distinction, October 15:** persona goals describe the general direction of the companion's development and aspirations. Desires describe particular outcomes the companion currently wants to achieve. Specificity and purpose distinguish them; a desire can take time to satisfy without becoming a general persona goal. A robot execution objective is the outcome of a particular admitted request or activity and remains distinct from both.

The model uses goals, attributed experience and actual operating state to decide whether a specific desire is warranted. It may create, strengthen, weaken, retain, complete or archive desires as the evidence and lifecycle justify. An empty desire list is neither inherently a success nor inherently a failure. Evaluation must check whether meaningful supported opportunities or unfinished needs were missed, whether obsolete concerns were retained, and whether claimed progress matches execution evidence. The owner clarifies intended design; the owner is not expected to choose the desired verdict for each model review.

Psychotherapist is the sole autonomous editor of persona goals through the existing persona-learning owner. Desire Agent owns specific desires through Agency and may use persona goals as context. Strong or repeatedly reinforced desires do not automatically become persona goals. A goal is not fulfilled merely because an associated desire, action or conversation ends. Cleanup of historically misplaced specific items must preserve their provenance and history and must not treat an old record as evidence of a current need. The current owner-authorized goal-list reconciliation is recorded in the historical evaluation (retained locally).

Nurturing reviews every open desire, including those already being planned or executed. The model selects a relevance strength on the existing zero-to-one scale and cites attributed evidence for a change; it can reduce, increase or retain strength. Zero means archival with history retained. The existing elapsed-time decay policy remains separate. Archival requests cancellation of that desire's remaining work through Coordinator; a cancellation request is not proof that physical activity stopped, and late receipts do not reopen the desire.

The review draws on enabled saved conversation and memory sources, standing persona goals, the selected robot's actual state and capabilities, and current or explicitly linked execution records. Memory type, speaker, source and timestamps distinguish conversation, observations and imagined material. An original request, the selected program, a command receipt and evidence of the desired outcome remain different facts. Generation receives the current review's proposed relevance changes explicitly as uncommitted decisions; after persistence, duplicate comparisons use the resulting open desires. Unchanged evidence is not new reinforcement merely because the agent runs again.

In the shared Environment Mode workflow, Intent selects whether a response is needed. Task selects executable actions, sensing and behaviors; it does not compose or publish speech. The conversation context builder joins the selected results, and Persona generates the outward reply through the single conversation delivery path. The former speech program step has been removed, including exact spoken lines inserted between motion steps. This makes Persona the single speech author for that execution path rather than having Task speak and Persona repeat it. Independent controller or agent outputs retain their own documented workflow ownership.

A conversational exchange does not require inventing a goal. Goal Review applies only to an unfinished non-Agency objective selected for review, after selected work returns; an explicit wait for new input does not request another immediate review. Finite action-result objectives with no selected continuation settle from their receipts: success completes the objective, while terminal failure ends the one-off task as failed and remains available to Persona as response evidence. A failure does not silently select continued pursuit. Goals selected for continued pursuit remain saved without reserving a worker; new conversation and body commands can run independently. When review is selected, it uses returned actions and observations; review may revise its objective and completion criteria, mark it complete, retain it pending relevant input, or abandon it. Review does not start planning or actions. A reply is selected by Intent through `needsResponse`, not treated as a goal. Task and Goal Review completion bases are `action_result`, `visual_observation`, `environment_state`, and `user_input`. Goal Review returns assessment data and does not publish conversation or speech. Robot Status displays this state; the durable execution retains it.

Persona receives the current execution’s correlated action results after a selected program returns, independently of whether Intent selected Goal Review. The graph visibly connects Active Task’s result to the existing Current Execution reader; when review is selected, its existing dependency supplies the assessment before the final context is assembled. Skipping Goal Review must not discard motion receipts or leave admission as the only supplied evidence.

**Objective completion and step completion are separate.** `taskDecision.completionCriteria` describes success for the overall request; it does not terminate an open-ended action. A visual behavior's own `completionCriteria` governs that behavior's Finish path. For example, an objective to obtain a view beneath a desk does not make a bare `crawl` stop beneath it, and a capture scheduled after that crawl cannot execute while the action remains unfinished. Goal Review assesses the supplied results; it cannot retrospectively supply a missing movement endpoint. This distinction belongs in capability/context delivery, execution, status and evaluation, without replacing the model's choices with scripted navigation.

For an open request such as finding a wallet, the intended system preserves the request, records searches and observations, and lets the model assess what to try next or whether the outcome is established. This is not a hardcoded wallet-search procedure. The original request and later corrections remain distinguishable from the planner's interpretation.

### Active Operator and initiative — owner intent, 2026-10-23

Active Operator manages the relevance and activation of available functions in the Agency interface. Semi uses its configured assessment interval; Full Auto has no configured waiting interval or model-selected suspension. Assessment selects activity rather than independently timing each agent. The model owns percentage changes and reasons; elapsed time does not mechanically increment every operation. Conversation, quiet periods and environmental changes should inform which functions become relevant, rather than merely postpone all assessment until conversation stops. Reaching 100% requests that operation in Semi mode.

Assessment needs relevant, attributed context: recent conversation and interaction activity; time of day and inactivity; current perception and body connection; available capabilities; persona and standing goals; desires; inner activity and memories; existing work, recent selections and actual outcomes. These sources are not interchangeable, and historical evidence must retain its time and uncertainty. The owner's examples are acceptance scenarios, not keyword rules: substantial conversation can make conversation-related processing relevant; lack of incoming triggers can make boredom and other self-directed functions relevant; nighttime can make dreaming or Sleep relevant. None prescribes an automatic verdict merely because that circumstance exists.

Full mode retains reactive interaction and the existing operation catalog while
continuously originating and carrying out meaningful activity. It can muse,
reason, pursue tasks, trigger agents, move or run the Sleep workflow. It must not
wait for a human, an external event or a configured interval to supply its next
activity. An empty desire list does not remove this responsibility. No operation,
all-zero selections and repeated assessments that perform nothing are not valid
Full Auto outcomes. The model chooses meaningful activity from the available
capabilities; this does not authorize a scripted fallback, forced movement or a
fixed rotation. Deliberately running the Sleep workflow is activity, not idle.

The owner specifies that when the robot body is disconnected, embodied autonomy functions should neither be triggered nor have their activation updated. A connected gateway alone does not establish a connected body. Physical disconnection does not suspend Full Auto's available non-embodied activity: reasoning, memory, agents and Sleep remain distinct from unavailable physical actions. This is intended behavior, not a claim that current admission implements that separation.

Nighttime motivation uses the existing Sleep/Dreamer ownership. Sleep Workflow is
an available model-selected operation; its enabled, sleep-window and inactivity
settings determine admission. Periodic Semi assessment and Sleep eligibility
remain distinct. Qualify the complete choice, stage outcomes and return to
interaction using the [Sleep scenario](QUALIFICATION.md#representative-scenarios).

### Active Operator execution contract

The editable [Active Operator graph](../../etc/cognitive-graphs/robot-autonomy-controller-mode.json)
is shared by Semi and Full. It selects activity; the shared Environment graph
executes admitted intentions. The mode contract below describes the required
behavior. Inspect the responsible source and deployment before claiming that an
installation satisfies it.

In Semi and Full modes, Active Operator runs the same editable activation-assessment workflow. Semi starts that workflow periodically using `semiAssessmentMinutes`, default five minutes, exposed in Active Operator settings. Conversation does not restart the countdown; entering Semi or finishing an assessment starts a fresh interval. The persistence owner preserves the former saved inactivity interval when reading old settings. Queue bookkeeping does not bypass the interval. Full requests its next assessment when the current assessment finishes, without a waiting interval, event-only wake condition or waiting for selected work to finish. The model receives selected persona, recent conversation, inner activity, robot outcomes/status, environment evidence, operation meanings, retained levels and recorded activity. Semi requests every returned update at 100; Full requests the highest positive returned activation even below 100, with returned order breaking ties. Semi may record zero updates or an empty selection without requesting work. A valid Full decision must select meaningful activity through an available operation or an existing execution/Desire target; empty and all-zero selections are not successful Full decisions. Omitted operations retain their previous levels without being requested again. Selected work runs through independent Work Coordinator admissions, so its duration does not block subsequent assessment. The assessment itself does not author outward speech. Human messages and autonomous intentions enter separate inputs of the same Environment Mode graph. Its input join preserves the selected origin and planner metadata, and the shared Intent, context, Task, action-result, Goal Review and final-response paths execute the request. The separate Robot Autonomy Executor graph has been removed; the Autonomy Controller remains the decision owner. Active goals, observations and recorded results inform the controller or an appropriately triggered Semi Auto agent when choosing and planning work. Goal Review updates the durable goal shown by Robot Status after selected work returns; it does not trigger the next planning pass. Task also has no `continue` outcome. The executor records program results without manufacturing a continued-pursuit decision; advancing already selected program steps remains distinct from choosing new work. Abandonment removes a goal from active consideration while retaining its original instruction and recorded results. Current source does not implement Full mode as a compulsory rotation of movements.

The graph first asks the configured Orchestrator category to select assessment context from the trigger, mode, available source identities and recorded operation state. It uses the familiar Environment routing fields: `taskContext` selects assessment sources; this selector does not execute activities. Visible source branches load only the selected persona sections, conversation, private thoughts, robot actions, memory, status, environment, camera evidence, execution, activity, observation history and desires. Memory retrieval uses the selected query and scope; there is no unconditional newest-memory read. Conversation does not also merge private thoughts in this graph. Complete selected records retain their source, speaker, identity and time; repeated content uses lossless JSON Pointer references. Selection quality remains a model qualification concern, separately from correct graph gating.

The controller hands already-read context to Environment with its originating intention. Existing source owners reuse only matching retrieval scopes and camera session evidence, preserving frame identity and acquisition time. A new query, different scope or explicit acquisition still uses its normal owner. Human input clears unrelated autonomous context. This removes duplicate reads without turning historical records into current-world evidence, adding a global cache or prescribing what the robot should do.

### Full Auto continuity — owner contract

**Activity and assessment are different.** The product requirement is sustained,
meaningful self-directed activity with progress and accurate outcomes. An LLM
assessment is one means of selecting that activity; its frequency, token use or
GPU utilization does not demonstrate engagement. A previously selected pursuit
can still be running while another assessment occurs.

**Approved scheduling policy:** Full currently requests another assessment when
the preceding assessment settles, independently of selected work. Semi uses its
configured assessment interval. These scheduling choices remain in force; this
documentation update does not replace them with event-only wakeups, waits, limits
or a different loop.

**Open design question:** does that Full assessment cadence produce useful new
choices while work is already progressing, or repeatedly spend inference on the
same situation? Evaluate selected context, ongoing work, actual outcomes,
duplicate requests and resource use together. Any scheduling change needs an
explicit owner decision at the existing Active Operator responsibility. Do not
redefine continuous companionship as continuous model generation, or claim that
an immediate assessment loop proves useful autonomy.

**Owner requirement, 2026-10-26:** Full Auto is a self-directed robot that remains
meaningfully engaged while enabled. Every successful assessment selects or
continues meaningful activity. The model may choose musing, reasoning, tasks,
agents, movement or the Sleep workflow. Doing nothing is not a valid choice.
Recording a reason, updating percentages or repeatedly running an assessment
without activity does not satisfy this requirement.

The assessment records its reason and selected activity in the existing execution
and activation history. Newly updated activation levels retain their originating
mode; older unattributed records stay unknown. This Full requirement does not
change Semi's configured interval or its allowance for a non-triggering update.

Full Auto can select new work or address an existing execution by its recorded ID. A continuation enters that execution through the existing event owner with autonomous authorship, the complete instruction, reason and attributed context. It preserves the original objective and actual results. Selecting a Desire identifies the existing desire and its lifecycle operation; Agency remains the owner of planning, execution, review and check-in. This does not turn a desire summary into an unreviewed motion command or let the controller edit persona.

The shared Environment executor accepts conversational and computer-tool intentions as well as physical and sensing objectives. Intent selects those routes independently. Successful delegated tool work remains completed while its response's speech rendering is pending; the durable output workflow retains later speech outcomes. Pending speech does not turn the tool result into failure or request another execution of the tool.

Full Auto's existing Active Operator requests its next assessment after the
current assessment finishes. There is no model-selected `reconsider` policy,
quiet option, future-time pause or event-only suspension in the intended Full
contract. Selected operations execute independently; their duration and receipts
do not become a global assessment barrier. The LLM owns the activity choice and
requested behavioral ordering. Use the existing assessment and work owners.

Human input, returned results, changed observations, desires and memories inform
subsequent decisions; they are not prerequisites for another Full assessment.
Preserve source, speaker, time and uncertainty. Transport clocks and successful
processing counters are not environmental changes, and retained body events must
not be presented as new observations. Restart must preserve admitted work and
actual outcomes without replaying completed physical actions.

Full has its own graph-owned instruction and activity-selection contract.
Empty or all-zero decisions are errors, not successful self-directed activity.
The model chooses the operation, intention and continuation target; no replacement
action, automatic retry or fixed rotation is supplied. Semi retains non-triggering
updates. Qualification must follow a chosen brief through its actual workflow
results and into useful subsequent choices. Selecting an operation or displaying
an intention alone does not qualify companion behavior.

Recent attributed recall remains available. Full can additionally select a topic, time range, record order, memory type or sleep cycle for the next assessment through the existing Memory Router. All selected records and complete intentions cross the handoff without semantic truncation, text deduplication or removal of speaker/time/source attribution. A stored memory remains historical evidence, independently of current camera or robot status.

Activity context now reads canonical execution outcomes after temporary queue receipts have been released. The graph's existing Task Receipt Limit selects completed activities; all linked running, waiting and idle objectives remain available. Robot Status separates its current running/waiting task from `parkedGoals`: unfinished idle objectives retain their identity, source, decision and timestamps without claiming current work. Activity outcomes pair the task’s selected action ID with its correlated receipt and retain the latest activity result separately. Later speech playback cannot replace that action’s evidence. Full ordered events remain available through execution context. Selected work, its returned receipt, and evidence that its objective succeeded are separate facts. The controller can use those facts for another decision; a completed movement receipt alone does not prove a visual or conversational goal succeeded.

The shared Core Robot Operator body-connection reader identifies the selected
body for admission, assessment and dispatch. Physical actions require the actual
body connection; a gateway connection alone is insufficient. Available
non-physical activity must continue in Full Auto when the body is unavailable.
Whether the running admission path makes that distinction is a separate
qualification question. Already-admitted actions retain their actual receipts
and uncertain outcomes.

An assessment's finite camera read must not remain stranded after its Bridge connection ends or the application restarts. The Bridge owner resolves a disconnected read with its actual failure; authenticated Coordinator recovery applies that same rule to restored requests and delivers the correlated result to the waiting execution. Stream teardown releases its subscription and owned work even when the consumer is paused, and failed stream setup leaves no subscriber behind. This is connection-lifecycle reconciliation, not a camera timeout, a retry loop or evidence that physical work completed. Persistent depth acquisition retains its separate existing reconnect lifecycle.

Autonomous intentions sent to Environment-style execution are displayed in Inner Dialogue and saved in long-term memory by the existing Inner Dialogue Buffer and Inner Dialogue Memory Saver nodes. The entry contains the selected instruction, stated reason and observed context, tagged `autonomy` and `autonomy-intention`. Metadata retains the originating agent, trigger source, decision time, source observation time, session, cycle and execution identities. This records the model's declared intention rather than claiming the selected motion has completed; action receipts remain separate evidence. Observer, Movement, Reflection and direct Full Auto Controller handoffs use this same output path. This adds no spoken announcement or model call.

Desire Agent is the public controller for Agency work and can be invoked manually or selected by Sleep or Robot Autonomy. Its stages handle generation, planning, execution, outcome review and check-in as needed. It operates within the Desire system: it may read persona as context, but must not create or update persona goals or other persona fields. Agency-owned steps do not acquire a second continuation owner in Robot Goal Review. How well enduring goals and fresh experience inform new desires remains an integration question for the [qualification scenarios](QUALIFICATION.md#representative-scenarios).

Standing persona goals and fresh reinforcement evidence have different purposes. Full Autonomy needs recorded proposed, planning, aspirational and active aims, retaining their status and horizon; an aim is not automatically an active task. Desire review needs the same context even after earlier evidence has been consumed, without treating unchanged goals as new evidence or reinforcement. The approved October 15 extension adds an optional standing-goal selection to the existing Persona Formatter and shares the recorded-goal selection with Desire. Other formatter consumers retain active-only defaults. Deployment and behavioral evidence are recorded in the historical diary (retained locally).

The **Intent Orchestrator** is the program-wide input-routing responsibility, represented by the single `orchestrator` category. Task Decisions selects concrete supported actions, Planner develops complex plans, Psychotherapist independently assesses experience and outcomes, and Persona expresses identity, conversation and self-directed intentions. These are the approved distinctions in [the model and learning contract](MODELS_AND_LEARNING.md#models-and-learning). The category consolidation preserves each mode's existing Intent assignment, including the trained Environment specialist, rather than assigning the small model to unrelated higher reasoning. Activation evidence belongs in the dated qualification record; the category name alone does not establish which artifact is serving.

**Psychotherapist owns autonomous persona changes.** The owner clarified on October 15 that this is the only agent allowed to edit persona. It analyzes saved conversational evidence and develops Ainekio's persona through the existing persona-learning and persistence owners. Greg's statements remain attributed to Greg; they do not automatically become Ainekio's traits or circumstances. Explicit manual persona editing, onboarding and restoration remain separate owner actions. The existing agent is internally identified as `psychoanalyzer` and uses the `psychotherapist` model role; its manual and Sleep triggers do not imply a continuously running service.

Desire nurturing must not promote specific desires into persona goals. Completing
an Agency desire or robot execution does not by itself change a standing persona
aspiration. Reconciliation of misplaced items preserves original evidence and
persona history; it does not fabricate current needs or revive obsolete tasks.
The earlier goal-list cleanup is retained in the reference history.

**Desire relevance must be reviewed throughout its open lifecycle.** A triggered review reassesses all open desires against fresh attributed evidence and current lifecycle state. The model selects an exact target strength from zero to one, with a reason and supporting evidence references for changes; an unchanged assessment may have no references. This replaces the fixed positive reinforcement increment for model relevance review. Existing elapsed-time decay remains distinct. At zero, the Agency storage owner saves archived disposition and strength together, retaining history. The existing Desire outcome/Coordinator path requests cancellation of that desire's remaining work. Archived status and a cancellation request do not establish that physical work stopped; actual receipts and uncertain outcomes remain recorded. Late planning or execution results must preserve the saved archival and newer relevance assessment. Source qualification, recovery checks and activation are tracked in the historical diary (retained locally).

Nurturing uses the enabled conversation, episodic memory, task, goal, curiosity,
reflection and dream sources gathered by the existing Desire owner. Source windows
and record counts belong to its settings; they are not a second semantic-search
policy in this document. Selected content remains complete and retains
speaker/source/mode/time attribution. Standing goals provide context, not fresh
evidence. Repeatedly reading the same event must not count as fresh reinforcement.
Qualification must check whether the same event arriving through buffer and memory
is recognized as the same evidence; the historical identity gap is not a claim
that this handoff has been repaired.

**Workflow nodes select model categories, and the status widget assigns models to those categories.** Desire generation and nurturing select `psychotherapist`; the status widget owns its current deployment for each mode. The owner's October 26 reasoning rule keeps this ordinary work's Reasoning checkbox off. Full Autonomy assessments alone request high reasoning through the connected mode input; Semi assessments and ordinary task execution request none. An explicit node override takes precedence over the checkbox, and an unchecked ordinary Codex call requests none rather than inheriting a higher configured effort. Diagnostic and delegated terminal sessions retain their separate settings. This does not change the category's persona-editing authority: Desire still writes only Agency records, while Psychotherapist's separate review agent owns autonomous persona edits. Planning, execution and outcome stages retain their existing role selections unless explicitly reassigned.

References: [autonomy controller](../../etc/cognitive-graphs/robot-autonomy-controller-mode.json), [shared human/autonomy executor](../../etc/cognitive-graphs/environment-mode.json), [Active Operator](../../brain/agents/active-operator/), [Robot Goal Review](../../etc/cognitive-graphs/robot-goal-review-mode.json), [Weekly Goal Review](../../etc/cognitive-graphs/goal-review.json), [Agency owners](../../packages/core/src/agency), [remaining-objective routing](../../packages/core/src/nodes/utility/execution-context.node.ts).

## Workflows and interaction examples

Connections and the existing execution owners determine actual scheduling.
This describes responsibility and information flow, not a mandatory serial sequence.

1. User/event input enters the graph with originating instruction and attribution.
2. Intent Orchestrator selects needed routes and context.
3. Persona, history, memory, Robot Status, current execution, available capabilities and camera evidence feed the relevant context builders.
4. Task Decision selects an executable plan or delegation. Visual Planning and the existing plan resolver contribute when selected.
5. The existing active-task executor dispatches selected operations and records progress/outcomes.
6. Remaining-objective routing conditionally invokes Goal Review for an unfinished owned objective. Its assessment returns as data; unrelated conversation does not require review.
7. When Intent selects `needsResponse`, the final context builder combines its selected sources, returned execution/image evidence and applicable goal assessment. Graph dependencies hold the builder until selected results return; unselected branches are skipped. Persona generates the response and the single Conversation Out records and speaks it. The caller then handles newer input, selected continuation or an explicitly selected input wait.
8. Save nodes retain Intent and Task decisions for later curation. Tool delegation has its own eventual result-return path.

Core distinction: **request → selected plan → dispatched operation → operation receipt → evidence about the objective**. These are different events. Saying “done” or receiving a command completion does not by itself prove that an object was found, tracking is active, or a clearer image was obtained.

An ordinary command does not require a separate Goal Review call. Finite
objectives whose selected completion basis is `action_result` can settle from
their correlated completion results as described above; program completion alone
does not establish a broader visual or environmental objective. Goal Review is
an Intent-selected assessment of an eligible unfinished objective, and Active
Operator chooses subsequent autonomous work. Neither edits standing persona goals.
Conversation inference or delivery failure remains a failure, rather than an
empty successful reply.

Sources: [Environment graph](../../etc/cognitive-graphs/environment-mode.json), [autonomy controller](../../etc/cognitive-graphs/robot-autonomy-controller-mode.json), [shared human/autonomy executor](../../etc/cognitive-graphs/environment-mode.json), [Goal Review](../../etc/cognitive-graphs/robot-goal-review-mode.json).

### Illustrative request paths

These examples explain intended information flow. They are not runtime prompts, forced action sequences, or claims that every case currently passes. Intent selects routes; the task/conversation models decide the actual response and actions from the supplied evidence.

| Request or trigger | Relevant path and expected evidence |
| --- | --- |
| “How are you?” | Intent may select conversation and relevant context. A generated reply is delivered to text and the selected speech output. No body action or goal review is inherently required. |
| “What do you see?” | Selected vision context supplies a dated image through cached read or selected capture. Visual interpretation and returned evidence reach conversation. A capture receipt without the image does not establish what was seen. |
| “Walk forward,” then “Please stop” | The first turn selects goal-bearing locomotion with an endpoint or continuing condition; bare gait starts are not exposed to the model. The later turn reaches the existing execution for interpretation and cancellation/control. Results distinguish endpoint evidence from gait termination. Stop, detach and Finish remain distinct. |
| “Tell me what you see, a fact about cats, and bow” | Context selection and planning cover the visual, conversational and physical parts. Independent work can overlap where supported. The response receives relevant completed results; independent specialist roles are not assumed to run simultaneously when one needs another's output. |
| “Help me find my wallet” | A selected objective persists with the request and corrections. Model-selected searches/actions produce evidence; review assesses fulfillment or the next step rather than discarding the goal at the end of one graph pass. |
| Full-auto activity | Context and available capabilities inform a controller choice. Execution or agent work returns attributed results; later decisions receive that history instead of repeatedly seeing only the original situation. |
| “What did you dream about last night?” | Routing selects memory/inner evidence as relevant; retrieval must distinguish dated dreams from older questions and physical experiences. Missing evidence is not supplied by inventing a remembered event. |

### Dependencies and concurrency

Intent context selection precedes the planning that consumes it. A description of a newly captured picture depends on the returned image. These are necessary data dependencies. Independent speech, motion, sensing and delegated computer work can overlap through their existing owners; one shared graph is not a requirement that the entire robot perform only one activity at a time. Hardware, speaker ordering, configured inference capacity and real requested ordering still affect concurrency.

Build Conversation Context assembles the selected inputs and available task results for the conversation model. It does not execute commands or magically receive evidence after a model call has already started. Correct result handoff and continuation are therefore part of the functional contract, not optional reporting details.

Execution recovery services outstanding work: interrupted execution, pending delivery, unfinished cancellation, and results belonging to current jobs. It does not repeatedly process completed history or dormant goals. An arriving result retains the identity of its originating execution; separate live requests can progress independently. Historical evidence and goals can remain available to selected context without entering the recovery loop. Cleanup selects records due under the existing retention policy separately. This distinction does not change the existing application-restart policy or the preservation of admitted work through a Body Control disconnection.

Active Operator reads the Coordinator's active-item membership, not its retained receipt payloads. Receipt recovery resumes unacknowledged handoffs, including a result recorded just before its queue acknowledgement was interrupted; it does not repeat the original action. The queue retains unfinished work, undelivered results or failure notices, and the existing recent-activity window used by autonomy. After the execution owner records a result, the same delivery handoff acknowledges it to the Coordinator. Normal queue lifecycle removes the copy when it leaves that activity window; no later cleanup sweep or parent-goal completion is needed. The execution outbox and events retain the original admission and result identities; a settled outbox does not resubmit work on reconnect. Terminal-execution history has its separate configured retention period, measured from the execution's last update. That period does not extend the lifetime of unused queue payloads.

### Active Operator activation display and evidence

Agency → Active Operator displays the configured operation list, current activation percentages, recent assessment trends, reasons, instructions and work states. The operation selection is editable in the graph's Available Autonomy Tasks node; model selection remains a saved model role in the model widget. Assessment records remain in durable executions and are projected into the next decision; there is no separate accumulating queue history. Initial unassessed operations have level zero and no assessment date. Levels are not automatically raised or reset. Goal Review is still tied to goals and returned evidence, not an idle polling operation. Reflection, daydream and curiosity timers migrated to this owner are removed; Sleep and explicit manual invocation retain their existing owners.
