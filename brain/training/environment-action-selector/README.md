# Environment specialist training

The large development and evaluation JSONL corpora are stored with Git LFS. After cloning, run `git lfs install` and `git lfs pull` before training or validating the corpus. LFS preserves the complete files and their manifest hashes.

This existing lane trains independent Intent and Task LoRA adapters on Qwen3.5 0.8B (default) or the explicitly selected Qwen3.5 2B base:

- **Intent** reads only the current request and returns `needsResponse`, `needsAction`, `needsToolUse`, `taskPlanner`, and independent `taskContext` / `conversationContext` lists, with optional memory search fields. Context lists select individual persona sections and the relevant evidence sources for each consumer.
- **Task** receives the runtime Context Builder's selected evidence and capability catalog. It returns `taskDecision`, an ordered `program`, and execution handoff fields when applicable. It can also return the approved `{"delegatePlanning":true}` branch to ask the configured larger model for a plan. Both paths use Core task validation and the same active executor. Task does not select speech steps. Intent selects `needsResponse`, and the separate Persona conversation model authors the outward response after selected task results.

**Version 18 — attributed ground-contact evidence.** The approved fixture refresh corrects 96 Task development inputs and 48 planner reference outputs to retain explicit selected ground-contact points and vision evidence. Record counts, fitting target outputs, Intent records, and evaluation/regression records are unchanged. The archived version 17 snapshot and the remote 0.8B run using it remain unchanged.

**Version 17 — goal-directed locomotion.** `locomotion-cases.ts` adds 408 Task
development records and 72 separate evaluation records for measured displacement,
relative rotation, approach/follow references, visual endpoints, missing measurement,
delegation, cancellation, finite gestures and discussion. User/autonomy and catalog
siblings stay in the same development fold. New totals are 6,766 development
records (1,432 Intent / 5,334 Task), 1,590 evaluation records (297 Intent / 1,293 Task),
and 187 regression records (46 Intent / 141 Task). Intent records are unchanged.

The generator refreshes synthetic capabilities through Core's current locomotion
contract. Retired bare-gait/cycle targets explicitly delegate planning; they do not
invent metric endpoints. Existing visual behavior targets and completion criteria
become explicit visual locomotion goals. Original v16 records and a per-record
migration receipt remain in the ignored training run archive. New metric targets
use attributed position/yaw evidence; retained visual frame/box references stay
exact. Visual planning remains delegated under the approved Task instructions.
The eight recorded runtime qualification requests remain outside development data.
Neither synthetic reference validity nor training completion proves physical travel.

The existing CLI can reuse a development-selected recipe on a separately approved
RunPod job through Brain's existing `runRemoteTraining` lifecycle owner:

```sh
pnpm train:environment-action-selector:0.8b --specialist task \
  --reuse-settings-from out/environment-action-selector/training/<selected-run>/final \
  --output out/environment-action-selector/training/<new-run> \
  --remote-profile <profile> --remote-max-hourly 0.65 --remote-max-total 1.30
```

This remote option accepts only a development-only reused-settings fit. It uses
the profile's configured GPU/template, a separate pod, 20 GB volume and 40 GB
container, checks allocated GPU price plus storage before fitting, and reserves
90 seconds for the existing provider termination owner within the total budget.
Native sequence capacity is measured from complete examples. Training does not
use evaluation/regression inputs. Candidate receipt and downloaded artifact
checksums are verified before cleanup; actual serving qualification and registry
activation remain separate. `--dry-run` validates inputs without allocating a pod.
Run remote-owner tests with `tsx --experimental-test-module-mocks --test
brain/training/personalization/lora-trainer.spec.ts`; their provider calls are mocked.

**Version 16 — single Persona speech owner.** The owner approved removing the Task `speech` program step. Current development and comparison records use the new contract: speech-only requests have null Task output, mixed requests retain their body/sensing steps, and explicit requests to speak activate Intent's response route. Quoted-command contrasts still distinguish requested words from requested body actions. The historical version notes below describe their original snapshots; their speech-step targets are superseded in version 16. Saved training-run datasets, weights and qualification reports are unchanged. Re-freeze inputs for future runs and compare both adapters against the same version 16 reference set; earlier scores are not directly comparable, and previously inspected evaluation cases remain reviewed evidence. No adapter was trained or promoted by this revision.

