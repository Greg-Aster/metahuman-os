# Models and learning

[Roles and providers](#roles-backends-and-delegated-computer-work) · [Learning](#learning-and-personalization) · [Learned persona](#intended-model-specialization-and-learned-persona) · [Training by mode](#conversational-training-by-cognitive-mode)

[Start with the robot design core](ROBOT_BIBLE.md). Read this for role separation, model selection, learning and persona-review intent.

[Model roles](../../packages/core/src/model-roles.ts) own category definitions;
[specialist training](../../brain/training/environment-action-selector/README.md)
and existing Core training owners retain their executable contracts.

This page states the maintained capability contract. It does not report current
service state, selected weights or installed firmware. Use the linked owners for
configuration and [qualification](QUALIFICATION.md) for proof of behavior.
Dated deployments, comparisons and incidents are retained in the
reference history (retained locally).
A historical success or failure is evidence under its recorded conditions;
refresh those conditions before treating it as the present state.

## Models and learning

### Roles, backends, and delegated computer work

The status widget assigns concrete models/deployments and adapters to categories for the selected profile and cognitive mode. Each category selects its base deployment once. The adjacent LoRA checkbox reveals a separate dropdown of adapters for that base; clearing it selects the plain base through the same Model Registry owner. Multiple adapter assignments share a base deployment rather than representing separate copies of its weights. Providers and serving endpoints remain distinct choices. Model-calling graph nodes select the category they need; [the shared role catalog](../../packages/core/src/model-roles.ts) and Model Registry/Router own resolution. “Model Role” is the existing UI/API name for this category. Model assignments are configurable installation state, not permanent aspects of Ainekio's personality or abilities. Application startup starts only llama.cpp listeners required by the effective Status assignments, without loading weights. Deployment defaults and unassigned inventory cannot replace those assignments. The bundled embedding service starts unloaded and follows the assigned Embedder on actual requests. The selected role's actual inference request loads its configured deployment and adapters; native llama.cpp unloads idle weights after the configured interval (five minutes on this installation). Inventory and assignment do not run warmup inference. Systemd and `bin/llama-cpp-services` own process lifetime; Model Registry/Router own selection, and llama.cpp owns weight residency.

Category names, internal IDs and descriptions are maintained once in the
[shared role catalog](../../packages/core/src/model-roles.ts), which the widget
and node selectors consume. Read it for the current definitions; a prose copy
here would become a second catalog.

The same deployment may serve several categories, and different cognitive modes may assign different deployments to one category. The canonical Orchestrator replaces the former separate `environmentIntent` setting; the registry migration preserves the existing Intent assignment for each mode, including explicit disabled assignments and inherited defaults. Intent and Task have separate responsibilities and qualification, even when they share a base deployment. Renaming a category neither retrains nor qualifies a model for new responsibilities.

Complex planning, independent review and conversational personality are not generic orchestration. Selecting Persona does not automatically load the entire persona; selected context remains a graph responsibility. Selecting Psychotherapist for Desire review does not grant the Desire Agent persona-editing authority. Image input retains the selected category and its assigned provider; the router does not silently substitute Orchestrator for an incompatible image request. The existing provider capability contract reports unsupported input.

Available backends and deployments come from the existing backend and registry
owners. Small trained specialists can handle lighter tasks while a suitable model
handles conversation or demanding planning. The Environment graph can select
visual planning instead of the text specialist; a larger-model delegation is an
additional selected planning call, not evidence that the resulting plan is correct.

**Local model residency — owner intent, 2026-10-23:** Starting MetaHuman starts the configured llama.cpp listeners without loading model weights into GPU memory. A chat message or agent inference request loads the model selected through its category; local deployments retain GPU execution. The model stays resident while in use and unloads after five minutes without inference work, or when its service is closed. The next request reloads it, so that request includes cold-loading latency. Health checks and opening the model inventory must not keep models resident. Shared adapters use their shared base deployment. Voice, Body Control and other applications retain their own service lifecycles. llama.cpp owns native on-demand loading and idle sleep; MetaHuman does not maintain a second residency scheduler. Measured unloading, remaining CUDA allocation and allocation failures are
retained in the residency history (retained locally);
on-demand loading does not guarantee simultaneous workloads fit.

**Big Brother has two relevant uses:** it is a selectable provider deployment for individual roles, and its terminal/tool workflows can perform delegated computer work or diagnostics. Selecting it for Persona does not replace Intent, Task or Vision. A delegated tool submission is not its completed answer; the eventual result returns through the existing conversation/delivery path. Diagnostic terminal work is also distinct from ordinary chat. See [Big Brother](../technical/BIG_BROTHER.md), with dated routing discrepancies retained in the historical comparison (retained locally).

Ordinary Codex-backed model calls preserve graph message roles and image positions through the existing terminal owner. The graph's system instructions form the model's base instructions; repository coding instructions, Codex personal memories and skills are not automatically included. Diagnostic and delegated computer-work sessions keep their existing agent context.

Reasoning is configurable on supported model-calling nodes and mapped through provider settings. Full Autonomy assessments request high reasoning; Semi assessments and ordinary operational calls request none under the owner's October 26 policy. The controller mode connects to the existing Model Router's reasoning input without adding an inference call. Its effects on quality and latency require measurement for the actual model/backend. There is no permanently fastest or universally correct model encoded by this reference. Backend context capacity/cache allocation is working memory for inference, not durable conversation storage.

### Learning and personalization

The intended learning loop is **original inputs and outputs + separately attributed outcomes → review/curation and corrections → training data → fitting → independent evaluation → authorized activation → observed behavior**. Saving an example, finishing training, and improving the robot are different achievements.

### Intended model specialization and learned persona

The intended local architecture uses trained specialists for Intent and
Task decisions, with suitable models for conversation and higher functions.
Specialist size is not a permanent architectural requirement: the Owner
authorized separately evaluated replacements. Failures can motivate reviewed
LoRA training or fine-tuning. A larger or delegated model can investigate a
failure without proving that training repaired the intended deployment.

The October model history (retained locally)
preserves the 0.8B/2B/9B choices, precision changes, on-demand vision design,
evaluations and activation evidence. Resolve current artifacts, assignments,
reasoning settings and residency through the Model Registry, graphs and
existing service owners. Do not maintain a second live configuration here.

Future manually triggered Environment specialist retraining uses the selected adapter's recorded base and native checkpoint stage through the existing trainer. Activation uses that base's existing shared service and preserves the paired adapter. A selectable or newly fitted artifact is not implicitly qualified for production.

The current prompt-based persona is a bootstrap placeholder. Environment conversations should supply reviewed Ainekio replies for training a persistent persona in the conversational model's weights or LoRA. The intended result is learned identity, expression and personality: Ainekio should no longer need the full persona description injected into every conversational request to express who it is.

As enough suitable conversational data accumulates, the existing personalization pipeline should train and evaluate that persona, then the existing serving/configuration owners should activate it and retire the redundant persona-prompt dependency. This concerns the persona description; current requests, selected memories, robot status and task/tool instructions still provide information appropriate to each operation. The learned persona can continue improving through later reviewed training cycles. This entry records the intended development direction; it does not claim that a persona adapter has been trained or that persona prompts have already been removed.

Two related learning paths exist: profile personalization from reviewed memories/persona material, and Environment specialist training from recorded Intent/Task decisions and corrections. Freestyle also has decision recording; this does not establish a qualified V2 generator. Training owners preserve artifact identity and evaluation evidence; model-role assignment owns which artifact serves a request. Evaluation/regression/private diagnostic cases remain separate from fitting and checkpoint selection.

The Environment training evidence reader now supplies the original admitted request, ordered execution evidence, current objective state and saved decision identities to its existing Curator workflow. Repeated observations use the existing lossless initial-observation/change representation with recorded image times. This connects the decision to its consequences without creating a second recorder, treating action receipts as goal success, or automatically approving the output for training. A curator verdict, independent evaluation and model-owner activation remain distinct steps. No new adapter is implied by this evidence repair.

### Conversational training by cognitive mode

**Owner-confirmed intended behavior, 2026-10-14:** retain Ainekio's conversational replies as learning material. The cognitive mode in which the conversation occurred determines whose reply is the personalization target:

| Recorded cognitive mode | Reply to learn | Purpose |
| --- | --- | --- |
| Dual Consciousness | Greg's human reply | Learn the human's expression and response patterns from their own contributions. |
| Environment | Ainekio's assistant reply | Improve the robot companion's conversational responses from its reviewed interactions. |

Saved conversational records must preserve their originating cognitive mode, actual speaker/role, and the relationship between the request and its replies. Curation and dataset construction must carry this attribution forward so the trainer selects the intended author's response. The UI mode selected later, or one profile-wide target-author setting, must not reinterpret the authorship or training purpose of earlier records. Both sides remain available as attributed context; choosing a training target does not relabel who originally spoke.

Background-generated memories retain the actual cognitive mode at work admission
through Sleep stages and worker retries. Internal Agent-mode execution is a
separate fact. Records without recorded origin stay unattributed. Qualification
must trace that provenance into the saved memory and the selected training target.

This decision concerns conversational personalization. Intent and Task decision records retain their separate specialist review and training path. Retaining an Ainekio reply does not certify its correctness: the existing curation/correction and independent evaluation stages still apply. Agent and Emulation mode training policies were not specified by this clarification and must not be inferred from these two mappings.

Asynchronous replies retain an explicit link to the original user message,
independently of each message's idempotency identity. Multiple replies can have
separate review acknowledgments for the same request. Curator and training readers
use the exact request/reply pair and its review, rather than assuming that nearby
messages or node occurrences form a reviewed conversation.

**Owner-confirmed persona-review subject:** develop Ainekio's own personality while retaining facts about Greg as separately attributed memories. Learning whose reply style to imitate for a particular cognitive mode does not relabel that person's circumstances as the companion's identity. The approved review repair supplies the existing subject identity and each record's saved cognitive mode, alongside its speaker/source. It does not introduce hardcoded names, preferred traits or example-driven behavior rules. The assigned reviewer requires model-quality qualification with that attributed evidence.

Current instructions, training labels, precision, decoding constraints, backend templates and artifact conversion can all affect behavior. Comparisons must hold relevant conditions constant and inspect selected actions, not just fluent text or structurally valid JSON. Better aggregate scores do not erase meaningful new movement, silence, grounding, or continuation failures.

Sources: [specialist training](../../brain/training/environment-action-selector/README.md), [training configuration](../../packages/core/src/training-config.ts), [training dataset owner](../../packages/core/src/training-dataset.ts), [model router](../../packages/core/src/model-router.ts), [backend owner](../../packages/core/src/llm-backend.ts). Dated assignments and earlier measurements are preserved in the historical diary (retained locally), not presented as fresh live verification.