The conversation model remains independent. Training reads the approved prompts from `etc/cognitive-graphs/environment-mode.json` without changing them. Core owns context construction, intent parsing, task validation, and capability admission. The shared trainer is `docker/runpod-trainer/train_unsloth.py`; this directory owns synthetic task data and the specialist training/evaluation lifecycle.

`intent-cases.ts`, `intent-expanded-cases.ts`, and `intent-tool-cases.ts` contain sanitized intent source families. The original expanded intent corpus contained 1,128 distinct development requests and 228 separate evaluation requests: the existing 80 authored phrasings and 120 withheld task/response combinations, plus 24 tool-routing boundary cases and four explicit-silence requests. The combination set reuses individual clauses from development; it measures compositional generalization, not wholly unseen vocabulary. Related variants stay together in their source family and fold. The 44 previously inspected intent cases remain regression cases, not an untouched holdout.

For 164 reviewed development requests, choosing an action does not specify whether to speak. Their `responseOptional` annotation now produces one conversational training target with personality context, replacing equally represented silent/spoken alternatives. This implements the owner's requested preference for more communication through training labels, without forcing runtime output or changing the task's selected evidence. Explicit speech and silence requests retain their targets. The intent model selects whether a response is generated; the separate conversation model decides its wording, length, and factual explanation. This change alone cannot teach that model how to explain execution results.

Evaluation and regression preserve their optional-response annotations, so either choice remains semantically acceptable where annotated. When evaluating the preference, also compare the fraction of those requests selecting `needsResponse`; acceptable-routing accuracy alone does not measure talkativeness. Existing adapters retain their behavior until retrained and evaluated.

Task data contains 1,140 development records and 192 fresh evaluation records (64 request/context cases, each with three catalog variants). Variants cover original catalogs, reordered catalogs with equivalent descriptions and capability-only environment context, and opaque command identifiers. The capability catalog is available independently of optional environment observations. Additional families vary catalog size, misleading identifier names, ordered steps, corrections, supplied history/memories, and explicit user conditions evaluated against Robot Status. The earlier 132 task evaluation records remain regressions. These correlated variants must not be described as independent real-world trials.

`specialist-evaluation.jsonl` is frozen before fitting and excluded from checkpoint selection. Manifest version 5 supersedes the previous snapshot: intent records use the already approved tool-routing prompt/schema and include explicit `needsToolUse` targets, with 28 newly authored evaluation cases. Old run artifacts remain unchanged; compare candidate and current adapters on this same new snapshot, not against scores from different dataset digests. Task records remain byte-for-byte equivalent as decoded records. Its reviewed response-choice annotations supersede the earlier silence-only expectations; results using different dataset digests are not directly comparable, and reviewed cases are not an untouched holdout. `specialist-regression.jsonl` preserves the previously examined requests, with reviewed labels for the current contract. The manifest records all three dataset digests. Personal profiles and real user memories are not inputs. The retired Context Router's 16 closed cases remain untouched; only their existing lock and receipt are read for provenance. That revision did not change the approved graph prompts; version 11 below includes the later owner-approved interface and routing wording.

This is a **synthetic, text-only training corpus**, covering routes, capability-grounded commands, ordered actions, motion descriptions, non-action requests, and execution handoffs. It does not qualify image understanding, arbitrary autonomous activity selection, or every possible task state. The export preserves an unchanged base vision projector; that does not constitute visual evaluation.

## Speech versus requested body actions

Manifest version 14 appends `speech-action-boundary-cases.ts`: 576 Task development
records and 192 Task evaluation records. Quoted movement language is contrasted
with speech-plus-gesture programs, reversed speech/gesture order, spoken quoted
instructions, actual continuous gait requests, and discussion. Human and delegated
sources and catalog variants stay in one fold per family. Evaluation phrases stay
outside fitting. These are correlated synthetic records, not physical trials.

Totals are 5,782 development records (1,432 Intent / 4,350 Task), 1,326 evaluation
records (297 Intent / 1,029 Task), and the unchanged 187 regression records
(46 Intent / 141 Task). Every version 13 record remains unchanged. This extension
changes no Task system prompt, runtime command restriction, or model assignment.
The recorded rapid-movement incident is a private replay outside fitting; compare
its exact requested speech and gesture, not merely valid JSON or a valid command.
Both adapters must be evaluated against the same frozen corpus and serving setup.
Training completion alone does not qualify an adapter for activation.

Version 15 appends `quoted-imperative-cases.ts`: another 576 Task development
records and 192 Task evaluation records. Complete executable body instructions
appear as quoted speech paired with a different requested body action, alongside
speech-only, unquoted execution, ordering and discussion contrasts. These cover a
remaining compositional failure observed during version 14 qualification without
fitting the inspected requests themselves. Earlier evaluation records are now
reviewed comparison evidence, not claimed as untouched holdouts. New evaluation
families remain outside fitting, and all source/catalog siblings share a fold.

Totals are 6,358 development records (1,432 Intent / 4,926 Task), 1,518 evaluation
records (297 Intent / 1,221 Task), and the unchanged 187 regression records.
All version 14 records are preserved. An unchanged baseline prediction may be
reused only with identical frozen record, adapter bytes and serving settings;
record that reuse explicitly. Every new candidate still receives a complete
comparison, including previously observed failures.

## Ordered speech and vision routing

Manifest version 11 adds synthetic ordered speech and speech-only program examples,
with quoted-discussion and silent-motion contrasts. Source siblings and orderings
stay in one development fold; new gestures and phrases are held out. The saved
live wake request remains private regression evidence and is not fitted.

The owner-approved Intent wording routes camera capture and mixed visual routines
to the configured 9B vision planner. Capture-only examples do not require an
already available image. Earlier photo labels and visual task-context labels are
corrected to that contract. This is an explicit gold-contract revision, not a
claim that earlier evaluation labels or prompts are unchanged. Both adapters must
be compared on the same archived version 11 inputs. The new corpus has 1,288
Intent and 3,342 Task development records, 990 evaluation records, and 187
regression records. These are correlated synthetic variants, not independent
physical tests. No active adapter assignment changes during data generation or
training.

## Vision acquisition and tracking data

Version 10 adds the owner-approved `taskPlanner` choice to Intent records and
schemas. Visual acquisition/tracking requests select `vision`; ordinary requests
retain `specialist`. Context and response selections remain independent. Corpus
counts are unchanged. The existing graph branches share one execution owner;
this is not an additional Task adapter or robot controller. The scorer measures
planner selection explicitly. Archived version 9 fits retain their original
inputs and have not been qualified for this newer routing contract.

Keep `taskPlanner` at the end of the runtime schema's property order, matching
its position in these training targets. An actual llama.cpp development replay
showed the newly fitted adapter repeating into malformed output when decoding
forced that field before the context lists; the same adapter returned correct
JSON with the matching order. Preserve this serving contract when extending the
schema and compare both adapters under the same decoding configuration. Field
descriptions that the model needs to understand must also reach its readable
context: Qwen's installed template does not insert `response_format` schema
descriptions into the prompt. The approved reference-image description is shared
by the existing capability context and output schema.

Version 9 adds `vision-continuation-cases.ts`: 48 Intent and 336 Task development
records, plus 12 Intent and 84 Task evaluation records. The unchanged original
tracking intention is paired with initial acquisition and returned-candidate
selection, for both human and autonomous sources. Localization-only contrasts
do not configure tracking merely because candidates exist. Source, stage and
catalog siblings share a development fold. New subjects are held out, and the
private live chair continuation remains outside fitting. Totals are 4,358
development (1,280 Intent / 3,078 Task), 886 evaluation (253 / 633), and 187
regression records. Current approved graph prompts and current runtime schemas
are regenerated for all records; archived version 8 run snapshots are unchanged.
Candidate and baseline comparisons must use the same version 9 snapshot.

`vision-cases.ts` extends the existing two specialists with 36 intent and 120
Task development records, plus seven intent and 21 Task evaluation records. The
observed stationary-chair request is kept separately as one intent and three
catalog-variant Task regression records; it is not fitted or used for checkpoint
selection. Task counts include three correlated catalog variations per request,
not independent scenes or image trials.

The version 7 extension totals were **3,452 development** (1,184 intent / 2,268 Task),
**790 evaluation** (241 / 549), and **187 regression** (46 / 141) records. These
supersede the earlier revision counts above. Manifest version 7 records new
corpus digests; every pre-extension record retains its original ID, prompt,
input, schema, target and metadata. Archived runs remain untouched. Compare
candidate and existing adapters on the same expanded evaluation snapshot.

Manifest version 8 corrects two held-out intent references: configuring category
search and releasing a target require environment context, consistently with the
development examples, without requiring an image. Acquisition still selects
vision. At that reference-only handoff, training and regression files were byte-identical to version 7; prompts,
schemas, IDs, and evaluation inputs are unchanged. Version 7 model runs and
reports retain their original references. Reference-only rescoring with version 8
leaves all headline scores unchanged; other context-selection differences remain.
See `out/environment-action-selector/training/vision-reference-rescore-20261013/`
for preserved inputs, explicit reference changes, unchanged raw predictions and
new reports. Do not treat these rescored outputs as a new inference run.

The subsequent owner-authorized refinement retains version 8's corrected held-out
references and adds `refinement-cases.ts`: 48 Intent and 474 Task development
records. Current totals are **3,974 development** (1,232 Intent / 2,742 Task),
with the same **790 evaluation** and **187 regression** records. Every prior
development record is preserved; evaluation/regression files remain byte-identical
to the version 8 reference-only handoff. Fresh examples contrast explicit silence,
recall and capabilities, sensing versus description/status, quotation versus
execution, strict numeric comparisons, exact returned frame/box selection,
qualified targets, release and ambiguous ownership. Related branch and source
variants share a fold; acquisition/selection variants for one new target do too.
Battery evidence uses the existing Robot Status voltage field. No runtime prompt,
schema, production decoding or model assignment changes accompany this extension.
Run-local dataset digests distinguish this extension from the earlier version 8
snapshot. Full precision qualification remains separate from fitting and epoch
selection; improved aggregate counts alone do not establish no regressions.

The additions cover stationary acquisition, category search, selection from
returned candidates, retained-image references, release, explicit reacquisition,
and stationary observation. Contrasts cover scene description, status-only
questions, quotation, explicit silence, unavailable operations, ambiguous
ownership and not-found results. The latter requests explicitly ask for user
clarification; they do not define an automatic target-loss behavior.

Selection examples use the existing Context Builder's `environmentTaskEvidence`
input with the same `vision_acquisition` shape returned by the active-task owner.
The selected frame ID and normalized box come from those synthetic candidates.
Acquisition does not invent a later selection, claim ownership from a category,
or mark tracking complete before fresh query-associated evidence. Catalog
reordering retains recognition state because it advertises the vision operations;
removing that state would change the interface rather than vary the catalog.

These are text-only routing/planning examples, including synthetic vision-result
metadata, **not image-recognition training**. The approved runtime prompts and
schemas are unchanged. Generating the data does not train, activate adapters,
change model assignments, or issue robot commands. After fitting each existing
specialist, compare old/new skills on the expanded evaluation and regression
sets and repeat the real conversational camera-to-tracker test before claiming
working integration. Typed program comparison covers vision steps; the existing
physical-action counters alone are not a measure of sensing correctness.

Generate and validate:

```bash
pnpm generate:environment-action-selector-training
pnpm validate:environment-action-selector
```

Use distinct run directories for each specialist. Commands below use `intent`; repeat with `task` and its own directories. All GPU jobs within these commands run sequentially. The existing environment must be installed through the repository's training setup; the merged exporter uses the installed Unsloth llama.cpp converter and quantizer. LoRA export uses `convert_lora_to_gguf.py` from the adjacent `llama.cpp-source` checkout. Provision those tools before export; the exporter does not install packages. `HF_HUB_OFFLINE=1` can be set when the exact base is already cached.

For routine corpus refinements, reuse a prior final run's development-selected
settings instead of repeating all four folds. Pass its `final` directory to
`--reuse-settings-from` and choose a new output directory. This fits the current
validated development corpus once, using the archived epoch count and training
recipe. It remeasures sequence capacity from complete current examples. Provenance
records the old settings-selection dataset and report separately from the new
fitting dataset; it does not claim cross-validation of the new data. Evaluation
and regression records remain excluded from fitting and checkpoint selection.
Compare the resulting candidate against production through the existing serving
qualification before activation. Use new folds when investigating new training
settings; the original exact-dataset `--final-from` contract remains unchanged.

```bash
pnpm train:environment-action-selector:0.8b -- --specialist task --reuse-settings-from out/environment-action-selector/training/task-cv-final/final --output out/environment-action-selector/training/task-refined
```

```bash
pnpm train:environment-action-selector:0.8b -- --specialist intent --output out/environment-action-selector/training/intent-cv-001 --dry-run
pnpm train:environment-action-selector:0.8b -- --specialist intent --output out/environment-action-selector/training/intent-cv-001
pnpm evaluate:environment-action-selector:folds -- --root out/environment-action-selector/training/intent-cv-001 --checkpoint-policy final-epoch
pnpm score:environment-action-selector:development -- --root out/environment-action-selector/training/intent-cv-001 --checkpoint-policy final-epoch
pnpm train:environment-action-selector:0.8b -- --specialist intent --final-from out/environment-action-selector/training/intent-cv-001 --selection-report out/environment-action-selector/training/intent-cv-001/development-validation-final-epoch.json --output out/environment-action-selector/training/intent-final-001
pnpm export:environment-action-selector:merged -- --root out/environment-action-selector/training/intent-final-001
```

Select the 2B base through the same training CLI, using separate run directories for Intent and Task:

```bash
pnpm train:environment-action-selector:0.8b -- --specialist intent --base-model unsloth/Qwen3.5-2B --reuse-settings-from out/environment-action-selector/training/<selected-intent-run>/final --output out/environment-action-selector/training/intent-2b-refined
pnpm export:environment-action-selector:merged -- --root out/environment-action-selector/training/intent-2b-refined --stage final --lora-only
```

The command name retains its historical `0.8b` suffix; `--base-model` selects the actual base. Omit it to retain 0.8B. Reused settings record both their source base and the fit's target base; 0.8B development selection is not evidence of 2B quality. Complete examples are measured again, with no inherited sequence capacity or changed hyperparameters. The checkpoint evaluator reads the recorded training base, and export checks that base against run provenance. Adapter-only export permits one shared base with separate specialist adapters. Existing reviewed-data callers keep `--lora-only`'s reviewed-stage default; `--stage final` selects final or reused-development fits explicitly. Qualification and production activation remain separate.

`--fold 0` runs one development rotation. Three epochs are the initial recipe; select `epoch-1`, `epoch-2`, or `final-epoch` from development results, then fit one final adapter to all development records for that many epochs. Fold adapters are never merged together. `best-loss` identifies a per-fold selected checkpoint; final fitting should use an explicit epoch policy so it does not confuse different folds' best epochs.

For manually reviewed runtime decisions, run `scripts/environment-training-bank.ts export --username PROFILE` to write separate `intent.jsonl` and `task.jsonl` files under that profile's output directory. The Memory tab accepts or corrects curator proposals; a proposal alone is excluded. Train with `pnpm train:environment-action-selector:0.8b -- --specialist intent --reviewed-data PATH_TO_INTENT_JSONL --output out/environment-action-selector/training/intent-reviewed-001` (or `task` with its export). Use `--dry-run` first to validate the input without launching the GPU job. This path fits only approved records and leaves the synthetic development and frozen evaluation files untouched. Evaluate the resulting adapter against the separate frozen cases before considering activation; the training command does not activate it.

The manual **Environment Training Trainer** agent runs that reviewed-data export, Unsloth fit, frozen-case evaluation of both the new and currently assigned adapters, report scoring, and GGUF LoRA export in one finite run. Trigger it from Agent Monitor, or run `node --import tsx brain/agents/environment-training-trainer/cli.ts --username PROFILE --specialist intent` (`task` or `all` are also accepted). No fit starts for a specialist without human-approved records. For a nonempty fit, the agent stops the existing 9B and shared 0.8B llama.cpp services, plus the optional 2B service when running, during GPU training/evaluation and restores whichever were running, including after a failure; Kokoro remains running. Each run writes its inputs, reports, adapter and decision receipt under ignored `out/environment-action-selector/training/<specialist>-reviewed-<run>/`; the current PEFT adapter must still be present for comparison. The frozen evaluation set is filtered by specialist and is never used as training input. The manual trainer uses the selected adapter’s recorded base for the reviewed fit and both evaluations. It resolves native checkpoints from the exact exported adapter stage, including nested final exports and successive reviewed runs, rather than assuming `run/final/adapter`. Qualifying activation updates the existing shared service for that base (0.8B or 2B), preserving its paired adapter and restoring the prior unit if activation fails.

Automatic promotion compares the two reports on the same frozen cases and device. The candidate must retain at least the current adapter's Core-valid and acceptable-routing counts, have no more missed, unexpected or wrong physical actions or false completions, and improve acceptable routing or measured p95 inference latency. That latency is a Transformers batch-duration proxy, not llama.cpp serving time. If it qualifies, the trainer replaces only that specialist's path in the existing shared llama.cpp unit, restarts the service, verifies the new LoRA is loaded, and delegates the Environment role assignment to Core's model-registry owner. If activation fails, it restores the previous service startup list and leaves the old role selected. Training itself does not write the model registry. This restart affects the specialist server briefly; application startup is unchanged.

For final evaluation, filter the frozen evaluation records by `metadata.specialist` into the run directory. Run `evaluate_qwen_checkpoint.py` with `--split evaluation --data <filtered-jsonl> --adapter <final/adapter> --config <final/training-config.json> --output <predictions-jsonl>`. Use `--split regression` for the previously examined set. Add `--base` for the unchanged base comparison. Reports record the device and batch size. Score each with `score-development.ts --root <run-root> --predictions <predictions-jsonl> --records <filtered-jsonl> --output <report-json>`.

Evaluation uses the same native tokenizer template and disabled thinking as training, with unconstrained greedy generation. Scoring checks strict JSON, the live Core contract, all ordered program steps, task-state fields, execution targets, missed/wrong physical selections, and false completion declarations. Intent scoring retains exact label agreement and separately reports `acceptableRouting` using frozen per-consumer required/optional/alternative-source annotations. Required action/response flags cannot be waived by optional context. Tool selection participates in exact and acceptable routing; missed and unnecessary delegation appear under `routeErrors.needsToolUse`. Only an explicit `responseOptional` annotation permits either response choice; it cannot waive an action or required context. Use `acceptableRouting` to assess these alternatives: a single deterministic prediction cannot exactly match both training completions for one optional-response request. Missing required sources, unnecessary context, and incorrect consumers are counted separately. These annotations are offline evaluation data, never runtime rules. Intent scoring also reports missed/extra routes and context entries per consumer, independent of list order; optional response differences are not missed/extra response errors, while exact context differences remain visible. Its optional query wording and memory types receive only structural validation. Free-text task objectives and reasons need separate review. Exact gold matches can penalize a reasonable alternative selection or equivalent motion wording; they are not a complete measure of semantic correctness.

Environment request intent inherits the selected model's repetition penalty through Model Router. Include the actual node and model sampling settings in serving comparisons; a penalty on repeated tokens can change structured route decisions.

Transformers evaluation latency is **not** llama.cpp/Ollama serving latency. Benchmark merged exports and shared adapters through the configured backend separately before claiming a speed improvement. Preserve PEFT adapters, GGUF LoRA adapters, training provenance, and quantized merged exports under ignored `out/environment-action-selector/training/`. Export receipts hash the merged language, GGUF adapter, and projector files. Training and export do not activate a model or execute robot actions.

Scoring verifies every expected record ID and provenance against the frozen input file (or each archived fold's `validation.jsonl`) before writing a report. Missing, duplicate, unexpected or changed reference records fail scoring. `typedDecisionMatch` measures the program and typed fields, not semantic correctness. The report includes a `semanticReview.pending` list with the input, reference, actual output and prediction digest; no unreviewed prediction counts as confirmed correct. A valid prediction with a recorded passing semantic and grounding review can count as confirmed correct even when its wording differs from the reference. A human review JSON array can be supplied with `--reviews <json>`; each entry contains `recordId`, `predictionDigest`, `semantic` and `grounding` (`pass` or `fail`), and a nonempty `reason`. This separates format/action measurements from reviewed interpretation and grounding without a new grader prompt.

Conversation uses finite Coordinator work and the `environment-conversation` delivery workflow under the same durable execution; slow generation does not hold the active program's execution lease. Task selection and conversation retain the same capability interface but independently select their optional context. Recall uses the existing Coordinator and is joined only by consumers selecting memory. The larger planner receives the original task context and schema; only the small planner sees the approved delegation option. Delegation training targets follow explicit requests to use that planner, with separate discussion, quotation, and direct-selection cases. These examples do not calibrate when the specialist should independently seek help or impose a complexity threshold.

Archived runs retain their exact training/validation files and hashes. Updating the current corpus for a changed routing or delegation contract does not update an in-progress adapter's training inputs or qualify it against the new prompt. Keep those run directories intact and evaluate the served candidate against the current contract before activation; do not relabel old prompt results as current-contract results.


## Tool-use scenarios and delegation boundaries

The scenario inventory is implemented in [intent-tool-cases.ts](intent-tool-cases.ts): 84 delegated and 44 local development requests across 32 families, plus 12 delegated and 16 local evaluation requests across seven separately authored families, including four requests explicitly requiring silence. They extend the existing mostly local corpus; tools are not the majority training label. These are training requests, not a catalog injected into every inference.

The capability research used official [Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli), which covers working with local files, commands, code and web search; [ChatGPT capabilities](https://learn.chatgpt.com/docs/use-chatgpt), including research, file analysis and artifact creation; and [MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), which describes connected tools. Product capability does not establish availability in the installed Terminal session. Connected-service requests in this corpus explicitly identify configured connections. Browser interaction, image generation, email sending, and calendar writes need installation-specific capability verification before adding positive cases promising those operations.

| Scenario family | Delegated outcome | Similar request that stays local |
| --- | --- | --- |
| Web research and verification | Retrieve and cite external sources | Explain an ordinary concept |
| Current facts | Check forecasts, hours, releases or timetables | Answer from supplied text |
| Local services | Find nearby stations or businesses from a specified location | Discuss what a gas station is |
| Comparison research | Check prices, specifications or availability | Compare two supplied descriptions |
| File discovery and reading | Locate, inspect or compare files on disk | Recall a conversational memory |
| Artifact creation | Save a PDF, spreadsheet, CSV or report | Compose a short spoken poem |
| File organization | Rename, copy, archive or back up files | Explain how backups work |
| Software creation and repair | Implement, test, debug or inspect a repository | Explain a short supplied code expression |
| Execution and automation | Run existing scripts, builds or tests | Describe a command without running it |
| Host diagnostics and settings | Inspect processes, storage, services or saved settings | Read robot telemetry through Robot Status |
| Data and media processing | Analyze stored datasets, plot, resize or convert files | Calculate simple arithmetic |
| Connected services | Use a configured API, repository, calendar or storage connection | Discuss an integration concept |
| Context-dependent delegation | Retrieve selected history or memories for computer work | Use those same sources for a local answer |
| Combined body and computer tasks | Select both action and tool routes | Perform a gesture through the body interface |
| Explicit delegation and informal phrasing | Honor a clear request for the computer agent | Discuss or quote the agent's name |

There is no runtime keyword rule. Repeated words such as make, find, search, look up, and Codex appear on both sides of the boundary. Underspecified requests retain a conversation route for clarification; explicit known computer outcomes select tools even without a trigger word. More response-positive labels do not enable tool use or load persona into task context. No prompts, model roles, adapters, or running services are changed by regenerating this corpus.

Specialist training derives sequence capacity from the longest complete native-template training or validation example, including the supervised output. It does not use a fixed 1,536-, 4,096-, or 8,192-token training ceiling. The shared trainer writes `effective-training-config.json` and records its digest and measured capacity in `training-result.json`. Evaluation independently sizes capacity for its full prompts plus the configured generation budget. Personalization retains its separate configuration contract. Neither path truncates specialist examples to fit a preset window; model and hardware failures remain visible.

`posture-cases.ts` adds the bridge's body-command meanings, including distinct resting and lying postures, independently selected prior Robot Status, longer dated observation histories, and non-action discussion. Related context variants stay in the same development fold. The reported posture failures use separate evaluation wording and are excluded from fitting. These additions address a specific coverage gap; they do not qualify a candidate without comparison against the current adapter and saved runtime inputs.

`goal-cases.ts` adds compound movement/capture requests, visual objectives, reported-state confirmation, open-ended search, finite captures and non-action discussion. Each development intention has both human and internally authored variants, kept in the same fold. The generator reuses the unchanged Environment Mode or Autonomy Executor prompt and the runtime Context Builder, including `plannerDecision` attribution for autonomous intentions. Both graph-property sets contribute to the manifest digest. Dated synthetic observations are context, not evidence that the new goal succeeded. Existing finite-action labels remain appropriate for finite requests; visual and reported-state goals have explicit outcome criteria and continuation labels instead of the generic receipt-only target.

The sanitized reposition-and-capture failure is regression-only. Unseen subjects and combinations are separately evaluated. The exact private runtime input and output remain in local diagnostic records, excluded from published training data. Reference movement directions are candidate plans, not mandatory runtime choices: equivalent outputs can pass the existing digest-bound semantic/grounding review. JSON validity, action matching and whole-goal correctness remain distinct measurements. Regenerating the corpus neither trains nor activates an adapter; the original failure remains unresolved in the served model until a newly trained candidate is qualified against the frozen cases and recorded runtime input.

`task-contrast-cases.ts` addresses the failed goal candidate's request/plan mismatches with paired examples. Discussion, quotation and execution siblings share the same selected evidence and upstream action hint. Movement-only, capture-only and compound siblings preserve the particular visual target and completion evidence. Conditional families vary reported voltage below, at and above the requested threshold; exclusive alternatives, a condition with no else-branch, and unconditional sequences have different supervised selections. All related branches and both source attributions stay in the same development fold. These are corpus annotations, not runtime rules or prompt additions.

The `contrast-eval-*` suites contain fresh wording, subjects and conditional combinations outside the fit. Report these separately from the previously inspected qualification cases, which now provide regression evidence for subsequent rounds. Preserve old run directories and their frozen inputs. For retraining, compare current, rejected goal candidate and new candidate under the same real serving contract, including semantic review of targets and completion evidence. Select training settings on development evidence only; do not add inspected qualification requests to fitting or describe regression tuning as unseen accuracy. Training and production activation remain separate actions.

`task-binding-cases.ts` extends the request-to-program coverage with nine development families (360 records including both source attributions and the three catalog variants). Gesture demonstrations, photographs of gesture drawings, verbal descriptions, quotations and gesture-plus-photo sequences share context. Voltage examples cover inclusive thresholds, reversed branch wording, no-else requests and explicit two-action sequences. Visual examples retain the particular target despite unrelated dated label observations; finite-cycle movement, capture-only, movement-plus-capture and observed-condition behavior programs remain distinct. Reference turn direction and cycle counts come from the synthetic request. A visual-condition behavior uses the existing executor contract; a bare ongoing gait with a bounded task declaration is not substituted for it. No new model-visible prompt, schema description, runtime choice rule or execution contract is introduced.

The 168 `binding-eval-*` records hold out gesture identities, a conditional command combination/threshold and a visual target/cycle count. They share construction patterns with development examples and measure compositional transfer, not wholly unfamiliar language. Existing evaluation and regression records are unchanged. These are separate diagnostic results from whole-workflow success: a structurally valid plan still requires actual execution and visual evidence before its objective can be called complete.

For the next Task training handoff, use the current generated corpus (2,148 Task development records; Intent data unchanged), the existing development-family folds, complete native-template examples and the existing trainer/export owners. Select settings on development evidence. Compare the resulting adapter with the *currently assigned* production Task adapter, not a historical deployment inferred from a run number. Preserve the original 360 Task evaluation records and 138 Task regression records, and report the 168 newly added Task evaluation records separately. Review selected actions, conditional exclusivity, targets, completion criteria and continuation programs alongside typed scores. The previously observed private runtime replay remains diagnostic-only. No training, inference-setting change, service lifecycle change or production activation is performed by this data update.

### Version 12: specialist-only visual delegation

The owner-approved Specialist Instructions property belongs to the existing Task
Context node. It is appended only to the small Task model's messages. Direct and
delegated larger planning retain the original task prompt and schema.

Visual Task targets now use the existing `{"delegatePlanning":true}` output.
Typed source annotations, camera/vision operations, visual completion contracts
and acquisition evidence identify these synthetic labels; none become runtime
keyword rules. Nonvisual targets, speech steps and discussion contrasts remain.
The original visual program is retained as `plannerReferenceOutput` outside model
input for larger-planner contract checks. It is not an additional training target.

Version 11's frozen run remains unchanged. Version 12 explicitly revises the Task
gold contract in development, evaluation and regression. Previously examined
requests remain reviewed comparison evidence, not an untouched holdout. Compare
current and candidate adapters on the same archived version 12 records; do not
compare aggregate scores across versions. Fit and recipe selection exclude
both evaluation and regression records.

### Version 13: positive and negative sensing contrasts

Additional synthetic families contrast requested camera work with explicitly
excluded sensing, a person watching a gesture, ordered speech, and quoted
instructions. Both Intent and Task use the same distinctions and source pairs.
Development uses eight gestures; two separate gestures and utterances remain
outside fitting for the new comparison. All sibling variants share a fold.
Previously inspected evaluation and private wake requests remain excluded from
fitting and are reported as reviewed regressions. Recipes and approved prompt
wording are unchanged; this revision does not add runtime routing rules.
