# Robot Operator Motion-Control Progress

## Purpose

This document is the maintained work record for Robot Operator motion-control
diagnosis, software-only safety improvements, latency reduction, and eventual
camera-feedback control. Update it when an implementation step is started,
completed, validated, reverted, or materially redesigned.

Status reviewed: 2026-08-31. The latest recorded implementation evidence in
this ledger is dated 2026-08-22. This documentation cleanup does not establish
later live-runtime, camera, network, or physical-motion behavior.

This is a progress record, not a competing architecture authority. The broader
mode philosophy and implementation sequence remain in
`docs/implementation-plans/robot-active-operator-roadmap.md`. Environment Mode
latency work remains in `docs/technical/environment-mode-performance.md`.

### Long-term product intent

Ainekio V1 is the first embodiment of an **intelligent pet**, not the final
robot architecture. The intended system should support a persistent character
that can perceive, remember, express itself, investigate, follow, approach,
play, and interact through only the skills and physical capabilities its
current body truthfully provides.

MetaHuman owns personality, memory, social context, curiosity, semantic
intentions, and authorization. The Ainekio embodied runtime owns perception,
state estimation, skill execution, locomotion, recovery, and hardware safety.
Those layers must evolve independently: adding an IMU, feedback servos, contact
sensors, a richer body, or a trained motion policy should replace or extend a
body-side component without requiring the pet cognition, Environment Bridge,
or semantic skill contracts to be rebuilt.

Autonomous operation is part of that product intent. Subject to the selected
Active Operator mode, MetaHuman may combine a fresh, correlated environmental
photo or sensor event with bounded relevant context from the existing memory
owners to choose a high-level activity. Memory may influence attention,
preference, curiosity, and semantic intention, but it is not current sensor
truth or physical authorization. The governing mode, observation, memory, and
future-body contract lives in the **Intended Intelligent-Pet Operating Model**
section of `docs/implementation-plans/robot-active-operator-roadmap.md`; this
motion record must implement its body-side seam rather than duplicate its
autonomy policy or memory system.

V1 should therefore produce more than a demonstration. It should establish
truthful state and capability contracts, replaceable controller boundaries,
timestamped replay data, independent safety ownership, and simulator seams
that can support later learned policies. Forward compatibility does not mean
inventing unused abstractions or advertising future capability now; it means
keeping the stable semantic, state, control, and hardware boundaries explicit.

## Update Rules

- Separate observations, proposals, implemented changes, and validated results.
- Never mark an item complete from a source edit alone. Record its focused test
  evidence and, when relevant, its physical-robot result.
- Record measured values with the date and test conditions. Do not silently
  replace an older result with a newer one.
- Do not paste private conversation, profile data, images, credentials, local
  absolute paths, or full runtime logs into this remote-safe record.
- Do not add scene-specific rules for particular objects, rooms, walls, phrases,
  or motions. Corrections must be capability- and evidence-driven.
- Treat removability as an acceptance requirement, not a later cleanup task.
  Every implementation batch must identify its owned module, shared integration
  points, dependencies, runtime artifacts, and exact removal path before it is
  marked implemented.
- Preserve the existing owners: Robot Operator admits embodied work and owns
  the high-level decision; Environment Mode owns execution and refinement;
  Environment Bridge transports actions and observations; Environment Task
  Validator currently owns completion while `ROM-20` consolidates that
  responsibility into a smaller deterministic lifecycle/result boundary.

## Status Vocabulary

- `not_started`: agreed work with no implementation in progress.
- `in_progress`: implementation or validation is actively underway.
- `implemented`: source changes exist, but all acceptance evidence is not yet
  complete.
- `validated`: focused automated acceptance and required physical acceptance
  have passed.
- `blocked`: progress requires a named external dependency or decision.
- `deferred`: intentionally postponed with a recorded reason.

## 2026-08-04 Baseline Observation

Status: observed and documented; corrective implementation not started in this
work record.

A manually triggered Robot Observer cycle selected the objective of moving
closer to an observed object for a better view. The robot repeatedly executed
generated open-loop motion but did not make useful progress toward the visual
objective.

### Measured execution

| Measurement | Result |
| --- | ---: |
| Complete bounded cycle | approximately 5 minutes 30 seconds |
| LLM calls | 28 |
| Combined LLM latency | 254.7 seconds |
| Total model tokens | 70,164 |
| Prompt tokens | 64,681 |
| Completion tokens | 5,483 |
| Image-bearing model calls | 16 |
| Image-bearing model latency | 164.6 seconds |
| Generated motion plans | 4 |
| Identical generated plans | 3 of 4 |
| Duration encoded in each motion plan | 8 seconds |

The cycle ended at its fifth lifecycle step with a request for user guidance;
it did not leave an infinite queue. The bounded lifecycle worked as a final
backstop, but it permitted several expensive attempts without meaningful
progress.

### LLM critical path

The cycle performed one initial Robot Operator vision decision, then repeatedly
executed two Environment Mode passes around each physical attempt:

```text
Context Router LLM
  -> Environment LLM
  -> Movement Generator LLM
  -> open-loop physical motion
  -> Context Router LLM
  -> Environment LLM
  -> Visual Evidence Assessor LLM
  -> Task Refiner LLM
  -> next attempt
```

Routine buffer and graph bookkeeping were not the material latency source. The
dominant cost was serial model inference, especially repeated image-bearing
calls and repeated prompt ingestion.

### Capability and control findings

- The connected robot advertised camera capture, named robot commands, and
  `robotMotionPlan`. It did not advertise mapping or target-aware navigation.
- `robotMotionPlan` currently permits a generated joint trajectory whenever
  that action type is advertised. The action boundary does not distinguish
  body-local expressive motion from target-relative locomotion.
- Each generated plan ran open loop. A fresh correlated image was assessed only
  after the full physical plan, too late to steer or stop during approach.
- Controller completion proved that the trajectory ran. It did not prove that
  the robot changed position, approached the target, avoided an obstacle, or
  improved the view.
- The visual validator correctly rejected unsupported whole-objective
  completion. The later refiner nevertheless restated the same strategy, and
  the Movement Generator produced the same plan three times.
- No structured target bearing, target scale, displacement, obstacle clearance,
  plan-repetition, or progress signal existed for the validator to consume.
- The initial camera command took approximately 10.5 seconds from queueing to
  completion. Its configured ten-second value is a dispatch-freshness window,
  not a desired acquisition latency. Stage-level timing is required before
  assigning that delay to the bridge, gateway, camera, or feedback path.

## Diagnosis

The LLM workflow is being used as a low-frequency locomotion controller. It has
semantic intent and intermittent images, but no continuous estimate of the
target, robot displacement, free path, or physical progress. Rewording the
objective cannot supply those missing control signals.

The immediate architectural defect is capability conflation:
`robotMotionPlan` means that the body can execute a bounded joint trajectory;
it must not imply that the system can navigate toward an environmental target.

The performance defect is repeated deliberation on known lifecycle state. A
persisted continuation already has an objective, route, completion basis, and
correlation identity, yet routine continuation and terminal-feedback passes
reinvoke several models before the next physical step.

## 2026-08-04 Evaluator and Refiner Technical-Debt Audit

Status: measured; retirement target defined; runtime removal not yet started.

### Verdict

The evaluator was not useless in every respect. It correctly prevented a
fresh-image objective from being declared complete merely because an open-loop
motion command finished, and its step limit prevented an infinite retry loop.
Those protections are worth preserving.

It is nevertheless the wrong mechanism for making a robot reach a target. It
is a **judge and retry pipeline**, not a feedback controller. It cannot create
target bearing, target scale, displacement, clearance, joint state, or
odometry. When evidence was inadequate, it paid another vision-model call to
say so, paid another model to rewrite the instruction, and queued the whole
Environment graph again. The measured run demonstrated the failure mode: the
validator rejected false completion correctly, but the next attempt repeated
essentially the same open-loop plan.

The debt is downstream of the now-separated autonomy graphs. The current Robot
Operator graph has 12 nodes and 16 edges and alone can dispatch authorized work
to Environment Mode. The Boredom Movement graph has 10 nodes and 12 edges and
does not contain that dispatch. The evaluator/refiner complexity lives in the
shared Environment execution graph after Robot Operator delegates a goal; it
should not be copied into either specialized autonomy graph.

### Measured change surface

The comparison point is the parent of commit `bb35f2ce`, immediately before the
five evaluator-era Environment nodes were added, through current `HEAD`:

| Measurement | Before evaluator | Current `HEAD` | Change |
| --- | ---: | ---: | ---: |
| Environment graph nodes | 24 | 29 | +5 |
| Environment graph edges | 47 | 77 | +30 |
| Inserted lines in the maintained Environment surface | - | 5,000 | 2,695 production/config and 2,305 tests |
| Removed lines in that comparison | - | 148 | - |

The five added nodes are `Visual Evidence Assessor`, `Task Contract`, `Task
Validator`, `Task Refiner`, and `Workflow Command`. Their current source files
contain 1,779 lines. This count does not include graph JSON, shared helpers, or
their 2,331 lines of direct validator/contract tests.

The uncommitted motion-control work in the same surface is also material. At
the time of this audit it contains 1,726 tracked insertions and 124 tracked
deletions, plus 603 lines in four untracked timing/visual-approach source and
test files. Split by responsibility, that is 1,176 added production lines and
1,153 added test lines. Tests are not a runtime latency source, but their size
is evidence of the number of states and contracts future changes must preserve.

### Actual model-call amplification

The graph visibly contains the Context Router and Environment LLM. Three nodes
that appear as ordinary Environment nodes also call a model internally:

- Visual Evidence Assessor performs another multimodal judgment against the
  correlated frame after a completed visual step or completion claim.
- Task Refiner performs another multimodal or text judgment to rewrite the next
  instruction after the Validator reports incomplete work.
- Movement Generator performs another model call when an admitted body-local
  movement needs a generated joint plan.

For target-relative work, one incomplete physical attempt can therefore pass
through Context Router, Environment LLM, Movement Generator, Visual Evidence
Assessor, and Task Refiner serially. Workflow Command then schedules another
full Environment pass. This is the direct explanation for the 28 model calls,
70,164 tokens, and approximately five-and-a-half-minute baseline. The
deterministic nodes add maintenance complexity, but repeated model inference is
the dominant wall-clock cost.

### Keep, consolidate, or retire

| Existing responsibility | Decision | Reason |
| --- | --- | --- |
| Capability admission at the action boundary | Keep | Rejecting a capability the adapter does not truthfully advertise prevents invalid or unsafe dispatch. |
| Action/cycle/frame correlation and freshness | Keep | This is how the system knows which physical result and image belong to which request. |
| Stop, cancellation, stale-input handling, and a bounded execution budget | Keep | These are interruption and containment contracts, not a substitute for goal-seeking control. |
| Stable objective and required completion basis | Keep, then consolidate | A model must not silently change the task or what counts as success. The contract does not require its own long-lived graph node once a smaller deterministic reducer owns it. |
| Typed progress and terminal outcomes | Keep | `accepted`, progress, `succeeded`, `failed`, `cancelled`, and explicit reasons are the useful bridge between MetaHuman and a local skill. |
| Independent Visual Evidence Assessor LLM | Retire from robot skills | It duplicates semantic image judgment after the Environment model and arrives too late to steer movement. Local perception and skill-specific verification should return measured evidence. |
| Task Refiner LLM | Retire from robot skills | Rewording an objective cannot supply missing sensor feedback and should not be the physical retry controller. |
| Workflow Command self-requeue | Retire from robot skills | Each retry reopens the full cognitive workflow. The admitted local skill should own its bounded feedback loop and return one terminal result. |
| Task Validator as a 622-line policy owner | Reduce to a deterministic result/admission reducer | It currently owns action admission, completion, generated motion, visual assessment, stuck state, task contracts, and retry policy. Those concerns belong at distinct action, skill, and result boundaries. |
| Movement Generator for locomotion | Exclude | It may remain for explicitly requested body-local expressive motion, but it must never generate target-relative walking or substitute for a locomotion controller. |
| Context Router on typed Robot Operator delegation | Bypass deterministically | Robot Operator has already supplied a typed intention and action requirement. Reclassifying that same delegation with another LLM adds latency and a second authority decision. |

### Simplified execution target

```text
Robot Observer image
  -> Robot Operator LLM: choose one semantic intention
  -> deterministic delegated-work route
  -> Environment LLM: select one advertised semantic skill
  -> action admission
  -> Ainekio Embodied Skill Runtime
       acquire/track -> choose bounded body primitive -> observe -> correct
       publish sparse progress and respond immediately to cancellation
  -> one correlated terminal result and best fresh evidence
  -> deterministic lifecycle/result reducer
  -> optional user-facing response
```

There must be no LLM call inside the local acquire/track/correct loop. A skill
may take many camera frames and body corrections without creating more
MetaHuman graph passes. A terminal result can be presented directly or phrased
once; it must not invoke an assessor, refiner, and workflow requeue.

This follows the established [ROS 2 action](https://docs.ros.org/en/rolling/Concepts/Basic/About-Actions.html)
pattern without requiring an immediate ROS installation: a long-running goal
has admission, progress, cancellation, and one result. The existing Environment
Interface already has most of that transport shape. Use maintained perception
and control libraries inside the skill, while keeping the
MetaHuman/Ainekio-specific state machine as small integration glue.

[BehaviorTree.CPP](https://www.behaviortree.dev/) and
[`py_trees`](https://py-trees.readthedocs.io/en/devel/introduction.html) remain
valid later candidates when several skills share recoveries and asynchronous
sub-behaviors. They are deliberately not selected for the first `inspect`
skill. Adding another tree framework now would reproduce the graph complexity
being removed; the initial skill has a small explicit lifecycle and no
installed ROS or behavior-tree runtime on the companion host.

### Retirement sequence and acceptance

1. Freeze evaluator/refiner expansion. Do not add new completion cases, retry
   policy, or physical state to those nodes.
2. Finish the adapter-owned skill goal/progress/result/cancel contract and the
   recorded-frame replay lane before removing the old backstop.
3. Route the first admitted `inspect` skill around Visual Evidence Assessor,
   Task Refiner, Workflow Command, and Movement Generator. The local skill owns
   reacquisition and bounded correction.
4. Reduce Task Validator to deterministic admission/result reduction, then fold
   the stable task contract into that boundary if doing so preserves the same
   typed objective and evidence semantics.
5. Delete unreachable nodes, graph edges, prompts, metadata envelopes, and
   tests rather than leaving compatibility copies in place.
6. Compare the same bounded objective before and after retirement.

The retirement is accepted only when a Robot Operator investigation uses at
most one Robot Operator decision and one Environment planning call before
dispatch, uses zero model calls while the skill is running, preserves immediate
cancel/stop behavior, returns correlated typed progress and one terminal
result, and removes automatic robot-skill refinement/requeue. Call count,
tokens, dispatch latency, control cadence, and total task time must be recorded,
not inferred.

## Target Software Architecture

No new physical parts are required for the first implementation stages. The
existing camera can support a conservative proof-of-concept feedback skill,
but camera-only operation must not be represented as guaranteed collision-free
navigation.

```text
Robot Operator Mode
  -> chooses one semantic objective
  -> Environment Mode checks the required advertised capability
  -> body-local motion OR visual-approach skill

visual-approach skill
  -> initial target specification
  -> camera frame
  -> lightweight target tracker
  -> one bounded body-owned movement primitive
  -> structured progress / reached / lost / blocked / stuck feedback
  -> repeat locally without conversational LLM calls

terminal typed result
  -> deterministic Environment result reducer
  -> optional semantic reconsideration only after a terminal result and
     genuinely new evidence, never as an automatic physical retry loop
```

The public capability contract is `motionClasses`, with `target_relative` used
for an adapter-owned feedback skill or navigation implementation. A future
`visual-approach` skill may implement that capability, but its implementation
name is not treated as full navigation or as a second dispatch path.

### Build forward from the current V1 robot

The current eight-servo, camera-equipped Ainekio robot is the supported V1 body
and the starting point for the intelligent-pet system. It is not a disposable
mock whose interfaces may be abandoned when a more capable body exists. The
existing semantic commands, motion assets, camera path, adapter, protocol,
Environment Bridge, emulator seams, and physical acceptance evidence should be
preserved and improved as the robot gains feedback and autonomy.

Development should be additive and replace components behind stable contracts:

```text
MetaHuman pet cognition
  personality / memory / social context / curiosity
  -> semantic skill goal such as inspect, follow, come, look, or play

Ainekio Embodied Skill Runtime
  target state / skill lifecycle / progress / recovery
  -> BodyMotionCommand

replaceable LocomotionBackend
  V1 Primitive Backend
    -> existing calibrated named commands and motion assets
  V1 Feedback Backend
    -> camera/state error selects bounded V1 primitives
  future Learned Policy Backend
    -> trained Ainekio policy produces bounded actuator targets

independent Safety Supervisor
  -> validates freshness, limits, stop, and body health
  -> actuator driver / firmware / eight-servo V1 body
```

The V1 Primitive Backend remains a supported fallback and test oracle after a
feedback or learned backend exists. A later policy may improve how motion is
produced, but it must not require Robot Operator, Environment Mode, the skill
API, or the bridge transport to understand its internal tensors or joint
control method.

#### Stable motion-policy contracts

The controller seam should remain small and versioned:

- `BodyMotionCommand` expresses a desired body outcome such as bounded forward
  motion, yaw rate/change, posture, or gait plus duration, limits, and a
  `validUntil` deadline. V1 may quantize it to a named primitive; it is not an
  unrestricted servo command from an LLM.
- `RobotStateSnapshot` carries timestamped, source-labelled observations and an
  explicit validity/capability mask. Commanded servo positions available in V1
  remain named `commanded`, never misrepresented as measured joint state.
- `LocomotionBackend.step(command, state, previousAction)` returns bounded
  `ActuatorTargets` or a typed unavailable/fault result. Primitive,
  deterministic-feedback, and learned implementations use the same ownership
  boundary even when their internal update rates differ.
- `MotionPolicyManifest` records the schema version, required sensors, exact
  input/output ordering, units, normalization, expected control frequency,
  action bounds, training/simulator version, artifact digest, and safe fallback.
- The Safety Supervisor remains outside every backend so replacing a controller
  cannot replace stop, watchdog, actuator-limit, stale-state, or fault handling.

`RobotStateSnapshot` may grow through truthful optional observations such as
camera-derived target error, calibrated camera pose, IMU orientation/angular
velocity, measured joint position/velocity, foot contact/load, range/depth,
bump/cliff state, battery, and controller health. A trained policy may use only
the sensors declared in its manifest. Missing inputs remain unavailable; the
system must never fabricate joint feedback, clearance, or pose so a policy can
run.

#### Controller evolution without an overhaul

The first active-view controller should use measured image error and calibrated
V1 primitives. It should implement the same command/state/result seam intended
for a later model and log every input, output, timestamp, correction, terminal
reason, and safety intervention. That creates replay fixtures and body-response
measurements now while solving a useful V1 skill.

When hardware feedback is added, the same V1 body can gain an IMU, measured
joint state or feedback servos, contact/load sensing, and range/depth evidence
incrementally. The state estimator and capability advertisement expand; pet
cognition and skill contracts do not change merely because new observations
become available.

A later Ainekio-specific locomotion policy can be trained in a maintained
robot-learning framework such as [Isaac Lab](https://isaac-sim.github.io/IsaacLab/main/index.html)
with [RSL-RL](https://github.com/leggedrobotics/rsl_rl), then exported with its
deployment semantics to ONNX or another measured runtime artifact. Training
requires a calibrated digital twin and consistency between simulated and real
observations, dynamics, output processing, and control rate. The project should
retain the exported preprocessing, action postprocessing, and recurrent/last-
action state rather than reconstructing those details in adapter glue; Isaac
Lab's [LEAPP export path](https://isaac-sim.github.io/IsaacLab/release/3.0.0-beta2/source/policy_deployment/05_leapp/exporting_policies_with_leapp.html)
is one maintained reference for packaging those semantics.

The learned backend must first run in replay and simulator acceptance, then in
shadow mode where it proposes but does not control motion, and finally in
explicitly authorized bounded physical trials. A policy trained on fabricated
state, an inaccurate simulator, or a different robot embodiment is not an
upgrade path. A large vision-language-action model is also not the default
locomotion controller; semantic intelligence and fast body control remain
separate unless later evidence justifies a different boundary.

## Preserved MetaHuman Decision Architecture

The Environment Mode graph and its decision lifecycle remain useful. The
architectural correction is not to replace them with a robotics stack; it is to
stop asking them to operate as the robotics feedback loop.

```text
fresh observation or user objective
  -> Robot Operator / authorized autonomy policy chooses an intention
  -> Environment Mode selects and admits a semantic robot skill
  -> stable task contract records target, limits, and completion basis
  -> Environment Bridge sends one typed skill request
  -> Ainekio Embodied Skill Runtime executes the fast closed loop
       -> body primitive -> sensors/image -> state estimate -> correction
       -> repeats locally within the admitted limits
       -> emits milestone, evidence, stop, and terminal events
  -> deterministic Environment result reducer records the typed result
  -> Environment Mode or Robot Operator reasons again only when needed
```

The stable task contract and result reducer are responsibilities, not a
requirement to retain the current separate Task Contract and Task Validator
graph nodes in their present form.

For example, the LLM should not choose `walk`, wait, inspect a photograph, and
choose `walk` again. It should request a semantic outcome such as "inspect this
object" or "approach this tracked object." The body-side runtime may use
several constrained walk/turn primitives, images, tracker updates, and stop
checks to fulfill that one request.

The proposed **Embodied Skill Runtime** is a working name for a new component
behind the existing Ainekio adapter boundary. It is not a new MetaHuman agent,
cognitive graph, queue, bridge, validator, or source of autonomous goals. Its
public surface is a typed skill request plus correlated progress, evidence,
cancel, and terminal-result events over the existing Environment Interface.

Progress should return to MetaHuman when it is useful for observability,
conversation, interruption, authorization, or strategy—not on every camera
frame. Normal internal corrections stay local. A terminal `lost`, `blocked`,
`stuck`, `stopped`, `failed`, or `succeeded` result returns to the existing
Validator. A nonterminal milestone may update the coordinator and UI without
starting another LLM graph pass.

### Robot Observer and Boredom Movement boundary

In the maintained 2026-08-04 implementation, the autonomous workflow that can
look at a current image, choose an intention such as investigating an object,
and delegate that intention to Environment Mode is **Robot Observer -> Robot
Operator Mode**. The separately triggered **Boredom Movement** agent currently
performs one allowlisted stationary movement first, takes one correlated image,
and runs a reflection-only Boredom Movement graph; that graph intentionally has
no Environment delegation output.

If product policy should allow a boredom-triggered observation to begin an
investigation, that should be an explicit autonomous-admission change: hand the
fresh observation to Robot Operator (or a future single Full-mode policy owner)
and then use the same Environment Mode -> Embodied Skill Runtime path. Do not
put action planning back into the reflection-only Boredom Movement graph or
give the boredom timer its own robot-control loop.

Longer term, an authorized Full-mode policy may use a fresh Robot Observer image,
relevant bounded memory, current task state, and body capabilities to select an
investigation or another useful activity. That high-level choice still enters
the same Environment Mode -> Embodied Skill Runtime path. Memory, an interesting
image, or a detector label may make an activity worth considering, but none of
them bypasses mode admission, action authorization, capability truth, or safety.

A request such as `find a cat` also exposes a skill boundary that the current
`inspect` lane does not by itself satisfy. `inspect` improves and verifies the
view of a subject already present in a fresh frame. A bounded future object-
search or investigation skill must own the local scan, reacquisition, and, when
truthful clearance and locomotion capabilities exist, approach loop. It should
return progress and one terminal result without converting each V1 quadruped
turn, walk asset, or photo into another MetaHuman graph pass. The semantic goal
and result remain valid if a future body performs those corrections through a
different locomotion backend.

## Expanded Goal: Object-Centered Robot Skills

Stopping repeated failed movement is necessary, but it is not the end goal. The
system should be able to identify an object, preserve that object's identity
across fresh frames, move relative to it, perform only interactions the body can
actually execute, and verify the physical result.

### Control-priority correction

The first motion-control implementation emphasis was incomplete. Expiration,
duplicate-plan rejection, stale-frame rejection, cancellation, and stop behavior
are safety and lifecycle facilities. They do not estimate the target, choose an
informative next view, reduce target error, or recover the objective. Treating
those facilities as the controller would create an elaborate shutdown system
that can only inhibit the robot.

The objective-achievement owner must instead be an active perception and skill
controller. Its normal path is:

```text
acquire target
  -> preserve target identity across a local frame stream
  -> estimate image error and view quality
  -> select one body-owned action expected to improve the objective
  -> observe while or immediately after the action
  -> correct, reacquire, change viewpoint, verify, or complete
```

The independent safety monitor may interrupt that path when evidence is stale,
the robot is cancelled, or a body fault is reported. It is subordinate to the
goal controller and is not itself evidence that a useful skill exists. Weak or
temporarily lost visual evidence should normally enter bounded reacquisition,
not immediately become terminal failure.

This should extend the current control architecture rather than add more
conversational reasoning to the inner loop:

```text
MetaHuman semantic layer (slow, event driven)
  -> choose objective, target description, and allowed interaction
  -> admit one typed object-centered skill

Ainekio Embodied Skill Runtime behind the adapter
  (fast, deterministic, feedback driven)
  -> detect / select / track / localize target
  -> check free space and body capability
  -> run bounded visual approach or interaction stages
  -> verify each stage from sensors and controller feedback

Body controller / firmware layer (fastest, hardware owned)
  -> execute calibrated primitives or joint trajectories
  -> report measured completion, interruption, fault, and stop state

terminal typed result
  -> deterministic Environment result reducer
  -> Robot Operator receives a concise outcome and new evidence
```

The LLM may decide *what* object matters and *what* skill to request. It must
not assign track identities frame by frame, generate velocity commands, decide
collision clearance, or repeatedly judge whether a motor step worked.

### Established building blocks to adapt

The project does not need to invent standard robotics concepts, and it does not
need to adopt ROS as a runtime dependency merely to learn from its contracts.
The following are reference designs and candidate libraries, not preselected
dependencies:

| Need | Established reference | MetaHuman/Ainekio adaptation |
| --- | --- | --- |
| Frame-bound object detections | ROS [`vision_msgs/Detection2D`](https://docs.ros.org/en/iron/p/vision_msgs/interfaces/msg/Detection2D.html) carries hypotheses, a 2D box, a source-frame header, and an optional cross-message id. | Add a small typed object-observation contract with exact frame identity, class hypotheses, confidence, box, and adapter-issued track id. Do not send raw detector-specific output through the cognitive graph. |
| Portable inference | [OpenCV DNN](https://docs.opencv.org/5.0/tutorials/tutorials.html) and [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/) support model inference across CPU and available accelerators. | Keep the detector behind an adapter interface. Select and benchmark a model on the actual Ainekio compute target instead of coupling the public contract to YOLO, a model size, or one accelerator. |
| Short-horizon tracking | [OpenCV tracking and optical-flow APIs](https://docs.opencv.org/5.0/main_modules/video_track.html) provide lightweight trackers, optical flow, and Kalman filtering. | Run detection periodically and tracking on intervening frames. The track manager owns association, confidence decay, occlusion, loss, and reacquisition without an LLM call. |
| Controlled visual alignment and approach | [ViSP](https://github.com/lagadic/visp) provides visual tracking and visual-servo control-law building blocks. | Begin with an image-based error from target-box center and scale, mapped to calibrated, bounded body primitives. Evaluate ViSP concepts or code where platform-compatible; do not emit unconstrained servo values from MetaHuman. |
| Deterministic navigation and recovery | [Nav2 behavior trees](https://docs.nav2.org/behavior_trees/) separate planning, following, recovery, and status, while [Collision Monitor](https://docs.nav2.org/configuration/packages/configuring-collision-monitor.html) independently filters motion from fresh sensor data. | Use the same separation of concerns for local skills. Import or bridge Nav2 only if the body gains the localization, maps, odometry, and obstacle sensors needed to advertise truthful navigation. Safety remains below the semantic planner. |
| Manipulation planning | [MoveIt Planning Scene](https://moveit.picknik.ai/main/api/html/planning_scene_overview.html) models robot state and world geometry for constraints and collision checks; [MoveIt Task Constructor](https://moveit.picknik.ai/main/doc/concepts/moveit_task_constructor/moveit_task_constructor.html) composes manipulation into explicit stages. | If a supported arm or end effector exists, expose adapter-owned staged skills such as reach, grasp, lift, place, or push. Do not advertise them from a camera and locomotion capability alone. |
| Repeatable calibration targets | [AprilTag](https://github.com/AprilRobotics/apriltag) supplies fiducial detection and pose estimation. | Use tagged test objects as a deterministic calibration and regression lane before relying on open-vocabulary object detection. Tags supplement general perception; they do not become a production requirement. |

### The pattern across existing reactive machines

Drones, robot vacuums, quadrupeds, tracking cameras, toys, and industrial arms
use different hardware, but mature systems repeatedly converge on the same
separation:

```text
goal / mode / mission
  -> local skill or planner
  -> desired state or bounded command
  -> controller compares desired state with measured state
  -> actuators change the machine
  -> sensors update measured state
  -> correct, complete, recover, or stop
```

Examples worth studying during component selection include:

- **Drones:** PX4 uses cascaded position, velocity, attitude, and angular-rate
  feedback controllers driven by a fused state estimate, as shown in its
  [controller diagrams](https://docs.px4.io/main/en/flight_stack/controller_diagrams).
  External autonomy sends supported setpoints and a continuous proof-of-life;
  PX4 leaves Offboard mode if that signal stops according to its
  [Offboard contract](https://docs.px4.io/v1.14/en/flight_modes/offboard).
- **Robot vacuums and mobile bases:** iRobot Create 3 exposes fused odometry,
  hazard and stop state, velocity commands, and longer-running actions such as
  drive, rotate, dock, and wall-follow through its
  [ROS 2 API](https://iroboteducation.github.io/create3_docs/api/ros2/). The
  caller requests a behavior while the robot continuously consumes encoders,
  IMU, optical odometry, proximity, bumper, and cliff evidence.
- **Quadrupeds:** Spot exposes image, robot-state, local-grid, world-object,
  command, lease, and E-stop services. Higher autonomy services are layered on
  lower core services, and longer commands are monitored through command
  feedback, as described in the [Spot service architecture](https://dev.bostondynamics.com/docs/concepts/robot_services.html).
- **Industrial and research robots:**
  [`ros2_control`](https://control.ros.org/rolling/doc/getting_started/getting_started.html)
  separates reusable controllers from hardware interfaces and runs a repeated
  read -> controller update -> write loop. MoveIt adds world geometry,
  collision/constraint checks, and staged manipulation above that controller
  boundary.
- **Tracking cameras and sentry-style observation systems:** ONVIF
  [Profile M](https://www.onvif.org/profiles/profile-m/) standardizes streaming
  analytics metadata and events for object classifications and related
  observations. The perception device can publish compact object state and
  events instead of forcing every consumer to reprocess every image.
- **Toys and simpler embodied devices:** the algorithms may be smaller and the
  commands coarser, but the useful products still keep balance, motor limits,
  bump response, joint feedback, and watchdog behavior local to the device.
  MetaHuman must discover the actual Ainekio firmware guarantees rather than
  assume a toy-class command interface supplies them.

The lesson is not that one of these products is the exact template. It is that
MetaHuman should issue a sparse semantic goal to a maintained local robotics
stack, while tracking, correction, hardware limits, and emergency response
remain close to the sensors and actuators.

### Research and selection before implementation

The systems in this document are reference designs and candidate components,
not a decision to install all of them or build simplified copies. Before the
general object system is designed in detail, the project should:

- inventory the actual Ainekio camera, compute architecture, accelerator,
  memory, operating system, body-command interface, joint/odometry feedback,
  range/contact sensors, and sustainable update rates;
- determine whether the existing controller exposes position, velocity, or
  joint setpoints, or only coarse named commands such as `walk` and `turn`;
- compare an established ROS 2 stack with a narrow bridge, a lighter
  library-based companion process, and any maintained vendor stack already
  supported by the body hardware;
- benchmark candidate detector/tracker combinations on recorded frames from the
  actual camera and compute target;
- prototype one tagged-object inspect/approach flow in simulation or replay;
- compare license, platform support, maintenance health, process footprint,
  latency, failure behavior, existing safety facilities, and integration cost;
- record the selected components and rejected alternatives in an architecture
  decision record before general implementation.

Some MetaHuman/Ainekio-specific glue and Environment Interface types will still
be required. The detector, tracker, visual-servo mathematics, navigation
planner, collision monitor, manipulation planner, and controller should come
from maintained systems wherever the hardware and license permit.

### 2026-08-04 measured platform inventory

Status: source and host inventory complete; physical control calibration and
recorded camera benchmarks not yet complete.

#### Ainekio body and camera

- The controller is an ESP32-S3 N16R8 with 16 MB flash and 8 MB PSRAM. It is an
  actuator, camera, audio, protocol, and failsafe owner; it is not the suitable
  host for the proposed general detector and video tracker.
- The body camera is an OV3660. Firmware provides fresh XGA 1024x768 JPEG stills
  and QVGA/VGA preview. The home gateway profile bounds preview to 10 frames per
  second. The camera uses one framebuffer and is idle between frames when
  preview is off.
- The Gateway already publishes every received camera frame to registered local
  frame consumers. The current Environment Adapter intentionally ignores all
  preview frames without a one-shot snapshot correlation. Therefore MetaHuman's
  current Environment observation path is not an active-view stream.
- Completed body actions already produce one correlated XGA still. That still
  is useful terminal evidence, but it arrives too late to steer a long motion.
  A local skill can use QVGA/VGA preview for tracking and reserve a fresh XGA
  still for verification.
- Camera streaming is currently controlled globally and is also used by the
  dashboard. A skill implementation needs one Gateway-owned camera consumer or
  lease policy that starts the existing stream when needed, shares or restores
  its state, and prevents the dashboard and skill from silently overriding one
  another. This is an ownership refinement, not a second camera transport.

#### Body control truth

- The adapter exposes named sit, stand, neutral, walk, backward, left/right,
  bounded motion assets, stop, and generated `motion_plan_v1`. Walking and turns
  are open-loop body motions.
- The smallest named heading change is currently an estimated 45-degree whole-
  body turn. The camera has no separate admitted pan/tilt or working `look`
  mapping. A 45-degree action is too coarse to serve as the only visual-centering
  control input. Its checked motion asset lasts 6.24 seconds; the 90- and
  180-degree assets last 11.52 and 22.18 seconds. Those are motion routines, not
  a responsive active-view control cadence.
- The firmware records commanded servo degrees, not measured joint positions.
  No wheel or joint encoders, odometry, IMU, lidar, range/depth sensor, bumper,
  or cliff sensor was found in the maintained controller and gateway contracts.
- A useful first active skill therefore needs a calibrated, body-owned small
  orientation or scan primitive with advertised bounds. The local controller may
  choose among those semantic primitives; MetaHuman and the LLM must not author
  servo angles. Forward approach remains a controlled-test capability until
  clearance and displacement evidence become truthful.

#### Simulator and replay truth

- The existing protocol-v1 Body Emulator correctly owns camera, motion,
  lifecycle, media, and fault seams. Its optional Sesame browser renderer can
  animate motion, but it has no robot-eye scene camera connected to that motion.
- The emulator's current `WebcamCameraSource` captures an external host webcam.
  A simulated turn therefore does not change the image because of simulated
  robot pose. The current browser renderer plus webcam cannot validate active
  visual correction or objective progress.
- The architectural test seam should remain inside the existing Body Emulator:
  add one scenario-owned `CameraSource` paired with its existing `MotionBackend`.
  A semantic body action advances a recorded/synthetic scenario state, and the
  next normal protocol camera frame represents that changed viewpoint. This
  exercises the real gateway, frame callbacks, adapter skill, interruption,
  correlation, and Validator path; it is not a second robot-control system.
- A checked-in remote-safe fixture may use generated geometry or AprilTags to
  prove controller mechanics. Actual component selection still requires ignored
  owner-local OV3660 sequences because synthetic imagery cannot establish
  ordinary-object accuracy, exposure behavior, blur, or inference latency.

The scenario manifest should be a small test contract, not a simulator-specific
control API. It records camera metadata, immutable frame ids/timestamps, target
ground truth used only by assertions, and which next viewpoint follows each
advertised semantic body primitive. The skill still consumes ordinary camera
frames and body results through the normal protocol. Initial acceptance
scenarios are:

- off-center target -> orientation action -> reduced horizontal image error;
- coarse overshoot -> opposite fine correction -> stable centered target;
- temporary occlusion -> active reacquisition -> same identity retained;
- target leaves frame -> scan beginning in its last known direction -> target
  reacquired;
- similar distractor enters -> no unverified identity switch;
- cancellation during acquisition or motion -> no later body action dispatch;
- stale or repeated frame -> await a genuinely fresh view without claiming
  progress or success.

#### Companion-host compute

- The same-computer host is x86-64 with an Intel i9-9900K (8 cores/16 threads),
  approximately 62 GiB RAM, and an NVIDIA RTX 4080. This is the appropriate
  location for an adapter-side perception and skill process.
- Matching NVIDIA 595 kernel and user-space packages are present. A read-only
  health check outside the restricted agent context sees the RTX 4080 normally:
  driver 595.71.05, CUDA 13.2 capability, and 16,376 MiB VRAM. The earlier
  `nvidia-smi` failure was execution-context device isolation, not a host GPU
  fault. A locked PyTorch/model environment and one real inference check are
  still required before treating a candidate as benchmark-ready.
- The default Python 3.12 environment currently has Pillow but not OpenCV,
  NumPy, PyTorch, TorchVision, ONNX Runtime, SAM 3, EdgeTAM, Grounding DINO, or
  AprilTag.
  A dedicated locked runtime environment will be required after component
  selection; dependencies should not be added to the lean gateway process by
  accident.
- The current 916 GiB home filesystem fell to approximately 2.9 GiB available,
  then returned to approximately 12 GiB after owner-led cleanup on 2026-08-04.
  Storage remains a resource to measure rather than silently consume. The
  earlier 2.9 GiB state was not a safe budget for a gated 848M-parameter
  checkpoint plus PyTorch/CUDA environments and replay artifacts. Model cache or
  storage placement must be an explicit owner decision; this work will not
  delete existing caches or user data to create space.
- A later owner-led cleanup on 2026-08-05 raised available space to
  approximately 98 GiB. This makes additional bounded replay practical but does
  not relax the requirement to inventory source, checkpoints, transitive model
  caches, and captures before selecting a production package.
- An existing MetaHuman vLLM environment already contains NumPy, OpenCV 4.13,
  PyTorch, TorchVision, and Transformers. It is suitable for a read-only
  component screen without another installation. Production active perception
  still needs its own locked dependency boundary so changes to an LLM runtime
  cannot silently change the robot controller.

### Current limitations are changeable design inputs

These findings describe the current platform; they are not instructions to
design permanently around every limitation. Research and acceptance should
retain the upgrade paths instead of quietly treating absent software or
hardware as impossible.

| Current condition | Immediate software option | Upgrade option and expected value |
| --- | --- | --- |
| About 98 GiB free disk after owner-led cleanup; host RAM is approximately 62 GiB | Continue bounded replay and record source, checkpoints, implicit backbone caches, and captures. The earlier low points were 2.9 and 7.0 GiB, so do not allow unbounded captures or duplicate checkpoints. | Allocate a dedicated model/replay volume if the selected production stack or longer datasets outgrow this headroom. More system RAM is not currently indicated. |
| OV3660 preview exists at QVGA/VGA up to 10 fps, but the Environment Adapter discards uncorrelated preview frames | Add a skill-owned latest-frame consumer to the existing Gateway preview; keep per-frame data out of the LLM graph. | Firmware may expose better stream control, timestamps, resolution, or cadence if measurements show 10 fps or JPEG behavior is inadequate. A new camera is an option, not the first assumption. |
| No measured body heading, joint position, odometry, range, contact, or cliff state | Use camera-measured target displacement and calibrated semantic body primitives for bounded active inspection. Do not advertise navigation or clearance. | An IMU improves heading/change estimation; front/side time-of-flight or depth improves clearance; contact/cliff sensing improves independent safety; measured joint feedback improves body control. Each capability must be advertised only after integration and validation. |
| Camera is fixed to the moving body | Derive and calibrate smaller whole-body left/right orientation primitives and correct from the next image. | A pan/tilt camera can improve views without destabilizing the whole body. Stereo/depth or a tracking camera can add geometry, but requires a new calibrated sensor contract. |
| Current simulator motion does not alter the camera view | Add an action-indexed scenario through the existing `CameraSource` and `MotionBackend` seams. | A full robot-eye 3D simulator is useful later if contact, terrain, localization, or manipulation become active scope. |
| One ignored owner-local ordinary-object OV3660 sequence now covers a distinct distractor, partial cover, full loss, and return | Keep it as the first component-comparison fixture while adding an independent target and same-class distractor sequence before selection. | A repeatable tagged test area and broader ordinary-object suite improve regression quality; captured personal media remains untracked. |

Hardware priority should follow the objective gap. For active **inspection**, the
highest-value first changes are live preview consumption and a smaller semantic
orientation primitive, both software/body-asset work. For **approach**, range or
depth plus displacement/heading feedback becomes much more valuable. For
contact or manipulation, measured joints and contact/workspace sensing become
prerequisites rather than optional refinements.

### Initial component research screening

These are benchmark decisions, not production dependency selections.

| Component | Useful role | Current decision |
| --- | --- | --- |
| [AprilTag 3](https://github.com/AprilRobotics/apriltag) | Fast deterministic target detection and calibrated pose for repeatable fixtures. | Use as the first calibration and regression truth lane. It cannot replace ordinary-object perception. |
| [OpenCV optical flow and tracking](https://docs.opencv.org/5.0/tutorials/others/optical_flow.html) | CPU-capable short-horizon feature motion, target displacement, and inter-frame tracking. | Benchmark as a lightweight baseline and possible bridge between detector refreshes. Do not treat a drifting box tracker as durable object identity. |
| Existing local YOLOv8m person segmentation | Already-installed 53 MiB checkpoint that can validate the host detector/runtime seam without another download. | Use only as a runtime and person-fixture screen. It is class-specific and cannot satisfy general open-set object acquisition. Measured CPU/GPU results are recorded under ROM-19. |
| [EdgeTAM](https://github.com/facebookresearch/EdgeTAM) | Apache-2.0 promptable video-object segmentation designed for substantially lighter on-device tracking than SAM 2. | Retain as a fast tracking-tier reference, not an identity authority. OV3660 replay met the latency budget and followed the correct target through partial cover and return, but its learned presence head retained a positive mask in all full-loss frames. The official high-level predictor is also finite-video rather than append-only live input. |
| [Cutie](https://github.com/hkchengrex/Cutie) | MIT-licensed video-object segmentation with an official frame-by-frame `InferenceCore.step()` path and object-memory design. | Retain as the strongest current V1 tracking candidate, not an identity authority. It tracked all 86 visible frames, never switched to the distinct cup, and recovered all 28 return frames without reseeding at 23-millisecond p95, but falsely retained a target mask in 15 of 29 full-loss frames. Its constructor also performs implicit TorchVision backbone downloads unless the package supplies a controlled model path. |
| [BootsTAPIR](https://github.com/google-deepmind/tapnet) | Apache-2.0 causal point tracker with official per-point visibility/uncertainty, PyTorch weights, live-camera code, and RoboTAP evaluation. | Reject as the sole object-presence owner on the current sequence. It tracked all visible/return frames at 80-millisecond p95, but three of eight seeded target points remained officially visible through every full-loss frame. Retain as a possible independent motion/visibility signal only if broader replay justifies an object-level aggregation policy. |
| [SAM 3.1](https://github.com/facebookresearch/sam3) | Unified text/exemplar/box detection, segmentation, unique instance identities, and video tracking. | Benchmark as a slower acquisition/reacquisition candidate, not assume it is the 10 Hz loop. It has 848M parameters, requires a CUDA 12.6+ runtime and gated checkpoint access, and uses the custom SAM License; throughput and license fit must be accepted explicitly. |
| [Grounding DINO](https://github.com/IDEA-Research/GroundingDINO) | Apache-2.0 language-conditioned open-set box acquisition or reacquisition. The official Transformers-compatible Tiny checkpoint is about 0.2B parameters with a 689 MB safetensors file. | Use Tiny as the first open-set acquisition benchmark after storage is available. The installed Transformers runtime already exposes the required model API. Do not select it before OV3660 replay/GPU measurement or run it on every frame. |
| [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/) | Stable detector interface with CPU, CUDA, or TensorRT backends when a candidate exports cleanly. | Keep as the preferred portability seam for compatible detectors; measure conversion correctness and fallback boundaries before adopting it. |
| [ViSP](https://github.com/lagadic/visp) | Established visual features, tracking, control laws, and visual-servo simulation. | Use its image-based visual-servo concepts and simulation as a control reference. Direct integration is not assumed: the current body lacks velocity/kinematic feedback and ViSP's GPL terms require an explicit license decision. |
| [Nav2](https://docs.nav2.org/setup_guides/odom/setup_odom_gz.html) and [`ros2_control`](https://control.ros.org/rolling/doc/getting_started/getting_started.html) | Navigation and real-time read/update/write controller ownership when a robot has transforms, odometry, state interfaces, and obstacle sensing. | Defer production integration. Ainekio does not currently provide the required odometry, transform tree, measured state, or obstacle observations. Preserve compatible contracts rather than pretending those inputs exist. |

The initial research rejects four tempting shortcuts:

- a custom color/box tracker as the production perception stack;
- repeated multimodal LLM calls as the camera or motor feedback loop;
- monocular depth estimates as certified collision clearance or metric range;
- an immediate Nav2 adoption before Ainekio can publish truthful state and
  obstacle inputs.

An isolated custom tracker/controller experiment was never integrated into the
Ainekio repository or dispatched to the robot. It was rejected because its
dominant behavior was loss/obstruction termination, it could not acquire or
re-identify a general object, and it did not actively choose a better view.

As of 2026-08-04, the leading benchmark shape is therefore two-tier rather than
one large model in every frame:

```text
slow acquisition/reacquisition
  -> SAM 3.1 concept/exemplar prompt OR Grounding DINO box
fast stream tracking
  -> Cutie frame-step leading candidate OR EdgeTAM finite-video quality reference
explicit presence/loss and bounded reacquisition
  -> a maintained identity/presence owner must reject absence before action
active-view controller
  -> measured target state -> bounded semantic orientation primitive
```

SAM 3.1 may ultimately be fast enough for both tiers on the RTX 4080 at VGA,
but Meta's published SAM 3.1 throughput is for an H100 and cannot answer that
question for this host. EdgeTAM's published figures are likewise reference
results from other devices. Only replay on this camera, host, and action cadence
will select the production path.

### Runtime and process ownership to preserve

The large model dependencies should not become a second autonomy service or be
allowed to control the body. The Ainekio Environment Adapter remains the one
skill owner:

```text
GatewayService camera callback
  -> bounded latest-frame mailbox
  -> replaceable perception worker returns typed target state only
  -> adapter-owned active-view state machine selects an advertised primitive
  -> GatewayService dispatches that primitive through normal body safety
  -> fresh frames update the same skill
```

The perception worker may be isolated in a dedicated locked environment/process
so a CUDA/model failure does not crash speech, the dashboard, or the authenticated
robot gateway. It receives only frames and target prompts, never Environment
Bridge credentials and never a motor-dispatch capability. The adapter owns
skill cancellation, correlations, body commands, milestones, and the one
terminal result. A latest-frame mailbox drops obsolete preview work rather than
building another unbounded image queue.

This process boundary remains a selection item for `ROM-11`: an in-process CPU
baseline and an isolated GPU worker should be compared for copy cost, startup
time, failure containment, and deployment complexity. In either form, it is an
implementation detail behind the existing `visualApproach`/future `inspect`
node output, not a bypass around the cognitive graph or Environment Bridge.

### First useful active-view skill

The first implementation target is `inspect`, not general `approach`:

```text
Robot Operator supplies an exact current frame, bounded target query, and objective
  -> adapter semantic perception localizes the target
  -> install the resulting verifier prompt and seed temporal continuity
  -> start existing bounded local preview under Gateway ownership
  -> track target and calculate center error, scale, mask quality, sharpness,
     exposure, and occlusion
  -> choose a calibrated small left/right orientation or a fresh still
     because it is expected to improve the view
  -> process the next frame without an LLM call
  -> periodically refresh detection and re-identify after loss
  -> complete only after the same target has a measurably improved stable view
  -> return the best fresh evidence through the existing Environment Bridge
```

The local state should distinguish at least `acquiring`, `tracking`,
`improving_view`, `reacquiring`, `verifying`, `succeeded`, `cancelled`, and
`failed`. Safety status such as stale input or body fault is orthogonal to that
goal state. A bounded scan after loss begins in the last known target direction
and expands only through advertised orientation primitives. It should not
default to remaining stationary merely because the initial frame is static.

The current MetaHuman Validator treats a reported `lost` result as terminal.
That contract remains appropriate only if the adapter emits `lost` after its
local reacquisition budget is exhausted. A temporary confidence drop is an
internal `reacquiring` state or an optional nonterminal milestone; it must not
be promoted to terminal `lost` merely because one frame is weak.

The first orientation contract should advertise body-owned semantic profiles
such as `fine` and `coarse`, supported directions, duration, interruption, and
post-action-frame behavior. It should not claim an exact angle until that angle
has measured physical evidence. Calibration can instead record the observed
normalized horizontal image displacement and variance of each primitive against
an AprilTag fixture. The active-view policy then chooses the available primitive
whose measured response is expected to reduce the current target-center error.

After each action, the controller compares predicted and observed image change
and updates its skill-local response estimate. Floor slip or imperfect turns
therefore cause another visual correction rather than an LLM retry or a false
`completed` result. This is a small discrete image-based servo: its state and
actions are generic geometry and advertised body capabilities, not hard-coded
rooms, objects, or conversational instructions.

The replay acceptance metrics are target acquisition rate, time to first track,
track retention, identity switches, reacquisition rate and time, horizontal
image-error reduction per action, view-quality improvement, frame age, effective
control cadence, model load/inference latency, cancellation latency, and final
objective success. Thresholds will be set from recorded OV3660 sequences before
physical movement is authorized.

### Current end-to-end gap map

| Owner | Current truth | Required active capability |
| --- | --- | --- |
| MetaHuman Environment Interface | Has strict `visualApproach` contracts and exact-frame `inspect` admission, target, and active-progress types. It does not yet have a general multi-object inventory or durable object identity. | Preserve the narrow inspection seam while `ROM-12` separately defines truthful multi-object observations; do not redefine approach as inspection. |
| Environment action admission | Correctly rejects target-relative work when the adapter does not advertise a feedback skill. | Admit the new skill only after the Ainekio adapter truthfully advertises it; do not reopen open-loop LLM locomotion. |
| Ainekio Environment Adapter | The live adapter still handles snapshot, text, stop, coarse move/command, and generated body-local plans only. It now has an optional typed camera-frame bridge seam, but the launcher supplies no bridge or active-view controller and advertises no inspection skill. | Compose the validated controller only after identity and fine-turn gates pass; one composition point must own frames, milestones, cancellation, and the terminal result. |
| Gateway camera path | One Gateway-owned lease manager coordinates dashboard and isolated active-view consumers. An optional synchronous adapter bridge now correlates selected-robot frames into the existing bounded mailbox without exposing continuous preview to the LLM. | Keep the bridge inert by default until the controller's identity and calibrated-control prerequisites pass, then validate one composition point before registration. |
| Perception | The selected isolated V1 composition is YOLOE-11-M plus MobileCLIP for query bootstrap and independent semantic verification, with Cutie Base Mega restricted to frame-to-frame continuity. CPU and GPU worker lifecycles pass. On the existing bottle/cup replay, YOLOE owns correct visible, absent, and return semantics while Cutie meets the 5-fps continuity budget without switching to the cup. Partial-cover 2D mask geometry and one ambiguous semantic return frame remain limitations. The one-scene result does not satisfy the held-out identity gate, YOLOE licensing remains unresolved, and nothing is advertised. | Run one frozen multi-scene held-out composition replay covering same-class distractors, partial cover, full loss, return, lighting, and viewpoint change. Keep semantic verification, temporal continuity, physical authorization, and motion calibration separate. |
| Body control | Smallest named orientation is a 6.24-second estimated 45-degree turn. | Add calibrated fine/coarse body-owned semantic orientation profiles and learn their observed image response. |
| Simulator | The visual renderer and host webcam still do not share a scene or pose. A remote-safe action-indexed replay source now couples the existing BodySession motion backend and camera-source seams for deterministic post-action frames. | Replace synthetic JPEG bytes with ignored labeled OV3660 sequences and score the same public controller lifecycle before considering a richer shared-scene renderer. |
| Companion host | Suitable CPU/RAM/GPU hardware is healthy. The selected offline GPU process passed the frozen runtime gates at 1,768 MiB peak process VRAM, 35.083-millisecond XGA semantic p95, and 26.043-millisecond QVGA continuity p95. The CPU path remains a measured diagnostic but not a 5-fps claim. Research sources and weights remain pinned in temporary/local caches, and no production perception service is installed. | Keep replay/model growth bounded, prohibit implicit downloads, retain the CPU diagnostic fallback, and define one removable production environment only after the held-out identity and AGPL decisions pass. |

Until those links exist, the current MetaHuman gate can prevent an unsupported
open-loop target attempt, but it cannot help achieve the target. That limitation
must remain visible in status and documentation. The remedy is to complete this
active path, not to remove the gate and again let the conversational LLM drive
blind motion.

### Perception contract to add

`EnvironmentVisualTargetSpecification` is sufficient for the current
single-box `visualApproach` proof of concept. General object work needs a
separate observation contract rather than continually adding optional fields to
that action input.

A planned `EnvironmentObjectObservation` should contain at least:

- `frameId`, `frameTimestamp`, and `cameraFrame` so every measurement has an
  explicit source and coordinate frame;
- adapter-issued `trackId`, plus an optional durable `objectId` only when the
  adapter can truly re-identify the physical object;
- one or more `classHypotheses` with detector class id, human-readable label,
  and confidence, without presenting a label as certain identity;
- normalized 2D bounding box and optional segmentation mask;
- optional metric pose, dimensions, depth, and covariance only when calibrated
  sensing supports them;
- `visible`, `occluded`, `lost`, or `reacquired` tracking state, track age, and
  last-observed time;
- detector and tracker provenance sufficient for replay and performance
  comparison, without putting model internals into normal prompts.

Key identity rule: a detector label such as `cup` is a category hypothesis, a
`trackId` is a short-lived observation identity, and a durable `objectId` is a
physical-world claim. They are not interchangeable.

### Object-interaction capability contract to add

The existing generic `interact` action is too broad to prove that a robot can
touch or manipulate an object. A future object-interaction capability should
advertise only concrete, body-owned verbs, for example:

- `inspect`: center the object, collect one or more useful views, and return
  fresh evidence;
- `point`: orient an available body part toward a tracked object without
  contact;
- `touch` or `push`: make a bounded contact motion when contact and clearance
  can be checked;
- `grasp`, `lift`, `place`, or `release`: only when an end effector, joint-state
  feedback, reachability checks, and collision-aware execution exist.

Each advertised verb needs limits and prerequisites: required sensors,
required body hardware, maximum duration or stages, allowed force/contact mode,
workspace bounds, interruption support, and its verification method. An action
request should reference a current `trackId` or supported durable `objectId`,
not only a natural-language noun.

Suggested execution states are `selecting`, `tracking`, `approaching`,
`planning`, `executing`, and `verifying`, followed by one terminal state:
`succeeded`, `lost`, `unreachable`, `blocked`, `stuck`, `stopped`, or `failed`.
These are adapter skill states, not extra LLM graph nodes.

### Initial object-centered skill flows

#### Inspect object

```text
fresh frame -> detect candidates -> select target -> establish track
  -> center or take bounded alternate view -> capture fresh evidence
  -> verify same tracked target remains visible -> return result
```

This is the first useful skill because it builds on the camera without claiming
contact, metric range, or general navigation.

#### Approach object

```text
current tracked target -> compute center/scale error -> obstruction check
  -> one calibrated short primitive -> fresh frame -> update same track
  -> progress, reached, lost, blocked, stuck, or stopped
```

The detector may refresh the target periodically while the lightweight tracker
runs at the control cadence. Target scale is only a monocular proximity
heuristic until calibrated depth or geometry exists.

#### Interact with object

```text
current tracked target -> confirm advertised verb and hardware
  -> establish reachable object pose / interaction region
  -> collision and workspace check -> execute one bounded stage
  -> verify controller state plus fresh visual/contact evidence
  -> continue locally or return a terminal typed result
```

A mobile-base approach and an arm/end-effector interaction are separate skills
even when one user objective needs both. Their capability truth, planners,
feedback, and failure states must remain distinguishable.

### Adoption rules

- Preserve the existing Environment Bridge and Validator. Add typed payloads
  and adapter-owned skill execution, not a second autonomy queue.
- Prefer a proven library behind a narrow adapter interface over custom
  detection, tracking, servoing, planning, or collision algorithms.
- Select components only after `ROM-11` measures them against the real Ainekio
  hardware and control interface; familiarity and popularity are not enough.
- Keep detector models and hardware accelerators replaceable. Capability truth
  depends on measured behavior, not the brand name of the model.
- Do not assume ROS is either required or forbidden before `ROM-11`. Keep the
  first public contracts compatible with established message concepts so a
  selected ROS 2/Nav2/MoveIt bridge remains possible without rewriting the
  semantic layer.
- Use the selected robotics framework's action, state-machine, or body-side
  behavior-tree facilities for fast stages and recovery wherever practical.
  Do not expand the Environment cognitive graph into one node per camera or
  motor update.
- Treat semantic segmentation or open-vocabulary recognition as perception
  evidence, not automatic permission to approach or manipulate an object.
- Capability advertisement is earned separately in simulation, tagged-object
  tests, controlled ordinary-object tests, and authorized physical tests.

## Reversibility and Code-Hygiene Contract

The active-view and embodied-control system is an optional robot capability,
not a new foundation that every MetaHuman subsystem must depend on. MetaHuman,
Environment Bridge, Robot Operator, and the V1 manual/named-motion path must
continue to operate when this capability is disabled, unavailable, or removed.
An unsupported semantic skill should produce one truthful capability result;
it must not require a compatibility controller or a second fallback workflow.

The following rules are mandatory for all remaining implementation work:

- **One removable implementation unit:** detector, tracker, controller, skill
  state machine, recovery, and feature-specific configuration belong under one
  explicitly named Ainekio-owned module or package boundary. They must not be
  distributed across general MetaHuman graph nodes, queue handlers, validators,
  memory services, or conversation code.
- **One composition point:** the optional module is connected through one
  adapter-owned registration/factory boundary. Removing that registration must
  prevent process startup, model loading, camera subscription, capability
  advertisement, and action dispatch for the feature.
- **Small shared seam:** shared MetaHuman code may contain only the minimal
  versioned semantic request/result types, generic transport/correlation, one
  admission/dispatch registration, and deterministic result reduction.
  Controller phases, detector outputs, recovery policy, model selection, and
  per-frame state remain inside the removable module.
- **No graph-shaped controller:** do not add cognitive nodes or prompt branches
  for tracking frames, selecting corrections, reacquiring targets, or checking
  motor progress. Do not add further controller-specific cases to the legacy
  Task Validator or Refiner; `ROM-20` should reduce the transitional cases that
  already exist.
- **Dependency isolation:** perception, robotics, CUDA, and model dependencies
  live in a dedicated locked Ainekio runtime. `packages/core`, the general
  Environment Bridge worker, the gateway, and firmware must not import them.
  Removing the feature must not require repairing another runtime's dependency
  graph.
- **No hidden persistence:** feature state and replay artifacts must be
  explicitly versioned and feature-owned. Do not introduce a general database
  migration, new memory record type, or required runtime-data conversion for
  this optional capability without a separate owner-approved decision.
- **No speculative compatibility layer:** when a replaced implementation has no
  maintained caller, delete it after parity validation. Do not leave duplicate
  controllers, aliases, dormant services, copied prompts, or permanent fallback
  branches merely to make a rollback appear easier.
- **Isolated delivery:** motion-control work must be reviewable independently
  from Big Brother, Boredom Movement, classifier training, speech, or unrelated
  Environment work. Each implementation batch gets its own coherent patch or
  commit. If a required shared file already contains unrelated uncommitted work,
  record the exact owned hunks and preserve the other work; never use a broad
  file restore as the removal plan.
- **No premature scaffolding:** add only the files and abstractions required by
  the next accepted replay, simulator, or integration test. A possible future
  sensor, controller, model, or body does not justify an unused implementation
  today.

Before further `ROM-08`, `ROM-12` through `ROM-14`, or `ROM-20` source work, the
current motion-control changes must be separated from unrelated dirty-worktree
changes and given a rollback manifest. Each subsequent progress entry must list:

1. feature-owned files added or removed;
2. shared files and exact exported symbols or registration points changed;
3. configuration flags, capabilities, services, processes, ports, dependencies,
   model artifacts, caches, and persistent data introduced;
4. the ordered removal procedure; and
5. the tests proving that MetaHuman, Environment Bridge, Robot Operator, and V1
   manual motion still work with the feature absent.

A batch is not accepted as cleanly removable until the optional registration can
be disabled, the feature-owned module and dependencies can be deleted, the small
shared seam can be removed without redesigning adjacent systems, and validation
passes with no dead prompts, graph edges, configuration, exports, services, or
compatibility branches left behind.

## 2026-08-05 Goal-Alignment Review

Status: aligned; current work is restricted to measured replay and simulator
evidence.

- The product goal remains an objective-seeking intelligent-pet controller, not
  an elaborate shutdown system. Bounded cancellation, stale-frame rejection,
  and no-progress results remain subordinate safety and lifecycle behavior;
  action-indexed sensor feedback must demonstrate that a correction can improve
  the same target view.
- The current implementation lane is Batch 3: `ROM-11`, `ROM-19`, and the
  action-indexed emulator proof recorded as `ROM-23`. The unregistered
  controller is test material for that lane, not evidence that Batch 4 runtime
  integration is complete.
- No adapter registration, capability advertisement, Environment graph change,
  validator retirement, forward locomotion, or physical calibration should be
  added during this lane. `ROM-20` remains ordered after a replay-proven local
  skill cutover, so the existing completion backstop is not removed early.
- The replay proof must use the existing Body Emulator motion and post-action
  camera lifecycle. It must not invent a parallel queue, simulated adapter, or
  alternate robot protocol merely to make the controller testable.
- The experimental HSV identity heuristic cannot satisfy `ROM-13` or enable the
  runtime gate from synthetic bytes. Only labeled OV3660 replay with distractor,
  occlusion, full-loss, and reacquisition evidence can do that.
- Review of this document corrected stale claims that MetaHuman lacked an
  `inspect` contract and that host storage had not been freed. The distinct
  OpenCV and EdgeTAM measurements remain evidence under the one `ROM-19` work
  item rather than separate completed implementations.

### 2026-08-06 Goal-Alignment Checkpoint

Status: still aligned in late Batch 3; component selection is closed and live
Batch 4 integration remains gated.

- Evidence AD selects one V1 composition rather than reopening the model
  comparison: YOLOE plus MobileCLIP owns semantic bootstrap and verification;
  Cutie owns temporal continuity only.
- `ROM-13` now has isolated source and a real worker lifecycle, so it is
  `implemented` but not validated. Held-out identity, locked-runtime,
  cancellation, and cadence acceptance remain before registration.
- The selected-stack GPU qualification now passes. The `ROM-21` body-backend/
  state boundary has started inside the isolated controller and passes focused
  tests. Held-out composition replay and simulator fine-turn calibration remain;
  none of these steps authorizes a live capability or physical command.
- MetaHuman owns semantic interpretation and task intention. Ainekio owns the
  fast body-local acquisition, continuity, verification, and corrective skill
  loop after admission. This is the same Environment Interface path, not a new
  cognitive graph, queue, or autonomy owner.

## Work Register

| ID | Status | Work item | Acceptance summary |
| --- | --- | --- | --- |
| `ROM-01` | `implemented` | Separate body-local motion, open-loop locomotion, and target-relative motion in typed capability and task contracts. | Focused automated contracts pass. Live physical acceptance remains part of `ROM-10`. |
| `ROM-02` | `implemented` | Add a capability-enforced action gate at the Environment action boundary. | Missing or incompatible target-feedback capability is rejected before generation and recorded by the existing validator. Live physical acceptance remains part of `ROM-10`. |
| `ROM-03` | `implemented` | Add cycle-owned motion-plan identity and generic no-progress detection. | Repeated plans and stale frames stop before dispatch; adapter-owned typed no-progress is terminal in the existing Validator. Live controller evidence remains part of `ROM-10`. |
| `ROM-04` | `implemented` | Add deterministic continuation branches to existing Environment graph nodes. | Persisted task continuations reuse their typed route and contract without routine Context Router reinterpretation. Node ownership and graph visibility remain intact. |
| `ROM-05` | `implemented` | Remove routine locomotion from the LLM Movement Generator. | Target-relative and open-loop displacement cannot enter Movement Generator; known locomotion remains an advertised body primitive and the generator is body-local only. |
| `ROM-06` | `in_progress` | Add stage-level action and camera timing. | MetaHuman records queue, lease, Bridge send/receipt, frame, and Core receipt stages. Adapter-owned receipt/capture timestamps still require the Ainekio adapter integration. |
| `ROM-07` | `implemented` | Define generic camera-only acquisition/target specifications and structured progress results. | `inspect` carries an exact-frame semantic acquisition query with optional detector evidence; `visualApproach` carries an already-localized exact-frame box. Both share active acquisition/tracking/view-improvement/reacquisition/verification phases and terminal results without scene-specific concepts. Adapter integration remains under `ROM-08`. |
| `ROM-08` | `in_progress` | Establish the adapter-owned Embodied Skill Runtime seam and implement an active-view skill within it. | One admitted request owns acquisition, view improvement, semantic verification, bounded reacquisition, milestones, cancellation, and one terminal result. Camera leases and optional bounded frame routing are validated; live controller composition and capability registration remain gated. |
| `ROM-09` | `in_progress` | Keep the independent interruption and body-safety monitor subordinate to the goal controller. | Cancellation, stale evidence, and body faults can interrupt immediately, while ordinary uncertainty enters bounded active reacquisition instead of becoming the controller's default result. |
| `ROM-10` | `not_started` | Validate simulator, controlled physical tests, interruption, and recovery. | Automated contracts pass and physical evidence demonstrates stop, target loss, no-progress, interruption, and bounded success/failure behavior. |
| `ROM-11` | `in_progress` | Research and select maintained perception, tracking, skill-execution, control, safety, navigation, and manipulation components for the actual Ainekio hardware. | The earlier YOLOE-11-M/Cutie composition is rejected by held-out semantic bootstrap. One bounded YOLOE-26x text-mode diagnostic now passes top-five acquisition on four burned VGA/XGA frames, so typed candidate/ambiguity design is justified but perception selection is not closed. Cutie remains continuity only. Licensing, new unseen identity evidence, control calibration, and later safety/navigation/manipulation selections remain. |
| `ROM-12` | `not_started` | Add typed multi-object observations and capability discovery without changing the current action queue. | Contracts distinguish class hypothesis, short-lived track identity, durable object identity, frame binding, and optional calibrated pose. |
| `ROM-13` | `implemented` | Integrate the selected detector and tracker behind the adapter-owned perception interface. | The isolated provider seam composes semantic acquisition/verification with non-authoritative Cutie continuity and passes real CPU and GPU lifecycles. The currently wired YOLOE-11-M provider is rejected by held-out bootstrap; YOLOE-26x has only diagnostic acquisition evidence and is not wired. Candidate association, occlusion/loss/reacquisition, continuous controller frame consumption, and live registration remain unvalidated. |
| `ROM-14` | `in_progress` | Add a bounded `inspect` object skill using the new perception contract. | MetaHuman now has exact-frame `inspect` admission behind a truthful `activeView` capability and its Bridge Out allowlist. The adapter-owned acquisition/tracking/control implementation and end-to-end evidence remain. |
| `ROM-15` | `not_started` | Integrate a local obstacle/clearance representation below object skills. | Fresh range, depth, point-cloud, or conservative visual evidence can independently slow or stop motion; missing evidence never becomes assumed free space. |
| `ROM-16` | `not_started` | Replace generic physical `interact` claims with advertised object-interaction verbs, prerequisites, limits, and results. | Unsupported verbs are rejected at admission; supported verbs reference a current object identity and define how success is physically verified. |
| `ROM-17` | `not_started` | Integrate the first hardware-supported bounded contact or manipulation skill. | Simulator and controlled physical evidence cover reachability, collision/workspace checks, interruption, controller feedback, fresh visual/contact verification, and terminal failure. |
| `ROM-18` | `deferred` | Add full localization, mapped navigation, and manipulation-planner bridges when sensors and body hardware justify them. | Navigation or manipulation is advertised only after the required state estimate, world model, planner, controller feedback, and safety layer pass their own acceptance. |
| `ROM-19` | `in_progress` | Add perception/control replay fixtures, metrics, and regression thresholds. | QVGA and XGA suites reject the earlier sole-owner candidates. YOLOE-11-M/Cutie fails both frozen held-out scenes at semantic bootstrap. A later one-model YOLOE-26x smoke passes top-five acquisition on the four burned first-visible VGA/XGA frames, but cannot change the false identity gate. Typed candidate/ambiguity tests and genuinely unseen acceptance scenes remain; runtime registration is forbidden. |
| `ROM-20` | `in_progress` | Retire the robot-skill evaluator/refiner/requeue pipeline after the local skill cutover. | Robot investigations use no Visual Evidence Assessor, Task Refiner, Workflow Command retry, or Movement Generator locomotion; retained admission, correlation, cancellation, stable objective, and terminal-result contracts pass focused tests and the same objective records materially lower model calls, tokens, and wall time. |
| `ROM-21` | `in_progress` | Preserve the current V1 robot behind a replaceable locomotion-backend and learned-policy seam. | The isolated Active View controller now emits bounded `BodyMotionCommand` values with frame-derived `RobotStateSnapshot` input through an injected `LocomotionBackend`; only the V1 backend maps them to named assets. Versioned manifests, broader body state, logging, learned-backend fallback, simulator calibration, and authorized physical acceptance remain. |
| `ROM-22` | `validated` | Establish the isolated active-view hygiene gate before integration. | Existing Ainekio runtime owners remain unchanged; valid timestamp, cancellation, subprocess shutdown, feature-absence, calibration-gate, and identity-gate tests pass with a complete removal manifest. |
| `ROM-23` | `validated` | Couple the active-view controller to action-indexed frames through the existing Body Emulator lifecycle. | A semantic orientation command passes through `BodySession`, unlocks its correlated replay frame, emits the normal post-action snapshot before `done`, and lets the controller verify measured image improvement without an LLM, live adapter, or physical robot. |
| `ROM-24` | `validated` | Preserve bounded semantic candidate sets and resolve identity only from frame-bound evidence. | The isolated provider, composition, JSON-line transport, client, and controller preserve up to five stable candidates and select only from explicit frame-bound evidence. Fifty-four focused tests prove ambiguity, truncation, ties, malformed/weak/mismatched/stale evidence, and continuity disagreement authorize no new target motion. Live registration and physical acceptance remain forbidden. |

## Recommended Implementation Order

### Batch 1: Stop unsafe repetition and measure the transport

- `ROM-01`: typed capability separation.
- `ROM-02`: capability-enforced action admission.
- `ROM-03`: duplicate-plan and no-progress termination.
- `ROM-06`: stage-level action/camera timing.

This batch must prevent target-relative open-loop autonomy before attempting to
make it faster.

### Batch 2: Remove unnecessary cognitive work

- `ROM-04`: deterministic persisted-continuation routing.
- `ROM-05`: body-owned locomotion primitives instead of regenerated joint
  trajectories.

This batch should record before/after model call counts, prompt tokens, and
wall-clock timing using the same bounded test objective.

### Batch 3: Establish measured active perception before more control code

Current checkpoint: component selection, camera leases, bounded frame routing,
CPU and GPU lifecycle qualification, and the action-indexed emulator seam are
complete. Frozen held-out composition replay, simulator fine-turn calibration,
and `ROM-21` source contracts remain. Batch 4 has not started live adapter
composition or capability registration.

- `ROM-11`: complete the hardware-grounded component comparison and decision
  record.
- `ROM-19`: add ignored/local recorded-frame fixtures plus a remote-safe replay
  harness and metrics.
- Verify one inference in the selected locked GPU runtime, while retaining a CPU
  baseline so the architecture does not silently depend on one provider.
- Allocate adequate model/runtime/replay storage without deleting owner data.
- Add a Gateway-owned camera consumer/lease contract for active skills and
  measure the actual OV3660 frame rate, latency, frame age, and drop behavior.
- Make preview admission and applied state observable. The current body can ACK
  `cam on` while its idle-state gate keeps preview disabled, and the Dashboard
  retains the last frame across later requests.
- Keep live preview off by default and bounded by an explicit owner/expiry. The
  current robot's battery and data limits do not justify an always-on stream.
- Add and calibrate a small body-owned orientation/scan primitive in simulation
  before it becomes an advertised physical capability.
- Couple the existing Body Emulator camera and motion seams through an
  action-indexed scenario so a simulated correction produces a new viewpoint.
- Define the `ROM-21` command, state, backend, manifest, logging, and safety
  boundaries while implementing V1 control. Do not install or train a motion
  policy merely to prove that the interface exists.

No additional physical control implementation should be selected until this
batch supplies measurements. The current typed target and lifecycle contracts
remain useful, but they are not represented as the completed controller.

### Batch 4: Implement the active-view `inspect` lane

- `ROM-12`: multi-object observation and identity contracts.
- `ROM-13`: selected acquisition and video-tracking components.
- `ROM-14`: bounded object inspection, view improvement, and reacquisition.
- `ROM-08`: connect that active skill to the existing Environment Interface and
  Ainekio adapter seam.
- `ROM-09`: attach interruption and body safety as an independent monitor.

Start with AprilTag fixtures for calibration and repeatability, then validate
the same public contracts with ordinary objects. Local preview frames feed the
selected tracker and controller, not the Environment cognitive graph or
repeated multimodal inference. Completion must demonstrate improvement of the
same target's view; merely completing a turn command is not success.

### Batch 4b: Controlled approach only after inspection works

- Extend the active skill from orientation/view improvement to one calibrated
  displacement primitive at a time.
- Use only simulation or an owner-authorized controlled fixture until the
  project has truthful clearance evidence.
- Complete `ROM-10` interruption, loss, recovery, bounded failure, and physical
  acceptance for the capability actually advertised.

### Batch 4c: Retire the legacy robot retry pipeline

- Complete `ROM-20` by cutting Robot Operator skill results over to the small
  deterministic result reducer.
- Remove Visual Evidence Assessor, Task Refiner, and Workflow Command from the
  robot-skill path; remove the corresponding source, prompts, edges, metadata,
  and tests once no maintained caller remains.
- Fold Task Contract and Task Validator only after focused parity tests prove
  that capability admission, correlation, cancellation, stable objectives, and
  typed terminal outcomes remain intact.
- Re-run the same bounded investigation and publish before/after model-call,
  token, latency, and task-outcome measurements.

### Batch 5: Add truthful object interaction

- `ROM-15`: local clearance/obstacle layer.
- `ROM-16`: concrete interaction verbs and capability prerequisites.
- `ROM-17`: first hardware-supported contact or manipulation skill.

The first verb should match the body that actually exists. If no end effector
is present, `inspect` and possibly `point` are honest capabilities; `grasp` is
not. A single deterministic skill can contain multiple physical stages without
adding corresponding nodes to the cognitive graph.

### Batch 6: Add spatial autonomy only when supported

- `ROM-18`: localization, mapping, navigation, and manipulation-planner
  integration.

This batch should evaluate direct ROS 2/Nav2/MoveIt integration or a narrow
bridge rather than reimplementing full navigation and manipulation planning in
MetaHuman. It remains deferred until the body exposes the needed odometry,
calibrated transforms, obstacle sensing, and controllable hardware.

### Batch 7: Train and admit learned locomotion only when V1 evidence supports it

- Extend the current V1 robot with the sensors selected from measured control
  gaps, prioritizing IMU/body orientation, measured joint state or feedback
  servos, contact/load, and clearance evidence rather than adding sensors only
  because a candidate policy expects them.
- Calibrate a digital twin against the V1 body's geometry, joint limits, mass,
  servo response, camera transform, command latency, and measured sensor noise.
- Train an Ainekio-specific compact locomotion policy against the versioned
  `ROM-21` state and action contracts. Export the model together with its
  preprocessing, normalization, recurrent/last-action state, output mapping,
  required sensors, and safe fallback.
- Validate recorded replay and simulator behavior, then run the model in shadow
  mode beside the deterministic controller. A mismatch must be observable and
  cannot silently fall through to actuator dispatch.
- Admit only bounded, explicitly authorized physical trials. Preserve the V1
  Primitive Backend as a recovery/fallback path and keep the Safety Supervisor
  independent of the learned artifact.

This is an incremental upgrade of the current V1 robot, not a replacement
project. Failure of a trained policy must leave the existing semantic skills,
bridge, controller fallback, and body usable.

## Non-Goals and Constraints

- Do not hard-code a blue object, wall, room, direction, or conversational
  phrase.
- Do not add a second task validator, coordinator queue, lifecycle store,
  conversation memory, TTS path, or Robot Operator service.
- Do not make shorter retry limits the primary correction. A bounded limit is a
  safety backstop; progress evidence and capability truth must control retries.
- Do not lower action deadlines before measuring where time is spent.
- Do not represent monocular visual heuristics as certified distance or
  collision sensing.
- Do not send raw LLM-authored servo values directly to the robot. Bounded,
  validated body primitives remain body/gateway owned.
- Do not treat a detector class label as a persistent physical-object identity
  or an affordance such as graspability.
- Do not add detector, tracker, controller, and recovery iterations as new LLM
  nodes. They belong in one adapter-owned real-time skill.
- Do not advertise `grasp`, `push`, `place`, or target-aware navigation merely
  because an image model can describe the scene.

## Validation Checklist

Each implementation batch must record the applicable results:

- focused Environment action-parser, task-contract, validator, refiner, and
  workflow-command tests;
- Environment Interface action/capability and feedback compatibility tests;
- Robot Operator graph and lifecycle tests;
- all cognitive graphs validate;
- architecture and remote-safety checks pass;
- no unrelated dirty-worktree changes are included;
- every implementation batch includes a current rollback manifest and a
  feature-absent validation proving the V1/manual path remains operational;
- disabling the single feature registration prevents its process, model,
  camera-consumer, capability-advertisement, and dispatch activity without
  changing unrelated services;
- removal leaves no dead feature imports, exports, prompt text, graph edges,
  configuration keys, services, dependencies, caches, or persistent-state
  requirements;
- model call count, prompt tokens, and wall-clock duration are measured before
  and after performance changes;
- perception inference latency, effective frame/control rate, track retention,
  identity switches, target-loss/reacquisition, and false-positive behavior are
  measured on recorded fixtures;
- every object interaction records the requested verb, target identity and
  source frame, capability prerequisites, controller result, verification
  evidence, and terminal reason;
- physical movement tests are explicitly authorized and report the commanded
  primitive, fresh-frame evidence, progress outcome, stop behavior, and queue
  terminal state.

## Decision Log

### 2026-08-06 - Preserve memory-informed autonomy above the body seam

- Record the current quadruped as the first embodiment of a persistent
  intelligent pet whose personality, relationships, memories, curiosity, and
  objectives remain owned by MetaHuman and survive future body changes.
- Allow authorized autonomy to combine fresh, correlated environmental evidence
  with bounded relevant memory when selecting a semantic intention. Memory may
  influence attention and preference but cannot establish current physical
  truth, authorize movement, or bypass capability and safety gates.
- Keep photographs used for semantic deliberation in the existing Robot
  Observer / Full-policy path. Keep ordinary tracking frames and motor
  corrections inside the embodied runtime so an investigation does not create
  an LLM pass for every V1 walk or turn.
- Treat `find a cat` as a stable search/investigation objective. The existing
  `inspect` lane covers a currently visible subject; a future bounded search
  skill must add local scan and reacquisition, with approach admitted only when
  truthful locomotion and clearance capabilities support it.
- Put V1 quadruped assets behind the replaceable locomotion-backend seam. A
  future embodiment may execute the same admitted semantic skill differently
  without rebuilding memory, autonomy, Environment Mode, or bridge contracts.
- The Active Operator roadmap owns the complete memory and autonomous-mode
  policy. This motion paper owns only the compatible embodied skill, state,
  control, result, and safety boundaries.

### 2026-08-05 - Make the embodied-control system removable by construction

- Treat active perception and embodied control as one optional Ainekio-owned
  implementation unit behind one adapter registration point, not functionality
  distributed through general MetaHuman services and graphs.
- Keep the shared MetaHuman seam limited to versioned semantic contracts,
  generic transport/correlation, admission/dispatch registration, and
  deterministic result reduction.
- Require every implementation batch to ship with a rollback manifest and a
  feature-absent validation. Removal must leave the existing V1 manual/named-
  motion path and unrelated MetaHuman services working.
- Separate the current motion-control work from unrelated dirty-worktree changes
  before adding further active-skill or legacy-retirement source code.

### 2026-08-04 - Begin with software-only control refinement

- New physical sensors are not a prerequisite for the immediate safety,
  capability, progress, latency, and duplicate-work corrections.
- The existing camera is suitable for developing a conservative visual-feedback
  proof of concept.
- Camera-only control will remain explicitly limited until physical validation
  demonstrates acceptable behavior; it will not be described as general safe
  navigation.
- The work will correct the existing Robot Operator, Environment Mode,
  Environment Bridge, and Validator owners instead of creating a parallel
  autonomy subsystem.

### 2026-08-04 - Extend the roadmap to object-centered skills

- The motion-control work is a foundation for perception-guided inspection,
  approach, and physical interaction rather than a shutdown-only subsystem.
- Robot Operator and Environment Mode remain the intention, admission,
  task-contract, and semantic-validation owners. They will request a semantic
  skill rather than generate each physical correction.
- A companion-computer-style Embodied Skill Runtime behind the Ainekio adapter
  will integrate selected maintained robotics components and own the rapid
  perception/action feedback loop. It will not create a second MetaHuman queue,
  graph, or validator.
- Established robotics components will be researched against the actual
  hardware before selection. The public MetaHuman contracts will remain small,
  typed, hardware-truthful, and vendor-neutral.
- The current `visualApproach` contract remains the narrow first proof. General
  object observations, track identity, concrete interaction verbs, scene
  clearance, and staged verification are separate planned contracts.
- Fast perception, tracking, control, collision response, and skill recovery
  stay outside the conversational LLM graph.

### 2026-08-04 - Correct the controller from stop-dominant to objective-dominant

- The existing expiration, duplicate, stale-frame, cancellation, and terminal
  result work is retained as safety/lifecycle infrastructure, not credited as
  the objective-achievement controller.
- The first isolated adapter experiment is rejected and will not be integrated.
  It could stop on weak evidence but could not acquire a general target,
  preserve identity, choose a better view, or demonstrate objective progress.
- `ROM-11` and `ROM-19` now precede additional adapter control code. Component
  selection will be based on actual OV3660 replay and host measurements.
- `inspect` becomes the first active skill. It requires target acquisition,
  video tracking, active orientation, bounded reacquisition, measurable view
  improvement, and verification of the same target.
- Safety remains independently able to interrupt, but uncertainty is routed to
  active reacquisition whenever a valid camera and orientation capability are
  available.

### 2026-08-04 - Use the current robot as V1 of an intelligent pet

- The existing eight-servo, camera-equipped robot is the supported first body
  to improve, instrument, and extend; it is not throwaway scaffolding for an
  unrelated future system.
- MetaHuman pet cognition remains separate from embodied skill execution and
  locomotion so personality, memory, social behavior, and semantic intentions
  survive controller, sensor, and body upgrades.
- V1 named motions become the first `LocomotionBackend` and remain a supported
  fallback. The camera-feedback controller is the next implementation behind
  the same seam; a compact trained locomotion policy is a later backend, not a
  new cognitive architecture.
- V1 begins collecting truthful timestamped state, action, result, and safety
  data. New sensors extend the versioned state contract without reclassifying
  commanded servo positions as measured state.
- Learned control requires an Ainekio-calibrated digital twin, declared sensor
  inputs, packaged preprocessing/output semantics, replay and simulator
  acceptance, shadow-mode comparison, and explicitly authorized physical
  trials. It cannot bypass the independent Safety Supervisor.
- A failed, unavailable, or incompatible learned artifact leaves the existing
  V1 primitives, semantic skills, bridge, and body operational.

## Progress Log

### 2026-08-04 - Baseline captured

Status: documented.

Changes:

- Added this maintained motion-control observation and progress record.
- Recorded the measured LLM critical path, repeated motion-plan behavior,
  capability gap, missing progress signals, and software-only implementation
  sequence.

Validation:

- Documentation reviewed against the maintained Robot Operator ownership and
  Environment Mode performance records.
- No runtime source, graph, gateway, or physical robot behavior changed in this
  documentation step.

Remaining:

- Begin Batch 1 with `ROM-01`, `ROM-02`, `ROM-03`, and `ROM-06`.

### 2026-08-04 - ROM-01 and ROM-02 - Typed motion admission

Status: implemented.

Changes:

- Added the generic `body_local`, `open_loop_displacement`, and
  `target_relative` motion classes to the Environment capability and task
  contracts.
- Kept motion classification in the existing Environment Context Router and
  preserved it through the existing Task Contract, Validator, Refiner, and
  Workflow Command lifecycle.
- Added one typed Action Parser admission result and connected it to the
  existing Environment Task Validator. No new queue, planner, validator,
  bridge, or Robot Operator service was added.
- Restricted Movement Generator to admitted `body_local` work. A
  `target_relative` request cannot become `robotMotionPlan`.
- Kept explicit current-user open-loop commands available while preventing a
  Robot Operator intention from entering the narrow direct-user command path.
- Capability rejection produces a visible typed lifecycle result and cannot
  enter bounded refinement.

Evidence:

- The existing action boundary previously admitted generated joint plans from
  the presence of `robotMotionPlan` alone.
- The connected robot advertises joint-plan execution but no target-relative
  feedback capability or navigation action.

Validation:

- Environment motion-plan tests: 11 passed, including target-relative denial,
  semantic target-capability admission, Robot Operator open-loop denial,
  current-user open-loop admission, and Movement Generator defense in depth.
- Environment task-contract tests: 11 passed.
- Environment task-validator/refiner/workflow tests: 36 passed, including a
  visible target-capability rejection with no refinement request.
- Environment Bridge compatibility and instruction-interpreter focused checks
  passed.
- All 26 cognitive graphs validated.
- Architecture guardrail reported zero violations; `./bin/audit check` passed.
- Core-wide typecheck remains non-green because of pre-existing errors in
  unrelated modules; it reported no error in the files changed for ROM-01 or
  ROM-02.
- No physical robot command was sent during validation.

Remaining:

- Rebuild/restart and run a live Robot Observer acceptance check when physical
  testing is authorized. The expected current behavior is a visible capability
  rejection or a supported non-motion/body-local choice, never open-loop target
  approach.
- Continue Batch 1 with `ROM-03` duplicate/no-progress termination and `ROM-06`
  stage-level timing.
- Implement the actual camera observer/correction loop under `ROM-07` through
  `ROM-09`; ROM-01 and ROM-02 intentionally do not pretend that loop exists.

### 2026-08-04 - ROM-03 through ROM-07 - Control identity, timing, and target contracts

Status: implemented in MetaHuman; adapter integration in progress.

Changes:

- Rewired Movement Generator output through the existing Environment Task
  Validator before Environment Bridge Out. Removed the now-unused generated
  action/response inputs from Bridge Out rather than retaining a second path.
- Added a stable plan identity and bounded cycle metadata using the existing
  action, queue, observation, Validator, Refiner, and Workflow Command
  lifecycle. An identical plan or stale post-motion frame returns a typed
  `stuck` result before another physical dispatch; the stale-frame case also
  avoids another Movement Generator model call.
- Made adapter-owned exhausted `lost`, `blocked`, `stuck`, `stopped`, and
  `failed` visual-approach results terminal in the existing Validator. A
  temporary target loss remains an adapter-owned active `reacquiring` phase;
  only the final result can close the local control loop.
- Added owner-contributed action timing for queue entry, lease, Bridge send,
  adapter receipt, capture start, frame ready, adapter feedback send, Bridge
  receipt, and Core receipt. Missing adapter-owned timestamps remain absent
  rather than being guessed. Adapter timing takes precedence over portable
  image timestamps, is recovered from the existing Work Coordinator lifecycle
  after Bridge restart, and Bridge correlation state is bounded and retired
  after terminal observations.
- Added one strict deterministic route input to the existing Context Router
  node. Persisted continuations reuse their immutable task contract and current
  evidence without routine router inference; new user work still uses the
  normal Context Router model.
- Added `visualApproach` as a target-relative semantic action with an exact
  frame-bound normalized target box and typed progress. It is admitted only
  when both `target_relative` and `visualApproach` are advertised. An open-loop
  command, generated joint plan, or stale target frame cannot substitute for
  it. Autonomous targets must also carry a valid image from the exact current
  Robot Observer correlation cycle.
- Kept known locomotion on advertised body primitives and Movement Generator
  restricted to `body_local` pose/gesture trajectories.

Validation:

- Motion-plan contracts: 13 passed, including duplicate-plan and stale-frame
  termination.
- Environment Task Validator/Refiner/Workflow contracts: 38 passed, including
  typed adapter no-progress termination.
- Action-context lifecycle contracts: 5 passed, including motion-control state
  recovery from the existing queue.
- Visual-approach contracts: 3 passed at the time of this entry, covering
  normalized targets/progress, capability admission, open-loop denial, and
  exact-frame binding.
- Timing contracts: 3 passed; Environment Bridge compatibility and diagnostic
  contracts passed.
- Persisted routing and Orchestrator contracts passed without a model call.
- All 27 cognitive graphs validated.
- Core-wide typecheck remains red from pre-existing unrelated modules; filtered
  output reports no errors in the motion-control files changed in this batch.
- No physical robot movement was issued.

Remaining:

- The Ainekio environment adapter must advertise and own `visualApproach`, run
  the bounded tracker/controller beside its camera and body feedback, populate
  adapter receipt/capture timestamps, and return the final typed progress plus
  correlated frame. This is a separate repository and must not be emulated by
  a second MetaHuman dispatch loop.
- Complete simulator acceptance before requesting authorization for an exact
  physical target, interruption, target-loss, obstruction, and recovery test.

### 2026-08-04 - ROM-07/ROM-08 - Active visual-control lifecycle boundary

Status: implemented in MetaHuman; adapter behavior remains in progress.

Changes:

- Replaced the progress contract's stop-dominant vocabulary with explicit
  active controller phases: `acquiring`, `tracking`, `improving_view`,
  `reacquiring`, and `verifying`. The existing generic `progress` value remains
  compatible with older adapters.
- Centralized active-versus-terminal classification in the Environment
  Interface owner and changed the existing Validator to consume that shared
  contract instead of carrying its own hard-coded shutdown list.
- Kept `reached`, exhausted `lost`, `blocked`, `stuck`, `stopped`, and `failed`
  as terminal results. This contract change does not pretend that an active
  controller exists in the current Ainekio adapter.

Evidence:

- Before this correction the typed contract named one generic progress state
  but five failure/stop states. The Validator locally classified those stop
  strings, while acquisition and recovery could not be represented.
- The active phases map directly to the recorded adapter-owned controller:
  acquire the target, track its identity, improve the view, reacquire after
  temporary loss, and verify the same target before returning one result.

Validation:

- Visual-approach and Environment Task Validator focused suites passed 42 of
  42 tests, including active/terminal classification and the existing terminal
  no-progress contract.
- No graph edge, queue, bridge path, Ainekio source, camera process, or physical
  robot command changed in this step.

Remaining:

- The Ainekio skill runtime must actually emit these phases from its local
  camera/control loop; MetaHuman naming alone does not help the robot achieve
  an objective.
- Continue ROM-11/ROM-19 replay and component measurements before selecting and
  integrating the active tracker/controller.

### 2026-08-04 - ROM-14 - MetaHuman active-inspection admission seam

Status: implemented in MetaHuman; adapter skill remains in progress.

Changes:

- Added a distinct generic `inspect` Environment action instead of repurposing
  `visualApproach`. It carries an exact-frame `inspectionTarget` with a concise
  semantic acquisition query and is treated as target-relative embodied work.
- Kept `visualApproach` for an already-localized target box. `inspect` does not
  require the cognition model to invent coordinates: the embodied perception
  backend owns localization and physical target identity. An optional paired
  `seedBox` and `seedConfidence` may accelerate acquisition only when current
  detector evidence already supplies them.
- Added an `activeView` capability contract. `inspect` is admitted only when the
  adapter advertises the action, `target_relative` motion, a configured local
  active-view controller, a valid camera frame, and the acquisition request is
  bound to that exact frame.
- Consolidated inspection and approach lifecycle reporting into one
  `activeViewProgress` result carrying `skill: inspect | visualApproach`. This
  avoids an inspection-only side channel and avoids forcing inspection through
  an approach-specific result name.
- Kept acquisition, tracking, view correction, reacquisition, and verification
  adapter-owned. The Environment prompt describes the semantic contract but
  contains no scene-specific object, room, motion, or fixed decision rule.
- Corrected the maintained Environment graph's Bridge Out allowlist. It omitted
  the already-defined `visualApproach` action, so a capable adapter could pass
  parser admission and still fail at final queueing. Bridge Out now admits both
  `inspect` and `visualApproach`, subject to the earlier capability gate.

Validation:

- Visual action and Environment Validator focused suites passed 43 of 43 tests.
  Coverage includes semantic inspection-target normalization, optional seed
  evidence pairing, exact-frame inspection admission, missing-controller
  rejection, stale-frame rejection, queue preservation, and graph allowlist
  parity.
- All 27 cognitive graphs validated.
- The current Ainekio adapter does not advertise `inspect` or `activeView`, so
  this change cannot cause a robot action and does not claim the skill exists.
  No physical command was issued.

Remaining:

- Add the local camera/perception/correction loop in the Ainekio skill owner and
  advertise the capability only after action-indexed replay acceptance.
- Return typed active milestones and one correlated terminal result through the
  existing Environment Bridge, then cut robot skill results around the legacy
  assessor/refiner/requeue path.

### 2026-08-04 - Object-centered robotics expansion documented

Status: documented; `ROM-11` through `ROM-19` are not implemented unless their
work-register status says otherwise.

Changes:

- Expanded the target architecture from bounded motion failure handling to
  object detection, identity tracking, inspection, visual approach, clearance,
  concrete interaction capabilities, staged execution, and verification.
- Recorded ROS vision-message semantics, OpenCV/ONNX inference and tracking,
  ViSP visual servoing, Nav2 navigation/safety separation, MoveIt planning and
  staged manipulation, and AprilTag fixtures as established references to
  evaluate rather than mandatory dependencies.
- Compared the recurring feedback architecture in drones, robot vacuums,
  quadrupeds, tracking cameras, and industrial control systems.
- Preserved the original Robot Operator -> Environment Mode decision path and
  defined one typed skill request into an Ainekio-side runtime that can report
  milestones and terminal results through the existing bridge.
- Added research-first staged work items that favor maintained systems over
  custom algorithms and put the high-frequency robotics loop in the Ainekio
  adapter and body controller.

Validation:

- Documentation was compared with the current `visualApproach`, motion-class,
  capability, and progress contracts in `packages/core`.
- No runtime source, cognitive graph, adapter, gateway, or physical robot
  behavior changed in this documentation step.

Remaining:

- Complete `ROM-11` component research and `ROM-19` replay measurements before
  selecting the adapter implementation for `ROM-08`.
- Do not represent the current robot as capable of active object inspection or
  closed-loop target approach until the corresponding replay, simulator, and
  explicitly authorized physical acceptance succeeds.

### 2026-08-04 - ROM-11 - Hardware inventory and active-perception screening

Status: in_progress.

Changes:

- Recorded the real ESP32-S3, OV3660 still/preview, gateway frame-consumer,
  body-command, missing-feedback, and companion-host compute boundaries.
- Identified that continuous preview already reaches Gateway frame callbacks but
  is discarded by the Environment Adapter unless a snapshot correlation exists.
- Identified the need for a Gateway-owned skill camera consumer/lease and a
  calibrated small body-owned orientation primitive; neither requires a second
  MetaHuman queue, graph, bridge, or camera transport.
- Confirmed that the current Sesame renderer and host webcam are not coupled;
  current simulation cannot demonstrate visual error reduction after motion.
- Confirmed that Gateway frame subscribers are invoked and awaited serially.
  Detector or tracker inference must therefore leave the receive callback
  immediately through a latest-frame mailbox; running inference inline would
  stall every later camera consumer and the robot receive loop.
- Located a body-owned fine-orientation candidate in the existing motion asset
  rather than inventing raw servo output. Each current 45-degree turn contains
  three repeated eight-frame gait cycles plus entry and return frames. A
  one-cycle derivative would encode 2,720 milliseconds instead of 6,240
  milliseconds and can be exposed only as a semantic calibrated primitive.
- Screened AprilTag, OpenCV optical flow/tracking, EdgeTAM, SAM 3.1, Grounding
  DINO, ONNX Runtime, ViSP, Nav2, and `ros2_control` against the actual platform.
- Reordered the work so replay and component measurements precede additional
  control implementation.

Evidence:

- Ainekio firmware bounds home preview at 10 frames per second, provides one
  XGA still after a completed action, and exposes no measured joint, odometry,
  inertial, range, contact, or map state through the gateway contracts.
- The current minimum named whole-body turn is an open-loop estimated 45
  degrees, which is too coarse as the sole active-view correction.
- The companion host has ample CPU/RAM and a healthy RTX 4080. Outside the
  restricted agent context, `nvidia-smi` reports driver 595.71.05, CUDA 13.2
  capability, and 16,376 MiB VRAM.
- The default gateway Python environment does not contain OpenCV, Torch, or the
  candidate perception runtimes. Measurements use an isolated existing host
  runtime and do not imply that the production gateway can import those
  packages or should run inference in its event loop.
- After owner-led cleanup and the 2026-08-05 restart, the host filesystem has
  about 17 GiB available. That is sufficient for the selected small model
  screen and ignored replay work, but the volume remains 99 percent full and
  is not permission to duplicate full CUDA/Torch environments.
- No ordinary OV3660 sequence with frame timestamps, target annotations, and
  body-action correlations exists in maintained Ainekio or MetaHuman source.
  Documentation records prior still-image sizes, but those stills are not a
  tracking/control replay set and owner camera media must remain untracked.

Validation:

- Read-only source inspection confirmed the existing camera, action, frame
  callback, capability-advertisement, and post-action correlation paths.
- Read-only emulator inspection confirmed the existing `CameraSource` and
  `MotionBackend` extension seams and the absence of a robot-eye scene coupled
  to simulated motion.
- Read-only host inspection recorded CPU, memory, GPU PCI identity, loaded
  driver modules, `nvidia-smi` failure, and default Python module availability.
- Primary project documentation was reviewed for the candidate components. No
  package was installed, Ainekio source was changed, camera stream was started,
  or physical movement was issued.

Remaining:

- Build the selected locked GPU environment and verify one inference
  independently of the gateway process.
- Keep locked model runtimes and ignored replay data in an owner-approved local
  location without duplicating the existing Torch/CUDA payload.
- Record ordinary and tagged OV3660 sequences with exact frame timestamps and
  body-action correlations; keep owner camera data out of tracked source.
- Build the remote-safe replay harness and compare AprilTag/OpenCV CPU baselines,
  EdgeTAM fast tracking, and SAM 3.1 versus Grounding DINO acquisition and
  reacquisition.
- Implement the skill camera consumer as a bounded latest-frame mailbox outside
  the serial Gateway callback. Measure dropped superseded frames explicitly;
  do not add another unbounded camera queue.
- Add the action-indexed camera scenario through the existing Body Emulator
  seams so corrections can be tested end to end without physical movement.
- Build the one-cycle left/right turn candidates from the existing body asset,
  measure their simulated image-displacement response, and treat their physical
  angle as unknown until an explicitly authorized calibration test records mean
  displacement and variance.

### 2026-08-04 - ROM-19 evidence A - Local OpenCV replay-mechanics screen

Status: in_progress; production component selection is not established.

Changes:

- Reused the existing MetaHuman vLLM Python environment for a temporary,
  non-repository replay screen. No package or checkpoint was installed.
- Generated a 60-frame 480x320 transform, exposure, blur, six-frame occlusion,
  and distractor sequence in memory around a box in a public Espressif camera
  fixture. Compared installed OpenCV Lucas-Kanade sparse optical flow and the
  OpenCV MIL tracker.
- Kept the screen outside maintained source because it contains an absolute
  cross-repository fixture path and does not yet implement the remote-safe
  Ainekio scenario contract.

Evidence:

- One uncontended run measured Lucas-Kanade at 0.468 milliseconds mean and
  0.918 milliseconds p95 per frame, with 6.52-pixel median center error. MIL
  measured 27.63 milliseconds mean and 31.92 milliseconds p95, with 1.79-pixel
  median center error.
- Five simultaneous stress runs measured Lucas-Kanade mean latency from 0.838
  to 2.974 milliseconds and MIL mean latency from 47.259 to 50.857
  milliseconds. Both fit beneath a 100-millisecond 10-fps frame period in this
  synthetic screen, but shared-process contention materially affected MIL.
- Neither component switched to the simple inserted distractor in this fixture.
  This is not ordinary-object identity evidence. Continuing a track across the
  synthetic occlusion is also not proof of reacquisition after full target loss.
- The host already contains a 53 MiB person-only YOLOv8m segmentation checkpoint.
  On the same public fixture it detected one person at 0.8743 confidence. Fifteen
  warmed CPU runs measured 171.84 milliseconds mean and 214.87 milliseconds
  p95. Fifteen warmed RTX 4080 runs measured 10.94 milliseconds mean and 13.32
  milliseconds p95. The permission boundary made end-to-end process startup
  timing unusable, so only the script's measured warmed inference is recorded.
- The existing local SAM ViT-B checkpoint is 358 MiB and the environment has a
  Segment Anything implementation, but that older image segmenter does not
  provide the required video identity, full-loss acquisition, or
  re-identification. Its presence is not a reason to select it over the
  maintained candidates.
- After owner-led storage cleanup, the official Apache-2.0 Grounding DINO Tiny
  safetensors checkpoint was cached and screened through the already-installed
  Transformers runtime. On the RTX 4080 in FP32 it loaded in 2.40 seconds, used
  1,987 MiB peak CUDA allocation, and measured 100.67-122.07 milliseconds mean
  with 101.51-122.97 milliseconds p95 across three public repository fixtures.
  It acquired a distant red-shirted person, the quadruped robot rendering, and
  a green battery from text queries. The battery case also produced weaker
  duplicate candidates, confirming that ranking, overlap suppression, and
  ambiguity handling belong in acquisition rather than being assumed away.
- The same Grounding DINO Tiny cases measured 4.20-5.33 seconds mean on the
  i9-9900K CPU. CPU preserves an offline/debug fallback but is too slow for
  routine active reacquisition. The installed Transformers path also failed
  naive whole-model FP16 because its fused text path retained FP32 tensors;
  production code must use a verified mixed-precision/export path or retain
  the measured FP32 behavior rather than adding dtype coercion hacks.

Validation:

- Six total harness executions completed without installing dependencies or
  writing captured media.
- One CPU and one GPU detector screen completed using an explicit local weights
  path; no model was downloaded and no physical action was issued.
- Grounding DINO Tiny completed one GPU and one CPU acquisition screen after
  the owner made storage available. Its checkpoint is cached model data, not a
  repository file; no physical action was issued.
- The screen validates image generation, timing, box-error, occlusion, and
  distractor metric plumbing only. Its source image is not OV3660 robot data,
  its camera motion is synthetic, and it does not exercise a body command,
  Gateway, adapter, Environment Bridge, or physical robot.

Remaining:

- Convert the test into the existing Ainekio Body Emulator's action-indexed
  scenario seam so semantic corrections produce the next normal camera frame.
- Capture ignored owner-local OV3660 preview sequences and repeat the benchmark
  without synthetic transforms.
- Add explicit full-loss and detector-driven reacquisition so a tracker that
  merely drifts through an occlusion cannot be scored as recovered.
- Repeat Grounding DINO Tiny on ordinary OV3660 replay, add explicit ambiguity
  and full-loss cases, and compare it with SAM 3.1 only if the gated license,
  footprint, and likely benefit justify that download.
- Repeat the EdgeTAM and OpenCV measurements on exact OV3660 action-indexed
  replay before selecting production tracking by quality rather than host
  throughput alone.

### 2026-08-05 - ROM-19 evidence B - EdgeTAM tracking-tier benchmark

Status: measured on a public recorded sequence; OV3660 acceptance remains
pending.

Changes:

- Installed only EdgeTAM's small Python support packages into an isolated `/tmp`
  target with `--no-deps`, reusing the existing measured Torch/CUDA runtime
  instead of resolving or duplicating another multi-gigabyte CUDA stack.
- Used the official Apache-2.0 EdgeTAM source, its 56,116,523-byte checkpoint,
  and the first 60 frames of its recorded indoor bedroom example. Seeded the
  model with the example's frame-zero box and propagated one object through the
  sequence.
- Kept acquisition separate. The box prompt measures the tracking tier; it is
  not counted as proof that the robot can semantically locate an object.

Evidence:

- On the RTX 4080 with PyTorch 2.10 and bfloat16 autocast, model load took 3.57
  seconds, state initialization took 2.44 seconds, and initial box seeding took
  431 milliseconds.
- Sixty-frame propagation measured 29.96 milliseconds mean, 28.57 milliseconds
  median, 32.47 milliseconds p95, and 72.64 milliseconds maximum. Peak allocated
  CUDA memory was 461.27 MiB.
- All 60 output masks were nonempty; mask area changed from 33,271 pixels on the
  first frame to 32,926 on the last while the seeded child moved substantially
  across the frame. This is continuity evidence on the example, not labeled
  identity-switch or segmentation-accuracy evidence.
- The optional SAM2 connected-components CUDA extension was not built, so the
  runtime warned and skipped small-hole post-processing. Core propagation still
  completed. Production packaging must either build that pinned extension or
  accept and test the explicitly reduced post-processing path.
- The official PyTorch video-predictor API initializes from a finite video or
  JPEG directory. The benchmark therefore does not establish an append-only
  live-camera integration. A live implementation must use a supported streaming
  path or select the already measured OpenCV online tracker; it must not depend
  on private EdgeTAM state mutation.

Validation:

- Dependency import versions were checked before inference: Hydra 1.3.2,
  iopath 0.1.10, timm 1.0.15, Torch 2.10.0+cu128, and Torchvision 0.25.0+cu128.
- The inference ran entirely on recorded public frames. No Gateway connection,
  camera stream, Environment action, or physical movement was used.

Decision:

- EdgeTAM passes the host throughput and memory screen for a future maintained
  tracking tier, but it is not yet selected for the V1 live loop because the
  measured API is batch-oriented and no OV3660 quality set exists.
- V1 integration should first use a worker-isolated online tracker with
  Grounding DINO Tiny reserved for semantic acquisition and bounded
  reacquisition. EdgeTAM remains the preferred comparison candidate once a
  supported streaming interface and action-indexed replay are available.

Remaining:

- Record ignored QVGA/VGA OV3660 preview with exact action/frame correlations,
  labeled target boxes, full loss, distractors, low light, and occlusion.
- Score track retention, center/box error, identity switches, reacquisition,
  ambiguity, latency, dropped superseded frames, and control outcomes on that
  replay before advertising `activeView`.
- Implement the bounded latest-frame mailbox and worker boundary without adding
  inference to the Gateway frame callback or an unbounded image queue.

### 2026-08-04 - ROM-20 - Evaluator/refiner debt audit

Status: in_progress.

Changes:

- Measured the committed evaluator-era graph, source, and test growth and the
  additional uncommitted motion-control surface.
- Distinguished protections worth keeping from the automatic model-based
  visual judgment, instruction rewriting, and whole-graph retry loop that must
  leave robot-skill execution.
- Defined the target as one semantic skill dispatch, a local sensor/control
  loop with no LLM calls, and one correlated terminal result handled by a small
  deterministic reducer.
- Recorded a staged retirement so the old backstop is not deleted before the
  local skill and replay evidence can replace it.

Evidence:

- Environment Mode grew from 24 nodes and 47 edges to 29 nodes and 77 edges in
  the evaluator-era comparison, with 5,000 inserted lines in the maintained
  surface.
- The five added node implementations currently contain 1,779 lines, while
  direct Task Validator and Task Contract tests contain 2,331 lines.
- Visual Evidence Assessor, Task Refiner, and Movement Generator each hide a
  model call behind an ordinary Environment node; Workflow Command can then
  schedule another full Environment pass.
- The recorded failed investigation used 28 model calls and 70,164 tokens but
  repeated essentially the same open-loop plan.

Validation:

- Read-only graph comparison, source inspection, model-call search, line counts,
  and current-worktree diff measurements were recorded in this audit.
- The existing Robot Operator and Boredom Movement graphs were counted
  separately to confirm the debt is in downstream Environment execution, not a
  remaining shared autonomy graph.
- No runtime source, graph, adapter, gateway, or physical robot behavior was
  changed by ROM-20 in this audit step.

Remaining:

- Finish the recorded-frame replay lane and first adapter-owned `inspect` skill.
- Cut that skill around the assessor, refiner, workflow requeue, and movement
  generator, then validate deterministic result reduction and cancellation.
- Remove unreachable legacy nodes and contracts only after parity tests pass,
  and publish before/after call, token, latency, and objective-success data.

### 2026-08-04 - ROM-21 - V1 continuity and learned-policy seam

Status: documented; implementation not_started.

Changes:

- Recorded that the current physical robot is V1 of the intended intelligent
  pet and must be extended rather than discarded behind a later architecture.
- Defined the separation between MetaHuman pet cognition, the Embodied Skill
  Runtime, a replaceable Locomotion Backend, independent safety, and the V1
  actuator driver.
- Defined the responsibilities of `BodyMotionCommand`, truthful
  `RobotStateSnapshot`, bounded backend output, and `MotionPolicyManifest`.
- Preserved V1 named motions as the first backend and future fallback while
  placing deterministic camera feedback and a trained policy behind the same
  seam.
- Added the sensor, digital-twin, export, replay, simulator, shadow-mode, and
  physical-admission sequence required before learned locomotion can control the
  body.

Evidence:

- V1 currently has working semantic motion assets and a camera path but only
  commanded servo state; no maintained measured joint, IMU, contact, clearance,
  or odometry state is available to a trained locomotion policy.
- Maintained robot-learning systems train policies against explicit observation
  and action spaces and can export inference artifacts, but useful sim-to-real
  deployment depends on matching those semantics and dynamics on the physical
  body.
- The immediate active-view controller and replay work can populate the same
  state/action/result boundary without pretending a learned policy already
  exists.

Validation:

- Documentation was checked against the measured V1 hardware inventory,
  active-view roadmap, independent-safety requirement, and existing adapter and
  Environment Interface ownership.
- No runtime source, graph, model, adapter, gateway, firmware, or physical robot
  behavior changed in this documentation step.

Remaining:

- Implement the minimal versioned `ROM-21` contracts inside the existing
  Ainekio/MetaHuman ownership boundaries while building the V1 feedback skill.
- Record V1 body-response and sensor data before selecting a trained locomotion
  architecture or purchasing sensors for it.
- Keep policy training and physical policy admission deferred until the
  required instrumentation and simulation acceptance exist.

### 2026-08-05 - ROM-22 - Isolated active-view hygiene gate

Status: validated as an unregistered experiment; runtime integration remains
not_started.

Changes:

- Rolled back the premature edits to Ainekio's existing adapter export,
  translation, server, launcher, and example-environment files. The active-view
  experiment does not have a runtime import, action translation, capability
  advertisement, configuration entry, or live dispatch path.
- Replaced the two large prototype modules with an isolated
  `gateway/environment_adapter/active_view/` package. Contracts, the bounded
  latest-frame mailbox, controller, subprocess client, and experimental vision
  worker now have separate owners.
- Replaced the invalid no-frame `timestamp: "unavailable"` progress record.
  Malformed requests now produce no wire progress, while terminal results for a
  valid request retain its validated frame id and timezone-aware timestamp.
- Added an explicit controller and perception shutdown lifecycle. Controller
  shutdown cancels and drains an active run before the JSON-lines client asks
  its worker to exit, waits for it, and uses bounded terminate/kill fallbacks.
- Removed hidden references to nonexistent `turn_left_fine` and
  `turn_right_fine` assets. A future runtime configuration must name distinct,
  calibrated orientation assets before the controller can become available.
- Added a second availability gate for target-identity validation. Grounding
  DINO acquisition and OpenCV MIL remain established components, but the
  project-authored HSV-histogram continuity check is explicitly experimental
  until it passes OV3660 replay.

Rollback manifest:

- Experiment source:
  `Ainekio/Master/gateway/environment_adapter/active_view/__init__.py`,
  `contracts.py`, `controller.py`, `mailbox.py`, `worker.py`, and
  `worker_client.py`.
- Experiment validation:
  `Ainekio/Emulator/tests/test_active_view.py` and
  `Ainekio/Emulator/tests/fixtures/active_view_worker_stub.py`.
- Runtime entry points: none. Existing Ainekio files are unchanged, so rollback
  does not require restoring an adapter, launcher, translation, capability, or
  environment file.
- Configuration, installed dependencies, generated data, captured media, and
  persistent state: none.
- Exact removal order: remove the worker stub, remove the active-view test, then
  remove the unregistered `active_view/` package. No existing tracked file must
  be edited to make the feature absent.

Evidence:

- Ainekio `git diff --name-only` is empty. `git status --short` reports only the
  new package and test paths, not modifications to existing adapter or Gateway
  source.
- A maintained-owner search found no active-view import, `inspect` translation,
  inspection target handling, or `activeView` capability in
  `environment_adapter/server.py`, `translation.py`, `__init__.py`, or
  `gateway/server/__main__.py`.
- The isolation test directly verifies that `translate_environment_action()`
  rejects `inspect`, the ready observation does not advertise `inspect`, and it
  contains no `activeView` capability.

Validation:

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=Master:Slave/software:. python3 -m
  unittest Emulator.tests.test_active_view` passed 11 of 11 tests without a
  camera, Gateway connection, model load, or physical motion.
- The combined active-view, Environment Adapter, and command-catalog regression
  run passed 45 of 45 tests. The first restricted-sandbox run could not bind the
  existing localhost WebSocket fixtures; the authorized rerun with loopback
  sockets available passed all tests.
- All eight active-view package, test, and fixture Python files parsed through
  the standard-library AST parser. The worker lifecycle test starts a
  dependency-free subprocess, performs a correlated acquisition request, asks
  it to shut down, and verifies a zero exit code. A second lifecycle test uses a
  deliberately non-exiting stub to verify the bounded forced-shutdown fallback.
- `node --import tsx --test
  packages/core/src/environment-interface/visual-approach.spec.ts` passed the
  MetaHuman inspection-target and active-view progress normalization contract,
  including its valid-date requirement.
- No model was downloaded or loaded. No robot, camera, Environment action, or
  physical movement was used.

Remaining:

- Capture ignored, action-indexed OV3660 replay covering distractors, low light,
  occlusion, full loss, and reacquisition; do not set the identity-validation
  gate from public or synthetic footage.
- Create and physically calibrate small left/right orientation assets, with the
  owner authorizing the physical test separately; do not substitute the
  existing 45-degree turns or invent asset names.
- Review replay outcomes and the rollback manifest before proposing any edit to
  the Ainekio adapter, launcher, translation, or capability owners.
- Keep forward locomotion, live dispatch, and capability advertisement outside
  this hygiene checkpoint.

### 2026-08-05 - ROM-23 - Action-indexed Body Emulator replay seam

Status: validated with remote-safe synthetic frames; recorded OV3660 replay
remains pending under `ROM-19`.

Changes:

- Added a bounded `ActionIndexedReplay` inside the removable active-view
  package. It structurally implements the existing Body Emulator camera-source
  and motion-backend seams: initial frames are available immediately, while
  later frames remain locked until the exact expected semantic action executes.
- Reused `BodySession` without changing it. The replay test sends the
  controller's semantic orientation command through the normal protocol
  acceptance and motion lifecycle; `BodySession` then captures the newly
  unlocked frame through its existing `origin: action` snapshot before emitting
  `done`.
- Used two simulator-only `replay_left_step` and `replay_right_step` assets
  supplied by a test `AssetStore` subclass. They are not added to the V1 motion
  catalog, are not advertised, and do not claim a physical angle or
  calibration.
- Kept perception deterministic in this proof. The first replay frame reports
  horizontal error, the action-indexed post-action frame reports centering, and
  an ordinary preview frame verifies continuity. No synthetic result changes
  the Grounding DINO/OpenCV identity-validation gate.
- Added fail-closed replay matching: a wrong semantic action does not consume
  the step or unlock its frames.

Rollback manifest extension:

- Added source:
  `Ainekio/Master/gateway/environment_adapter/active_view/replay.py`.
- Added validation:
  `Ainekio/Emulator/tests/test_active_view_replay.py`.
- Feature-owned export changed: the unregistered active-view package
  `__init__.py` exports `ActionIndexedReplay` and `ActionIndexedReplayStep`.
- Shared tracked files, live entry points, configuration, services, processes,
  ports, dependencies, model artifacts, caches, persistent state, and physical
  assets introduced: none.
- Removal order: remove `test_active_view_replay.py`, remove the two replay
  exports from the feature-owned `__init__.py`, then remove `replay.py`. The
  earlier `ROM-22` package-removal procedure remains valid and no BodySession,
  adapter, Gateway, or MetaHuman file needs repair.

Evidence:

- The controller acquired an off-center target from the initial frame, issued
  one `emote/replay_left_step`, consumed the normal post-action frame, consumed
  one preview verification frame, and returned `reached` for the same target.
- The recorded capture sequence was `XGA` initial request, `XGA` post-action
  snapshot, then `QVGA` preview verification. The action-correlated `cam_meta`
  preceded the matching `done` event in the real BodySession control stream.
- Replay status ended with zero remaining steps, zero available frames, one
  exact executed semantic action, and no stop. A deliberately wrong right-step
  request left the planned step and initial frame untouched.

Validation:

- `PYTHONDONTWRITEBYTECODE=1
  PYTHONPATH=Master:Slave/software:Emulator:. python3 -m unittest
  Emulator.tests.test_active_view_replay` passed 2 of 2 tests.
- The active-view, replay, BodySession media/session, and command-catalog suite
  passed 62 of 62 tests.
- The final combined active-view, replay, BodySession media/session,
  Environment Adapter, and command-catalog suite passed 93 of 93 tests with
  localhost WebSocket fixtures enabled.
- All ten current active-view source/test Python files passed AST and trailing
  whitespace checks. Maintained adapter/translation/launcher owners still have
  no active-view import or advertised `inspect` path, and Ainekio still has no
  tracked-file diff.
- No model was loaded, no live Gateway or Environment action was used, and no
  camera or physical robot was activated.

Remaining:

- Locate or capture ignored owner-local OV3660 sequences and define the smallest
  manifest needed to bind each frame to its semantic action and labeled target.
- Run the exact replay lifecycle with real JPEGs, detector/tracker estimates,
  distractors, occlusion, full loss, and reacquisition; record metrics rather
  than promoting this deterministic mechanics proof into perception evidence.
- Keep both runtime gates false and make no adapter composition-point proposal
  until recorded replay supplies acceptance thresholds.

### 2026-08-05 - ROM-19 evidence C - Ignored-capture replay manifest

Status: manifest and integrity mechanics validated; no owner-local OV3660
dataset is currently available.

Changes:

- Added the smallest file-backed contract needed to move from in-memory replay
  bytes to ignored local recordings. A versioned manifest names one bounded
  target/query, initial frames, semantic action-indexed steps, exact frame ids
  and timestamps, relative JPEG files, SHA-256 digests, normalized target boxes,
  and `visible`, `occluded`, or `lost` label state.
- The loader resolves every frame beneath the manifest directory, rejects path
  traversal and missing files, verifies content digests, enforces unique frame
  ids and bounded counts, and then constructs the existing
  `ActionIndexedReplay`. It does not create a second replay engine or camera
  path.
- Restricted action matching to bounded semantic scalar fields. Manifest data
  cannot inject sequence ownership, private prepared-motion fields, nested
  motion plans, model settings, or arbitrary controller state.
- Searched current MetaHuman `out`, `logs`, and `data/user-data` paths and the
  Ainekio `build` tree for reusable JPEG/PNG captures. No recorded OV3660 media
  was present. Historical `ainekio-camera-*` identifiers therefore cannot be
  converted into replay evidence without a new owner-authorized capture.
- Relied on the existing Ainekio ignore rules for `recordings/`, `captures/`,
  and `snapshots/`; no camera content, personal path, or example recording was
  added to maintained source.

Rollback manifest extension:

- Added source:
  `Ainekio/Master/gateway/environment_adapter/active_view/replay_manifest.py`.
- Added validation:
  `Ainekio/Emulator/tests/test_active_view_replay_manifest.py`.
- Feature-owned export changed: the unregistered package `__init__.py` exports
  `LoadedActionIndexedReplay`, `RecordedReplayFrame`, and
  `load_action_indexed_replay`.
- Shared tracked files, runtime entry points, configuration, dependencies,
  services, processes, ports, generated data, and persistent state introduced:
  none.
- Removal order: remove `test_active_view_replay_manifest.py`, remove its three
  exports from the feature-owned `__init__.py`, then remove
  `replay_manifest.py`. The `ROM-22`/`ROM-23` removal procedures remain
  otherwise unchanged.

Validation:

- The replay-manifest suite passed 3 of 3 tests: one valid bounded dataset,
  one escaping frame path, and one content/digest mismatch.
- The combined action-indexed lifecycle and file-manifest replay suite passed 5
  of 5 tests after splitting those test owners into separate files.
- The final active-view, replay, BodySession media/session, Environment Adapter,
  and command-catalog regression suite passed 96 of 96 tests.
- All twelve current active-view package/test files passed AST, trailing
  whitespace, and 100-column checks. Ainekio still reports only the isolated
  untracked package/tests and no tracked-file diff.
- No model, live camera, Gateway, Environment action, or physical movement was
  used.

Remaining:

- A new OV3660 capture requires explicit owner authorization because no suitable
  local frames remain. Capture data must stay in an ignored replay directory.
- The first dataset should include an initial off-center view, exact small
  left/right action boundaries, post-action and verification frames,
  distractors, low light, partial occlusion, full loss, and reacquisition.
- After labeling, run Grounding DINO/OpenCV and the controller against the
  manifest, record per-stage latency and identity/control metrics, and set
  evidence-based gates. Do not enable runtime integration from the manifest
  mechanics alone.

### 2026-08-05 - ROM-19 evidence D - Idle-state preview admission trace

Status: measured live without motion; the authorized preview attempt did not
produce a fresh QVGA sequence and is not accepted as replay evidence.

Authorization and scope:

- The owner authorized one camera-only capture at QVGA and 5 fps, bounded to 30
  seconds, beneath Ainekio's ignored `recordings/` owner. Motor commands and
  physical movement were explicitly excluded.
- The capture reused the already-running physical Gateway and its authenticated,
  localhost-only Dashboard API. It did not start a second Gateway, camera owner,
  adapter, or model process.
- The temporary capture client allowed only Dashboard login, status, camera
  configuration, and camera-frame requests. It contained no intent,
  motion-plan, state, stop, detach, microphone, or TTS endpoint.

Evidence:

- The Gateway was live with one authenticated robot on the home profile. Robot
  transport and Dashboard listeners remained owned by the same production
  Gateway process.
- Gateway sequences 3 and 4 issued `cam on` and `cam off`; the body acknowledged
  sequence 4, ended with no pending commands, remained connected and idle, and
  reported `camera_ready: true` with `cam_drops: 0`.
- The 30.006-second request returned only the Dashboard's already-held counter 1
  frame at the start. No subsequent counter arrived. That frame measured
  1024x768 rather than the requested QVGA, so it is classified as a stale XGA
  frame and not as a successful preview sample.
- Firmware explains the result. `sync_camera_stream()` applies preview only
  when camera streaming is requested, fps is nonzero, profile is home, and the
  body core state is `AINEKIO_STATE_ACTIVE`. The robot was already
  `AINEKIO_STATE_IDLE`, so the command was accepted while the computed applied
  stream state remained false.
- The core returns from idle to active only for an accepted intent, motion plan,
  or snapshot. It automatically returns active to idle after 60 seconds without
  intent activity. The Dashboard exposes idle, doze, and sleep controls but no
  direct active-state request.

Architecture findings:

- Command acceptance and applied camera state are currently different facts,
  but status and the `cam` acknowledgement expose only enough information to
  infer the difference after frames fail to arrive. A maintained camera lease
  needs an explicit applied/streaming state or a fail-closed readiness result.
- The Dashboard frame mailbox retains its last JPEG and counter across camera
  on/off cycles. A new consumer therefore must establish a pre-command counter
  watermark and reject the held frame until a later counter arrives.
- A physical active-view skill cannot assume that `camera_ready: true` means
  preview is flowing. `camera_ready` currently means the device exists; it does
  not prove active streaming, requested resolution, requested cadence, or frame
  freshness.
- No firmware or Gateway source was changed from this trace. A camera-only
  follow-up can use a snapshot to transition the existing lifecycle to active
  before preview, but it requires a separate owner-authorized capture because
  it would be a second physical sequence.

Local data and rollback:

- One ignored owner-local capture directory contains the bounded metadata and
  the single stale frame. It is retained only as failure evidence and must not
  be converted into an action-indexed replay or committed.
- Maintained source files, runtime registration, configuration, dependencies,
  services, ports, model artifacts, and physical motion assets introduced:
  none.
- To remove the local evidence, delete only that one ignored capture directory.
  No MetaHuman, Gateway, adapter, firmware, or Body Emulator repair is needed.

Remaining:

- Obtain separate authorization before another live capture. For a camera-only
  retry, record the pre-command counter, request preview, use one correlated
  snapshot to transition the existing body lifecycle to active, require a
  strictly newer counter and measured QVGA dimensions, then request preview off
  in a bounded `finally` path.
- Before runtime integration, decide whether active skills should own a typed
  camera lease that can wake the camera lifecycle without a fake conversational
  intent. Expose requested versus applied stream state and freshness through
  the existing Gateway/status contracts rather than teaching each consumer the
  firmware's implicit state rule.
- This trace does not satisfy the distractor, occlusion, loss, reacquisition,
  detector/tracker, action-correlation, or control-improvement gates.

### 2026-08-05 - ROM-19 evidence E - Gateway snapshot-woken QVGA baseline

Status: validated as a bounded camera-only baseline; action-indexed perception
and control acceptance remain pending.

Authorization and scope:

- After evidence D exposed the idle-state gate, the owner authorized using the
  Gateway to wake and operate the camera. Firmware changes were permitted for
  later consideration if the maintained camera path could not provide video.
- The retry remained camera-only. It issued preview on, one correlated snapshot,
  and preview off through the existing authenticated Gateway Dashboard. It did
  not issue an intent, motion plan, servo command, power-state command, or
  physical movement.
- Preview remained bounded to 30 seconds at QVGA and 5 fps. Captured media and
  metadata remain beneath Ainekio's ignored `recordings/` owner.

Evidence:

- The consumer first recorded the Dashboard's held-frame watermark: counter 1,
  1024x768. It then rejected that stale frame from the new sequence.
- Gateway sequence 5 requested QVGA preview. Sequence 6 requested an XGA
  snapshot through the existing camera owner; that camera-only command changed
  the body lifecycle from idle to active and completed normally.
- Fresh counter 2 was the correlated 1024x768 snapshot. Counters 3 through 147
  were 145 fresh 320x240 preview JPEGs. Counters were unique, strictly ordered,
  and gap-free, and every preview payload had a distinct SHA-256 digest.
- The preview measured 4.848 fps. Median inter-frame arrival was 205.838 ms,
  p95 was 367.718 ms, and the longest interval was 424.016 ms.
- Preview JPEGs ranged from 6,156 to 6,318 bytes with a 6,242-byte median. The
  145 preview payloads totaled 905,146 bytes and averaged approximately 30.47
  KiB/s, or 0.244 Mbit/s, before WebSocket and network framing.
- Visual checks of the initial XGA snapshot and middle/final QVGA frames showed
  a coherent, static, low-light room view rather than corrupt or repeated image
  bytes.
- Sequence 7 requested preview off. A later status check, performed after the
  asynchronous acknowledgement arrived, showed sequence 7 terminal, zero
  pending commands, the body returned to idle, `camera_ready: true`, and
  `cam_drops: 0`.

Architecture findings:

- The current Gateway and firmware can provide bounded QVGA preview; no firmware
  rewrite is required merely to obtain a live stream.
- The wake mechanism is implicit: `cam on` records the requested configuration
  while idle, and a later snapshot changes the core to active so
  `sync_camera_stream()` applies it. This is usable for evidence collection but
  should not become duplicated consumer-side folklore.
- An active skill should acquire a typed, bounded camera lease through the
  existing Gateway owner. The lease should expose requested versus applied
  state, its frame-counter watermark, resolution, measured cadence, owner, and
  expiry. It should release preview in a bounded finalization path.
- Preview must remain off by default. The present robot intentionally avoids an
  always-on stream because battery and data transmission are constrained. A
  future firmware contract may make bounded lease activation explicit, but it
  should not silently turn every idle state into continuous video.
- The capture utility's immediate post-off status sample saw sequence 7 pending
  even though the acknowledgement arrived normally moments later. Completion
  checks must await the matching terminal sequence instead of sampling pending
  state once.

Local data and rollback:

- The accepted owner-local baseline contains one XGA wake snapshot, 145 QVGA
  preview JPEGs, and one integrity/telemetry manifest. Its allocated local size
  is approximately 2.5 MiB. It remains ignored and must not be committed.
- Maintained MetaHuman, Gateway, adapter, firmware, protocol, emulator, and
  active-view source changed by this capture: none.
- The temporary camera client is removed after validation. Removing the one
  ignored capture directory removes all persistent data from this evidence
  run; no source or runtime registration needs repair.

Remaining:

- Treat this sequence as a low-light static-camera baseline, not as proof of
  target identity, occlusion handling, reacquisition, viewpoint improvement, or
  objective completion.
- Add labels only for observations actually visible in these frames. Do not
  fabricate action boundaries or promote the wake snapshot into a robot motion
  step.
- Obtain separate action-correlated frames before replaying controller course
  corrections. Physical robot movement remains separately authorized per exact
  test; owner-arranged scene changes can supply non-motor distractor and
  occlusion evidence.
- Use this baseline to measure acquisition and static tracking before proposing
  the smallest Gateway camera-lease/applied-state contract.

### 2026-08-05 - ROM-19 evidence F - OV3660 acquisition and static tracking

Status: static low-light acquisition and continuity measured; identity,
localization accuracy, loss/reacquisition, and control gates remain false.

Changes:

- Reused the isolated Grounding DINO Tiny/OpenCV MIL worker and MetaHuman's
  existing vLLM Python environment. The cached model loaded with downloads
  disabled; no dependency, checkpoint, or alternate inference environment was
  added.
- Corrected the worker's OpenCV boundary after real acquisition reached
  `TrackerMIL.init()`: detector rectangles are now converted from bounded float
  geometry to the integer `Rect` required by OpenCV 4.13.
- Corrected a second real-camera boundary without teaching the controller a
  camera-resolution special case. The worker now retains its normalized box
  and frame dimensions; when XGA acquisition is followed by QVGA preview, it
  scales the last box, checks the existing appearance support, and reinitializes
  the tracker on the new pixel geometry.
- Added pure contract tests for bounded integer OpenCV geometry and normalized
  box rebasing. The worker remains isolated, unregistered, and disabled by the
  fine-turn and identity-validation gates.

Acquisition evidence:

- Screened three targets visibly present in the actual recording on the XGA
  wake snapshot and first QVGA preview. Each case ran three times through the
  JSON-lines subprocess boundary.
- `bed in the background` was acquired on XGA at 0.335 confidence but was not
  detected on QVGA. `light rectangular storage bin left of center` measured
  0.442 on XGA and 0.331 on QVGA.
- `dark vertical metal post in the center` was the strongest consistent target:
  0.747 confidence on XGA and 0.637 on QVGA. Its normalized detector boxes were
  nearly identical across resolutions and were visually checked against the
  central post in the source images.
- Worker/model startup measured 4,353.627 ms. The first cold acquisition request
  measured 601.463 ms; subsequent recorded cases were generally approximately
  180 to 200 ms. Grounding DINO remains an acquisition/reacquisition tier, not a
  per-preview-frame operation.

Tracking evidence:

- Before resolution rebasing, XGA acquisition lost the target on the first QVGA
  frame at counter 3. QVGA-only tracking retained all 144 subsequent frames,
  proving the loss came from pixel-state transition rather than missing target
  evidence.
- After the correction, three XGA-to-QVGA runs retained all 145 frames each and
  three QVGA-only controls retained all 144 frames each: 867 of 867 attempted
  tracking frames reported continuity.
- Mean per-frame tracking latency across the six runs ranged from 18.535 to
  21.934 ms. The highest per-run p95 was 24.227 ms and the overall observed
  maximum was 27.164 ms, comfortably below the measured approximately 206 ms
  median camera interval at 5 fps.
- This is not localization ground truth. Against the fixed QVGA detector box
  used only as a reference, XGA-rebased runs showed median horizontal offsets
  from 0.884 to 7.116 pixels and a 9.116-pixel observed maximum. QVGA-only runs
  showed 2.116 to 10.116-pixel medians and an 11.116-pixel observed maximum.
- Reference-box IoU fell as low as 0.379 while the project-authored HSV gate
  continued to report at least approximately 0.508 confidence. The worker can
  sustain a coarse static track, but this single scene does not prove box
  accuracy or that the appearance heuristic would reject an identity switch.

Rollback manifest extension:

- Feature-owned source changed:
  `Ainekio/Master/gateway/environment_adapter/active_view/worker.py`.
- Existing feature-owned validation changed:
  `Ainekio/Emulator/tests/test_active_view.py`.
- Shared tracked source, adapter registration, translation, capability
  advertisement, launcher composition, configuration, ports, services,
  dependencies, model artifacts, firmware, and physical assets introduced:
  none.
- Owner-local ignored evidence added beside the capture: one acquisition JSON
  and one static-tracking JSON. They contain measurements and frame references,
  not duplicate camera media.
- To remove only this correction, remove the tracker-size/normalized-box state,
  integer-rectangle conversion, resolution-rebase branch, and their two tests.
  The broader `ROM-22` package-removal procedure remains unchanged.

Validation:

- The focused active-view suite passed 13 of 13 tests, including the new integer
  OpenCV rectangle and normalized cross-resolution geometry contracts.
- The final active-view, replay, BodySession media/session, Environment Adapter,
  and command-catalog regression passed 98 of 98 tests with localhost fixtures
  enabled. The first restricted run reached the same 98 tests but the three
  existing WebSocket fixtures could not bind loopback sockets.
- The cached CUDA worker completed all 18 acquisition requests and all six
  full-sequence tracking runs through its JSON-lines process boundary. No model
  download, live Gateway request, camera activation, or physical movement was
  involved in inference.
- All twelve feature-owned package/test Python files passed AST, trailing
  whitespace, and 100-column checks. Both ignored evidence JSON files parse,
  Ainekio has no tracked-file diff, and maintained adapter/translation/launcher
  owners remain unchanged.

Remaining:

- Do not set `identity_gate_validated` from 100-percent static retention. Obtain
  manual labels plus distractor, partial-occlusion, full-loss, and reappearance
  sequences and score identity switches, false retention, and reacquisition.
- Measure per-frame localization error against human labels. Detector-box
  reference overlap is useful for drift screening but is not ground truth.
- Compare the current MIL variance with the existing optical-flow baseline and
  the supported EdgeTAM streaming options before selecting the V1 tracker.
- Obtain action-correlated before/after frames before changing the controller's
  progress threshold or claiming that visual correction improves an objective.
- Keep adapter integration and capability advertisement outside this evidence
  batch.

### 2026-08-05 - ROM-19 evidence G - Static optical-flow control baseline

Status: forward-backward optical flow selected as the current static
view-displacement baseline; identity and reacquisition selection remain open.

Changes:

- Reused OpenCV 4.13 from the existing perception environment. The installed
  build exposes MIL but not KCF, CSRT, or the legacy tracker module, so no second
  OpenCV package was installed merely to widen the comparison.
- Compared OpenCV MIL with established pyramidal Lucas-Kanade optical flow on
  the same 145-frame QVGA sequence and fixed Grounding DINO reference box.
- The optical-flow screen used forward-backward consistency and a minimum of
  four retained features to reject unsupported displacement. That surrounding
  propagation logic is benchmark glue, not selected production identity code.
- Ran three repeats of each method. No detector, model, live Gateway, camera, or
  physical robot was used in this comparison.

Evidence:

- Both methods retained all 144 attempted updates in all three repeats: 432 of
  432 MIL updates and 432 of 432 optical-flow updates.
- MIL mean latency ranged from 18.273 to 19.259 ms per frame, with per-run p95
  from 20.163 to 23.421 ms and an observed maximum of 28.548 ms.
- MIL's median horizontal offset from the fixed detector reference ranged from
  1.116 to 6.116 pixels; its observed maximum was 8.116 pixels. Reference IoU
  fell as low as 0.503 in the three direct OpenCV repeats.
- Forward-backward Lucas-Kanade mean latency ranged from 0.414 to 0.568 ms,
  per-run p95 from 0.776 to 0.845 ms, and the observed maximum was 1.668 ms.
- Optical flow was deterministic across the three repeats on this recording.
  Median horizontal offset was approximately 0.010 pixels, observed maximum
  was 0.038 pixels, and reference IoU remained at least 0.9965.

Decision:

- Use forward-backward optical flow as the lightweight V1 baseline for
  short-horizon image displacement and control-progress measurement when the
  acquired target contains sufficient retained features.
- Do not treat optical flow as object identity. Grounding DINO remains the
  semantic acquisition/reacquisition candidate, while durable association,
  occlusion handling, and full-loss recovery still require labeled evidence and
  comparison with a supported video tracker such as EdgeTAM.
- Do not replace the isolated MIL worker from one static scene. The comparison
  narrows the next experiment; it does not establish production adoption.

Local data and rollback:

- One ignored owner-local `opencv-tracker-comparison` JSON records per-frame and
  aggregate measurements beside the existing capture. It adds no duplicate
  image data.
- Maintained source, dependencies, configuration, model artifacts, services,
  ports, runtime registration, and physical state changed by this comparison:
  none.
- Removing that ignored JSON removes all persistent data from this screen.

Remaining:

- Repeat the comparison on targets with low texture, moving distractors,
  partial occlusion, full loss, and reappearance. Measure feature exhaustion,
  false displacement, identity switches, and bounded detector reacquisition.
- Add human-labeled target boxes before converting reference overlap into an
  accuracy threshold.
- Use action-correlated before/after frames to test whether optical-flow
  displacement agrees with the robot's commanded view correction and improves
  the same target.
- Keep the identity gate false and the active-view worker unregistered.

### 2026-08-05 - ROM-19 evidence H - Rejected dark identity phase

Status: camera lifecycle validated; phase rejected as identity evidence because
no semantic target remained consistent across XGA and QVGA.

Changes:

- Captured one owner-authorized six-second camera-only baseline after the owner
  asked work to continue. The existing Gateway snapshot-wake path produced one
  XGA snapshot and 25 fresh QVGA preview frames, then acknowledged preview off
  as sequence 12. No motion, servo, intent, or power-state command was issued.
- Screened three descriptions grounded in the actual dark scene. A separate
  raw-detector diagnostic was used after the combined worker exposed an
  acquisition-to-tracker failure; it did not initialize or score tracking.
- Made the acquisition handoff fail closed. If OpenCV rejects otherwise valid
  detector geometry, the worker now resets tracking state and returns a bounded
  missing-target reason instead of failing the correlated worker request.
- Added a dependency-free contract test for this untrackable-geometry result.

Evidence:

- The new scene was substantially darker and closer than evidence E. A vertical
  black object dominated the center, with a lighter perforated strip to its
  left, but visual appearance alone did not establish a movable target identity.
- `black electronic device in the center` was not detected on XGA and measured
  only 0.338 confidence on QVGA.
- `dark vertical object in the center` measured 0.301 on XGA and 0.323 on QVGA,
  but its boxes moved from approximately normalized x=0.523 on XGA to x=0.318
  on QVGA. Those detections do not support same-object continuity.
- `light perforated strip left of center` measured 0.340 on XGA. On QVGA the raw
  detector returned an approximately full-width bottom-of-frame box, visually
  corresponding to the carpet rather than the strip. MIL rejected that geometry
  because it could not generate positive target samples.
- After the correction, the same six combined acquisition cases completed and
  the unsuitable QVGA geometry returned `semantic target geometry could not
  initialize online tracking`. The worker remained correlated and shut down
  normally.

Rollback manifest extension:

- Feature-owned source changed:
  `Ainekio/Master/gateway/environment_adapter/active_view/worker.py`.
- Existing feature-owned validation changed:
  `Ainekio/Emulator/tests/test_active_view.py`.
- The correction adds no shared owner, registration, configuration, dependency,
  service, port, model, firmware, or physical asset.
- To remove only this correction, remove `_initialize_tracker_safely()`, restore
  the two direct tracker-initialization calls, and remove its fail-closed test.
  The broader active-view removal manifest remains unchanged.

Validation:

- The focused active-view suite passed 14 of 14 tests.
- The final active-view, replay, BodySession media/session, Environment Adapter,
  and command-catalog regression passed 99 of 99 tests with localhost fixtures
  enabled.
- Phase metadata, raw detector evidence, and the completed acquisition screen
  remain ignored owner-local JSON. Maintained adapter, translation, launcher,
  firmware, and MetaHuman runtime owners remain unchanged.

Decision and remaining:

- Do not label this phase as target-visible or use it to score identity. It is
  retained only as a low-light rejection and camera-lifecycle diagnostic.
- The next phase needs adequate light and one recognizable, movable ordinary
  object clearly separated from the background. The owner must identify the
  target before distractor, partial-occlusion, full-loss, and return phases are
  recorded.
- Keep the identity gate false and make no adapter integration from rejected
  evidence.

### 2026-08-05 - ROM-19 evidence I - Visible target with distinct distractor

Status: target acquisition and static short-sequence continuity validated for
this phase; identity under occlusion, loss, and return remains unvalidated.

Scene and capture:

- The owner identified a blue teardrop-shaped creature as the target and a
  coffee cup as the distractor in the live robot-camera scene.
- Captured one owner-authorized six-second camera-only phase through the
  existing Gateway dashboard path: one XGA snapshot plus 29 fresh QVGA preview
  frames at five frames per second. Preview-off received terminal acknowledgement
  sequence 17. No motion, servo, intent, or power-state command was issued.
- Visual inspection accepted the phase. Both objects were well lit, spatially
  separated, and continuously visible; the cup was in the left foreground and
  the blue creature was in the right foreground.

Acquisition evidence:

- The owner's exact description, `blue teardrop-shaped creature`, acquired the
  target at confidence 0.772 on XGA and 0.831 on QVGA. Its normalized center x
  was 0.734 in both resolutions, and the returned boxes covered approximately
  x=0.679, y=0.538, width=0.111, height=0.241 on XGA and x=0.679, y=0.529,
  width=0.112, height=0.251 on QVGA.
- Two descriptive sensitivity checks resolved to the same target and nearly the
  same box: `small blue teardrop-shaped creature` measured 0.808/0.824 on
  XGA/QVGA, and `blue spiky teardrop-shaped figurine` measured 0.719/0.756.
  These are benchmark probes, not prompt special cases or runtime aliases.
- A separate `coffee cup` acquisition resolved the distractor at normalized
  center x=0.318 on XGA and x=0.317 on QVGA, with confidence 0.965/0.953.
  This confirms that the two semantic queries were spatially separable in this
  phase rather than both attaching to one object.
- Worker startup measured 4,419 milliseconds. After the first warmed request,
  semantic acquisition generally measured 150 to 176 milliseconds; the first
  exact-query acquisition measured 599 milliseconds.

Tracking evidence:

- Exact-query XGA acquisition followed by the resolution rebase and all 29
  QVGA frames retained the target for 30 of 30 estimates. The rebase itself
  measured 7.9 milliseconds; subsequent MIL updates measured approximately
  26.7 to 38.6 milliseconds.
- Independent QVGA acquisition followed by the remaining 28 previews retained
  the target for 29 of 29 estimates. MIL updates measured approximately 24.9
  to 31.0 milliseconds.
- The target remained static and continuously visible. These results prove only
  acquisition consistency and short static continuity beside the cup. They do
  not prove durable identity, occlusion handling, full-loss rejection,
  distractor resistance after target loss, or semantic reacquisition.

Architecture, data, and rollback:

- This phase used the isolated, unregistered active-view worker and the existing
  camera transport. It did not enter the Environment Adapter runtime, MetaHuman
  graph, capability advertisement, or physical motion path.
- Capture files and phase metadata remain ignored owner-local data under
  `Ainekio/recordings/active-view/20260805-identity-sequence-01/`.
- The benchmark harness is temporary `/tmp` tooling. Maintained MetaHuman and
  Ainekio source, dependencies, configuration, services, ports, model files,
  firmware, and robot state were not changed by this phase.
- Removing the ignored phase directory removes the persistent capture. Removing
  the temporary benchmark harness removes the local test driver. There is no
  runtime rollback because nothing was registered or integrated.

Decision and remaining:

- Accept this as the target-with-distractor baseline for the current identity
  sequence. Do not set `identity_gate_validated` from one continuously visible
  phase.
- Next record the same scene with only the blue creature partially occluded
  while the cup remains visible. Then record full target loss with the cup still
  present, followed by the target returning at a different position.
- Score target retention during partial occlusion, prompt loss without an
  identity switch to the cup, and bounded semantic reacquisition after return.
  Keep the identity gate false and the worker unregistered until those phases
  and their regression expectations pass.

### 2026-08-05 - ROM-19 evidence J - Partial target occlusion

Status: partial-occlusion acquisition and short-sequence continuity validated
for this scene; full-loss rejection and return/reacquisition remain unvalidated.

Scene and capture:

- At the owner's confirmation, captured one camera-only phase with a separate
  dark object covering approximately the right half of the blue creature. The
  coffee cup remained unobstructed and spatially separate on the left.
- The existing Gateway path produced one XGA snapshot plus 29 fresh QVGA
  previews over six seconds. Preview-off received terminal acknowledgement
  sequence 23. No motion, servo, intent, or power-state command was issued.
- Visual inspection accepted the phase as partial rather than full occlusion:
  the creature's left outline and color remained visible beside the occluder.

Fresh acquisition evidence:

- `blue teardrop-shaped creature` still acquired the visible target fragment at
  confidence 0.693 on XGA and 0.784 on QVGA. Its normalized center x measured
  0.729/0.733, close to the unobstructed phase's approximately 0.734 center.
- The detected width contracted from approximately 0.111/0.112 in the visible
  phase to 0.086/0.093 under occlusion while height remained approximately
  0.242/0.248. This is consistent with the visible portion becoming narrower;
  it is not by itself proof of stable identity.
- Independent `coffee cup` acquisition remained at normalized center x
  0.321/0.323 with confidence 0.967/0.936. The semantic target and distractor
  remained separated by approximately 0.41 normalized image width.

Continuity evidence:

- Unobstructed XGA acquisition followed by partial-occlusion XGA and all 29
  partial QVGA frames retained a target for 31 of 31 estimates. Center x stayed
  between 0.733 and 0.740; confidence ranged from 0.586 to 0.772. Updates
  averaged 28.1 milliseconds and reached 35.0 milliseconds maximum.
- Unobstructed final-QVGA acquisition followed by all 29 partial QVGA frames
  retained a target for 30 of 30 estimates. Center x stayed between 0.735 and
  0.741; confidence ranged from 0.717 to 0.858. Updates averaged 29.2
  milliseconds and reached 38.8 milliseconds maximum.
- Fresh partial-XGA acquisition followed by all 29 partial QVGA frames retained
  a target for 30 of 30 estimates. Center x stayed between 0.727 and 0.730;
  confidence ranged from 0.687 to 0.693. Updates averaged 28.5 milliseconds and
  reached 41.8 milliseconds maximum.
- In all three sequences, every retained box remained closer to the independently
  acquired creature center than to the independently acquired cup center. No
  measured identity switch to the cup occurred.

Interpretation and limits:

- This phase supports short-horizon continuity under one moderate, static
  occlusion pattern. It does not establish general occlusion robustness; the
  target did not move, the occluder did not move during capture, and the
  creature retained visible color and outline.
- The experimental HSV score did not cause target loss in this case, but these
  results do not validate its thresholds. A full target-loss phase is required
  to test whether it fails closed instead of tracking the occluder, background,
  or cup.
- The temporary benchmark's target-versus-distractor distance comparison is an
  offline measurement derived from this scene's independent acquisitions. It
  is not a hard-coded runtime object location or special-case prompt rule.

Architecture, data, and rollback:

- The phase used only the isolated worker and existing camera transport. No
  source, dependency, model, configuration, service, port, firmware, runtime
  registration, capability advertisement, graph, or robot behavior changed.
- Capture and phase metadata remain ignored owner-local data beside evidence I.
  The transition benchmark remains temporary `/tmp` tooling.
- Removing the ignored phase directory and temporary harness removes all data
  introduced by this phase; no runtime rollback is required.

Decision and remaining:

- Accept this phase as partial-occlusion evidence, but keep
  `identity_gate_validated` false and the worker unregistered.
- Next fully cover or remove only the blue creature while leaving the coffee cup
  visible and the camera fixed. Measure where continuity declares loss, whether
  any box transfers to the cup, and whether semantic acquisition correctly
  reports the target absent.
- After full-loss evidence, return the same creature at a different position to
  measure bounded semantic reacquisition and distractor resistance.

### 2026-08-05 - ROM-19 evidence K - Full target loss exposes false retention

Status: semantic absence validated for this phase; current online identity gate
failed the full-loss acceptance case and must not be enabled.

Scene and capture:

- At the owner's confirmation, captured one camera-only phase with a large white
  bottle covering the blue creature's prior image region. The coffee cup
  remained visible and unobstructed on the left, and the camera stayed fixed.
- The existing Gateway path produced one XGA snapshot plus 29 fresh QVGA
  previews over six seconds. Preview-off received terminal acknowledgement
  sequence 26. No motion, servo, intent, or power-state command was issued.
- A tiny blue fringe remained visible at the bottle's lower-left edge, but the
  creature's distinguishing outline and appearance were absent. The operational
  acceptance condition therefore remained strict: semantic creature acquisition
  must report absent, and continuity must not claim the occluder as the target.

Fresh acquisition evidence:

- `blue teardrop-shaped creature` returned no target at either resolution. XGA
  rejected multiple weak, spatially separate candidates as ambiguous; QVGA
  reported `semantic target was not detected`.
- Independent `coffee cup` acquisition remained stable at normalized center x
  0.322 in both resolutions with confidence 0.957/0.942.
- Independent `white bottle` acquisition measured normalized center x
  0.804/0.802 with confidence 0.954/0.945. Its large box occupied and extended
  beyond the creature's former region.
- These results establish that Grounding DINO did not semantically relabel the
  cup or bottle as the creature in this phase. They do not rescue the online
  tracker result below.

Continuity failure:

- Unobstructed XGA acquisition followed by loss XGA and all 29 loss QVGA frames
  falsely retained a target for 31 of 31 estimates. Confidence fell only from
  0.772 to a minimum of 0.514, and the reported center stayed near the former
  target region at x=0.727 to 0.736.
- Unobstructed final-QVGA acquisition followed by all 29 loss QVGA frames
  falsely retained a target for 30 of 30 estimates. The first loss-frame update
  moved to center x=0.778, toward the independently detected bottle center, then
  drifted back to x=0.731. Confidence remained 0.510 to 0.858.
- Partial-occlusion final-QVGA acquisition followed by all 29 loss QVGA frames
  also falsely retained a target for 30 of 30 estimates. Its center stayed at
  x=0.714 to 0.733 and confidence remained 0.521 to 0.612.
- All updates remained computationally normal at approximately 27.6 to 29.6
  milliseconds mean. This is a correctness failure, not a timeout, worker
  lifecycle failure, or insufficient processing budget.

Diagnosis:

- OpenCV MIL is a location/appearance tracker, not an identity authority. It
  continued producing boxes after the tracked creature was replaced by an
  occluder.
- The project-authored HSV-histogram correlation transformed those replacement
  crops into confidence above the current 0.2 cutoff. It therefore failed to
  distinguish partial target support from complete semantic loss.
- Because the tracker never declared loss, the controller's bounded semantic
  reacquisition path would not be entered. The current implementation can thus
  report progress toward the wrong visual region even though the semantic model
  correctly reports the requested target absent when queried directly.
- Raising one HSV threshold from this single scene would be an overfit patch.
  The evidence instead requires a designed identity-verification policy that
  periodically or conditionally consults semantic evidence, separates tracking
  confidence from identity confidence, and has replay-backed transition rules.

Architecture, safety, and rollback:

- The failure occurred entirely in offline replay through the isolated,
  unregistered worker. It did not enter the Environment Adapter, MetaHuman
  workflows, capability advertisement, or physical motion path.
- No source, dependency, configuration, service, port, model, firmware, runtime
  registration, graph, or robot state changed. Capture files remain ignored
  owner-local data and the benchmark is temporary `/tmp` tooling.
- Removing the ignored phase directory and temporary harness removes all data
  introduced by this phase; there is no runtime rollback.

Decision and remaining:

- Record this as a failed full-loss acceptance case. Keep
  `identity_gate_validated` false, keep fine-turn control unavailable, and keep
  the active-view feature unregistered.
- Capture the creature returning at a clearly different image position. Measure
  direct semantic reacquisition separately, while explicitly recording that the
  current controller would not request it because false retention suppresses
  the loss transition.
- Use the completed visible, partial, loss, and return sequence to specify and
  test a non-special-cased identity-verification policy before changing the
  worker or controller. The policy must fail closed on this loss phase without
  destroying the proven partial-occlusion continuity.

### 2026-08-05 - ROM-19 evidence L - Return and suppressed reacquisition

Status: direct semantic return/reacquisition validated for this scene; current
continuous tracker path failed to discover the returned target.

Scene and capture:

- At the owner's confirmation, captured the blue creature fully visible between
  the coffee cup and white bottle. The creature moved from its original
  normalized center near x=0.734 to a clearly different center near x=0.529;
  the cup, bottle, and camera remained fixed.
- The Gateway produced one XGA snapshot plus 28 fresh QVGA previews over the
  bounded camera-only phase. Preview-off received terminal acknowledgement
  sequence 29. No motion, servo, intent, or power-state command was issued.
- Visual inspection accepted the scene: all three objects were fully visible,
  separated, and stable throughout capture.

Direct semantic reacquisition:

- `blue teardrop-shaped creature` acquired the returned target at confidence
  0.765 on XGA and 0.760 on QVGA. Its normalized center x measured 0.528/0.529,
  and its XGA/QVGA boxes agreed closely.
- Independent `coffee cup` acquisition remained at center x=0.320/0.322 with
  confidence 0.959/0.917. Independent `white bottle` acquisition measured
  center x=0.721/0.722 with confidence 0.955/0.942.
- After an explicit worker reset, semantic target acquisition followed by all
  28 return QVGA frames retained the creature for 29 of 29 estimates. Center x
  remained 0.528 throughout and no frame was closer to the bottle center than
  to the returned target center.
- Reacquisition measured approximately 201 milliseconds in the combined run;
  later MIL updates remained near the prior approximately 27 to 30 millisecond
  range. This demonstrates that the existing semantic model can recover the
  useful target quickly enough for the low-frequency action/image loop when it
  is actually invoked.

Current-path failure:

- The uninterrupted baseline-to-loss-to-return sequence acquired the original
  creature once, then falsely retained a box through all 29 loss previews at
  center x=0.725 to 0.731.
- On the 28 return previews, it continued returning a box at center x=0.684 to
  0.688. Every one of those boxes was closer to the independently detected
  bottle center than to the returned creature center.
- Confidence remained 0.507 to 0.533 and every update reported
  `target tracked online`. No loss transition occurred, so semantic
  reacquisition was never requested even though it would have succeeded on the
  first return frame.
- The failure is therefore architectural: the control loop treats online
  location tracking as sufficient identity evidence. It is not a detector
  capability, latency, camera transport, memory, or physical-motion limitation.

Generic correction boundary:

- Do not add prompt aliases, object names, scene coordinates, cup/bottle rules,
  or a tuned HSV cutoff. Those would encode this replay rather than correct the
  system contract.
- The low-frequency action/image loop must base every subsequent action and any
  `reached` result on fresh semantic evidence for the requested query. Online
  tracking can remain a non-authoritative, high-frequency displacement hint,
  but it cannot independently authorize motion, success, or continued identity.
- Reuse the existing perception `acquire(frame, query, ...)` operation for
  semantic verification after each action and on final centering. This avoids a
  parallel detector, duplicate model, second workflow, or special-case path.
- If semantic evidence is absent, wait for a bounded fresh frame and retry up to
  the existing reacquisition limit. If the target returns elsewhere, the same
  semantic acquisition should reinitialize at that location and continue
  correcting the view. If it remains absent, terminate as lost without another
  orientation action.

Architecture, safety, and rollback:

- The measurements used only ignored owner-local captures, temporary `/tmp`
  harnesses, and the isolated unregistered worker. No runtime source or physical
  behavior changed during this evidence phase.
- The correction belongs inside the existing active-view controller/perception
  contract, not the MetaHuman graph, conversation buffer, Environment Bridge,
  or firmware. Fine-turn calibration and identity validation gates remain
  false, so no physical movement can be dispatched from this experiment.
- Capture removal remains deletion of the ignored identity-sequence directory.
  Temporary harnesses can be removed after remote-safe replay expectations are
  extracted. Any controller correction must receive its own feature-owned test
  and rollback entry before integration is considered.

### 2026-08-05 - ROM-19 evidence M - Semantic action authorization

Status: isolated controller correction implemented and validated against the
first controlled sequence; still unavailable and unregistered.

Measured threshold evidence:

- Screened the exact query independently on every QVGA frame in the visible,
  partial-occlusion, full-loss, and return phases: 115 frames total.
- Visible target with cup distractor acquired on 29 of 29 frames at confidence
  0.797 to 0.879. Partial occlusion acquired on 29 of 29 frames at 0.552 to
  0.832. Return at the new position acquired on 28 of 28 frames at 0.744 to
  0.832.
- Full loss produced 17 weak false candidates across 29 frames, including a
  six-frame consecutive run. Their confidence was only 0.302 to 0.344; boxes
  alternated between the cup and bottle regions. Ten frames reported no target
  and two rejected multiple similarly supported candidates.
- A two-hit confirmation rule alone would therefore fail this replay. A
  configurable 0.50 controller confidence floor separates every genuine frame
  from every full-loss candidate in this dataset: 86 of 86 genuine frames pass
  and 0 of 29 loss frames pass.
- The 0.50 value is a provisional replay-derived default, not a universal
  calibrated probability or object-specific constant. The identity gate stays
  false until broader targets, lighting, viewpoints, and same-class distractors
  establish a final operating characteristic.

Controller correction:

- Reused the existing perception `acquire(frame, query, ...)` operation after
  every orientation action and on final centering. Those low-frequency control
  decisions no longer call or trust the MIL `track()` output.
- A semantic miss now waits for a fresh mailbox frame before each retry, bounded
  by the existing reacquisition limit. Repeating inference on the same stale
  image was removed from that path.
- When the query returns at a different position, semantic acquisition
  reinitializes there. A centered reacquisition advances to a fresh semantic
  verification frame without issuing an unnecessary orientation action.
- OpenCV MIL and the HSV experiment remain available only behind the isolated
  perception interface for non-authoritative displacement research. They can no
  longer independently authorize an action or a `reached` result in this
  controller.
- Changed the isolated `ActiveViewConfig.minimum_confidence` default from 0.30
  to 0.50. No worker detector threshold, query wording, object alias, scene
  coordinate, cup/bottle rule, MetaHuman workflow, or firmware behavior changed.

Remote-safe test contract:

- Updated the controller fakes so post-action and final verification estimates
  come through semantic acquisition. Existing injected-assets, centered-success,
  no-progress, cancellation, shutdown, and feature-absence coverage remains.
- Added a weak 0.34 semantic-candidate case proving that no action is queued.
- Added a full-loss case proving that one initial correction is followed only by
  two fresh semantic retries and `lost`, with no additional action.
- Added a return-at-the-opposite-side case proving that bounded semantic
  reacquisition resumes useful correction in the new direction and reaches the
  verified center. The controller makes zero tracker calls in these cases.
- Updated the existing action-indexed BodySession replay so the initial,
  post-action, and final frames all require semantic acquisition. The fixture
  now raises if tracker output is used to authorize replay actions.

Validation:

- Focused controller and action-indexed replay suites passed 19 of 19 tests.
- Active-view, replay-manifest, BodySession media/session, Environment Adapter,
  and command-catalog regression passed 102 of 102 tests. The expected fixture
  log `motion backend failed for sequence 1: renderer unavailable` remained part
  of an intentional failure-path test; the suite passed.
- Real Grounding DINO frames were then driven through the corrected controller
  with a fake Gateway that only records intents. In the loss case, the controller
  recorded one initial `offline-right` intent, rejected the next three loss
  frames below 0.50, exhausted two fresh retries, and returned `lost`.
- In the return case, the controller recorded the same one initial simulated
  correction, rejected the loss frame, reacquired the creature on the first
  return frame near center x=0.529 at confidence 0.760, semantically verified a
  second fresh return frame, and returned `reached`. No simulated second motion
  was required and zero physical commands were sent.
- All feature Python files and related tests pass the 100-column and trailing-
  whitespace screens. Existing adapter translation, server registration,
  capability advertisement, launcher, firmware, and physical robot state remain
  untouched. Feature-absence coverage still passes.

Rollback manifest extension:

- Feature-owned source changed:
  `Ainekio/Master/gateway/environment_adapter/active_view/controller.py` and
  `Ainekio/Master/gateway/environment_adapter/active_view/contracts.py`.
- Feature-owned tests changed: `Ainekio/Emulator/tests/test_active_view.py` and
  `Ainekio/Emulator/tests/test_active_view_replay.py`.
- To remove only this correction, restore the two controller decision sites to
  tracker calls, remove fresh-frame reacquisition state, restore the 0.30
  default, and remove the semantic authorization/loss/return assertions. The
  broader active-view package removal manifest remains unchanged.
- No shared runtime owner, dependency, model artifact, service, port,
  configuration, firmware, graph, registration, capability, or physical asset
  was added. All Ainekio feature files remain untracked and removable as one
  isolated experiment.

Decision and remaining:

- Keep `identity_gate_validated` false, keep fine-turn control unavailable, and
  keep the feature absent from live adapter capabilities and dispatch.
- Repeat semantic distributions with other ordinary object classes, low-texture
  targets, same-class distractors, lighting changes, movement, and longer loss.
  The current semantic query identifies a class/description, not durable
  instance identity; instance-level re-identification remains `ROM-12/ROM-13`.
- Preserve the 0.50 weak-candidate rejection and semantic-per-action policy as
  remote-safe regression expectations. Replace or augment MIL/HSV only after a
  maintained tracker/re-identification component passes the same sequence.
- The next architecture work is the typed Gateway camera-consumer lease proposal
  and more remote-safe replay metadata. Physical action-correlated view
  correction remains gated on fine-turn calibration and the owner's exact
  authorization for that later test.

### 2026-08-05 - ROM-08/ROM-11 - Typed Gateway camera-consumer lease proposal

Status: proposal validated against current owners; not implemented or
registered.

Current ownership findings:

- `GatewayService` owns the authenticated body connection, validates QVGA/VGA
  preview requests and profile frame-rate limits, sends the protocol `cam`
  command, correlates terminal results, and fans received binary frames to
  subscribers. It is the only correct authority for shared camera lifetime.
- The maintained dashboard and isolated active-view controller are the only two
  non-test callers of raw `GatewayService.set_camera()`. Both can currently send
  `on` or `off` without knowing whether the other consumer still needs preview.
  The resulting last-writer-wins lifetime is not safe for integration.
- The Environment Adapter already subscribes once to all Gateway frames, but its
  maintained camera path intentionally discards JPEG frames unless they match a
  snapshot/action correlation. That behavior is correct for Environment
  observations and must remain separate from a skill's private preview mailbox.
- Gateway frame subscribers are invoked from a tuple snapshot in registration
  order, and awaitable callbacks are awaited serially. Inline detection or
  tracking in a subscriber would delay the dashboard, audio plugins, adapter,
  and robot receive loop. Active view must copy validated frame metadata into a
  bounded latest-frame mailbox and return immediately.
- Camera binary frames contain robot id, connection epoch, counter, payload, and
  Gateway receipt timing context. They do not carry calibrated capture time.
  Skill freshness must therefore use monotonic Gateway/Adapter receipt time,
  while UTC receipt time remains the typed external timestamp.

Proposed owner and contract:

- Add one Gateway-owned `CameraLeaseManager` behind `GatewayService`; do not add
  a MetaHuman camera service, controller-local reference count, second frame
  socket, or dashboard-specific bypass.
- `acquire_camera_lease()` accepts a bounded consumer id, robot id, purpose,
  requested frames per second, resolution, and lease lifetime. It returns a
  typed lease id, robot epoch, effective configuration, activation sequence when
  one was needed, and whether the caller joined an already-active compatible
  preview.
- `release_camera_lease()` is idempotent and epoch-bound. Releasing one consumer
  leaves preview active while any compatible lease remains; only releasing the
  final lease sends `cam on=false`. Disconnect or epoch replacement invalidates
  all leases for that body.
- The first V1 policy should share only an exactly compatible active
  configuration. An incompatible request is rejected with the current effective
  settings and owners summarized, rather than silently raising resolution or
  frame rate and increasing battery/data use. Explicit future negotiation can
  be added after measurements justify it.
- Requests remain bounded by existing body profile limits. Active view requests
  QVGA at five frames per second and a short operation lifetime; dashboard
  choices remain explicit. Snapshot/XGA action correlation is not a lease and
  continues through its existing `snap` and post-action ownership paths.
- Lease acquisition and release must be usable as an async context manager so
  controller cancellation, timeout, failure, and `close()` all release in one
  `finally`-owned lifecycle. Gateway shutdown and robot disconnect also close
  outstanding leases without relying on a consumer callback.

Adapter and frame routing:

- During later integration, the Environment Adapter may construct one
  active-view controller and offer camera frames to its latest-frame mailbox
  from the existing `_handle_gateway_frame()` subscriber before the maintained
  snapshot-correlation branch. The offer is synchronous, bounded, and performs
  no model work.
- Preview frames admitted to the skill carry robot id, epoch, counter, payload,
  receipt timestamp, monotonic receipt time, and mailbox generation. The
  controller rejects mismatched robot/epoch, stale source frames, and
  superseded generations using its existing typed checks.
- The current snapshot delivery queue, action visual futures, Environment
  observation encoding, and MetaHuman Bridge transport remain unchanged. A
  skill-private preview is not published into conversation or Environment
  observations unless the existing skill result contract explicitly references
  its final evidence.
- OpenCV/Grounding DINO processing remains in the isolated subprocess. The
  Gateway callback only feeds the mailbox, and the controller awaits perception
  from its own task so slow inference cannot backpressure frame publication.

Required migration order:

1. Add and test the Gateway lease manager without changing current callers or
   capability advertisement.
2. Migrate the dashboard `on/off` endpoint to a dashboard-session/robot lease and
   release it on explicit off, session expiry, or server shutdown. Remove its
   raw `set_camera()` lifetime ownership in the same coherent change.
3. Change the isolated controller's camera lifecycle dependency from raw
   `set_camera()` plus a boolean callback to the typed lease context. Keep the
   feature unregistered and its availability gates false.
4. Feed the controller mailbox from the adapter's existing frame subscriber and
   prove that snapshot observations, dashboard preview, microphone frames, and
   frame counters remain unaffected.
5. Only after identity, fine-turn, lease, replay, cancellation, and authorized
   physical acceptance pass may the adapter advertise `activeView` and admit the
   existing MetaHuman `inspect` contract.

Acceptance tests before integration:

- One compatible lease sends one camera-on command; a second compatible lease
  shares it; releasing the first sends no camera-off; releasing the last sends
  exactly one camera-off.
- Incompatible resolution/frame-rate requests fail explicitly without mutating
  the active configuration. Profile limits and tether snapshot-only behavior
  remain enforced by `GatewayService`.
- Cancellation, timeout, consumer exception, dashboard-session expiry, Gateway
  shutdown, robot disconnect, and epoch replacement each release or invalidate
  the correct leases without affecting another robot.
- A dashboard lease and skill lease can overlap while both continue receiving
  frames. Skill inference delay cannot delay dashboard delivery or later frame
  subscribers; mailbox supersession remains bounded and observable.
- Existing snapshot/action correlation delivers exactly one visual through the
  maintained Environment path while preview frames remain private. Preview
  release cannot consume, relabel, or discard a pending snapshot.
- Lease state exposes bounded diagnostic fields—consumer count, effective
  configuration, epoch, activation sequence, and age—without tokens or image
  payloads. Tests cover stale release ids and double release.
- Active-view feature-absence, calibration-gate, identity-gate, subprocess
  shutdown, semantic loss/reacquisition, and 102-test boundary regressions stay
  green before any live caller migration.

Decision and rollback boundary:

- The camera proved usable through the Gateway, so firmware video changes are
  not required for this V1 path. Battery and data constraints are addressed by
  the bounded QVGA/five-fps lease and last-consumer shutdown, not a second
  transport.
- No source changed for this proposal. When implementation begins, the lease
  manager, dashboard migration, and isolated controller migration must each
  receive a rollback manifest and feature-absent validation before proceeding
  to adapter registration.
- The next evidence-bearing step is additional remote-safe perception replay or
  fine-turn calibration. Any physical orientation command still requires the
  owner's exact test authorization at that time.

### 2026-08-05 - ROM-08/ROM-11 - Standalone Gateway camera lease manager

Status: step one implemented and validated; no caller migration or live runtime
behavior.

Authorization and scope:

- The owner explicitly authorized camera-lease step one: the manager and unit
  tests only, with no caller migration, capability registration, firmware
  change, or robot movement.
- Added `Ainekio/Master/gateway/server/camera_leases.py` as a standalone module
  inside the existing Gateway server owner. It is not imported by
  `GatewayService`, `gateway.server.__init__`, the dashboard, the Environment
  Adapter, or active-view runtime code.
- Added `Ainekio/Emulator/tests/test_gateway_camera_leases.py`. No existing
  Ainekio source or test file changed in this step.

Implemented contract:

- Typed request, preview configuration, active lease, release result, conflict,
  and camera-command protocol records keep consumer, robot, epoch, purpose,
  frame rate, resolution, lifetime, activation sequence, and join state
  explicit.
- The manager shares one preview only among exact-compatible frame-rate and
  resolution requests for the same robot epoch. An incompatible request reports
  the requested/effective configuration and current consumer ids without
  mutating camera state.
- The first lease invokes one injected camera-on command. Intermediate release
  does not stop preview; final release invokes one camera-off command.
  Release is idempotent for stale lease ids.
- Consumer/robot/purpose text, positive epoch, QVGA/VGA resolution, one-to-ten
  frames per second, 0.1-to-300-second lifetime, and returned command sequence
  are bounded before state is admitted. Text identifiers are normalized once at
  the contract boundary.
- An async context manager releases on normal exit or consumer exception.
  Explicit expiry collection preserves preview while another consumer remains;
  final expiry stops it. Epoch invalidation removes disconnected-body lease ids
  without sending a command to an unavailable epoch.
- Concurrent compatible acquisition is serialized by one manager lock, so it
  produces one activation command. Final camera-off failure retains the lease
  for a later retry, while activation failure or an invalid command sequence
  leaves no phantom lease.
- Bounded status exposes robot id, epoch, effective preview configuration,
  consumer count and ids, purposes, oldest age, and next expiry. It includes no
  image data, tokens, or transport payloads.
- The injected command contract is the future seam through which
  `GatewayService.set_camera()` plus terminal acknowledgement will be owned.
  This step uses only a fake command and does not bind that seam to the live
  service yet.

Validation:

- The standalone lease suite passed 11 of 11 tests. Coverage includes compatible
  sharing, last-consumer shutdown, idempotent release, explicit conflict,
  duplicate consumer rejection, async-context exception cleanup, staggered
  expiry, epoch invalidation, concurrent acquisition, failed final shutdown,
  failed/invalid activation, status shape, normalization, and request bounds.
- Gateway service, dashboard, security, active-view isolation, action-indexed
  replay, replay manifest, Environment Adapter, and command-catalog regression
  passed 104 of 104 tests with localhost and fake fixtures.
- Both new files pass the 100-column and trailing-whitespace screens. Existing
  tracked Gateway service, dashboard, adapter, firmware, capability, launcher,
  protocol, and MetaHuman files remain unchanged.
- Repository search confirms the manager has no runtime importer or caller.
  The running Gateway was not restarted and the physical robot received no
  camera, intent, servo, state, or motion command from this implementation.

Rollback manifest:

- Feature-owned source added:
  `Ainekio/Master/gateway/server/camera_leases.py`.
- Feature-owned test added:
  `Ainekio/Emulator/tests/test_gateway_camera_leases.py`.
- Removing those two untracked files removes the entire step-one implementation.
  No import, registration, configuration, dependency, service, port, firmware,
  model, graph, dashboard, adapter, or physical rollback is required.
- Owner-local capture data and the unrelated untracked Frame8 hardware assets
  were preserved and not modified.

Decision and next gate:

- Step one is ready for review but does not yet solve last-writer-wins camera
  ownership in the running system because no caller uses it. Do not represent
  the live Gateway as lease-aware.
- A later step-two migration would first bind this manager inside
  `GatewayService` and migrate the dashboard session lifecycle. That changes
  maintained shared runtime owners and requires separate owner authorization,
  terminal-acknowledgement tests, shutdown/error review, and its own rollback
  manifest before the active-view controller is migrated.

### 2026-08-05 - ROM-08/ROM-11 - Gateway binding and dashboard lease migration

Status: step two implemented and validated in software; active-view runtime
integration remains unregistered.

Authorization and scope:

- The owner asked work to continue after the standalone lease checkpoint. This
  batch was explicitly kept to `GatewayService`, dashboard camera/session
  lifecycle, shutdown, and focused tests.
- The active-view controller was not migrated, the Environment Adapter was not
  changed, and no capability, command catalog, firmware, model, or physical
  motion path was enabled.
- The Ainekio tracked worktree was clean before this batch. The unrelated
  untracked Frame8 hardware assets and owner-local active-view recordings were
  preserved and not modified.

Implemented owner flow:

- `GatewayService` now constructs the one `CameraLeaseManager` and resolves a
  lease request against the currently authenticated robot connection and epoch.
  Callers cannot supply or forge the epoch.
- The manager's camera-command seam is now epoch-aware. The service sends the
  existing protocol `cam` command through the captured connection and admits or
  releases lease state only after the body returns terminal `ack`. A `nak`,
  cancellation, stale epoch, invalid sequence, or timeout cannot be reported as
  a successful lease transition. An uncertain camera-on timeout sends a bounded
  compensating camera-off on the same epoch so a delayed activation is not left
  without an owner; a final camera-off timeout retains the lease for retry.
- Connection replacement and disconnect invalidate only the affected robot
  epoch without sending a command to an unavailable body. The raw
  `GatewayService.set_camera()` primitive remains for lower-level tests and the
  still-isolated active-view experiment, but the dashboard no longer calls it.
- The manager now supports bounded renewal without another camera command and
  reports each group's activation sequence. A Gateway-owned sweeper expires
  abandoned leases; final expiry sends camera-off and cleanup errors remain
  observable through the existing Gateway event path. Gateway shutdown cancels
  the sweeper and closes remaining groups through the same terminal-acknowledged
  command seam.
- `GatewayService.status_snapshot()` includes bounded `camera_leases`
  diagnostics: robot, epoch, effective preview settings, activation sequence,
  consumer count and ids, purposes, age, and next expiry. It includes no image,
  authentication token, CSRF token, or transport payload.

Dashboard lifecycle:

- Added a small `DashboardCameraLeases` interface adapter. It stores only the
  mapping from a non-credential dashboard session id and robot id to the typed
  Gateway lease. Preview sharing, compatibility, command dispatch, expiry, and
  camera lifetime remain owned by the Gateway manager; the adapter is not a
  second camera service or reference counter.
- Camera-on acquires one 30-second session/robot lease. Reapplying identical
  settings renews it without another camera command; changing settings while it
  is active is rejected explicitly rather than silently increasing battery or
  data use.
- The existing authenticated camera-frame long poll renews an active lease.
  Its ten-second maximum wait remains below the lease lifetime. Polling without
  first turning the camera on does not acquire a lease or start preview.
- Explicit camera-off, logout, actual dashboard-session expiry, and dashboard
  shutdown release the mapped lease. If a browser disappears without logout,
  renewal stops and the Gateway sweeper owns the bounded final camera-off.
- Dashboard shutdown first stops accepting HTTP work, then releases dashboard
  leases and finally closes any remaining Gateway lease groups. A failed
  dashboard release therefore receives one Gateway-owned final cleanup attempt.

Validation evidence:

- The focused manager plus new service-binding tests passed 16 of 16. They
  verify exact-compatible sharing, last-consumer shutdown, renewal without a
  command, terminal acknowledgement, `nak` rejection without phantom state,
  stale-epoch rejection, activation-timeout compensation, bounded diagnostics,
  and automatic final expiry.
- The full non-physical Gateway, dashboard, security, active-view, replay,
  replay-manifest, Environment Adapter, and command-catalog regression set
  passed 113 of 113 tests with localhost and fake/replay fixtures.
- Dashboard acceptance covers identical renewal, incompatible-setting
  rejection, authenticated frame-poll renewal, explicit off, logout, session
  expiry, and server shutdown. Repository search finds no maintained dashboard
  call to raw `set_camera()`.
- Active-view isolation, feature absence, semantic loss/reacquisition, worker
  shutdown, snapshot/action correlation, preview privacy, microphone handling,
  and command-catalog boundaries remained green in the same regression run.
- All changed Python files pass the 100-column screen, `git diff --check`, and
  module import validation. Tests required a permitted localhost namespace;
  the earlier restricted-sandbox socket failures were environmental and were
  rerun successfully outside that restriction.
- No running Gateway was restarted. No attached robot received a camera,
  intent, state, servo, motion-plan, speaker, microphone, or firmware command
  from this batch.

Rollback manifest:

- New step-two dashboard adapter:
  `Ainekio/Master/gateway/dashboard/camera_sessions.py`.
- Step-two tracked integration points:
  `Ainekio/Master/gateway/server/service.py`,
  `Ainekio/Master/gateway/dashboard/auth.py`,
  `Ainekio/Master/gateway/dashboard/server.py`,
  `Ainekio/Master/gateway/server/__main__.py`,
  `Ainekio/Emulator/tests/test_gateway_service.py`, and
  `Ainekio/Emulator/tests/test_gateway_dashboard.py`.
- The step also extended the untracked step-one files
  `Ainekio/Master/gateway/server/camera_leases.py` and
  `Ainekio/Emulator/tests/test_gateway_camera_leases.py` with epoch-aware
  commands, renewal, activation diagnostics, and their tests.
- The exact full-feature rollback is to restore the six tracked integration
  points above to `HEAD` and delete the three lease-owned untracked files:
  `camera_sessions.py`, `camera_leases.py`, and
  `test_gateway_camera_leases.py`. Because the tracked Ainekio tree was clean
  before this batch, that removes the complete camera-lease program without
  touching active-view files, firmware, recordings, configuration, dependencies,
  services, ports, or unrelated hardware assets.
- A step-two-only rollback that preserves the standalone experiment must also
  restore the pre-binding forms of the two step-one files; deleting only the
  dashboard adapter is insufficient because `GatewayService` now imports the
  manager.

Decision and next gate:

- Step two removes the dashboard's last-writer-wins preview ownership and is a
  validated runtime integration, but it does not yet make active view available
  to MetaHuman. The feature remains unavailable and unadvertised.
- The next planned batch is migration-order step three: replace the isolated
  controller's raw camera on/off callback with the typed lease context while
  keeping the controller unregistered and both calibration/identity gates
  false. Adapter frame-mailbox routing and capability advertisement remain
  later, separately validated gates.

### 2026-08-05 - ROM-08/ROM-11 - Isolated active-view lease migration

Status: step three implemented and validated in software; the active-view skill
remains unavailable to the live Environment Adapter.

Authorization and scope:

- The owner asked work to continue from the reviewed camera-ownership sequence.
  This batch was restricted to the Gateway lease context, the isolated
  active-view controller contract, its fake/replay facades, tests, and this
  progress record.
- No Environment Adapter composition point, frame subscription, capability,
  command catalog, launcher, firmware, model download, configuration, or
  physical control path was added or enabled.
- Calibration and target-identity validation remain mandatory controller gates.
  Their production defaults remain false, and the adapter still has no importer
  or advertised `inspect` action.

Implemented owner flow:

- `GatewayService.camera_lease()` now exposes the existing acquire/release
  lifecycle as one typed async context. A consumer exception still exits
  through the Gateway-owned final-release path instead of leaving camera
  shutdown to the caller.
- `ActiveViewGateway` now requires that context plus bounded renewal. The
  controller enters one 60-second, 5-fps QVGA lease for an inspection, renews it
  before every bounded control step, and releases it on success, loss,
  cancellation, timeout, command failure, or perception failure.
- The controller's raw `set_camera()`, `preview_active`, and
  `set_preview_active` paths were deleted. It cannot independently infer camera
  state or switch preview off while another consumer still owns it.
- Lease duration is a validated numeric configuration value bounded from one to
  300 seconds. It contains no scene names, object examples, conversation text,
  persona policy, or action preference.
- The Body Emulator replay facade now uses the real `CameraLeaseManager` and
  the existing `BodySession` camera command/terminal lifecycle. It is no longer
  a second raw camera fake.

Validation evidence:

- The focused active-view, action-indexed replay, and Gateway context set passed
  22 of 22 tests. It covers typed acquisition, renewal, release on cancellation
  and consumer exception, acquisition failure before perception, expired lease
  failure before an orientation action, and the existing semantic
  loss/reacquisition and worker-shutdown boundaries.
- The replay keeps a compatible dashboard lease open while the controller runs.
  The real manager reports both consumers during verification; controller exit
  removes only `active-view`, preview remains on for `dashboard:replay`, and
  camera-off occurs only when the dashboard lease exits.
- The full non-physical Gateway, dashboard, security, active-view, replay,
  replay-manifest, Environment Adapter, and command-catalog regression set
  passed 116 of 116 tests with localhost and fake/replay fixtures.
- The changed active-view, lease, dashboard-session, service, and focused test
  files pass the 100-column and trailing-whitespace screens. `git diff --check`
  is clean.
- Repository search finds no remaining raw camera callback in the active-view
  package and no active-view importer outside that isolated package. The live
  adapter contract still omits `inspect`; its feature-absence test passed in the
  broad run.
- No Gateway or MetaHuman process was restarted. No attached robot received a
  camera, intent, state, servo, motion-plan, audio, or firmware command from
  this batch.

Rollback manifest:

- Step-three tracked integration points are
  `Ainekio/Master/gateway/server/service.py` and
  `Ainekio/Emulator/tests/test_gateway_service.py`; the step-three additions are
  the `camera_lease()` context and its consumer-exception test.
- Step-three isolated experiment points are
  `Ainekio/Master/gateway/environment_adapter/active_view/contracts.py`,
  `Ainekio/Master/gateway/environment_adapter/active_view/controller.py`,
  `Ainekio/Emulator/tests/test_active_view.py`, and
  `Ainekio/Emulator/tests/test_active_view_replay.py`. They remain untracked as
  part of the removable active-view experiment.
- A step-three-only rollback that retains the experiment restores those four
  files to the preceding raw-callback checkpoint and removes the service
  context plus its test. A full active-view rollback still deletes the isolated
  active-view package, its tests, and its replay fixtures using the earlier
  ROM-22 removal manifest.
- Full camera-lease-program rollback remains the step-two manifest: restore its
  six tracked integration points and delete `camera_sessions.py`,
  `camera_leases.py`, and `test_gateway_camera_leases.py`. The unrelated Frame8
  hardware assets and owner-local recordings remain outside every rollback.

Decision and next gate:

- Step three removes the last isolated Active View camera-ownership bypass. It
  does not make the robot autonomous, improve target perception, or authorize
  movement by itself; it only gives the later skill one safe existing camera
  owner.
- The next migration-order gate is a bounded adapter-owned frame bridge from the
  existing Gateway frame callback to the active-view mailbox. That bridge must
  preserve robot id, epoch, counter, frame id, valid timestamp, generation, and
  latest-frame bounds, and it must be tested with the skill still unregistered.
- Capability advertisement and live dispatch remain later gates after frame
  correlation, cancellation, clean shutdown, identity replay, and calibrated
  fine-turn assets are all validated together.

### 2026-08-05 - ROM-08/ROM-11 - Optional adapter frame-mailbox bridge

Status: migration-order step four implemented and validated in software; no live
active-view instance, action, capability, or physical path is enabled.

Authorization and scope:

- The owner asked work to continue from the isolated lease migration. This batch
  was restricted to the existing Gateway frame callback, one optional adapter
  seam, the existing active-view mailbox/controller boundary, tests, and this
  record.
- The maintained launcher was not changed and supplies no frame bridge. The
  adapter imports no active-view implementation, translates no `inspect`
  action, advertises no `activeView` capability, and constructs no perception
  subprocess or controller.
- No model, dependency, firmware, camera setting, motion asset, service,
  configuration, graph, or MetaHuman source changed. No physical test or command
  was authorized or attempted.

Implemented owner flow:

- Added a 131-line `ActiveViewFrameBridge` inside the isolated active-view
  package. It accepts only bounded JPEG camera frames for one explicit robot id
  and creates `ActiveViewFrame` records with robot id, epoch, binary counter,
  one opaque frame id, one timezone-aware host-arrival timestamp, monotonic
  receipt time, JPEG bytes, and mailbox generation.
- Same-epoch duplicate or decreasing counters, older epochs, other robots,
  malformed JPEGs, invalid identifiers, invalid counters, and invalid timing
  fail closed without entering the mailbox. A newer connection epoch clears
  exact-frame history; a stale disconnect cannot clear a newer session, while
  the matching disconnect does.
- The bridge writes to the existing `LatestFrameMailbox`; it does not own a
  queue, camera, detector, tracker, worker, or second copy of frame-lifecycle
  state. `ActiveViewController` can now receive that same mailbox through its
  constructor instead of creating a parallel store.
- `EnvironmentAdapter` now defines a structural `CameraFrameBridge` protocol and
  accepts it as an optional injected dependency. Its existing authenticated
  Gateway frame callback invokes the bridge synchronously before the existing
  snapshot-delivery filter. No inference or model work occurs in the callback.
- Continuous preview still stays out of environment observations. When an
  already-correlated snapshot is delivered, the queued delivery path reuses the
  exact bridge frame id and timestamp and includes the existing robot id,
  epoch, and counter metadata. MetaHuman and the controller can therefore refer
  to the same immutable frame identity instead of independently generating
  timestamps.

Validation evidence:

- The focused active-view, action-indexed replay, and complete Environment
  Adapter suite passed 56 of 56 tests with permitted localhost fixtures.
- New coverage proves shared controller/mailbox ownership, selected-robot
  filtering, valid timestamp and monotonic receipt, duplicate and stale-epoch
  rejection, matching-epoch cleanup, bounded exact-frame eviction, and invalid
  JPEG/timing rejection.
- Adapter coverage proves three continuous preview frames populate only the
  injected bounded mailbox and emit no LLM observation. A correlated snapshot
  then preserves the bridge id and timestamp through the same size-one queued
  delivery path used by a connected adapter.
- The full non-physical Gateway, dashboard, security, active-view, replay,
  replay-manifest, Environment Adapter, and command-catalog regression set
  passed 120 of 120 tests.
- `git diff --check`, source trailing-whitespace checks, the 100-column screen
  for active-view source/tests, and added-line checks for the maintained adapter
  and test are clean. Repository search finds no active-view implementation
  import, `inspect` route, or `activeView` capability outside the isolated
  package.
- No Gateway or MetaHuman process was restarted. No attached robot received a
  camera, intent, state, servo, motion-plan, audio, or firmware command.

Rollback manifest:

- New step-four feature-owned source:
  `Ainekio/Master/gateway/environment_adapter/active_view/frame_bridge.py`.
- Step-four tracked integration points:
  `Ainekio/Master/gateway/environment_adapter/server.py` and
  `Ainekio/Emulator/tests/test_environment_adapter.py`.
- Step-four changes within the still-untracked experiment:
  `Ainekio/Master/gateway/environment_adapter/active_view/__init__.py`,
  `Ainekio/Master/gateway/environment_adapter/active_view/controller.py`, and
  `Ainekio/Emulator/tests/test_active_view.py`.
- A step-four-only rollback deletes `frame_bridge.py`, removes its export and
  tests, restores controller-owned mailbox construction, and removes the
  optional adapter protocol, constructor argument, event/frame calls,
  correlation fields, epoch metadata addition, and adapter test. Camera leases
  and the preceding active-view experiment then remain at the validated
  step-three checkpoint.
- A full active-view rollback must also restore the two tracked step-four
  integration points before deleting the isolated package, tests, and fixtures.
  The earlier camera-lease rollback and unrelated Frame8/recording exclusions
  remain unchanged.

Decision and next gate:

- Step four supplies real frame feedback plumbing, not a stop-only controller:
  later perception can consume every fresh bounded frame and compare measured
  image change after each body-owned correction. It does not itself choose an
  action or improve perception.
- Live composition remains correctly unavailable because the production
  fine-turn assets named by the controller do not exist and the experimental
  target-identity gate remains false. Enabling the optional bridge before those
  prerequisites would consume memory without providing a truthful skill.
- The next useful evidence gate is to close one of those two blockers without
  registration: validate target identity through recorded OV3660
  distractor/occlusion/loss-return replay, or define and calibrate body-owned
  fine-turn primitives under a separately authorized physical test. Capability
  advertisement and live dispatch remain later decisions.

### 2026-08-05 - ROM-19 evidence N - Cross-query semantic identity gate

Status: multi-query replay completed; the semantic identity gate failed and
remains false.

Scope and acceptance fixed before inference:

- Reused the ignored owner-local OV3660 sequence already captured for visible
  target/distractor, partial occlusion, full target loss, and return at a new
  position. No new camera phase or physical command was requested.
- Replayed three independently visible descriptions over all 115 QVGA preview
  frames: the described creature, coffee cup, and white bottle. These names
  exist only in the temporary evidence harness and capture metadata; none was
  added to runtime source, prompts, aliases, or controller policy.
- Visual labels required the creature in target/distractor, partial, and return
  phases but absent under full loss; the cup in all four phases; and the bottle
  only in full-loss and return phases. Four representative end frames were
  inspected before inference to confirm those phase labels.
- The predeclared strict gate required every labeled-present frame to produce a
  non-ambiguous semantic result at or above the existing 0.50 controller floor,
  zero labeled-absent frames at or above that floor, and p95 inference below the
  controller's existing two-second fresh-frame wait.
- Grounding DINO Tiny loaded only from the existing Hugging Face cache with
  `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, and downloads disabled. The
  ComfyUI CUDA 13 library directory was supplied through `LD_LIBRARY_PATH` after
  the first attempt reproduced the machine's known missing-NVRTC-builtins loader
  error. No package, model, cache, or startup script changed.

Measured result:

- The run performed 345 independent semantic acquisitions: 258 labeled-present
  cases and 87 labeled-absent cases. All 258 positives were accepted, but 12 of
  87 negatives were also accepted, so the strict gate failed.
- The described creature passed 86 of 86 present frames. During its 29-frame
  full-loss phase, none cleared 0.50; 17 weak candidates measured at most 0.344
  and two frames were ambiguous. Its median center moved from approximately
  0.735 before occlusion to 0.529 after return, confirming useful semantic
  reacquisition for this query.
- The cup passed 115 of 115 frames across every phase at confidence 0.794 to
  0.961, with median center x remaining approximately 0.317 to 0.323.
- The bottle passed all 57 frames where it was present at confidence 0.925 to
  0.954. Before the bottle existed, however, 11 of 29 target/distractor frames
  and one of 29 partial-occlusion frames still cleared 0.50. The false candidates
  reached 0.705; most target/distractor boxes landed near the creature region,
  while the partial-phase acceptance landed near the cup.
- A global confidence increase cannot correct this evidence without harming
  valid targets: rejecting the bottle false candidates would require a floor
  above 0.705, while genuine partially occluded creature detections fell as low
  as 0.552. This is cross-query score calibration failure, not a defensible
  threshold adjustment.
- Cached-model startup measured 5,254 milliseconds. Aggregate p95 inference was
  222 milliseconds; per-row p95 remained 187 to 234 milliseconds. Latency passed
  comfortably and is not the blocker.

Reusable evaluation contract:

- Extended the existing isolated `replay_manifest.py` with bounded
  `SemanticReplayOutcome`, `SemanticReplayScore`, and
  `score_semantic_replay()`. It joins outcomes to exact recorded frame ids,
  treats `visible` and `occluded` labels as required presence, treats `lost` as
  required absence, and reports recall, false-accept rate, p95 latency, and one
  terminal pass/fail result.
- The scorer requires both presence and loss evidence, rejects missing,
  duplicate, invalid-confidence, invalid-latency, and mismatched outcomes, and
  keeps confidence, recall, false-accept, and latency thresholds explicit. It
  contains no object classes, query strings, scene coordinates, model names, or
  runtime registration.
- Added tests for strict success with weak lost candidates, accepted-negative
  failure, one-sided/mismatched evidence rejection, and latency failure. This is
  an offline evidence gate only; controller inference and its 0.50 provisional
  floor were not changed.

Validation and isolation:

- Focused Active View controller, BodySession replay, and replay-manifest tests
  passed 31 of 31.
- The full non-physical Gateway, dashboard, security, active-view, replay,
  replay-manifest, Environment Adapter, and command-catalog boundary passed 124
  of 124 tests with localhost and emulator fixtures.
- The feature source/tests pass the 100-column and trailing-whitespace screens;
  `git diff --check` is clean. The live adapter still has no active-view
  implementation import, `inspect` route, `activeView` capability, worker, or
  controller instance.
- No process was restarted. No attached robot received a camera, intent, state,
  servo, motion-plan, audio, or firmware command. Recorded JPEGs and phase JSON
  remain ignored owner-local data.

Rollback manifest extension:

- Feature-owned source changed:
  `Ainekio/Master/gateway/environment_adapter/active_view/replay_manifest.py`
  and its export list in `active_view/__init__.py`.
- Feature-owned validation changed:
  `Ainekio/Emulator/tests/test_active_view_replay_manifest.py`.
- To remove only this evidence contract, remove the two semantic result records,
  scorer and private numeric helpers, remove their exports, and remove the four
  scorer tests. The earlier action-indexed manifest, controller correction,
  frame bridge, camera leases, and their rollback boundaries remain unchanged.
- The temporary `/tmp` inference harness is not maintained source and is removed
  after this record. Removing the ignored identity-sequence directory remains
  the complete local-media rollback; no tracked media was added.

Decision and next gate:

- Keep `identity_gate_validated` false. Perfect recall on the current positives
  does not compensate for accepted detections of an object before that object
  existed. Grounding DINO text-query confidence can support semantic evidence,
  but it cannot alone authorize arbitrary instance identity or physical action.
- Do not add query-specific thresholds, cup/bottle/creature rules, prompt aliases,
  scene coordinates, or a higher global confidence floor. Each would either
  encode this room or discard proven partial-occlusion evidence.
- The next non-physical architecture step is to compare maintained
  instance-association or video-object components behind the existing perception
  interface. The same replay gate must then include same-class distractors and
  additional ordinary targets before identity can become available.
- Fine-turn asset calibration remains the separate physical-control blocker and
  still requires the owner's exact authorization for a later movement test.

### 2026-08-05 - ROM-19 evidence O - EdgeTAM loss and return replay

Status: fast target continuity measured; the persistent-identity gate failed
and remains false.

Selection and acceptance fixed before inference:

- Reused the official Apache-2.0 EdgeTAM source and 54 MiB checkpoint already
  present under `/tmp` from evidence B. No repository, checkpoint, package,
  cache, camera phase, or dependency was downloaded or installed.
- Replayed the 115 ignored owner-local QVGA frames from the target/distractor,
  partial-occlusion, full-loss, and return-at-new-position phases as one
  chronological finite-video sequence. The EdgeTAM predictor received one
  initial Grounding DINO box on frame zero and no later prompt or reseed.
- Grounding DINO independently evaluated the described target and coffee-cup
  distractor on every frame. Those 230 acquisitions were evaluation references,
  not per-frame runtime inputs to EdgeTAM or the controller.
- A present frame passed only when the EdgeTAM mask was nonempty, its normalized
  center was within the controller's existing 0.12 center tolerance of the
  independently detected target, and it was not closer to the cup. Every
  full-loss frame required an empty mask. Return had to pass without reseeding,
  and aggregate p95 propagation had to remain below the 100-millisecond period
  of the maximum 10-fps camera preview.

Measured result:

- EdgeTAM agreed with the target reference on all 86 labeled-present frames and
  was never closer to the cup. Target/distractor center error measured 0.0011
  median and 0.0052 maximum; partial-occlusion error measured 0.0040 median and
  0.0063 maximum.
- After full target loss, all 29 masks remained positive, so all 29 strict
  absence cases failed. Median mask area fell from approximately 1.57 percent
  of the frame before cover and 1.17 percent under partial cover to 0.17 percent
  during full loss; maximum full-loss area was 0.24 percent.
- The target returned in a new position without a new prompt. All 28 return
  frames again agreed with the target reference, with center error 0.0087 median
  and 0.0143 maximum. This is useful learned continuity and return evidence, but
  it does not erase the false retention during absence.
- Model construction measured 438 milliseconds, finite-state initialization
  3,200 milliseconds, and box seeding 124 milliseconds in the already-warm
  runtime. Propagation measured 33.4 milliseconds mean, 38.7 milliseconds p95,
  45.5 milliseconds maximum, and 448.6 MiB peak CUDA allocation on the RTX 4080
  with bfloat16 autocast. The tracking cadence passed comfortably.
- The independent Grounding DINO references measured 163.6 milliseconds mean
  and 174.8 milliseconds p95 across 230 inferences. They were deliberately
  exhaustive for scoring and are not a proposed 10-fps production loop.
- The optional SAM2 connected-components extension remained unavailable under
  the current Torch 2.11/CUDA 13 runtime, so EdgeTAM skipped its documented
  small-hole post-processing. This is the same explicit reduced path recorded
  in evidence B and must remain a packaging acceptance item.

Interpretation and component comparison:

- EdgeTAM did not drift to the obvious cup distractor and recovered the correct
  returned target, unlike the earlier MIL location track. It remains a strong
  fast tracking-tier quality reference.
- The official EdgeTAM configuration enables its learned object-presence head,
  and the model suppresses output masks when that learned score declares the
  object absent. Positive masks in every full-loss frame therefore show that
  the component itself did not declare loss on this sequence.
- Do not turn the observed mask-area collapse into a project-authored object- or
  scene-specific threshold. The official high-level video iterator returns
  masks but not the learned presence logit, and its supported input is a finite
  JPEG directory or video rather than append-only camera frames. Production
  code must not read private predictor dictionaries or mutate private state to
  manufacture a live API.
- [Cutie](https://github.com/hkchengrex/Cutie) is the next V1 replay candidate:
  its MIT-licensed official API accepts one frame at a time through
  `InferenceCore.step()`, and its object-memory design targets stronger
  consistency than XMem. It still needs a separate semantic seed and must prove
  full-loss rejection, return, and same-class distractor behavior on OV3660
  frames before selection.
- [SAM 3.1](https://github.com/facebookresearch/sam3) remains a later comparison
  because it integrates open-vocabulary detection and tracking, but the official
  model is 848M parameters, checkpoint access is gated, its examples start from
  a finite JPEG directory or video, and its custom SAM License requires an
  explicit owner decision. It is not a reason to bypass the V1 worker contract.
- The home filesystem measured only 7.0 GiB available before the owner began
  another cleanup. No Cutie or SAM 3 dependency should be installed until the
  post-cleanup measurement and expected model/runtime footprint are recorded.

Isolation, rollback, and next gate:

- The run used only a temporary `/tmp` harness, existing ignored recordings,
  existing cached models, and the already-isolated host runtime. It did not
  change Ainekio or MetaHuman runtime source, register a worker, instantiate a
  live controller, advertise a capability, start the camera, or issue a robot
  command.
- The temporary harness is removed after this entry. The pre-existing `/tmp`
  EdgeTAM checkout/checkpoint remain reusable local research inputs and are not
  repository state. Removing this documentation entry is the complete tracked
  rollback for evidence O.
- Keep `identity_gate_validated` false and keep Active View unregistered. After
  disk headroom is remeasured, benchmark Cutie's supported frame-step path
  against this same sequence, then add a same-class distractor and at least one
  additional ordinary target before choosing the V1 identity component.
- Fine-turn calibration remains a separate physical gate and still requires the
  owner's exact authorization; no perception result authorizes movement.

### 2026-08-05 - ROM-19 evidence P - Cutie frame-step loss and return replay

Status: Cutie is the strongest current streaming tracker, but the persistent-
identity gate failed and remains false.

Selection, acquisition, and acceptance:

- After owner-led cleanup raised available storage to approximately 98 GiB,
  cloned the official MIT-licensed
  [Cutie](https://github.com/hkchengrex/Cutie) source at commit
  `ec5cdd4cf16f75c73ad785a2f96fb97dbad4125a` into `/tmp`. The source checkout
  occupied approximately 7 MiB before weights.
- Downloaded only the official `cutie-base-mega.pth` VOS checkpoint declared by
  Cutie's model utility. It is 140,443,788 bytes with the expected MD5
  `a6071de6136982e396851903ab4c083a` and SHA-256
  `9c05402ee36d3a356fb72715d263ba7e1ea06ad3bada48c1306491792da43023`.
  The separate interactive-mask checkpoint was not downloaded.
- Cutie's model constructor also loaded pretrained ResNet-50 and ResNet-18
  weights through `torch.utils.model_zoo`, causing two previously undisclosed
  TorchVision-cache downloads. The ResNet-50 file is 102,502,400 bytes with
  SHA-256 `19c8e3572231adff6824a2da93fd67b5986919a2e65f8b6007eab4edee220097`;
  the ResNet-18 file is 46,827,520 bytes with SHA-256
  `5c106cde386e87d4033832f2996f5493238eda96ccf559d1d62760c4de0613f8`.
  The three model files total 289,773,708 bytes, approximately 276 MiB, before
  source and Python dependencies.
- This implicit-download behavior is unacceptable for production construction.
  Any selected package must preseed a locked model directory, verify every
  digest, set Cutie's existing `resnet_model_path`, disable network access, and
  fail closed when an asset is absent. The live gateway must never download a
  model in response to a robot task.
- Replayed the same 115 ignored owner-local QVGA frames as one chronological
  sequence. One initial Grounding DINO target box was converted to a 1,160-pixel
  seed mask by the established EdgeTAM prompt segmenter. EdgeTAM did not track
  later frames. Cutie's official `InferenceCore.step()` then processed every
  frame with no new prompt or reseed.
- Independent Grounding DINO target and cup queries remained evaluation-only.
  The strict gate was identical to evidence O: every visible frame must produce
  a mask centered within 0.12 normalized image units of the target and not
  closer to the cup; every full-loss frame must produce Cutie's official empty
  argmax mask; return must pass without reseeding; aggregate p95 must remain
  below the camera's 100-millisecond maximum preview period.

Measured result and repeatability:

- Cutie agreed with the independent target on all 86 labeled-present frames,
  never moved closer to the cup, and recovered all 28 return frames without a
  prompt or reseed. Target/distractor center error was 0.0010 median and 0.0028
  maximum; partial-cover error was 0.0041 median and 0.0067 maximum; return
  error was 0.0076 median and 0.0131 maximum.
- During the 29-frame full-loss phase, Cutie emitted a nonempty mask on 15
  frames and an empty mask on 14, so the identity gate failed. This improves
  materially on EdgeTAM's 29 of 29 false-retained masks but is not sufficient
  to authorize action.
- The exact loss-presence pattern was
  `11111111111110000000100000100`, where `1` is a false retained mask and `0`
  is Cutie's official background result. Cutie first declared absence after 13
  frames, remained absent for seven, produced one false-positive frame, remained
  absent for five, produced another false-positive frame, and ended with two
  absent frames. The returning target was nevertheless recovered immediately
  and remained correct throughout the next phase.
- False-retained object probabilities were not merely marginal: the initial 13
  measured from 0.997434 through 0.999969, and the two later single-frame
  reappearances measured 0.877728 and 0.920495. A project-authored confidence or
  mask-area threshold would therefore encode this sequence rather than repair
  identity.
- The first run, which included constructor-triggered backbone downloads,
  measured 8,219 milliseconds for model construction and 32.5 milliseconds
  mean, 31.2 milliseconds p95, 1,063 milliseconds maximum frame latency, and
  177.3 MiB peak CUDA allocation. The first-frame maximum included seed/memory
  initialization.
- A fully cached repeat produced the identical 86/86 present, 15/29 false-loss,
  zero distractor-switch, and 28/28 return outcome. It measured 1,301
  milliseconds model load, 19.9 milliseconds mean, 22.7 milliseconds p95,
  68.3 milliseconds maximum, and the same 177.3 MiB peak CUDA allocation. This
  passes the steady-state 10-fps throughput screen. The evaluation-only DINO
  references measured 159.5 milliseconds mean and 162.6 milliseconds p95 on
  the repeat and are not proposed for per-frame production use.

Interpretation, isolation, and next gate:

- Cutie's official append-one-frame API fits the existing isolated worker
  boundary substantially better than EdgeTAM's finite-video predictor. Its
  visible-target continuity, distinct-distractor behavior, partial-cover
  retention, return without reseeding, and latency make it the leading V1
  tracking candidate.
- Cutie is not a semantic detector or a complete identity/presence owner. The
  loss pattern also shows why blindly adding an `N`-frame absence debounce is
  not a complete correction: delayed absence was followed by two later
  high-probability one-frame reappearances. No threshold, debounce constant,
  object name, coordinate, or scene rule was added to runtime source.
- The next selection evidence must include at least one independent ordinary
  target and a same-class or visually similar distractor, then compare a
  maintained presence/verification owner that can veto false track memory. Any
  temporal confirmation policy must be generic, predeclared, and evaluated
  across those sequences before it can affect action admission.
- The run changed no Ainekio or MetaHuman runtime source, did not register a
  worker, instantiate a live controller, advertise a capability, start the
  camera, or issue a robot command. It used ignored owner-local frames, isolated
  `/tmp` source/checkpoints, existing GPU dependencies, and a temporary harness.
- Removing `/tmp/rom19-cutie`, the temporary Cutie harness, and—only with owner
  approval—the two newly downloaded TorchVision cache files removes all local
  research artifacts. Removing this documentation entry is the complete tracked
  rollback for evidence P. The cache files are retained for now because deletion
  was not authorized and they are recorded inputs rather than repository state.
- Keep `identity_gate_validated` false, keep Active View unregistered, and do
  not compose the worker into `server.py`. Fine-turn calibration remains a
  separate physical gate and still requires exact owner authorization.

### 2026-08-05 - ROM-19 evidence Q - Causal BootsTAPIR visibility replay

Status: independent point visibility measured; the object-presence gate failed
and remains false.

Selection and predeclared acceptance:

- Screened the official Apache-2.0
  [Google DeepMind TAP repository](https://github.com/google-deepmind/tapnet)
  because its causal BootsTAPIR path processes a live stream, publishes learned
  per-point occlusion and uncertainty, supplies official PyTorch weights and a
  live-camera example, and is evaluated on the robotics-oriented RoboTAP data.
- Rejected CoTracker 3 as the first V1 screen because most of its official
  repository is CC-BY-NC. Deferred Track-On-R because its current supported
  package requires a gated DINOv3 backbone, PyTorch 2.4.1/CUDA 12.1, and a
  compiled MMCV extension. Deferred TAPNext++ because its official checkpoint
  alone is 2,532,282,370 bytes. These remain later research options, not runtime
  dependencies or claimed impossibilities.
- Cloned TAP at commit `c2cbab81cc06092b5f05bfe2da7bfec54e2079c9`
  into `/tmp` and downloaded only the official causal BootsTAPIR PyTorch
  checkpoint. It is 218,887,028 bytes with MD5
  `d42f8a6502f656e49d1091b11b010748` and SHA-256
  `87c1e752cf5ce56e3e2f7da460aeb4d40fc826d04ef2939bade86a5c7495377f`.
  The checkout plus checkpoint occupied approximately 216 MiB.
- Installed only `einshape` 1.0 and `dm-tree` 0.1.10 without dependencies into
  an isolated `/tmp` target. Their installed footprint was 832 KiB. No package
  was added to Ainekio, MetaHuman, the gateway Python environment, or the
  ComfyUI environment.
- Reused the same 115 ignored QVGA frames, initial DINO box, and one-frame
  EdgeTAM seed mask. OpenCV's established Shi-Tomasi implementation selected
  eight trackable points inside that mask. BootsTAPIR received those points on
  frame zero and no later point, prompt, mask, or reseed.
- Used BootsTAPIR's official visibility rule unchanged: a point is visible when
  `(1 - sigmoid(occlusion)) * (1 - sigmoid(expected_distance)) > 0.5`.
  No model score or visibility threshold was introduced by the project.
- The strict object-presence screen required at least one officially visible
  point centered within 0.12 normalized image units of the independent target
  and not closer to the cup on every present frame, zero officially visible
  points on every full-loss frame, return without reseeding, and aggregate p95
  below the camera's 100-millisecond maximum preview period.

Measured result:

- All 86 labeled-present frames agreed with the independent target, no visible
  point set moved closer to the cup, and all 28 return frames recovered without
  reseeding. Target/distractor frames retained all eight query points. Partial
  cover retained four to six, with a median of six. Return retained all eight.
- All 29 full-loss frames still contained exactly three points that BootsTAPIR
  officially classified visible. The loss pattern was 29 consecutive positive
  frames, so the strict presence gate failed.
- Median point-set center error was 0.0407 before cover, 0.0412 under partial
  cover, and 0.0281 after return. Maximum error remained 0.0428, 0.0713, and
  0.0390 respectively, within the evaluation tolerance.
- Model construction and locked local checkpoint load measured 423 milliseconds.
  Frame processing measured 77.1 milliseconds mean, 80.2 milliseconds p95,
  150.8 milliseconds maximum, and 273.0 MiB peak CUDA allocation in float32 on
  the RTX 4080. Aggregate cadence passed; the first phase's p95 was 100.3
  milliseconds while later phase p95 values were approximately 79.5 to 82.0.
- The 230 evaluation-only DINO references measured 168.3 milliseconds mean and
  188.9 milliseconds p95. They remain scoring evidence, not a proposed
  per-frame production path.

Interpretation, isolation, and next gate:

- Learned point visibility is independent evidence and may later help estimate
  target motion, deformation, or partial cover, but it did not veto false object
  presence on this sequence. Point tracking and object identity are distinct
  responsibilities; an official per-point decision does not create an official
  object-level decision.
- A four-of-eight point vote would separate this one recording: partial cover
  bottoms at four points while full loss retains three. Conjoining that vote
  with Cutie would also make the current sequence appear to pass. The margin is
  one selected point on one target, so encoding that vote now would be replay-
  specific threshold fitting, not validated architecture. No such policy was
  implemented.
- BootsTAPIR is therefore rejected as the sole object-presence authority. Keep
  it only as a possible secondary geometry/visibility component if independent
  targets and similar distractors later demonstrate a stable, predeclared
  aggregation contract.
- The run changed no Ainekio or MetaHuman runtime source, did not register or
  compose a worker, advertise a capability, start a camera, or issue a robot
  command. It used `/tmp` source, checkpoint, isolated dependencies, ignored
  frames, and one temporary harness.
- Removing `/tmp/rom19-tapnet`, `/tmp/rom19-tapdeps`, and the temporary harness
  removes all local evidence-Q assets. Removing this documentation entry is its
  complete tracked rollback. The source/checkpoint remain temporarily available
  for reproducibility; they are not repository or production state.
- Keep `identity_gate_validated` false and keep Active View unregistered. The
  next decisive evidence is a second ordinary target and a visually similar or
  same-class distractor captured through the existing ignored replay lane. That
  sequence is needed before choosing Cutie, defining any multi-signal presence
  policy, or spending further storage on a larger model.

### 2026-08-06 - ROM-19 evidence R - Second-sequence acceptance contract

Status: capture and scoring rules fixed before data; owner staging is pending.

Current-checkpoint audit:

- Re-read the isolated replay owner before adding code. The current
  `replay_manifest.py` binds immutable frame ids, timestamps, hashes, target
  state, and optional target geometry to the existing action-indexed replay. Its
  semantic scorer can join any set of globally unique frames and requires both
  presence and loss evidence.
- It does not yet encode negative-instance boxes, score target-versus-distractor
  geometry, or require every member of a multi-sequence suite to pass
  independently. Those are real gaps for same-class identity evidence.
- Do not add another schema, suite type, or scoring module before the second
  sequence exists. The isolated experiment already contains 2,173 production
  and 1,494 direct Active View test lines. A temporary evidence harness can
  compare annotated target and distractor geometry without becoming a runtime
  owner. If the selected composition passes, the smallest generic remote-safe
  score contract can then be extracted from measured fields and tested before
  integration.
- Re-ran the current non-physical boundary suite on 2026-08-06. Gateway camera
  leases, dashboard, security, Gateway service, Active View, action-indexed
  replay, replay manifest, media/session, Environment Adapter, and command
  catalog passed 170 of 170 tests in 14.6 seconds with localhost fixtures
  enabled. The restricted first attempt produced only expected socket-binding
  permission errors; the permitted run was clean.
- All nine Active View production modules and three direct Active View test
  modules parse successfully and pass the 100-column/trailing-whitespace screen.
  `git diff --check` is clean. The live adapter and launcher still contain no
  Active View import, `inspect` route, `activeView` capability, worker,
  controller instance, or composition point.

Capture contract:

- Use a different ordinary target from the first blue-creature sequence and a
  second, visually similar or same-class object as the negative instance. Two
  cups, bottles, plush toys, boxes, or comparable same-category objects are
  suitable. Object names remain ignored capture annotations and must not enter
  runtime prompts, aliases, controller policy, or source tests.
- Keep the robot stationary. Capture through the existing authenticated Gateway
  camera path only; do not issue an intent, state, servo, motion plan, audio, or
  firmware command. One camera-on/snapshot/preview/camera-off lifecycle per
  phase remains independently attributable and bounded.
- Record at least 20 monotonic QVGA preview frames plus one XGA evidence snapshot
  in each phase, with received timestamps, frame counters, dimensions, and
  SHA-256 digests. Captures remain ignored owner-local data.
- Phase one: the chosen target and similar distractor are both fully visible and
  spatially separated. Phase two: the target is partially covered while the
  distractor remains visible. Phase three: only the target is completely removed
  or covered while the distractor remains in view. Phase four: the same target
  returns at a different image position without moving or replacing the
  distractor.
- Keep camera configuration and ordinary room lighting unchanged across phases.
  Do not improve a failing result by changing exposure, model prompts, target
  wording, frame selection, or thresholds after capture. A later lighting
  sequence is separate evidence, not a correction to this identity test.

Predeclared scoring contract:

- Run Cutie's official frame-step path first because it is the current leading
  streaming tracker. Seed it once from the initial target instance and provide
  no later prompt, mask, point, box, or semantic reseed.
- Use independently annotated or independently detected target and distractor
  geometry only for evaluation. A present frame passes when the tracked center
  is within the existing 0.12 normalized tolerance of the target and is closer
  to that target than to every annotated distractor. Every full-loss frame
  requires the component's official empty/background result. Return must pass
  without reseeding.
- Preserve the existing 100-millisecond p95 streaming limit. Do not introduce a
  confidence, mask-area, color, point-count, object-name, coordinate, or temporal
  threshold to make the second sequence pass.
- Score the first and second ordinary-target sequences independently. The suite
  passes only when both sequences pass every visible, partial-cover, loss,
  distractor, return, and latency gate. Aggregate recall is evidence but cannot
  hide failure of either target.
- BootsTAPIR remains observational comparison data, not a required component.
  Do not add it to a production composition unless independent sequences first
  justify a generic object-level aggregation rule with a useful margin.
- If Cutie fails the second sequence, record the failure before deciding whether
  to compare a maintained object verifier or larger licensed model. Do not tune
  Cutie, combine two failing signals, or expand runtime code in response to one
  replay.

Isolation and next action:

- This entry changes documentation only. No Ainekio source, schema, test,
  dependency, model, cache, service, process, camera state, or robot state
  changed. Removing this entry is its complete rollback.
- Keep `identity_gate_validated` false, fine-turn control unavailable, and
  Active View unregistered. The next operation is the four-phase camera capture
  after the owner identifies and stages two similar objects. Physical body
  movement remains separately unauthorized.

### 2026-08-06 - ROM-19 evidence S - Independent bottle/cup identity replay

Status: the second sequence is captured and replayed; Cutie and the current
semantic-acquisition composition failed the independent suite, so the identity
gate remains false.

Capture evidence:

- Captured a dark bottle as the target and a stationary gray cup as the
  visually similar distractor through the existing authenticated Gateway
  camera owner. The ignored owner-local sequence is
  `Ainekio/recordings/active-view/20260806-identity-sequence-02/`.
- Each of the four predeclared phases contains one XGA evidence snapshot and 24
  monotonic QVGA preview frames. The replay input is therefore 96 QVGA frames;
  the evidence directory contains 100 JPEG frames in total.
- Target/distractor counters are 6 through 37 after watermark 5; partial-cover
  counters are 40 through 64 after watermark 39; full-loss counters are 66
  through 90 after watermark 65; return counters are 91 through 115 after
  watermark 90. All recorded counters are unique, globally increasing, and
  newer than their phase watermark.
- Every recorded byte length and SHA-256 digest matches its manifest. Each
  phase contains exactly 24 previews and one snapshot. Camera-off received its
  matching terminal ACK at sequences 10, 14, 18, and 21.
- The bottle is fully visible near image center in phase one, partially covered
  while the cup remains fixed in phase two, absent while the cup remains fixed
  in phase three, and the same bottle returns fully visible at the far left in
  phase four. The robot and camera remained stationary and ordinary lighting
  was not deliberately changed.
- Every phase records `physicalMotion: false`. Capture issued camera-on,
  snapshot, bounded preview, and camera-off operations only. It sent no intent,
  state, servo, motion-plan, audio, or firmware command. `git check-ignore`
  resolves the sequence through Ainekio's existing `recordings/` rule.

Reference acquisition and fixed evaluation geometry:

- The first second-sequence attempt was externally terminated by SIGTERM before
  a result and was discarded. Host health then showed approximately 49 GiB RAM
  available, roughly 15 GiB VRAM free, 97 GiB disk free, and no remaining
  replay process. One clean retry reached the established seed gate and failed
  because Grounding DINO Tiny did not accept the initial `dark bottle`
  reference. Cutie was not seeded in that attempt, so this is acquisition
  evidence rather than a tracker score.
- The predeclared contract allowed independent annotations or detections.
  Before any second-sequence Cutie output, human review fixed XGA `xyxy` boxes:
  target/distractor `[399,261,573,767]` / `[640,576,830,767]`; partial target /
  distractor `[430,445,573,767]` / `[640,576,830,767]`; full-loss target absent
  with distractor `[640,576,830,767]`; return target/distractor
  `[75,290,245,767]` / `[640,576,830,767]`. The temporary evaluator converted
  these to normalized geometry for scoring. They were not changed after seeing
  tracker output.
- The annotated first-frame bottle box produced a 6,716-pixel EdgeTAM seed
  mask. EdgeTAM supplied no later frame, mask, box, point, or correction. Cutie
  then received all 96 frames through official `InferenceCore.step()` with one
  seed and no semantic or geometric reseed.
- The prior temporary replay source had already been removed, so this run
  reused its remaining CPython 3.12 artifact with SHA-256
  `219f061a15be7a7b50344f1dfeaa66f6a0132c8621a4eef79881ecaafd8f1a8c`.
  A readable temporary suite driver supplied only dataset paths, annotations,
  and result packaging. The compiled artifact is acceptable for reproducing
  this local research result but is not reviewable production source and must
  not become a maintained dependency.

Control and second-sequence results:

- Replayed the original 115-frame blue-creature/cup sequence first with the
  same artifact and detected references. It reproduced evidence P exactly:
  86 of 86 present frames agreed, 15 of 29 absent frames retained a false mask,
  the loss pattern remained `11111111111110000000100000100`, return recovered
  28 of 28 without reseeding, no frame moved closer to the cup, and aggregate
  Cutie p95 was 22.481 milliseconds. This closes result-path parity before the
  second comparison.
- On the 96-frame bottle/cup sequence, Cutie passed all 24 fully visible frames,
  produced zero false retained masks on all 24 full-loss frames, recovered all
  24 return frames without reseeding, and never moved closer to the gray cup.
- Partial cover failed the predeclared geometry gate. All 24 masks were
  nonempty, but only 8 of 24 centers were within 0.12 of the fixed visible-
  bottle annotation. Median error was 0.121058 and maximum error was 0.123580.
  Median mask area increased from 0.085020 of the image before cover to
  0.129427 under cover, which is consistent with the tracker absorbing part of
  the covering material rather than preserving the visible bottle extent.
- The complete second sequence therefore accepted 56 of 72 expected-present
  frames and 24 of 24 expected-absent frames. Aggregate Cutie latency was
  21.045 milliseconds mean, 23.252 milliseconds p95, and 101.075 milliseconds
  maximum with 179.512 MiB peak CUDA allocation. The declared latency gate is
  p95 below 100 milliseconds, so cadence passed.
- The second sequence failed independently on partial-cover association. The
  original sequence still fails independently on full-loss rejection. The
  multi-sequence suite therefore fails without relying on aggregate recall.

Decision, architecture, and rollback:

- Cutie remains the strongest tested streaming continuity component, but it is
  rejected as the sole object identity/presence owner. The current Grounding
  DINO acquisition path also cannot be treated as a general seed owner because
  it failed to admit this ordinary low-contrast target.
- Do not move the annotation, relax 0.12, add a mask-area rule, debounce loss,
  combine Cutie with the failed BootsTAPIR signal, change the target wording,
  or fit a bottle/room special case. The measurements are rejection evidence,
  not constants to tune against.
- The next non-physical selection step is a maintained object-level verifier or
  integrated promptable video-object component that owns target acquisition,
  occlusion/loss, distractor rejection, and return semantics. It must replay
  both sequences independently behind the existing perception boundary before
  any runtime extraction or registration.
- This evidence added no Ainekio or MetaHuman runtime code, route, capability,
  controller composition, dependency, model installation, firmware change, or
  physical command. Active View remains unregistered,
  `identity_gate_validated` remains false, and fine-turn calibration remains a
  separate physical gate requiring exact owner authorization.
- Removing the ignored second sequence removes its persistent local media.
  Removing the temporary suite driver and review overlays removes evidence-S
  tooling. The previously retained `/tmp` research checkouts, checkpoints, and
  compiled harness remain separately removable as recorded in evidence P and
  Q. Removing this documentation entry is the complete tracked rollback for
  evidence S.

### 2026-08-06 - ROM-11/ROM-19 evidence T - Verifier candidate screen

Status: the current V1 composition is rejected; SAM 3.1 is selected only as the
next isolated verifier experiment, pending explicit owner acceptance of its
gated license and checkpoint access.

Primary-source screen:

- [MASA](https://github.com/siyuanliii/masa) is Apache-2.0 and learns generic
  instance association, but its own documented limitations say it cannot track
  objects its detector misses, cannot repair inconsistent detections, and may
  degrade under heavy occlusion. It therefore does not own either the failed
  dark-bottle acquisition or the failed partial-cover semantics by itself.
- [DAM4SAM](https://github.com/jovanavidenovic/DAM4SAM) directly targets
  distractor-aware memory and re-detection. Its 2026 paper also reports that the
  method can improve EdgeTAM. The current public repository, however, contains
  no declared license file for the DAM modifications. It is useful research
  direction but cannot become a clean maintained dependency without explicit
  upstream licensing.
- Cloned only the official Apache-2.0
  [SAMURAI](https://github.com/yangchris11/samurai) source at commit
  `76ba195984892b0d1e3db5d9c9f90bb62175680a` into `/tmp`; the checkout occupies
  67 MiB and no checkpoint or dependency was installed. SAMURAI's public API
  preloads an MP4 or finite JPEG directory and its documentation explicitly
  says live/streaming input is unsupported. Its official propagated mask can
  represent no object, but the useful object-existence logit remains inside
  predictor state rather than the public yielded result. It is therefore not a
  clean append-one-frame owner for the current worker boundary.
- [ODTrack](https://github.com/GXNU-ZhongLab/ODTrack) is MIT-licensed and
  propagates an initialized target through arbitrarily long online video, which
  is a better transport shape. It does not provide semantic acquisition or an
  official target-absent result, so it cannot independently own the missing
  presence/identity contract.
- [SAM 3.1](https://github.com/facebookresearch/sam3) is the only screened
  maintained component that unifies text/exemplar acquisition, segmentation,
  and video tracking. The official release reports improved VOS and first-
  person concept-tracking results, and its supported Python 3.12, PyTorch 2.7+,
  and CUDA 12.6+ floor fits the current RTX 4080 companion-host software stack.
  It remains a large verifier rather than an edge tracker.
- The official `facebook/sam3.1` checkpoint is 3.5 GB and
  [gated on Hugging Face](https://huggingface.co/facebook/sam3.1/tree/main).
  Access requires an authenticated user to agree to share contact information.
  Code and weights use Meta's custom
  [SAM License](https://github.com/facebookresearch/sam3/blob/main/LICENSE), not
  Apache or MIT. No local Hugging Face token or cached token file is present.
  Accepting those terms is an owner decision and must not be inferred from the
  request to continue research.

Architecture decision:

- Do not replace the current fast tracker with a 3.5 GB verifier and do not
  send every camera frame to SAM 3.1. Preserve the existing responsibility
  boundary: a streaming component supplies low-latency target continuity while
  an independent object-level verifier owns acquisition, identity, absence,
  distractor rejection, and return at objective admission, motion milestones,
  uncertainty, and reacquisition boundaries.
- Cutie may remain a candidate for the continuity role because it met the
  100-millisecond cadence and never switched to either distractor. It must not
  authorize motion or claim target presence. A verifier veto or unavailable
  result keeps the controller in acquisition/reacquisition rather than being
  averaged with Cutie confidence.
- This role split is not a conjunction of two weak scores. SAM 3.1 must pass
  the identity suite independently before it can own the verifier result; Cutie
  remains separately responsible only for the position of an already verified
  target between verifier milestones.
- The verifier can consume one fresh frame or a bounded recent clip through the
  existing isolated worker because it is not the high-rate control signal. That
  avoids requiring SAM 3.1's finite-video session to masquerade as the live
  camera owner. The Gateway lease manager and latest-frame mailbox remain the
  only acquisition owners.

Predeclared SAM 3.1 experiment:

- After explicit license acceptance, clone the official source and fetch only
  the official SAM 3.1 multiplex checkpoint into an isolated `/tmp` research
  environment. Record source revision, checkpoint digest, installed footprint,
  dependency footprint, model-load time, peak RAM/VRAM, and clean shutdown.
  Disable network access for replay and prohibit runtime downloads.
- First evaluate text-only acquisition on the initial frame of both existing
  sequences. The target prompt must resolve an unambiguous mask whose center is
  within the existing 0.12 normalized tolerance of the independent target and
  is closer to it than to the distractor. Manual geometry remains evaluation
  truth, not a runtime prompt.
- Then run the official video-object path with one initial target prompt and no
  later text, exemplar, point, box, mask, or semantic reseed. Every present and
  partially covered frame must agree with the target rather than the
  distractor; every full-loss frame must return the component's official absent
  or empty result; return must recover the same target instance without a new
  prompt.
- Each sequence must pass independently. Do not change prompt wording,
  annotations, model thresholds, coordinates, mask-area rules, temporal rules,
  or frame selection after seeing output.
- Cutie retains its separate sub-100-millisecond streaming budget. As a bounded
  verifier, SAM 3.1 must complete at p95 below 1,000 milliseconds per requested
  verification and fit within 14 GiB peak CUDA allocation so the companion host
  retains display and service headroom. These are role/hardware budgets, not
  presence thresholds.
- A pass authorizes only extraction of a typed verifier interface and direct
  tests behind the existing isolated Active View worker. It does not authorize
  adapter registration, capability advertisement, camera startup, robot motion,
  or fine-turn assets. Those gates remain separate.

Isolation and rollback:

- This screen changed documentation and `/tmp` research source only. It added no
  runtime source, route, schema, package, checkpoint, cache asset, service,
  camera operation, or physical command. Active View remains unregistered,
  `identity_gate_validated` remains false, and fine-turn calibration remains
  false.
- Removing `/tmp/rom19-samurai` removes the only evidence-T source checkout.
  No model or environment rollback is needed because none was installed.
  Removing this documentation entry is the complete tracked rollback for this
  candidate screen.

### 2026-08-06 - ROM-11/ROM-19 evidence U - Gated-access preparation

Status at this checkpoint: owner authentication is complete; blocked at gated
repository approval. No SAM 3.1 source or checkpoint had been acquired yet.

Changes:

- Created the disposable Python environment `/tmp/rom19-hf-auth` and installed
  `huggingface_hub` 1.26.1 plus its client dependencies. The first package
  attempt was correctly blocked by the sandbox's network isolation; the same
  isolated install succeeded after explicit network escalation.
- Did not store, request, print, or infer an owner token. Did not accept the SAM
  License, request gated model access, clone SAM 3.1, download a checkpoint, or
  execute model code.

Validation:

- `/tmp/rom19-hf-auth/bin/hf --version` returned `1.26.1`.
- `/tmp/rom19-hf-auth/bin/hf auth whoami` returned `Error: Not logged in` with
  exit code 1. The host also had no `HF_TOKEN`, standard cached token file,
  legacy token file, pre-existing `hf` command, or installed
  `huggingface_hub` module before this disposable environment was created.
- After the owner completed private browser authentication,
  `/tmp/rom19-hf-auth/bin/hf auth whoami` confirmed the account as `gmaster`.
  No token value was requested, printed, or copied into project files.
- An authenticated metadata-only dry run for `facebook/sam3.1` returned
  `Access denied. This repository requires approval.` No repository file was
  downloaded. This proves login succeeded but gated license access has not yet
  been granted.
- The companion host had 126 GB free storage, approximately 48 GB available
  system memory, and 14,688 MiB free on its RTX 4080 at the gate check. These
  are capacity observations, not model-runtime proof.
- No gateway registration, camera acquisition, runtime route, capability,
  physical motion, robot command, audio operation, or firmware change occurred.

Remaining:

- The owner must request or accept access on the official `facebook/sam3.1`
  model page. Authentication alone does not accept the repository's gated
  terms. A request to continue research is not treated as acceptance of
  third-party license terms.
- Once authenticated access is independently confirmed, execute the frozen
  evidence-T experiment without changing its prompt, geometry, thresholds,
  sequences, frame selection, or pass criteria.

Isolation and rollback:

- Removing `/tmp/rom19-hf-auth` removes the complete evidence-U environment.
  No tracked runtime source or persistent model asset was created. Removing
  this documentation entry is the complete tracked rollback for evidence U.

### 2026-08-06 - ROM-11/ROM-19 evidence V - Frozen SAM 3.1 replay harness

Status: checkpoint-independent harness validated; gated inference remains
pending repository-author approval.

Official-source findings:

- After the owner submitted the gated access request, cloned the public SAM 3
  source into `/tmp/rom19-sam3` and pinned commit
  `96914d2425f90a64f45ca977c2b5165418099543`. The clean checkout occupies
  131 MiB. Its `LICENSE` SHA-256 is
  `4dea99bfaa016e21bc860d73f344236bd1e5c4977d1a9a8fd32f822b500ae1be`.
  The repository request remains under author review and the checkpoint is
  absent.
- The official SAM 3.1 builder accepts a local `sam3.1_multiplex.pt`, loads its
  tokenizer vocabulary from the package, and does not call Hugging Face when a
  checkpoint path is supplied. The replay runner additionally sets Hub and
  Transformers offline flags before importing model code. Runtime download is
  therefore structurally excluded from the experiment.
- The public predictor owns finite JPEG/MP4 sessions and exposes
  `start_session`, one `add_prompt`, streaming `propagate_in_video`, and an
  idempotent `close_session`. The official public output contains object ids,
  normalized boxes, probabilities, and binary masks. Its postprocessor removes
  zero-area masks before returning those arrays, so zero public objects is an
  official absence result; the harness reads no private presence logit, memory,
  or predictor dictionary.
- The recommended multiplex builder contains its own detector, tracker,
  association, suppression, and output policy. The experiment omits all
  project-authored confidence and mask-area thresholds and leaves the official
  output probability default untouched. It disables optional Flash Attention
  only for dependency portability; this is an official builder option, not a
  result threshold.

Frozen experiment assets:

- Created only `/tmp/rom19-sam31-harness`, containing a 103-line JSON contract,
  157-line input/scoring module, 194-line official-API runner, and 159-line test
  module: 613 lines including data and tests. Nothing was added to Ainekio or
  MetaHuman runtime source.
- The contract pins the source revision, checkpoint filename, eight manifest
  digests, exact prompt text, phase order, 115- and 96-frame input counts,
  target/distractor reference centers, 0.12 geometry gate, 1,000-millisecond
  verifier p95 budget, 14-GiB CUDA-allocation budget, one frame-zero text
  prompt, zero reseeds, official empty-output absence, initial-object-id
  continuity, and independent per-sequence pass requirements.
- Contract SHA-256 is
  `e23b690bd4579aaaf2d07fe9dc27cfea90be71189524fd2838f12ef01c73124d`.
  Scorer, runner, and test SHA-256 values are respectively
  `bc086084e944ee42097946505389b003ce23222c7bfc24d457d13af3396762c5`,
  `0b5d6e063613309f64cfa978a1cc7616295a802f648a1ec9616cb199cb64baf8`,
  and `aaca2cc560c31a27bdb59c6b3da59d32e36ed8afa3fb8c150ba7b9b90855a39f`.
- The runner stages chronological symlinks in its own temporary directory,
  invokes one text prompt, consumes only public propagated results, closes the
  session in `finally` even when propagation raises, records source/checkpoint
  digests, model-load time, response latency, peak process RAM, peak CUDA
  allocation, and writes a result only after both sequences finish. The
  one-process experiment exits after model cleanup; it is not a service.

Validation:

- Input-only execution rehashed every selected manifest and JPEG and returned
  exactly `blue-creature-cup: 115` and `dark-bottle-gray-cup: 96`. Counters are
  unique and monotonically increasing within each chronological sequence.
- Ten pure-stdlib automated tests pass. They cover strict success, false target
  retention during loss, distractor switching, ambiguous extra output,
  different object id after return, reseeding, verifier latency, missing output,
  exactly one prompt plus normal close, and close after a propagation error.
- The three Python files compile, contain no line longer than 100 columns, and
  the progress document passes `git diff --check`. The harness occupies 72 KiB,
  the disposable authentication environment occupies 48 MiB, and no
  `sam3.1_multiplex.pt` exists locally.

Denied-or-delayed fallback:

- SAM 3.1 is not an architecture dependency. If access is denied or exceeds the
  owner's chosen wait, retain this frozen result as an unavailable candidate and
  replay public components against the same contract. Do not relax geometry,
  absence, identity, latency, or independent-sequence gates.
- The immediate honest V1 fallback is operator-seeded target geometry followed
  by the existing fast continuity lane and independent milestone verification.
  That preserves useful semi-autonomous view correction without pretending that
  text-only acquisition is validated.
- The autonomous fallback screen may compare public SAM 2.1 segmentation and
  tracking, a separately owned open-vocabulary acquisition component, and a
  separately owned instance-association component. SAM 2.1 alone is not a text
  or identity authority, and MASA alone cannot recover detections that never
  occurred. No weak scores may be averaged into authority; each selected owner
  must pass its responsibility and both recordings before extraction.

Architecture, safety, and rollback:

- No adapter registration, worker composition, route, schema, capability,
  package, persistent checkpoint, camera operation, robot command, audio
  operation, firmware change, or physical motion occurred. Active View remains
  unavailable, `identity_gate_validated` remains false, and fine-turn
  calibration remains false.
- Removing `/tmp/rom19-sam3` and `/tmp/rom19-sam31-harness` removes all
  evidence-V source and harness assets. `/tmp/rom19-hf-auth` remains the
  separately removable evidence-U client. The owner's Hugging Face login cache
  is personal credential state and is neither copied into these assets nor part
  of this rollback. Removing this documentation entry is the complete tracked
  rollback for evidence V.

### 2026-08-06 - ROM-19 evidence W - Public acquisition fallback contract

Status: acceptance frozen before download or inference; this is an acquisition
and absence screen, not a persistent-instance identity claim.

Candidate boundary:

- SAM 3.1 access remains under repository-author review. A fresh authenticated
  metadata request still returns `Access denied. This repository requires
  approval.` Continue the non-gated screen without changing the frozen SAM 3.1
  experiment or treating its external wait as a system dependency.
- OWLv2 is an Apache-2.0 zero-shot detector and exposes query-independent
  objectness, but its official postprocessor requires a score threshold and it
  has no temporal object id or official object-absence result. DINOv2 provides
  Apache-2.0 appearance features but likewise does not own proposal generation
  or absence. MASA owns association only after a detector emits an object and
  documents that it cannot repair missed or inconsistent detections. None is a
  clean first owner for the failed dark-bottle acquisition by itself.
- Microsoft Florence-2-base is a public MIT-licensed 0.23-billion-parameter
  model with an official caption-to-phrase-grounding task that returns parsed
  boxes and labels. A metadata-only preflight of the source repository pinned
  at `5ca5edf5bd017b9919c05d08aebef5e4c7ac3bac` exposed an invalid assumption in
  this contract before weight download or inference: its current model card
  requires `trust_remote_code=True`, and its tokenizer metadata cannot
  construct the installed native `Florence2Processor` with remote code
  disabled. Do not execute that repository's Python or synthesize the missing
  tokenizer fields locally.
- Current Transformers documentation instead uses
  `florence-community/Florence-2-base`, described as the native Transformers
  conversion of Microsoft's checkpoint. Pin revision
  `00921df66db728a9ceb750f5eca43e5c203a2051`. Its repository contains no Python
  files, is MIT-licensed, and publishes one 463,178,864-byte FP16
  `model.safetensors` with SHA-256
  `62f3e696da74f8869a68ddb529a9b3e14eb25b21c592cb3dea6179bf944df6a0`.
- The existing isolated ComfyUI Python runtime has Torch 2.11.0 and
  Transformers 4.57.6. With networking disabled and
  `trust_remote_code=False`, the pinned converted metadata resolves to the
  installed `Florence2Config`, `Florence2Processor`, `BartTokenizerFast`, and
  `CLIPImageProcessor`; its required `<image>` token resolves to id 51289.
  Freeze `use_fast=False` to avoid a documented future processor-default
  change. Do not install another Torch environment.

Predeclared acquisition/absence screen:

- Reuse the exact two prompts, eight pinned phase manifests, 115- and 96-frame
  order, target/distractor reference centers, and 0.12 normalized geometry gate
  from evidence V. Run every QVGA replay frame, not selected examples.
- Invoke only the official `<CAPTION_TO_PHRASE_GROUNDING>` task with the frozen
  sequence prompt. Freeze `do_sample=False`, three beams, 256 maximum new
  tokens, processor `use_fast=False`, and the model processor's public
  token-sequence postprocessing path before the scored replay. A one-frame
  lifecycle probe showed that generic batch decoding inserts spaces between
  location tokens and therefore produces an empty text-parser result even when
  the model emits a box. Passing the unchanged generated token sequence to the
  processor's explicitly supported `sequence` input preserves token boundaries;
  it is not a project parser or a perception threshold. Add no confidence
  threshold, mask-area rule, color test, query alias, coordinate hint, temporal
  debounce, or scene special case.
- Every visible, partially covered, and return frame must contain exactly one
  parsed box whose center is within 0.12 of the independent target and closer to
  it than every recorded distractor. Every full-loss frame must contain zero
  parsed boxes. Each sequence and phase passes independently; aggregate recall
  cannot hide either failure.
- Cached offline replay must remain below 1,000 milliseconds p95 per frame and
  below 14 GiB peak CUDA allocation. Record repository revision, exact file
  digests and footprint, model-load time, frame latency, process RAM, CUDA use,
  deterministic repeat result, and cleanup.
- A pass may nominate Florence-2 as a low-frequency semantic acquisition and
  absence verifier. It cannot validate persistent instance identity because it
  has no temporal object id or cross-frame memory. Cutie remains only the fast
  continuity candidate, and a same-class association gate remains required
  before any physical action authority or typed runtime extraction.

Isolation and rollback:

- This entry changes documentation only. No Florence file, dependency, source,
  cache asset, service, route, capability, camera operation, or physical command
  exists at this checkpoint. Removing this entry is its complete rollback.
- If the frozen screen proceeds, keep all model and harness assets under
  `/tmp/rom19-florence2-*`, record their digests, and retain Active View as
  unregistered with `identity_gate_validated` and fine-turn calibration false.

### 2026-08-06 - ROM-11/ROM-19 evidence X - SAM 3.1 official-main preflight failure

Status: checkpoint acquired; the frozen replay did not reach frame inference
because the official public predictor path is internally incompatible. This is
an upstream preflight failure, not a perception result.

Acquisition and provenance:

- The owner reported that the `SAM3` gating-group request was accepted on
  August 6. The authenticated download resolved `facebook/sam3.1` revision
  `daa63191845a41281374e725f4c9e51c7a824460` and acquired only
  `sam3.1_multiplex.pt` under `/tmp/rom19-sam31-checkpoint`.
- The checkpoint is 3,502,755,717 bytes with SHA-256
  `0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6`.
  Its state dictionary has 1,623 entries: 1,166 under `detector` and 457 under
  `tracker`. No duplicate checkpoint format was downloaded.
- The gated model card was pinned at the same repository revision and has
  SHA-256
  `4835b42b1a317f5bbfb664f17c421d0a081ad91ddf9288c76c9c0d205cbc5179`.
  It delegates code and usage to the public SAM 3 repository; it does not name
  an alternate source revision or checkpoint conversion.
- The official public source remains clean at
  `96914d2425f90a64f45ca977c2b5165418099543`. A fresh remote-ref check returned
  the same commit for `refs/heads/main`.

First execution result:

- The isolated runner revalidated both immutable input sequences, loaded the
  model, and failed on the first `start_session` request before a frame was
  inferred or a prompt was submitted. No replay-result JSON was written.
- `Sam3BasePredictor.start_session` always supplies
  `offload_state_to_cpu`, but the official
  `Sam3MultiplexTrackingWithInteractivity.init_state` signature does not accept
  it. Python therefore raised
  `TypeError: Sam3MultiplexTrackingWithInteractivity.init_state() got an
  unexpected keyword argument 'offload_state_to_cpu'`.
- This exact official-notebook failure is independently recorded in
  [facebookresearch/sam3 issue 544](https://github.com/facebookresearch/sam3/issues/544).
  The associated [open PR 543](https://github.com/facebookresearch/sam3/pull/543)
  filters initialization arguments with the same signature-inspection pattern
  already used by adjacent predictor methods. Its CLA-signed head is
  `081b4fca8296318b9f958b3b4a2527cb2f74dad4`; it remains open and is not part
  of official `main`.
- The model also reported 64 outer missing RoPE buffers under the builder's
  default `use_rope_real=True`. The acquired checkpoint contains complex
  `freqs_cis` entries rather than `freqs_cis_real` and `freqs_cis_imag` pairs.
  A public issue report identifies `use_rope_real=False` as the compatible
  video-builder configuration, but the official notebook, builder signature,
  and model card do not declare that requirement. The large first-stage
  missing-key report comes from the builder loading the combined
  detector/tracker checkpoint into its tracker submodel before loading the
  combined model; it cannot be treated as clean-load evidence.
- The failed runner exited, left no SAM process, and issued no camera or robot
  operation. Existing MetaHuman GPU processes were left untouched.

Decision and next measurement:

- Do not patch the pinned official checkout, suppress missing-key output, or
  call private model state an integration-ready owner path. Official-main SAM
  3.1 is not currently eligible for runtime selection.
- A second replay may be run only as a clearly provisional research result by
  applying the semantic PR 543 session-argument filter, without its two
  trailing-whitespace lines, to a separate temporary worktree based on the
  pinned official commit and by selecting the checkpoint's matching
  complex-RoPE configuration. Record the base and upstream patch commits,
  verify the resulting diff contains only the session-argument filter, and add
  a focused regression test before inference.
- A provisional pass would answer whether SAM 3.1's model outputs satisfy the
  frozen identity/presence contract; it would not clear integration. Production
  candidacy still requires an official merged owner path or a separately
  reviewed, tested dependency policy decision.
- If the provisional model fails either sequence, reject it and continue the
  already frozen public fallback screen. Do not tune prompts, thresholds,
  geometry, phases, or object-specific rules after viewing outputs.

Provisional harness and resource gate:

- A detached temporary worktree at `/tmp/rom19-sam3-pr543` retains the official
  base commit and changes only `sam3/model/sam3_base_predictor.py`. The clean
  seven-line semantic filter has working-diff SHA-256
  `db034c816eadded0c0df891144e0baa55c357808a9e2ebd1cc45ccef57ddac66`;
  its patched-file SHA-256 is
  `8433b027020295c34082b16658e73cac75885c1aace6d4f0d739203b80b9a427`.
  `git diff --check` passes.
- The revised research contract pins that exact base, changed file, file
  digest, diff digest, upstream PR and patch commit, and declares
  `use_rope_real=false`, `use_fa3=false`, compilation off, warm-up off, and
  asynchronous loading off. After the memory-fit measurement, it also pins the
  official session's `offloadVideoToCpu=true`. Its SHA-256 is
  `990749f98178366c1eb9dc79d0bdd92bb41fbd61ceb134d1d35020776170028d`.
  Acceptance criteria, prompts, reference geometry, phases, manifests, and
  frame counts did not change.
- The runner rejects any changed source commit, extra dirty file, patched-file
  digest, or diff digest before model construction. Ten replay/scorer tests and
  the new focused predictor-compatibility test pass. Input-only execution again
  returns exactly 115 and 96 frames. No output line in the harness exceeds 100
  characters.
- Actual inference is deferred while owner-authorized model training occupies
  the GPU. At the measured checkpoint, four existing MetaHuman Python processes
  used about 12.1 GiB of the 16-GiB RTX 4080, leaving 2.8 GiB free at 100%
  utilization. They were not inspected, stopped, unloaded, or interrupted.
- After the owner reported that GPU space had been freed, a fresh measurement
  showed improvement but not an idle benchmark window: 9.3 GiB remained used,
  6.6 GiB was free, four training processes each retained about 2.1 GiB, and GPU
  utilization remained 99%. The frozen replay was not started because both its
  load headroom and latency measurement would be compromised.
- CPU is not an equivalent supported replay path. The official SAM 3.1
  prerequisites require a CUDA GPU; the multiplex builder calls
  `demo_model.cuda()`, session initialization fixes its device to `cuda`, and
  the predictor enters CUDA BF16 autocast. Porting those paths to CPU would be
  an invasive third-party fork and would invalidate this candidate comparison.
  Contract logic and lifecycle tests can run on CPU; the 211-frame perception
  result cannot honestly be reported until sufficient GPU memory is available.
- No result JSON exists. Resource deferral is not a model pass or failure and
  does not change the rejection of the current DINO/Cutie composition.
- With 15.0 GiB free and no listed compute process, the first actual replay
  reached frame-zero text acquisition and began forward propagation. Before
  emitting a propagation-frame result, CUDA allocation failed: the process held
  13.59 GiB, 1.05 GiB remained free, and the next operation requested 1.27 GiB.
  The session closed in `finally`, released its frame state, and wrote no result
  JSON. This is a memory-fit failure before perception scoring, not a failed
  identity or presence decision.
- The official `start_session` request owns a non-semantic
  `offload_video_to_cpu` option. For the 115-frame sequence, its FP16
  3-by-1008-by-1008 frame store is approximately 0.65 GiB, exceeding the
  observed 0.22-GiB allocation shortfall. Freeze that option as `true` before a
  bounded retry. It changes storage placement and measured latency, not weights,
  prompts, outputs, thresholds, reference geometry, or acceptance. The runner
  now reads the setting from the contract, exposes it in its result, and its
  focused test proves the start request carries it. All 11 tests and the exact
  115/96 input validation pass after this change.
- Before the bounded retry could start, two new non-SAM Python compute processes
  appeared and grew GPU use from 3.3 GiB to 4.9 GiB within 14 seconds, reducing
  free memory to 11.0 GiB. They were not stopped or inspected. The offloaded
  retry has not run, and no result JSON exists.
- After the GPU returned to 14.94 GiB free with no listed compute process, the
  CPU-frame-offloaded retry again reached frame-zero acquisition and forward
  propagation, then failed before emitting a propagation-frame output. Live
  PyTorch allocation fell from 12.42 GiB to 12.09 GiB, confirming that offload
  reduced the intended storage owner, but the allocator held another 1.51 GiB
  reserved and unused while a 1.27-GiB contiguous request failed. The session
  closed and no result JSON was written.
- Installed PyTorch 2.11.0+cu130 supports `PYTORCH_ALLOC_CONF` and tests the
  `expandable_segments` option. Freeze
  `PYTORCH_ALLOC_CONF=expandable_segments:True` in the contract and set it
  before importing Torch. This is allocator fragmentation control recommended
  by the emitted PyTorch failure, not perception tuning. It does not change
  model weights, prompts, thresholds, outputs, references, or acceptance.
- Permit one final bounded retry with both official video CPU offload and the
  frozen allocator configuration. If it still cannot emit frame zero on an
  otherwise idle 16-GiB card, reject SAM 3.1 as not fitting the V1 hardware
  envelope; do not add further memory workarounds.
- The final bounded retry ran with 14.9 GiB initially free. Expandable segments
  reduced reserved-unused memory from 1.51 GiB to 127.55 MiB, proving the
  fragmentation control took effect. The first propagation operation still
  failed before output with 13.75 GiB in process use, 837.19 MiB free, and a
  further 1.27-GiB request. This is a real capacity deficit of approximately
  0.45 GiB at that operation, not allocator fragmentation.
- A later owner-provided lower-baseline window began with 15.35 GiB free. The
  exact same frozen runner emitted the first 16 of 115 propagation frames, then
  failed when the next multiplex chunk requested another 1.27 GiB. At failure,
  the process held 13.87 GiB, PyTorch had allocated 13.38 GiB with 200.47 MiB
  reserved but unused, and approximately 1.28 GiB remained free. This confirms
  that the earlier failure was not caused only by display or unrelated process
  occupancy: the official 16-frame batched-grounding path grows beyond the
  16-GiB card as replay advances. The incomplete run is not a perception score.
- The checkpoint contains 874,365,676 tensor elements occupying 3.262 GiB:
  873,186,028 FP32 parameters or buffers and 1,179,648 complex64 elements. The
  checkpoint itself therefore accounts for only part of runtime use. The
  official multiplex builder combines detector and tracker owners, uses
  1008-by-1008 inputs and 16-frame batched grounding, and retains video,
  feature, mask, and tracking state. Activations, caches, CUDA workspace, and
  the observed 1.27-GiB transient operation account for most of the gap between
  the 3.26-GiB tensors and the greater than 15-GiB execution requirement.
- Reject the public SAM 3.1 multiplex candidate for the RTX 4080 V1 hardware
  envelope before perception scoring. It produced no scored frame, no result
  JSON, and no evidence about target identity or presence. Retain it only as a
  future larger-memory research candidate; a practical later revision should
  use a GPU with materially more than 16 GiB rather than depending on a
  razor-thin theoretical fit. The owner has now closed this candidate for V1.
  If it is reconsidered for production, treat 24 GiB as the practical starting
  class rather than a proven minimum, and rerun the entire frozen replay plus a
  production-length soak before selection; the incomplete 16-GiB measurements
  cannot establish the full-run peak.
- Do not add batching changes, model surgery, precision conversion, private
  state access, prompt changes, lower image resolution, or more allocator
  workarounds. Continue the evidence-W public fallback contract unchanged.

Isolation and rollback:

- No tracked source, package, adapter, graph, service, capability, firmware, or
  runtime configuration changed. Active View remains unavailable,
  `identity_gate_validated` remains false, and fine-turn calibration remains
  false.
- Removing `/tmp/rom19-sam31-checkpoint`, `/tmp/rom19-sam31-model-card`, and the
  already documented SAM source, dependency, authentication, harness, and
  `/tmp/rom19-sam3-pr543` worktree directories removes the local evidence-X
  assets. The owner's Hugging Face credential cache is not copied, inspected,
  or included in rollback.
- Removing this documentation entry is the complete tracked rollback for
  evidence X.

### 2026-08-06 - ROM-19 evidence Y - Florence-2 phrase-grounding rejection

Status: the native public fallback completed both immutable sequences on CPU
and failed the perception contract independently on both. GPU benchmarking is
unnecessary for this rejected task/model composition.

Dependency and API correction:

- The original Microsoft repository pinned in evidence W requires
  `trust_remote_code=True`; its tokenizer metadata cannot construct the native
  Transformers 4.57.6 `Florence2Processor`. That mismatch was found before its
  weights were downloaded or any frame was inferred. No repository Python was
  executed and no missing token or processor field was synthesized.
- Current
  [Transformers Florence-2 documentation](https://huggingface.co/docs/transformers/model_doc/florence2)
  instead uses the native converted
  [`florence-community/Florence-2-base`](https://huggingface.co/florence-community/Florence-2-base)
  artifact. Pinned revision
  `00921df66db728a9ceb750f5eca43e5c203a2051` contains no Python files. Its only
  weight file is a 463,178,864-byte FP16 safetensors checkpoint with SHA-256
  `62f3e696da74f8869a68ddb529a9b3e14eb25b21c592cb3dea6179bf944df6a0`.
- Offline construction with `trust_remote_code=False` resolved only installed
  native classes: `Florence2Config`, `Florence2Processor`,
  `BartTokenizerFast`, and `CLIPImageProcessor`. The required `<image>` token
  resolved to id 51289. Processor `use_fast=False` was frozen to avoid a
  documented default change.
- Generic batch decoding inserts spaces between generated location tokens, so
  passing decoded text to the official parser produced an empty result despite
  a valid generated box. The processor's public `post_process_generation`
  method explicitly accepts the unchanged generated token `sequence`; that
  owner path preserves the location-token boundaries and returned the expected
  parsed box. The harness uses that public input and contains no location-token
  parser.

Harness and validation:

- `/tmp/rom19-florence2-harness` contains one 43-line JSON contract, a
  154-line input/scoring module, a 219-line runner, a 122-line test module, and
  a 102-line lifecycle probe: 640 lines including data and tests. It reuses the
  previously frozen 115/96-frame input contract by exact SHA-256 rather than
  copying the sequence geometry or manifests.
- Contract SHA-256 is
  `68f161e8b6659c67dc39d646a767ed5efc16dfa92a0f68769dca6aa3304a67f0`.
  Scorer, runner, tests, and probe SHA-256 values are respectively
  `76f96335050c987f01625008f4e0c563ddb960b7a85216ad40fc4ada7e11af56`,
  `f60916179afc4eff21d55bb5f471d19fffc249380ab54585bec892aed9579931`,
  `4e8bcda26c1ef09e34ae3ee00be53277e181f0cc48f43a10e7b2251b2129c568`,
  and `7d2e75672e5bede2e816a88f746257b089b9f970d99742da81e775b83d19b61d`.
- Eight pure scoring tests pass. They cover strict success, false presence,
  missing presence, ambiguous boxes, distractor localization, latency,
  deterministic repeat, and missing/reordered output. All Python files compile,
  the line-length screen passes, and exact input validation returns 115 and 96
  frames.
- A two-sequence one-frame smoke loaded once, produced one correct box for each
  target, repeated both outputs exactly, stayed offline, used no remote code,
  and completed cleanup. This justified the full CPU correctness replay without
  waiting for the owner-occupied GPU.

Measured replay result:

- The complete 118,177-byte result has SHA-256
  `0c659200b01e7c6c392d31b14ae7e783013d18e8ec1440532f7daf35ff36cce5`.
  Model load took 406.48 milliseconds and peak process RSS was 2,306,940 KiB.
  Both sequence repeat checks and the offline/no-remote-code/official-parser/
  cleanup lifecycle checks passed.
- Blue creature/cup accepted all 29 visible and all 28 return frames, only 6
  of 29 partial-cover frames, and zero of 29 full-loss frames. Twenty-three
  partial frames produced two candidate boxes; every loss frame produced one
  false box. Aggregate acceptance was 63 of 115 frames.
- Dark bottle/gray cup accepted all 24 visible and all 24 return frames, zero
  of 24 partial-cover frames, and zero of 24 full-loss frames. Every partial and
  loss frame produced one box, but the partial boxes failed frozen target
  geometry and every loss box was a false presence. Aggregate acceptance was
  48 of 96 frames.
- CPU p95 was 2,671.04 milliseconds for the first sequence and 2,142.27
  milliseconds for the second, above the production budget. This is a CPU
  diagnostic rather than GPU latency evidence. It cannot affect the rejection:
  faster execution would not repair 53 of 53 false-present loss outputs or the
  independent partial-cover failures.

Decision, architecture, and rollback:

- Reject caption-to-phrase grounding as the V1 acquisition/absence verifier.
  It grounds an asserted caption phrase and did not own absence on either
  sequence. Do not add a confidence threshold, box-area rule, text cleanup,
  location parser, phase debounce, target alias, scene rule, or tracker vote to
  reinterpret these outputs.
- The result does not reject the weight file for every task. Before any further
  inference, a separately frozen screen may evaluate Florence-2's maintained
  `<OPEN_VOCABULARY_DETECTION>` task because that is the API semantically
  intended to locate a queried concept rather than ground an asserted caption.
  It must use the same exact prompts, frames, geometry, independent sequence
  gates, official token-sequence parser, and zero-threshold absence rule. One
  bounded task-correct screen is permitted; failure rejects Florence-2 for V1.
  This limits the Florence comparison to two tasks total. OCR, captioning,
  region-description, and segmentation tasks are outside this responsibility
  and must not become an open-ended mode search.
- The replay resolution is a controller-policy choice, not an OV3660 hardware
  ceiling. The isolated `ActiveViewConfig` currently defaults to QVGA 320 by
  240 at 5 fps. The Gateway home profile supports QVGA or VGA 640 by 480 up to
  10 fps and defaults its general camera capability to VGA; firmware separately
  captures fresh XGA 1024 by 768 stills. The two identity recordings used QVGA
  because they were designed around the proposed low-bandwidth live-control
  stream, battery/data constraints, and fast-tracker cadence.
- QVGA is too conservative as the only semantic-verifier evidence. Florence
  expands those frames to 768 by 768 and SAM 3.1 expands them to 1008 by 1008;
  resizing cannot restore source detail. Preserve the QVGA results as truthful
  evidence for the current QVGA configuration, but do not generalize them to a
  higher-resolution verifier lane. Before final component selection, capture
  equivalent identity/absence evidence through the existing fresh-XGA still
  owner. The intended split is low-frequency XGA for acquisition, uncertainty,
  reacquisition, and milestone/terminal verification; QVGA may remain the fast
  continuity lane only if it passes that narrower responsibility.
- No adapter, graph, route, worker, capability, package, persistent model,
  camera owner, firmware, or robot state changed. Active View remains
  unregistered, `identity_gate_validated` remains false, and fine-turn
  calibration remains false.
- Removing `/tmp/rom19-florence2-base`, `/tmp/rom19-florence2-native`, and
  `/tmp/rom19-florence2-harness` removes all evidence-W/Y model, metadata,
  harness, and result assets. Removing this entry and the evidence-W changes is
  the complete tracked rollback.

### 2026-08-06 - ROM-19 - Freeze XGA verifier acquisition contract

Status: validated

Decision and owner evidence:

- Use the existing Gateway `snap` command for the next bounded semantic-
  verifier replay. Current firmware initializes its only PSRAM framebuffer at
  XGA 1024 by 768 and switches to XGA for each fresh snapshot before restoring
  an active preview. The dashboard already routes `/api/snap` through the
  canonical Gateway `request_snap` owner. Repeated XGA stills therefore require
  neither a firmware change nor a reflash.
- Do not reinterpret the still path as continuous XGA video. The Gateway
  rejects preview resolutions other than QVGA and VGA, and firmware rejects a
  configured preview resolution above VGA. Reducing preview FPS would reduce
  data and battery use, but it does not change either resolution contract.
  Continuous XGA preview remains a possible future coordinated Gateway and
  firmware capability, with rebuild, reflash, and physical validation required.
- XGA 1024 by 768 is the closest current camera-owned source to Florence-2's
  768 by 768 processor input. It preserves substantially more source evidence
  than QVGA while matching the low-frequency semantic-verifier responsibility;
  it is not proposed as the fast continuity or live-control stream.

Frozen acquisition contract before capture:

- Record four independent 20-frame phases under
  `20260806-identity-sequence-03-xga`: target and distractor fully visible;
  target partially covered; target absent or fully covered while the distractor
  remains; and the same target returned at a different position. The target is
  `dark bottle` and the distractor is `gray cup`.
- Dispatch exactly one fresh snapshot command at a time. Wait for both a new
  monotonic camera-frame counter and that command's terminal result before
  dispatching the next command. Never overlap capture commands.
- Pace dispatch at no more than one snapshot per second. Hardware, encoding, or
  transport latency may make the measured cadence lower. Record each frame's
  counter, command sequence, receipt time, elapsed time, dimensions, byte size,
  and digest, plus total and effective cadence; do not label the result as a
  fixed one-FPS video stream.
- Leave continuous preview disabled and acquire no camera lease. Confirm before
  and after each phase that the staged robot is connected, there are no other
  camera consumers, no capture command remains pending, and the camera is off.
  Do not command locomotion, joints, pose, speech, or any other physical action.
- Write a phase only after all 20 XGA frames and terminal results are complete;
  an interrupted or invalid phase must leave no accepted output directory.
  Initial target geometry for scoring must be reviewed independently from this
  new XGA sequence and frozen before model inference.
- Preserve the previously frozen Florence screen: exactly one
  `<OPEN_VOCABULARY_DETECTION>` replay with the exact prompt `dark bottle`, the
  maintained processor's official token-sequence parser, deterministic
  generation, zero detections as absence, and no invented score, box-area,
  temporal, color, phase, or scene heuristic. Failure rejects Florence-2 for
  the V1 semantic-verifier role; no additional Florence task search follows.

Current boundaries:

- This entry freezes an evidence acquisition method, not a production camera
  loop. Active View remains unregistered, `identity_gate_validated` remains
  false, and fine-turn calibration remains false.
- The capture harness and recordings remain isolated and removable. No adapter,
  graph, route, worker, capability, package, firmware, or robot runtime owner is
  changed by this acquisition.

Validation to date:

- Extended the existing isolated `/tmp/ainekio_capture_identity_phase.py`
  harness with a `snapshot-series` mode rather than adding another capture
  owner. Harness SHA-256 is
  `d30838d4d6731df8bef56c68004037b7daae999c40a7582def59d8068f46d0d0`;
  `python3 -m py_compile` and CLI argument rendering pass. The mode validates an
  idle connected robot and empty lease set, correlates every frame with one
  `done` terminal, enforces XGA dimensions and monotonic counters, paces from
  dispatch time, rechecks idle state, logs out, and writes only a complete
  phase. It commands no camera preview or physical motion.
- Captured phase `phase-01-target-distractor` from 18:28:02Z to 18:28:25Z.
  All 20 snapshot commands completed exactly once: command sequences 5 through
  24 map to camera counters 4 through 23, every terminal is `done`, every image
  is 1024 by 768, and all 20 JPEG digests are unique. The 898,167 captured
  bytes were dispatched at an effective 0.845179 FPS over 22.902 seconds; the
  minimum dispatch interval was 1,000.027 milliseconds. Continuous preview and
  camera leases remained disabled and `physicalMotion` is false.
- Phase metadata SHA-256 is
  `d0d356939a52f91072cede4b8c60b02d8f5dd4bcf0733248a7237e835a517941`.
  Independent visual review of frame 10 confirms the dark bottle is fully
  visible on the left and the gray cup is fully visible on the right. A small
  blue figure remains visible between them as ordinary scene clutter; it is
  neither relabelled as the named distractor nor removed from the truthful
  scene description.
- Captured and accepted `phase-02-target-partially-covered`. Command sequences
  26 through 45 map one-to-one to camera counters 25 through 44; all 20
  terminals are `done`, all frames are 1024 by 768, and all 20 image digests are
  unique. The 893,020 captured bytes ran at an effective 0.999922 FPS with a
  minimum 1,000.061-millisecond dispatch interval. Metadata SHA-256 is
  `ba4aa7512d5e008e96ee3200750e52ce5f39857329a2c2490157043864be3cff`.
  Independent review of frame 10 confirms a light covering obscures most of the
  bottle while its lower body and outline remain visible; the gray cup and blue
  scene-clutter figure remain visible. This is a genuine partial-cover phase,
  not an unchanged target or a fully absent target. Continuous preview, camera
  leases, and physical motion remained false.
- Captured and accepted `phase-03-target-absent`. Command sequences 46 through
  65 map one-to-one to camera counters 45 through 64; all 20 terminals are
  `done`, every frame is 1024 by 768, and all 20 image digests are unique. The
  871,280 captured bytes ran at an effective 0.999924 FPS with a minimum
  1,000.030-millisecond dispatch interval. Metadata SHA-256 is
  `ebb5c207120a3fdcc3be59ee15e0ba3fb2bd01bcd229635bf35d1b5be597186a`.
  Full-sequence contact-sheet review confirms the dark bottle and covering
  material are absent in every frame while the gray cup and blue scene-clutter
  figure remain visible. Continuous preview, camera leases, and physical motion
  remained false.
- Captured and accepted `phase-04-target-returned`. Command sequences 67 through
  86 map one-to-one to camera counters 66 through 85; all 20 terminals are
  `done`, every frame is 1024 by 768, and all 20 image digests are unique. The
  868,024 captured bytes ran at an effective 0.999915 FPS with a minimum
  1,000.046-millisecond dispatch interval. Metadata SHA-256 is
  `29501af0b4062d43e78311ce8888b2ae630bc59b1a00938bba97b26dc536e8ac`.
  Full-sequence contact-sheet review plus original-resolution review of frame 10
  confirms the same bottle is fully visible to the right of the cup, distinctly
  separated and substantially displaced from its original left-side position.
  The gray cup and blue scene-clutter figure remain visible. Continuous preview,
  camera leases, and physical motion remained false.
- The physical XGA acquisition gate is complete: four independently staged
  phases, 80 fresh snapshots, 80 unique image digests, four monotonic and
  non-overlapping command/counter ranges, and no live preview or motion. This
  proves the current chip, flashed firmware, Gateway, and low-cadence still path
  can supply the resolution class chosen for the semantic verifier. It does not
  prove a perception model or a continuous XGA video capability.

Remaining:

- The XGA capture-path validation is complete. Perception selection remains a
  separate gate and is resolved for Florence-2 by evidence Z below.

### 2026-08-06 - ROM-19 evidence Z - XGA open-vocabulary rejection

Status: validated rejection; no V1 semantic verifier selected.

Pre-output contract and harness validation:

- Froze `/tmp/rom19-florence2-harness/xga-input-contract.json` before model
  inference with SHA-256
  `b335e216613655453f4144826bfee531402bcf287c9c19308d80ac514b73b49a`.
  It binds all four phase-manifest digests, 80 frame digests, exact prompt
  `dark bottle`, XGA dimensions, phase states, and independently reviewed
  target/distractor centers. The partial-cover phase retains the stationary
  physical target center from phase one rather than recentering truth on the
  covering material.
- Froze the Florence replay contract with SHA-256
  `acf31029e8cc9014b3fc8fc00e1204b9ae51c8d097041934a926977d206ef7ae`.
  It permits only `<OPEN_VOCABULARY_DETECTION>`, deterministic three-beam
  generation, at most 256 new tokens, native slow processing, and the official
  token-sequence postprocessor. Presence requires exactly one parsed box and no
  polygon; absence requires neither a parsed box nor a polygon. The existing
  0.12 normalized center-distance, one-second verifier latency, 14-GiB CUDA,
  independent-sequence, exact-artifact, offline, and no-remote-code gates remain.
- Generalized the existing temporary Florence harness rather than adding a
  second inference owner. The input validator now checks the saved still schema,
  phase and frame digests, XGA geometry, monotonic camera and command sequences,
  matching `done` terminals, camera-lease and continuous-preview absence, and
  `physicalMotion: false`. The scorer uses each source frame's dimensions and
  counts official polygons as detections instead of treating them as absence.
  The runner records both official output types and enforces the CUDA budget.
- Replay validator, runner, and test SHA-256 digests are respectively
  `44eb6a5319d86d82e817c945d3bcd6a256bd3932795a255a388355445fe44d5b`,
  `09df465a98a77dc18848a11d8bc0f36c0f50ab40669859f660cd610e5c5e524c`,
  and `43b3930121ab7942314b0a71e0a842a86678ddec62870e2dfebe64f3d5be9da9`.
  Python compilation passes, all 11 pure scorer tests pass, and pre-inference
  input loading resolves exactly 80 frames across four 20-frame phases.

Execution and result:

- A one-frame CPU probe used the pinned native model offline and produced one
  official `dark bottle` box `[168,80,309,518]` on the actual bottle, no polygon,
  and a deterministic repeat. It loaded in 442.610 milliseconds, used 2,292,116
  KiB peak RSS, and inferred in 2,041.292 milliseconds. Probe SHA-256 is
  `025ab1f7e3c506547a2d2d9b7889f3d26011a8f9adb697048365d2f5b7985719`.
- The companion GPU was executing a separate training job at the decision
  point: 6,863 MiB used, 9,050 MiB free, and 99-percent utilization. The full
  screen therefore set `CUDA_VISIBLE_DEVICES` empty and ran on CPU, preserving
  the user's training workload. CPU latency is diagnostic rather than a GPU
  throughput claim.
- The complete result is 47,673 bytes with SHA-256
  `0ddc6ccbe7851dc6ec0f12a8aefc1604c86c8df0ec92f232bd8ed270d7c1148b`.
  Model load was 443.511 milliseconds, peak RSS was 2,290,944 KiB, peak CUDA
  allocation was zero, deterministic repeat passed, and offline/no-remote-code/
  official-sequence-postprocess/cleanup lifecycle checks passed. CPU p95 was
  2,035.947 milliseconds, so the one-second production latency gate failed as
  expected for this diagnostic path.
- Perception accepted 60 of 80 frames: 20 of 20 fully visible, 20 of 20
  partially covered, and 20 of 20 returned frames. Every one of those outputs
  contained one box labeled `dark bottle`, no polygon, and target-consistent
  frozen geometry.
- Perception failed all 20 target-absent frames. Florence emitted one box
  labeled `dark bottle` and no polygon in every loss frame. Eighteen boxes cover
  the small blue scene-clutter figure; two cover an unrelated upper-frame
  hanging object. Original-resolution review of the first official false box
  `[371,384,466,518]` confirms it encloses the blue figure, not the absent
  bottle. This is a complete false-presence failure, not a parsing ambiguity or
  a resolution shortfall.

Decision, architecture, and rollback:

- Reject Florence-2-base as the V1 semantic acquisition/absence verifier. XGA
  repaired positive target localization but did not provide target absence or
  instance identity; the task always returned a plausible queried-object box.
  Do not add a score, color, area, text, phase, scene-object, temporal, or
  cross-model rule to reinterpret the 20 false presences.
- The predeclared Florence comparison is closed after exactly two tasks:
  caption-to-phrase grounding and open-vocabulary detection. Do not test OCR,
  captioning, region description, or another Florence task for this owner.
- No deployable V1 identity composition is selected from the tested components.
  Cutie remains the strongest low-latency continuity candidate, but it cannot
  authorize presence or motion. Grounding DINO and Florence may propose
  candidates, but neither owns absence; combining their scores with Cutie would
  combine failing signals rather than establish an independent verifier.
- Preserve the validated low-cadence XGA acquisition path as camera-owner
  evidence. It is model-independent and usable by a future verifier without a
  firmware reflash. It does not authorize continuous XGA preview, adapter
  registration, capability advertisement, target-relative motion, or fine-turn
  control.
- Active View remains unregistered, `identity_gate_validated` remains false,
  and fine-turn calibration remains false. The safe V1 decision is explicit
  non-availability of target-relative Active View on the current selected
  perception stack, not a conversational fallback or a silent stationary
  success.
- A later selection cycle may evaluate an independently maintained instance-
  identity verifier on multi-scene held-out evidence, or retry the official SAM
  3.1 verifier on hardware with adequate VRAM. It must retain the same absence,
  distractor, lifecycle, and no-post-output-tuning contract; it must not reopen
  the bounded Florence mode search.
- Removing the four ignored XGA phase directories removes the physical media.
  Removing `/tmp/ainekio_capture_identity_phase.py` and
  `/tmp/rom19-florence2-harness` removes all evidence-Z tools, contracts,
  overlays, probes, and results. Removing this entry is the complete tracked
  rollback. No maintained Ainekio or MetaHuman runtime source changed.

### 2026-08-06 - ROM-19 evidence AA - Benchmark-first perception selection gate

Status: selection screen complete; one new acquisition candidate and one
higher-resolution control replay are justified. No model inference, runtime
integration, or physical motion occurred.

Method correction:

- Earlier ROM-19 screens mixed two distinct purposes: falsifying whether a
  component could own the required responsibility, and selecting the best
  available model for that responsibility. The falsification evidence remains
  valid, but future selection must not give every available or older model an
  equal full replay.
- Public benchmarks now narrow the field before local work. Local Ainekio
  replay remains necessary only to measure domain shift from the OV3660 image,
  compression, lighting, similar distractors, full target loss, return, the
  RTX 4080 budget, and the maintained worker contract. It is not a replacement
  for community model comparison.
- Detection AP and long-term tracking quality are not interchangeable. LVIS
  open-vocabulary and visual-prompt results inform acquisition. Distractor,
  occlusion, loss, and return benchmarks inform temporal continuity. A model
  must still expose the semantics required by the controller; a high tracking
  score cannot create an official `lost` result if the implementation always
  emits a box.

Hard gates before a full local replay:

1. Source and model artifacts must have an explicit, reviewed license and be
   usable from pinned local files with inference-time networking disabled.
2. The component must fit an existing responsibility: independent-frame
   acquisition/reacquisition, or persistent append-one-frame continuity. A
   whole prerecorded video or completed frame-directory API is not a live
   owner merely because the camera supplies JPEG snapshots.
3. Acquisition must expose detections, including a legitimate empty result.
   Continuity must expose an official loss, ambiguity, or confidence semantic
   that can satisfy `ActiveViewEstimate`; a project-authored score threshold
   may not synthesize identity or absence after seeing the replay.
4. A smoke must remain below the existing 14-GiB CUDA ceiling, load and shut
   down cleanly, remain deterministic for a repeated frame, and leave the
   training workload undisturbed.
5. Only a candidate that passes the smoke receives the frozen 80-frame XGA
   semantic replay or a newly captured VGA temporal replay. Parameters and
   acceptance rules are frozen before model output.

Weighted comparison after hard gates:

- 30 percent: task match for similar distractors, partial cover, full loss,
  and return;
- 20 percent: task-aligned public benchmark evidence rather than popularity;
- 15 percent: maintained independent-frame or append-one-frame API fit;
- 15 percent: license, local weights, offline operation, and reproducibility;
- 10 percent: measured latency, VRAM, and process lifecycle on the local host;
- 10 percent: maintenance state and bounded integration cost.

Community and source screen:

- The official
  [YOLOE repository](https://github.com/THU-MIG/yoloe) reports visual-prompt
  LVIS results at 640-pixel input. YOLOE-11-M uses 27 million parameters in
  visual-prompt mode, reports 31.4 fixed AP and 39.2 visual-prompt FPS on a T4
  with TensorRT, and supports a cross-image visual prompt. This is a closer
  acquisition responsibility match than another text-only `dark bottle`
  query because the initial target box supplies the exemplar.
- Read-only source review is pinned to official YOLOE commit
  `40cd606cabdbe2b566d6f14a6b162c89206e9a1b` in
  `/tmp/rom19-yoloe-source`. The checkout is 61 MiB and clean. The official
  example first derives a visual-prompt embedding from a source image and box,
  installs that embedding with `set_classes`, clears the prompt predictor, and
  applies it to another image. The maintained input loader accepts NumPy image
  arrays, so Gateway JPEGs can be decoded and passed one at a time without a
  video file or a second camera owner.
- YOLOE source and the selected Hugging Face model card are AGPL-3.0. This does
  not block isolated local research, but production adoption requires an
  explicit license decision. The official `jameslahm/yoloe-11m-seg` dry run
  reported a 119.9-MB FP32 safetensors file and 30 million parameters. No
  checkpoint was downloaded in this screen.
- The distractor-focused DiDi table published by
  [DAM4SAM](https://github.com/jovanavidenovic/DAM4SAM) reports quality 0.575
  for Cutie, 0.608 for ODTrack, 0.680 for SAMURAI, and 0.694 for DAM4SAM. This
  is more relevant to the staged cup/target problem than a generic detection
  leaderboard, but it does not supersede the hard interface and license gates.
- DAM4SAM is the top task-aligned research result, but official commit
  `9c954504b39ebca4c412f207be0787c26bfac85a` has no repository-level license
  visible and its documented demo consumes a completed directory of frames.
  Do not clone, download, or integrate it until permission is established and
  an official append-one-frame path is demonstrated.
- SAMURAI is Apache-2.0 and ranks second on DiDi, but its own FAQ states that
  live/streaming input is not supported. Here `streaming` means preserving one
  tracking session while future JPEGs arrive, not encoded continuous video.
  The one-XGA-snapshot-per-second lane still needs that temporal API if a model
  is to guide the next action. SAMURAI may be replayed offline in a later
  research cycle, but adapting its whole-video state is a separate engineering
  project, not a V1 drop-in.
- Read-only review of MIT-licensed ODTrack at official commit
  `88c0a8e4b50faa8fe4e087f1f4b634dc78b6911d` confirms a genuine
  `initialize(image, init_bbox)` plus `track(image)` online interface. However,
  the official tracker always updates and returns `target_bbox`; it exposes no
  official absent, lost, ambiguous, or confidence result. Adding a threshold
  over its internal score map would be new project policy. ODTrack is therefore
  not an identity/absence verifier and receives no V1 replay despite ranking
  above Cutie on DiDi.
- Cutie remains the practical continuity control because its official
  append-one-frame API, MIT license, approximately 23-millisecond local p95,
  and low CUDA allocation already passed the runtime-shape screen. Its failed
  QVGA identity results remain binding: it cannot authorize presence or
  motion, and a higher-resolution replay cannot promote it to verifier by
  itself.

Resolution decision:

- Do not rerun OpenCV MIL/HSV, BootsTAPIR, EdgeTAM, Grounding DINO Tiny,
  Florence-2, or SAM 3.1 merely with more pixels. Their recorded failures are
  responsibility, absence, interface, or hardware failures rather than an
  unresolved source-detail question. Florence-2 already received the frozen
  XGA replay and failed all 20 absent frames.
- Evaluate the selected semantic candidate on the existing low-cadence XGA
  1024-by-768 sequence. This exercises the maintained fresh-snapshot lane
  closest to its 640-pixel model input without reflashing firmware.
- If semantic acquisition passes, capture one equivalent VGA 640-by-480,
  5-fps sequence for Cutie as the continuity control. This is the meaningful
  QVGA-to-VGA comparison. Replaying isolated one-fps XGA stills would not prove
  the cadence or temporal behavior used by the control loop.

Next bounded experiment:

- Pin the exact `jameslahm/yoloe-11m-seg` repository revision and artifact
  digest before download. Keep source, dependencies, weights, harness, and
  results in `/tmp`; do not add a package, dependency, runtime registration,
  or capability advertisement to Ainekio or MetaHuman.
- Use YOLOE-11-M visual-prompt mode only. Derive one visual-prompt embedding
  from the frozen first visible XGA frame and its previously fixed target box,
  then run independent predictions over all 80 XGA frames. Report the prompt
  source frame as diagnostic only and score the other 79 frames, so the human
  seed cannot count as model success. Use no target name, color rule, phase
  signal, tracker output, conversation context, or scene-specific
  postprocessor.
- Freeze the official input size and default confidence behavior before output.
  Preserve every raw box, mask, class, and score. The existing semantic scorer
  remains authoritative: a present frame requires exactly one
  target-consistent accepted result; an absent frame requires no accepted
  result; multiple or distractor-consistent results are ambiguous failures.
  Do not tune the threshold after seeing the bottle sequence.
- Run one deterministic lifecycle smoke before the full replay. At this screen
  the RTX 4080 was occupied by a separate training process at 99-percent GPU
  utilization, with 9,180 MiB used and 6,733 MiB free. Do not start inference
  until that workload is idle or the owner explicitly authorizes sharing.
- A failed smoke or frozen replay rejects YOLOE for the V1 verifier role. A
  pass nominates it for a separate held-out multi-scene screen; it does not set
  `identity_gate_validated`, authorize movement, or register Active View.

Isolation and rollback:

- This entry changes documentation only. Removing
  `/tmp/rom19-yoloe-source` and `/tmp/rom19-odtrack-source` removes the two
  clean read-only source checkouts. No model weight or Python dependency was
  downloaded, no camera command was sent, and no robot action occurred.
- Removing this entry is the complete tracked rollback. Active View remains
  unregistered, `identity_gate_validated` remains false, and fine-turn
  calibration remains false.

### 2026-08-06 - ROM-19 evidence AB - Freeze selected YOLOE artifact and replay contract

Status: exact research artifact and pre-output contract validated; inference
is deferred while the owner training workload occupies the GPU.

Artifact preparation:

- The official Hugging Face metadata pins `jameslahm/yoloe-11m-seg` at
  revision `ebab2db7c4617f6a5fba63f7f824a02d87c88ba0`, reports AGPL-3.0,
  29,950,323 FP32 parameters, and 119,885,160 bytes of model storage. The
  repository is public and ungated.
- Downloaded only `model.safetensors`, `config.json`, and `README.md` at that
  exact revision into `/tmp/rom19-yoloe-model`. Their SHA-256 digests are
  respectively
  `a82a56113b075bd3d9fbb9df77da05b8759b21115f142bcb04ee044229ac0d43`,
  `8f01d959a1898de5bc543e42084c0ac54c95a1c5fd4f1c70fa13eb26b4145329`,
  and
  `2036cc3b8f87fd60071d0f12adf1ba279e429fa8e444449018ad127fa138f19e`.
  The complete local model directory occupies 115 MiB. No alternate size,
  export, text encoder, tracker, dataset, or training asset was downloaded.
- This is an isolated research download, not production license acceptance.
  The AGPL decision remains open before any maintained dependency or deployed
  service can use the artifact.

Frozen contract:

- Created `/tmp/rom19-yoloe-harness/contract.json`, 83 lines with SHA-256
  `e59dc0e4a0cc48c391095c7c5780046559588df3abcc4a5c2d3f9b3d54384c0d`.
  JSON validation passes. It binds the exact source revision and five reviewed
  source-file digests, exact model revision and three artifact digests, and the
  previously frozen XGA input contract SHA-256
  `b335e216613655453f4144826bfee531402bcf287c9c19308d80ac514b73b49a`.
- The visual prompt uses previously reviewed phase-one frame 10,
  `frame-0010-0000000014-snapshot.jpg`, whose SHA-256 is
  `24f1d0b9638429abf2459c0815a7b1e0c79cc343f8fcd747b6de113d786505f3`.
  Original-resolution review before YOLOE output froze the tight bottle box
  `[182, 78, 331, 519]` in XGA `xyxy` pixels. This is evaluator seed geometry,
  not runtime scene hard-coding.
- The contract permits only the official cross-image
  `YOLOEVPSegPredictor`, image size 640, FP32, and the official prediction
  default confidence 0.25. It supplies class `object0` only and explicitly
  prohibits target text, phase input, tracker input, networking, and
  post-output threshold tuning.
- All 80 frames receive raw predictions, but the one human-seeded source frame
  is diagnostic and cannot count toward acceptance. The other 79 frames are
  scored with the existing 0.12 center tolerance. Present frames require
  exactly one target-consistent accepted `object0`; absent frames require zero;
  multiple or distractor-consistent results fail as ambiguous. The existing
  one-second p95 and 14-GiB CUDA ceilings remain.

Pre-inference validation:

- With `CUDA_VISIBLE_DEVICES` empty, Hugging Face offline mode enabled, the
  pinned YOLOE source on `PYTHONPATH`, and no package installation, the existing
  isolated ComfyUI Python runtime loaded the model only from
  `/tmp/rom19-yoloe-model`. Construction completed in 2.56 seconds, returned
  the official `YOLOESegModel` on CPU, exposed 29,894,806 PyTorch parameters,
  and used 1,107,576 KiB maximum RSS. No prediction or GPU allocation occurred.
- Added a 259-line contract/input/scoring module and a 171-line pure unittest
  module under `/tmp/rom19-yoloe-harness`. Their SHA-256 digests are
  `0054bd63829d98904325b71bc9f83eaca6ebdaadeefd8d036fd4a5922f2f6890`
  and
  `b0612ddec7e7fe8e7d24aa366cc78819ade42fe70f64ddbe28dbbb48330e7099`.
  Neither file contains a line longer than 100 characters.
- Python compilation and all 11 tests pass. Coverage includes exact source,
  model, input-contract, phase-manifest, and 80-frame digest validation;
  monotonic capture identity; exclusion of the prompt seed; strict success;
  false presence; missing presence; multiple-result ambiguity; distractor
  localization; latency; CUDA; lifecycle; reordered output; and immutable
  inference settings. No untested inference runner has been added yet.

Current execution gate and rollback:

- After the download, the RTX 4080 still reported 9,182 MiB used, 6,731 MiB
  free, and 100-percent utilization from the separate training workload. The
  only model construction was the CUDA-hidden CPU load above; no CUDA-visible
  construction, CUDA allocation, or inference was attempted.
- No Python dependency was installed, no Ainekio or MetaHuman runtime file was
  changed, no camera operation occurred, and no physical action was issued.
  Active View remains unregistered, `identity_gate_validated` remains false,
  and fine-turn calibration remains false.
- Removing `/tmp/rom19-yoloe-model` and `/tmp/rom19-yoloe-harness` removes the
  artifact and contract. Removing this entry is the complete tracked rollback.

### 2026-08-06 - ROM-19 evidence AC - CPU YOLOE visual-prompt replay

Status: frozen CPU replay complete; visible acquisition, true absence, and
return passed, but partial-cover continuity failed. YOLOE is rejected as a
standalone V1 verifier and remains unregistered.

Final pre-output contract and validation:

- Before the first YOLOE prediction, the evidence-AB contract was strengthened
  to bind a distinct phase-one probe frame and require an exact repeated
  prediction. This changed the contract SHA-256 from the initial pre-inference
  value recorded in evidence AB to
  `7a09ba51baaed1c665583d2adcde8be8a145ea0bbfc53a64f2192b707303791d`.
  The model, source, prompt frame, prompt box, image size, confidence,
  acceptance rules, and input sequence did not change, and no model output
  existed when the probe binding was added.
- The final temporary harness contains an 88-line contract, a 266-line
  validator/scorer, a 271-line offline runner, and 248 lines of tests. Their
  respective SHA-256 digests are
  `7a09ba51baaed1c665583d2adcde8be8a145ea0bbfc53a64f2192b707303791d`,
  `1547ac0189633877721f5837de2e9e8ee6605b43297730ad6f8b2bd8228cc673`,
  `d797e6771024b908d7fae809573cf57f3d7d84490e74fa9b7d00cab8a1f6c704`,
  `b4695d23ad9e470c3f3b077a0c088375387f208f23efe3b1a664f04949c8ef85`,
  and
  `2a31dc047d444b455c0f943f2f075c8d5575aae370c3f78037e7b9a680b39f27`.
  Python compilation passes and all 13 contract, scorer, serialization, and
  deterministic-repeat tests pass in 0.458 seconds.
- The runner forced Hugging Face and Transformers offline modes, put the pinned
  source first on `PYTHONPATH`, hid CUDA, loaded the exact local model revision,
  verified every source, model, contract, phase, and frame digest, and retained
  raw boxes, confidences, classes, masks, and mask digests. No dependency was
  installed and no inference parameter was tuned after output.

CPU probe:

- The bound probe produced exactly one `object0` detection with confidence
  0.977572, XGA box `[173.846,80.641,303.258,515.435]`, and mask SHA-256
  `304216bc7b004725b7065249cf07adf2c51409f4156b040012a1b67c01092dec`.
  Its exact repeat produced the same box, confidence, mask size, and mask
  digest. First and repeated prediction latency were 667.927 and 438.458
  milliseconds.
- Model load took 383.020 milliseconds and one-time prompt construction took
  3,105.477 milliseconds. The complete probe process used 1,227,780 KiB peak
  RSS, zero CUDA bytes, no network messages, and completed cleanup. Probe JSON
  and mask-artifact SHA-256 digests are
  `2b64eebb2700fd7e35ef069032df0fa2780cfec7ec1ffc4e7b06650c28eb6638`
  and
  `0c7aa89626caac7fd6278f3263a745f19a37dbe3042c730549aa4e94990e3b73`.

Frozen 80-frame result:

- The full process completed in 41.89 seconds of wall time, used 1,287,004 KiB
  peak RSS, allocated zero CUDA bytes, sent or received no network messages,
  and completed cleanup. Model load was 379.862 milliseconds, one-time prompt
  construction was 1,855.709 milliseconds, and independent-frame CPU p95 was
  455.428 milliseconds, passing the frozen one-second diagnostic latency gate.
- The human-seeded frame remained diagnostic. Of the other 79 frames, the
  scorer accepted 59: 19 of 19 fully visible target-plus-distractor frames, 20
  of 20 target-absent frames, and 20 of 20 target-returned frames. There were no
  false presences, distractor boxes, multiple-result ambiguities, or return
  misses under the frozen 0.25 confidence behavior.
- YOLOE emitted no detection for any of the 20 partially covered frames. Those
  are genuine missing-presence failures under the predeclared contract; they
  are not reinterpreted using lower confidence, color, shape, phase, previous
  frames, or tracker output. Perception and overall acceptance therefore fail.
- Result JSON and compressed raw-mask artifact SHA-256 digests are
  `31e1868cf2057b908e3b628104a76a9a8af4df46a58696a163e6b4f39f9da655`
  and
  `68ace0ea02ab54730097b9b6e4441f59e41142cea414cf0b9bec681183c6881d`.

Decision and next bounded step:

- Reject YOLOE-11-M visual-prompt mode as a standalone V1 identity verifier.
  Its independent-frame role did, however, pass visible acquisition, true
  absence, and displaced return without confusing the gray-cup distractor.
  The failed responsibility is continuity through partial cover, not semantic
  acquisition or target-loss detection.
- This result satisfies the evidence-AA prerequisite for exactly one Cutie VGA
  640-by-480, 5-fps continuity-control replay. That replay may test whether an
  established temporal owner preserves the seeded instance across partial
  cover and reports loss without drifting to the cup. It may not use Cutie to
  authorize presence by itself, weaken the YOLOE absence result, or combine
  post-output scores into a new identity heuristic.
- A composition is eligible for a new held-out multi-scene screen only if each
  owner passes its declared responsibility and their handoff has an explicit
  loss/ambiguity contract. This replay alone cannot set
  `identity_gate_validated`, authorize motion, or establish production license
  acceptance for AGPL-licensed YOLOE.
- No camera command, robot action, maintained dependency, Ainekio source edit,
  MetaHuman runtime edit, adapter registration, or capability advertisement
  occurred. Active View remains unregistered, `identity_gate_validated` remains
  false, and fine-turn calibration remains false.
- Removing `/tmp/rom19-yoloe-source`, `/tmp/rom19-yoloe-model`, and
  `/tmp/rom19-yoloe-harness` removes every source, artifact, harness, and result
  used here. Removing this entry is the complete tracked rollback.

### 2026-08-06 - ROM-19/ROM-08 evidence AD - Selected perception composition

Status: V1 component selection and isolated CPU worker lifecycle validated;
held-out identity, license, fine-turn, registration, and physical gates remain
closed.

Decision:

- Close the V1 model search. The selected experimental composition is YOLOE-
  11-M plus MobileCLIP for semantic target ownership and Cutie Base Mega for
  frame-to-frame continuity. Do not spend more V1 time comparing SAM 3.1,
  Florence, Grounding DINO, MIL/HSV, EdgeTAM, BootsTAPIR, ODTrack, SAMURAI, or
  other modes unless a later revision opens a new, explicitly bounded
  selection cycle.
- Normal MetaHuman `inspect` requests provide a bounded semantic query and do
  not invent a target box. YOLOE text prompting therefore owns the first
  query-to-box bootstrap. That result creates YOLOE's visual prompt, which owns
  subsequent independent verification, target absence, and reacquisition.
- Cutie receives only the verifier mask and owns temporal continuity between
  semantic checks. Its output carries confidence `0.0`, cannot report
  completion, and cannot replace a missing semantic verification. It may guide
  only the controller's already bounded view-orientation recovery while YOLOE
  reacquires.
- This is a component and owner-boundary decision, not a production-readiness
  decision. YOLOE remains AGPL-3.0, so distribution or deployed-service use
  requires an explicit license decision before it becomes a maintained
  dependency.

Architecture changes:

- Added `active_view/perception.py` as the small composition boundary and
  `active_view/model_providers.py` as the concrete local-model provider owner.
  The former contains only provider protocols, normalized observations, and
  YOLOE/Cutie responsibility composition. The latter owns JPEG decode, pinned
  local model construction, official inference calls, masks, and geometry.
- Replaced the experimental Grounding-DINO/MIL/HSV worker internals with one
  selected offline JSON-line worker. It requires explicit source, weight, and
  ResNet paths plus `HF_HUB_OFFLINE=1`; runtime downloading is not an allowed
  fallback. Third-party model diagnostics are redirected to stderr so stdout
  remains exclusively correlated JSON responses.
- Updated the controller's existing post-action phase to call Cutie continuity
  and YOLOE semantic verification on the same fresh frame. YOLOE output owns
  progress and completion when present. If YOLOE is temporarily absent, a
  non-centered Cutie box can preserve at most the existing bounded recovery
  budget; a centered Cutie-only result forces a fresh semantic frame and can
  never become `reached`.
- Changed the isolated controller confidence floor from `0.50` to the frozen
  official YOLOE prediction behavior `0.25`. A focused regression proves an
  estimate below `0.25` queues no action. This changes no registered capability
  because both availability gates remain false.

Pinned local research assets:

- YOLOE source remains official commit
  `40cd606cabdbe2b566d6f14a6b162c89206e9a1b`; the model remains revision
  `ebab2db7c4617f6a5fba63f7f824a02d87c88ba0` with the evidence-AB digests.
- MobileCLIP-B(LT) is the official text-bootstrap dependency at
  `/tmp/rom19-yoloe-text/mobileclip_blt.pt`: 599,214,572 bytes, SHA-256
  `670844f7a886dd6eff7a9285adfc53f3d3c889c03bfc8354010cb5c6bf27441a`.
  A pre-integration CPU probe produced one correct `dark bottle` detection at
  confidence 0.635230 and XGA box approximately
  `[174.790,83.200,303.346,514.210]`.
- Cutie remains official commit
  `ec5cdd4cf16f75c73ad785a2f96fb97dbad4125a`, with Base Mega SHA-256
  `9c05402ee36d3a356fb72715d263ba7e1ea06ad3bada48c1306491792da43023`.
  Its required local ResNet-18 and ResNet-50 files retain SHA-256 values
  `5c106cde386e87d4033832f2996f5493238eda96ccf559d1d62760c4de0613f8`
  and
  `19c8e3572231adff6824a2da93fd67b5986919a2e65f8b6007eab4edee220097`.

Measured selected-worker smoke:

- One real JSON-line process used CPU explicitly, hid CUDA, disabled Hugging
  Face and Transformers networking, and loaded only the pinned local assets.
  Health became ready in 7,182.907 milliseconds after both providers loaded.
  Peak child RSS was 2,934,424 KiB. This process never opened the camera and
  received only two previously recorded XGA JPEGs.
- Text bootstrap plus same-frame visual-prompt installation took 1,817.226
  milliseconds. YOLOE returned one bottle at confidence 0.635230 and
  normalized center x approximately 0.2335; the staged gray cup center was
  approximately 0.6191.
- Cutie processed the next chronological frame in 428.748 milliseconds and
  retained a normalized center x approximately 0.2349. Its protocol result
  deliberately reported confidence `0.0` and stated that it had no identity
  authority.
- YOLOE independently verified that next frame in 727.430 milliseconds at
  confidence 0.446245 and center x approximately 0.2321. Reset completed in
  0.152 milliseconds, shutdown responded in 0.099 milliseconds, and the worker
  exited with code zero after 11.022 seconds total.
- These are single lifecycle measurements, not throughput percentiles. On CPU,
  one Cutie frame is already slower than the 200-millisecond interval of a
  5-fps feed, and the measured continuity-plus-verification pair took about
  1.156 seconds. CPU is suitable for deterministic qualification and a low-
  cadence fallback, not a 5-fps control claim. A later live deployment may use
  the validated GPU execution path, but hardware scheduling remains a separate
  integration decision.

Validation:

- The focused Active View controller, worker lifecycle, action-indexed replay,
  replay-manifest, feature-absence, and responsibility-separation set passed 32
  of 32 tests. New cases prove that continuity can guide bounded recovery but
  cannot complete, paired seed evidence is enforced, and noisy third-party
  output cannot corrupt worker stdout.
- The related Environment Adapter, Gateway service, camera-lease manager, and
  dashboard regression set passed 80 of 80 tests when localhost sockets were
  permitted. The same run inside the restricted workspace failed only at
  socket construction with `PermissionError`; the permitted rerun was green.
- All Active View source and test files compile, contain no lines over 100
  characters, and pass the explicit trailing-whitespace screen at this
  checkpoint. The tracked progress document separately passes
  `git diff --check`.
- No source registration, `inspect` translation, capability advertisement,
  launcher composition, persistent configuration, installed dependency,
  firmware, camera command, robot action, or physical motion was added or
  attempted. The adapter's optional frame bridge remains inert unless injected.

Rollback manifest extension:

- New selected-provider files are
  `Ainekio/Master/gateway/environment_adapter/active_view/perception.py` and
  `model_providers.py`.
- Feature-owned files changed for the composition are `controller.py`,
  `contracts.py`, `worker.py`, and
  `Ainekio/Emulator/tests/test_active_view.py`. The existing action-indexed
  replay and manifest files remain part of the earlier isolated experiment.
- A composition-only rollback removes the two provider files and restores those
  four feature-owned files to evidence AC. A complete rollback still follows
  the ROM-22 and later frame-bridge manifests: restore the optional tracked
  adapter bridge points, then delete the unregistered Active View package,
  tests, fixtures, and ignored recordings. No model asset or captured media is
  committed.

Remaining gates:

- Do not set `identity_gate_validated` from this one staged scene. Run the
  frozen YOLOE/Cutie composition on held-out rooms, lighting, low-texture and
  same-class distractors, target movement, partial cover, full loss, and return.
  Freeze the sequence labels and acceptance rules before output.
- Do not register Active View until the owner accepts the YOLOE license, the
  production model environment and resource schedule are explicit, and the
  selected providers pass clean startup, cancellation, reset, and shutdown in
  that environment.
- Do not advertise or physically dispatch orientation correction until two
  named fine-turn assets exist, are calibrated on the attached robot under a
  separately authorized test, and the controller-plus-camera replay passes
  with those exact semantic commands. Until then, `identity_gate_validated` and
  `fine_turn_calibrated` remain false and the live `inspect` action remains
  absent.

### 2026-08-06 - ROM-11/ROM-13/ROM-19 evidence AE - Selected GPU qualification

Status: selected-stack GPU runtime, cadence, resource, reset, and shutdown gates
validated on existing recorded fixtures; the identity and live-integration gates
remain false.

Frozen qualification:

- Before GPU output, created a 127-line contract at
  `/tmp/rom19-selected-gpu/contract.json`, SHA-256
  `2b29ea03166a958f372f7819d5c86c3d60bdc74198149f78445238cc4026712f`.
  It binds the three selected-provider source digests, six model-asset digests,
  exact YOLOE and Cutie revisions, eight phase-manifest digests, 80 XGA stills,
  96 QVGA preview frames, device `cuda:0`, image size 640, confidence 0.25,
  Cutie internal size 480, and all runtime thresholds.
- The contract explicitly closes model search, prohibits inference-parameter
  tuning after output, prohibits camera or motion commands and runtime
  registration, and states that this known-scene qualification cannot change
  `identity_gate_validated`.
- The 549-line temporary runner has SHA-256
  `f7695953374945533d1866ec50415cfcd2275607dd7297bcf402b062fd468caf`.
  Its validation-only pass verified every source, asset, manifest, and frame
  digest before launching inference. It uses the selected JSON-line worker
  rather than a parallel provider implementation.

Execution and lifecycle:

- The first attempt inside the restricted workspace failed before health with
  `RuntimeError: No CUDA GPUs are available`; PyTorch could not see the GPU
  inside that sandbox. The identical frozen command then ran with local GPU
  permission. This was an execution-environment correction, not a code,
  threshold, model, or input change.
- The worker became healthy in 7,424.389 milliseconds, used 1,768 MiB peak
  process VRAM and 2,924,008 KiB peak process RSS, processed both suites, reset
  twice, returned a clean shutdown response in 0.112 milliseconds, and exited
  with code zero. The complete process took 13.730 seconds.
- XGA semantic p95 was 35.083 milliseconds with a 35.216-millisecond mean. The
  QVGA Cutie continuity p95 was 26.043 milliseconds with a 22.368-millisecond
  mean. The two QVGA semantic operations took 119.422 and 30.819 milliseconds.
  Startup, 14-GiB process VRAM, 200-millisecond QVGA continuity, one-second XGA
  semantic, reset, clean-JSON, and shutdown gates all passed.
- A post-run process check confirmed that the qualification worker released its
  VRAM. No camera, adapter, Gateway, firmware, robot, or physical action was
  contacted during the replay.

Known-scene behavior:

- On the 80 XGA stills, YOLOE returned the correct bottle and no gray-cup switch
  for 20 of 20 fully visible frames, no target for 20 of 20 partially covered
  frames, no target for 20 of 20 truly absent frames, and the correct displaced
  bottle for 20 of 20 return frames. This exactly reproduces the frozen CPU
  semantic behavior at substantially lower latency.
- On the chronological 96-frame QVGA lane, text bootstrap localized the bottle
  rather than the cup. Cutie retained a target for all 24 visible and all 24
  partially covered frames, returned official background for all 24 full-loss
  frames, and retained the correct returned target for 23 subsequent frames.
  It never switched to the gray cup.
- Strict predeclared two-dimensional target-center geometry passed 24 of 24
  visible, 11 of 24 partially covered, zero applicable full-loss, and 23 of 24
  return frames. The first return semantic check was correctly rejected as
  ambiguous because YOLOE returned multiple candidates; continuity recovered
  the correct target on the following frame but remained non-authoritative.
- A post-result diagnostic found that all 24 partially covered Cutie boxes kept
  horizontal center error below 0.12, with 0.0274 p95, despite the failed 2D
  mask-geometry score. That is useful for the controller's current horizontal
  orientation responsibility, but it was not a frozen identity acceptance rule
  and therefore does not convert the failed 2D frames into passes.

Decision and architecture consequence:

- The selected providers fit the RTX 4080 resource and cadence budgets; the CPU
  performance limitation is not a reason to reopen model selection. Preserve
  the CPU path for deterministic diagnosis and a low-cadence fallback.
- Keep `identity_gate_validated` false. One staged room/object sequence cannot
  establish general instance identity, partial-cover mask geometry remains
  imperfect, and one return frame was semantically ambiguous. The next
  perception gate is one frozen multi-scene held-out composition replay, not
  another candidate or mode comparison.
- `ROM-13` is implemented but not validated. The provider exposes a real
  append-one-frame continuity operation, but the isolated controller currently
  consumes one fresh post-action mailbox frame rather than pumping every
  admitted preview frame through Cutie. Batch 4 must add that stream consumption
  inside the same adapter-owned Active View runtime; it must not create another
  camera owner, queue, cognitive node, or LLM loop.
- Keep the feature unregistered until the held-out identity, AGPL license,
  continuous-frame controller, simulator fine-turn, cancellation, and exact
  physical calibration gates pass. GPU qualification authorizes none of those
  steps by itself.

Artifacts and rollback:

- The complete result is
  `/tmp/rom19-selected-gpu/result.json`, SHA-256
  `e879313f17c52f382829c530b22f59875d24d34a7f1d5efae974786a6c891bae`.
  Removing `/tmp/rom19-selected-gpu` removes the contract, runner, result, and
  temporary bytecode without affecting Ainekio or MetaHuman runtime state.
- This checkpoint changes only the two maintained roadmap/progress documents.
  The selected Ainekio provider source remains isolated and unregistered under
  the evidence-AD and ROM-22 rollback manifests. No dependency, model weight,
  captured frame, service, configuration, cache requirement, capability,
  adapter composition, or persistent state was added to either repository.

### 2026-08-06 - ROM-21 evidence AF - Body-neutral locomotion boundary correction

Status: controller/backend seam implemented and validated in isolation; no live
integration, capability advertisement, or physical motion is authorized or
proven.

Mismatch found:

- A reread of the Intended Intelligent-Pet Operating Model and the 2026-08-06
  body-seam decision found that the isolated Active View controller did not yet
  satisfy their locomotion boundary. It selected `left_orientation_asset` or
  `right_orientation_asset` from controller configuration and directly called
  Gateway `queue_intent("emote", {"asset": ...})`.
- That implementation remained unregistered and gated, so the mismatch had not
  reached the live adapter or robot. Held-out perception capture and all further
  integration work stopped while the boundary was corrected.

Correction:

- Added `active_view/locomotion.py` as the removable owner of a bounded
  `BodyMotionCommand`, frame-derived `RobotStateSnapshot`, typed
  `LocomotionStepResult`, and replaceable `LocomotionBackend` protocol.
- Active View now requests only a signed, deadline-bounded yaw change through
  the injected backend. Its controller and generic contracts contain no asset
  names, `emote` intent, `queue_intent`, or terminal-wait dispatch.
- `V1NamedAssetLocomotionBackend` is the only feature component that maps the
  body-neutral yaw sign to current V1 left/right assets and calls the existing
  Gateway intent/terminal owners. Calibration, deadline, and measured-direction
  conflicts fail before dispatch.
- The existing action-indexed Body Emulator replay now composes that V1 backend
  explicitly. It still exercises the canonical `BodySession`, camera lease,
  post-action image, and terminal lifecycle; no parallel queue, adapter, camera
  owner, safety system, or protocol was introduced.

Validation:

- A source-boundary search returns no quadruped asset, `emote`, `queue_intent`,
  or terminal-wait dependency in `active_view/controller.py` or
  `active_view/contracts.py`. Those dependencies appear only in the V1 backend
  and its focused expectations.
- Python compilation and the explicit 100-character line screen pass for the
  Active View package and affected tests.
- The focused controller, locomotion, action-indexed replay, and replay-manifest
  set passes 35 of 35 tests. New cases prove that the controller emits a
  body-neutral yaw command, that a replaceable recording backend receives it,
  and that uncalibrated, expired, or direction-conflicting V1 requests dispatch
  no asset.
- The broader Active View, Environment Adapter, Gateway service, camera-lease,
  and dashboard set passes 115 of 115 tests. The feature-absence regression
  still proves that the live adapter advertises neither `inspect` nor
  `activeView` and has no Active View frame bridge.
- No robot command or physical motion was issued. This checkpoint is
  implemented and automated-test validated only; it has no simulator fine-turn
  calibration or physical proof.

Scope, rollback, and remaining gates:

- The Ainekio feature remains isolated under
  `Master/gateway/environment_adapter/active_view/`. This checkpoint adds only
  `locomotion.py` and changes the feature-owned `__init__.py`, `contracts.py`,
  `controller.py`, `Emulator/tests/test_active_view.py`, and
  `test_active_view_replay.py`. Reverting those six feature-owned changes is the
  checkpoint rollback; deleting the still-untracked Active View package and
  tests remains the complete feature rollback.
- No maintained Gateway, adapter server, Environment Bridge, MetaHuman graph,
  queue, memory, Robot Operator, safety, manual-motion, firmware, model, or
  persistent configuration owner changed.
- `inspect` remains limited to a target already visible in its source frame. A
  bounded scan/investigation skill is still required for object search such as
  `find a cat`; safe approach remains later and capability-dependent.
- `identity_gate_validated` remains false. The V1 backend calibration gate
  remains false in production because no named fine-turn assets are registered
  or physically calibrated. Held-out multi-scene identity, continuous frame
  consumption, AGPL acceptance, simulator calibration, cancellation, safety,
  registration, and authorized physical acceptance remain before any live
  advertisement or dispatch.

### 2026-08-06 - ROM-19 evidence AG - Held-out policy freeze and empty-scene preflight

Status: held-out acceptance policy frozen; scene capture is awaiting visible
physical targets. No model inference, registration, capability advertisement,
robot command, or physical motion occurred.

Policy freeze:

- Created `/tmp/rom19-heldout/acceptance-policy.json`, 129 lines with SHA-256
  `7487a778e1ea6a7aa56581ff6cffa01c926b0d81e47ea7ee7778f33450abd224`.
  JSON validation passes.
- The policy closes model search and binds only the already selected YOLOE plus
  MobileCLIP semantic owner and Cutie continuity owner. It preserves image size
  640, YOLOE confidence 0.25, Cutie internal size 480, startup, GPU-memory,
  latency, reset, clean-channel, offline, repeat, and shutdown thresholds.
- Identity may pass only if two genuinely new scenes pass independently. Each
  scene requires a previously untested physical target, a visible distractor,
  24 or more VGA preview frames plus one XGA annotation still in each of
  visible, partial-cover, absent, and returned phases. The returned target must
  occupy a materially different image position, and at least one scene must use
  a same-class distractor.
- Before inference, a separate scene binding must freeze the exact ordered frame
  hashes, target query and descriptions, phase-manifest hashes, original-frame
  target/distractor boxes, and true-absence labels. Annotations must be reviewed
  without model output. Output cannot change annotations, thresholds, or scene
  exemptions.
- Each scene requires correct first-frame text bootstrap, at least 90-percent
  visible semantic target rate, at least 90-percent horizontal continuity rate,
  zero distractor switches, zero semantic or continuity presence during full
  absence, semantic return reacquisition within three frames, and at least
  90-percent post-reacquisition target/continuity rates. Cutie remains unable to
  establish identity or skill completion by itself.

Camera preflight:

- Two isolated, non-overwriting camera-only probes used the existing physical
  Gateway camera owner. Each produced 24 fresh VGA previews, one XGA still, a
  correlated camera-off acknowledgement, and `physicalMotion: false`.
- The first manifest SHA-256 is
  `1152b148c0150ae4c7735f4377bd9560b07db9d53b8a992d310124cd54417909`;
  its XGA still SHA-256 is
  `3b868eda8a539bc2350e369ebda87dc857af454776beb1f6223816d88e9dbfbe`.
- The second manifest SHA-256 is
  `520f66d3d00ed67997f881970108fff31f9df00cb55e7e06423c052912331944`;
  its XGA still SHA-256 is
  `8b6eefb8d11540832643d55e26951927e96182e2d21b63e84b6517a9c1fe9c3f`.
- Original-resolution review found only a very dark carpet/furniture view and no
  identifiable staged target/distractor in either probe. Both directories stay
  explicitly labeled `scene-probe-unlabeled`; they are rejected from scoring
  and cannot be relabeled as held-out evidence after model output.
- A third unscored probe after staging clearly showed a blue creature, a large
  white plastic bottle, a silver bottle, and a yellow canister. Its manifest
  SHA-256 is
  `3484c5f4ec95621f7df861617ab5e359eb8ae804ca61ae3fb42df0c86e6a24da`;
  its XGA still SHA-256 is
  `bcca12603cec4368633b4a6baef5f5183a518a9a517da4658df9e3ee68370785`.
  Original-frame comparison confirmed that the blue creature is the same
  physical figure used in the 2026-08-05 model-selection fixture. The directory
  remains `scene-probe-03-blue-creature-unscored`; the creature cannot satisfy
  the frozen previously-untested-target rule and received no model output.

Remaining:

- Stage two visible, previously untested objects for scene one and name the
  target and distractor. Capture and freeze all four phases before any selected-
  stack output, then repeat with a different target instance and scene.
- A failed scene keeps `identity_gate_validated` false. Even a two-scene pass
  would not resolve AGPL acceptance, continuous controller frame consumption,
  V1 fine-turn calibration, safety, cancellation, registration, or physical
  motion acceptance.

### 2026-08-06 - ROM-19 evidence AH - Held-out scene one captured and bound

Status: first of two required held-out scenes captured, reviewed, frozen, and
mechanically validated; it remains unscored and model-blind.

Scene contract:

- The new target is a tall silver metal bottle; the same-class distractor is a
  large white plastic bottle. The target is neither the dark bottle nor the blue
  creature used during model selection. The query is frozen as `silver metal
  bottle`.
- Captured visible, partial-cover, absent, and returned phases under
  `Ainekio/recordings/active-view/20260806-heldout-scene-01-silver-white`.
  Each phase contains 24 ordered VGA previews and one XGA annotation still,
  reports `physicalMotion: false`, and ends with a correlated camera-off
  acknowledgement. The complete scene contains 100 frames.
- The silver target moved from normalized horizontal center 0.8564453125 in the
  visible phase to 0.42626953125 in the returned phase, a 0.43017578125 image-
  width displacement. It was completely absent in phase three. The white
  distractor remained centered near 0.58. The blue creature moved during return
  staging and is explicitly recorded as unscored scene clutter.

Frozen binding:

- Created `/tmp/rom19-heldout/scene-01-binding.json`, 124 lines with SHA-256
  `5861e9d9e72a8e50863e0421b966f094087b6504e75beb5cc384657ce6b1d3c0`.
  It binds acceptance-policy SHA-256
  `7487a778e1ea6a7aa56581ff6cffa01c926b0d81e47ea7ee7778f33450abd224`,
  exact phase-manifest and ordered-frame digests, counters, snapshot hashes,
  original-XGA target/distractor boxes, target absence, and return displacement.
- The four phase-manifest SHA-256 values are, in order,
  `aca59c9c16f24bf0b08a6e8b2e83c754a5ab0b84e8c2daa9b8b7e06219ae9057`,
  `4a8f77b121373a200f1dcec9b7b45caf80866f37d20aae64be3b16810077cee5`,
  `a91b679e65d649ea2743af1d6a059ccdbdee205ad777967db2fcfdf298c3cd5c`,
  and `d4c8914b6795aa38998e71bb2ade6491f55833afd7f8ff0e31fff7529d3fdd53`.
- Added `/tmp/rom19-heldout/validate_binding.py` as a read-only binding
  validator. It verifies the policy, manifests, ordered frame hashes, snapshots,
  labels, counts, counters, camera-off results, boxes, normalized centers,
  absence, and displacement. Compilation and the explicit 100-character line
  screen pass. Validation reports four phases, 100 frames, 0.43017578125 target
  displacement, `physicalMotion: false`, and `inferenceRun: false`.

Remaining:

- Capture and bind a second scene with a different previously untested target
  instance and a materially different background, viewpoint, or lighting before
  launching the selected worker. The two scene bindings must then be combined
  into one final pre-output contract.
- No selected-stack inference may run until scene two annotations and hashes are
  frozen. Scene one cannot be exempted or relabeled after output.

### 2026-08-06 - ROM-19 evidence AI - Held-out scenes and final contract frozen

Status: both required held-out scenes are captured, manually reviewed, frozen,
and mechanically validated; the selected-stack evaluation is authorized but
has not started because unrelated active Ollama workloads occupy the GPU.

Second scene:

- The second new target is a pink and silver soda can; the fixed distractor is a
  red hand tool on tan backing. This is a different target instance and a
  substantially different low floor-level scene from held-out scene one.
- Captured visible, partial-cover, absent, and returned phases under
  `Ainekio/recordings/active-view/20260806-heldout-scene-02-soda-red-tool`.
  Every phase contains 24 ordered VGA previews and one XGA annotation still,
  reports `physicalMotion: false`, and ends with a correlated camera-off
  acknowledgement. The complete scene contains 100 frames.
- The same can moved from normalized horizontal center 0.189453125 to
  0.92919921875, a 0.73974609375 image-width displacement. Original-resolution
  review confirms partial cover by the white box, complete absence in phase
  three, and a fully visible return to the right of the stationary red tool.

Frozen evidence:

- Created `/tmp/rom19-heldout/scene-02-binding.json`, SHA-256
  `42c70e06781abc455c73eb7e36c6023ad0171ac0d21cbb5a3b3a0eac2d13d800`.
  It binds the unchanged acceptance policy, exact manifests and ordered frames,
  counters, XGA stills, manually reviewed target/distractor boxes, true absence,
  and return displacement before any model output.
- Generalized only the temporary binding validator's scene-label consistency
  check; it no longer embeds scene-one object names. SHA-256 is
  `9676a9645959ff22cb4882048c38538cb3fcd0136caed4c3eb8913181c063285`.
  It revalidates scene one's unchanged binding SHA-256 and validates scene two;
  together they bind eight phases and 200 captured frames.
- Added `/tmp/rom19-heldout/run.py` as an evaluation-only harness. It reuses the
  selected JSON-line worker and provider composition, validates all bindings and
  source/model assets before worker startup, keeps YOLOE as identity owner,
  tests Cutie only as continuity, excludes annotation and seed frames from rate
  scoring, resets between passes/scenes, and repeats the complete decision path
  twice. It contains no perception implementation or runtime integration.
- Created `/tmp/rom19-heldout/final-contract.json`, SHA-256
  `76273e831487ef3938596277a9495826ee3b97ec82048ad669690c1f2a16b32e`.
  The contract freezes both scene bindings, policy, selected provider and model
  digests, selected qualification artifacts, evaluation harness and validator,
  image size 640, confidence 0.25, Cutie internal size 480, offline CUDA, and
  the no-post-output-tuning/annotation rule.
- The final no-model validation passes with two scene bindings and 192 scored
  previews. No selected-stack inference, camera operation, robot command,
  physical motion, registration, or capability advertisement occurred during
  this freeze step.

Architecture review:

- This checkpoint remains within the Intended Intelligent-Pet Operating Model.
  It evaluates a prospective Ainekio local perception/action component and does
  not add LLM calls, MetaHuman semantic intentions, Environment Mode skills,
  queues, bridges, camera owners, motion owners, or parallel runtime services.
- The evaluation does not claim object search or live approach. `inspect`
  remains limited to an already visible target; bounded search/investigation,
  continuous local frame consumption, locomotion calibration, and safe approach
  remain separate later gates.

Remaining:

- The locked evaluation requires an uncontended GPU. At this checkpoint,
  `qwen3.5:0.8b`, `qwen3.5:9b`, and
  `environment-action-selector-0.8b:v1` together used about 12.6 GiB and the GPU
  reported 92-percent utilization. The run was intentionally not started, so
  timing and VRAM evidence were not contaminated and no output has affected the
  frozen annotations.
- Run the frozen contract when those workloads are stopped, score each scene
  independently, and leave `identity_gate_validated` false unless both scene
  decisions and every runtime gate pass. Registration, licensing, continuous
  frames, fine-turn calibration, safety, cancellation, and authorized physical
  acceptance remain separate even if identity passes.

### 2026-08-06 - ROM-19 evidence AJ - Held-out identity gate rejected

Status: the frozen YOLOE/Cutie composition passes every runtime/lifecycle gate
but fails both independent held-out scenes. `identity_gate_validated` remains
false; runtime registration and capability advertisement remain forbidden.

Execution integrity:

- MetaHuman was stopped through the canonical repository `stop.sh`, its three
  Ollama residents were unloaded, and the valid run began with no GPU compute
  process and about 15.1 GiB free. No robot command, camera operation, or
  physical motion was issued.
- The first restricted-shell launch exited before the worker's first health
  response because that environment could not access the NVIDIA driver. It
  wrote no result and saw no scene output. The identical frozen command was
  rerun with direct local GPU access; no query, threshold, annotation, source,
  asset, runner, policy, or binding changed.
- The result contract SHA-256 is
  `76273e831487ef3938596277a9495826ee3b97ec82048ad669690c1f2a16b32e`.
  `/tmp/rom19-heldout/result.json` has SHA-256
  `697c0ee8a21fdef55a2962261b71b1cf124757a0eb7849400826bcbcd17df9e1`.
  Worker return code is zero; the evaluation command returns one only because
  the frozen identity decision failed.

Identity result:

- Scene one (`silver metal bottle`) fails first-frame text bootstrap. YOLOE
  returned multiple candidates on 93 of 96 semantic frames in each repeat, so
  the provider correctly classified the result as ambiguous and never seeded
  Cutie. Three single detections occurred only while the true target was absent;
  all were far from the fixed distractor and were scored as ambiguous rather
  than target presence under the frozen policy.
- Scene two (`soda can`) also fails first-frame text bootstrap. YOLOE returned no
  verified target on all 96 semantic frames in each repeat. Cutie again received
  no identity-authorized seed.
- Both scenes therefore report zero visible semantic rate, zero visible and
  partial-cover continuity rates, no semantic return reacquisition, and no
  post-reacquisition continuity result. These are acquisition failures; they
  are not evidence that Cutie switched identity. Both absence gates and the
  zero-distractor-switch gate pass because the composition safely withheld an
  identity claim.
- The complete decision path repeated identically. The failed held-out frames
  are now diagnostic evidence and cannot be reused as unseen acceptance data
  for a corrected candidate.

Runtime result:

- All frozen runtime gates pass: 7.611-second startup, 45.904 ms semantic p95,
  1.313 ms tracking p95, 1,766 MiB peak process VRAM, clean JSON, offline mode,
  12 successful resets, deterministic repeat, and clean shutdown.
- The two repeats issued 484 semantic requests and 284 tracking requests in
  29.174 seconds. Runtime speed and lifecycle readiness therefore remain
  proven separately from the failed semantic identity gate.

Architecture and lifecycle:

- The result does not authorize integration. The isolated worker and Active
  View package remain unregistered and unadvertised; Cutie remains continuity-
  only and cannot establish identity, task completion, or motion authority.
- MetaHuman was restarted through canonical `start.sh` after evaluation. The
  production server listened on `127.0.0.1:4321`, and a direct request returned
  `HTTP/1.1 200 OK`.
- No maintained queue, Environment Bridge, Robot Operator, camera owner,
  locomotion owner, safety system, workflow graph, model registry, or capability
  changed. Other agents' existing worktree edits were preserved.

Next evidence boundary:

- Do not lower confidence, alter the held-out annotations, add prompt-specific
  special cases, or retry these scenes as if they remained held out. Analyze
  semantic-bootstrap ownership using the failure artifacts, then define a new
  pre-output acquisition contract from established open-vocabulary detection
  or candidate-arbitration practice. Any corrected composition requires new,
  genuinely unseen acceptance scenes.
- `inspect` still means a target already visible in the initiating frame. A
  bounded local search/investigation skill, continuous frame consumption,
  obstacle evidence, calibrated locomotion, cancellation, licensing, safety,
  registration, and authorized physical acceptance remain separate work.

### 2026-08-06 - ROM-19 evidence AK - XGA does not repair semantic bootstrap

Status: post-rejection causal diagnostic complete; resolution-only correction
rejected. This evidence cannot change the failed held-out identity gate.

Contract and scope:

- Froze `/tmp/rom19-xga-diagnostic/contract.json` before diagnostic output with
  SHA-256
  `3f5b2a70186a20a715d40a254a847dbbf57dba18fe889a7ae8935b4f3303f3ce`.
  It binds the rejected held-out result, both unchanged scene bindings, the
  selected source/model artifacts, the diagnostic runner, unchanged queries,
  image size 640, confidence 0.25, CPU/offline execution, and exactly one
  already-bound XGA annotation still per phase.
- The two held-out scenes were already burned by evidence AJ. This diagnostic
  is permitted only to distinguish source-resolution failure from semantic-
  acquisition failure. It cannot reopen model selection, change an annotation,
  authorize registration, or become new acceptance evidence.

Result:

- `/tmp/rom19-xga-diagnostic/result.json` has SHA-256
  `a5c5466a469964f70a17e6a8eddd6533154268e5076b9b34e95426711c00d65f`.
  Both complete repeats are deterministic; worker startup, resets, shutdown,
  offline operation, and return code pass.
- Scene one remains `YOLOE returned multiple target candidates` on the XGA
  visible, partial-cover, absent, and returned stills. Scene two remains
  `YOLOE did not verify the target` on all four XGA stills.
- CPU semantic p95 is 555.397 ms, total elapsed time is 13.399 seconds, and peak
  child RSS is 2,925,740 KiB. No GPU, camera, Gateway, adapter, or robot action
  was used.

Decision:

- Higher-resolution semantic snapshots remain architecturally useful, but XGA
  alone does not fix this provider. Scene one requires a bounded candidate-set
  and principled association/ambiguity owner; scene two requires better
  semantic concept coverage. Cutie remains the continuity owner and is not the
  cause of either bootstrap failure.
- Do not patch the current provider with object names, prompt synonyms,
  confidence changes, phase rules, or an arbitrary top-one choice. Any next
  acquisition candidate must be chosen from public task evidence, screened in
  one bounded cycle, and validated on genuinely new scenes after component
  development.

### 2026-08-06 - Owner pause and resumption handoff

Status: paused by owner for approximately one week. No further download,
inference, capture, implementation, integration, registration, advertisement,
or physical work is authorized until the owner explicitly resumes this lane.

- Current status, architecture boundaries, artifacts, rollback, failure result,
  research position, and first safe resumption step are consolidated in
  `robot-active-operator-where-we-are-now.md`.
- MetaHuman was restored through canonical `start.sh` after the held-out GPU
  evaluation and returned `HTTP/1.1 200 OK` on `127.0.0.1:4321`.
- Other agents' dirty-tree edits remain untouched. The pause authorizes no
  cleanup, reset, commit, publication, service stop, model download, or robot
  action.

### 2026-08-22 - ROM-11/ROM-19 evidence AL - Bounded YOLOE-26x candidate smoke

Status: diagnostic acquisition candidate passed; identity, licensing,
integration, registration, and physical gates remain false or unresolved.

Scope and pre-output contract:

- The owner resumed the lane and authorized the next bounded step. This was one
  preselected official `YOLOE-26x-seg` text-mode smoke, not an equal-weight
  model bakeoff. No other mode or model was tested.
- The final frozen contract at
  `/tmp/rom19-yoloe26x-smoke/contract.json` has SHA-256
  `4fb8e9982f1c259e8fc65e25f7d8234b28ca28010d346b63c1a76b08dca1fd9`.
  It binds exactly four already-burned first-visible frames: one VGA preview
  and one XGA still from each held-out scene; the unchanged text queries;
  manually reviewed target and distractor geometry; image size 640;
  confidence 0.25; top five; two repeats; offline execution; latency, VRAM,
  asset, runtime-source, dependency, and runner digests; and a stop-after-this-
  candidate rule.
- A candidate counted only when its normalized center was within 0.12 of the
  target center and nearer the target than the staged distractor. Every
  returned candidate, confidence, box, mask digest, and score is preserved.
  Top one has no special authority.
- The official model artifact is 171,640,453 bytes with SHA-256
  `d08d390a08f98195f7c87807839fe4ff93a5491645fef1bc3bf0700efafdd639`.
  The required official `mobileclip2_b.ts` text encoder is 253,794,476 bytes
  with SHA-256
  `35d7f213e4d75f38514e4656ad3cb91158bd33e3805d8ac349f23b186f66982f`.
  Both came from the Ultralytics `v8.4.0` release.
- Ultralytics 8.4.36 also requires its official `CLIP` helper for tokenization.
  The first launch stopped before image inference when that package was absent.
  Official source commit `68dce32140994dfcb645a1320c4ebdc034fc19fd` was then
  pinned and hash-bound under the removable temporary root. The shared
  ComfyUI environment was not modified, and the contract was re-frozen before
  any image output.
- The runner has SHA-256
  `333f4a2288ff605d1988013a77444bd64bbe6245c59bb84d406212ed71bb49bc`.
  Five focused pure scorer tests have SHA-256
  `9cc834d14ad941e38bfa5eee46156d7a1ad6e52fe88e95673e6678e51529a264`
  and pass before contract validation. Model and helper code are AGPL-3.0; the
  production licensing decision remains unresolved.

Result:

- `/tmp/rom19-yoloe26x-smoke/result.json` has SHA-256
  `b4ccb51d3240ea636b62661277e05f6fd625e36021cc6bfd9375562415766437`
  and binds the final contract hash. All four frames pass on both repeats, the
  complete candidate output is deterministic, and
  `identityGateChanged` is false.
- Scene-one VGA returns three candidates. The true silver bottle is rank two at
  confidence 0.412419; an unrelated small can is rank one at 0.457449. This is
  measured evidence that silently choosing top one would select the wrong
  object.
- Scene-one XGA returns three candidates and places the true bottle at rank one
  with confidence 0.459955. Scene-two VGA returns two candidates and places the
  soda can at rank one with confidence 0.387128. Scene-two XGA returns one
  candidate, the soda can, at confidence 0.341583.
- Model load is 247.735 ms, joint two-query text embedding is 365.731 ms, total
  wall time is 2.356 seconds, and peak process VRAM is 1,238 MiB. Reported
  first-batch inference is 46.615 ms per image and steady inference is 14.710
  to 14.875 ms per image. The run began with 7,057 MiB free while the owner's
  Ollama model remained resident, confirming that an uncontended full-card
  shutdown was unnecessary for this diagnostic.
- The process enforced offline network denial, exited cleanly, released its
  VRAM, accessed no camera/Gateway/adapter/robot path, issued no motion, and
  left MetaHuman returning `HTTP/1.1 200 OK` on `127.0.0.1:4321`.

Decision:

- Nominate YOLOE-26x for a typed candidate-oriented acquisition component. Do
  not integrate or advertise it yet, and do not reinterpret this burned-frame
  diagnostic as held-out identity proof.
- The next work is contract design, not more model testing: expose a bounded
  scored candidate set; select only when generic evidence is sufficient; and
  return typed ambiguity for bounded active viewing or clarification. The
  scene-one rank-two result is the concrete regression fixture for this rule.
- Cutie remains continuity only after an identity-authorized seed. It cannot
  create identity, arbitrate semantic candidates, or declare completion.
- After the candidate/ambiguity owner and focused component tests pass, capture
  genuinely unseen multi-scene fixtures for identity, absence, partial cover,
  loss, return, and ambiguity acceptance. Licensing, continuous frame
  consumption, obstacle/safety evidence, calibrated locomotion, cancellation,
  live registration, and separately authorized physical acceptance remain
  required.

### 2026-08-22 - ROM-24 evidence AM - Typed acquisition-candidate and ambiguity contract

Status: contract designed from current owner/source truth; not implemented.

Existing owner trace:

- `YoloeSemanticProvider._observation` receives the full model result, but
  count zero becomes missing and any count other than one becomes only
  `ambiguous=true`. In the multi-candidate case it discards every candidate
  box, confidence, and mask.
- `PerceptionObservation.worker_result`, `ActiveViewEstimate`, and
  `estimate_from_worker` carry only one optional box. The JSON-line transport
  therefore cannot preserve or correlate alternatives even though the model
  produced them.
- `SelectedPerception` is already the correct composition owner: it keeps
  semantic identity separate from Cutie continuity and owns when a semantic
  result may seed Cutie. No new workflow, queue, LLM loop, or identity store is
  needed.
- `inspectionTarget.seedBox` and `seedConfidence` already provide optional
  evidence bound to the exact initiating frame. The controller also obtains a
  Cutie estimate and an independent semantic result from the same post-action
  frame. These are the two legitimate generic association seams.
- The controller currently maps an unusable ambiguous estimate to terminal
  `blocked` before locomotion. That is safe, but because the candidates were
  discarded it cannot report useful uncertainty or support later bounded
  active disambiguation.

Required contract shape:

- Add one immutable `PerceptionCandidate` value in the existing perception
  owner. It carries normalized box, normalized semantic confidence, and an
  internal optional mask. Candidate identifiers are ephemeral and frame-bound;
  they are never durable physical-object identity.
- Replace the contradictory `found` plus `ambiguous` interpretation with one
  explicit acquisition state: `selected`, `missing`, or `ambiguous`.
  `selected` names exactly one candidate index and derived box/confidence;
  `missing` has no selected candidate; `ambiguous` preserves alternatives and
  has no selected candidate.
- Bound semantic output to at most five candidates in stable descending
  confidence/geometry order. The worker response includes state, candidate
  count, candidate boxes/confidences, selected index when present, evidence
  kind, and a truncation/total-count indication. Masks remain worker-local and
  only the selected mask may seed Cutie.
- Keep selection policy inside `SelectedPerception`, not inside the YOLOE
  provider or controller. The model provider reports candidates; the
  composition owner applies generic evidence; the controller consumes only a
  selected estimate or a typed non-selection.
- A single above-threshold semantic candidate may be selected as
  `semantic_unique`. With multiple candidates, same-frame seed evidence may
  select only one candidate that has sufficient overlap and a clear margin
  from every other candidate. No match or a tied match remains ambiguous.
- During reacquisition, a Cutie box may support selection only when an
  independently returned semantic candidate uniquely overlaps it on the same
  frame. Record this as `semantic_continuity_agreement`. Cutie alone never
  creates identity, chooses a semantic candidate, seeds itself, or authorizes
  completion.
- A selected candidate is the only state that may initialize visual prompting,
  seed Cutie, emit target geometry to locomotion, or satisfy semantic
  verification. Missing and ambiguous states authorize no target motion.

Bounded active assistance:

- `inspect` continues to mean a target visible in the exact initiating frame.
  If query-only acquisition is ambiguous and no legitimate seed exists, it
  must return the bounded candidate set and a typed request for better evidence
  or clarification; it must not pretend that arbitrary movement is progress.
- The contract reserves an `active_disambiguation` transition for evaluating a
  bounded list of candidate hypotheses using fresh same-frame semantic results
  after view changes. This is local embodied-skill work, not an LLM call per
  frame. It cannot dispatch until fine-yaw calibration, cancellation, and
  obstacle/safety gates pass.
- Complete object search remains a separate skill. Candidate exploration must
  not silently turn `inspect` into “find an object somewhere in the room.”

Focused implementation tests required before provider replacement:

- five candidates survive provider, worker JSON, client validation, and reset
  in stable order; a sixth candidate is explicitly reported as truncated;
- the smoke regression shape is represented generically: a higher-confidence
  distractor plus a lower-confidence target, with same-frame seed overlap
  selecting the target rather than rank one;
- the same multi-candidate result without seed evidence remains ambiguous and
  causes zero locomotion calls;
- overlapping/tied, low-confidence, malformed, stale-frame, and mismatched
  seed evidence never selects a candidate;
- one unique semantic candidate selects and only its mask seeds Cutie;
- continuity-only output cannot select, complete, or reseed identity;
- one semantic candidate uniquely agreeing with the same-frame continuity box
  may reacquire, while disagreement remains ambiguous;
- worker shutdown, offline operation, candidate bounds, cancellation, feature
  absence, identity gate, and body-neutral controller tests continue to pass.

Implementation boundary:

- The minimal source owners are the isolated Ainekio Active View
  `perception.py`, `model_providers.py`, `contracts.py`, `worker_client.py`, and
  their focused tests. `controller.py` should require only the new selected
  state and expose bounded ambiguity metadata; it should not absorb model
  scoring or provider logic.
- Do not touch `server.py`, capability advertisement, the live frame bridge,
  MetaHuman Environment Mode, locomotion assets, or physical dispatch in this
  change. YOLOE-26x provisioning and licensing remain a separate removable
  runtime decision after the pure contract/provider tests pass.

### 2026-08-22 - ROM-24 evidence AN - Candidate association implementation

Status: validated as an isolated component; unregistered and physically
unproven.

Implemented owner corrections:

- `PerceptionCandidate` and `PerceptionObservation` now preserve a bounded,
  immutable candidate set with exactly one state: `selected`, `missing`, or
  `ambiguous`. A selected result identifies one candidate index and evidence
  kind; unresolved results cannot expose target geometry through the derived
  single-target fields.
- `YoloeSemanticProvider` now converts all returned detections into normalized
  candidates, sorts them deterministically by confidence and geometry, retains
  at most five, and reports the original total plus explicit truncation. Masks
  remain worker-local.
- `SelectedPerception` remains the sole association owner. Query-only output
  selects only when semantically unique. Supplied exact-frame seed evidence
  must be paired, above the configured confidence floor when it is a frame
  seed, overlap one candidate sufficiently, and have a clear margin over every
  alternative. A supplied seed must agree even when the semantic provider
  returns only one candidate.
- The internal visual-prompt seed cannot be supplied by a worker client.
  Post-action Cutie geometry may support selection only when an independent
  semantic result on that same frame uniquely agrees. Cutie-only output cannot
  initialize identity, pass semantic usability, declare completion, or reseed
  itself.
- The JSON-line worker/client contract now transports bounded candidates,
  selected index, evidence kind, total count, and truncation. Client validation
  rejects oversized, contradictory, malformed, and non-finite results.
- The controller consumes only an evidenced semantic selection for ordinary
  target motion or completion and includes the bounded candidate state in its
  progress result. Initial ambiguity returns `blocked` with zero locomotion.
  Post-action ambiguity cannot fall back to Cutie-only motion; only semantic
  absence may use the already bounded continuity-recovery behavior while a
  fresh semantic result is sought.

Focused regression evidence:

- A generic form of the burned silver-bottle failure is locked in: a
  higher-confidence distractor remains rank one, while same-frame overlap
  selects the lower-confidence target and only its mask seeds continuity.
- Five candidates survive provider conversion, JSON serialization, client
  validation, and reset in stable order; a sixth is reported as truncated.
- No-seed ambiguity, truncated alternatives, tied overlap, malformed or weak
  frame seeds, spatial mismatch, non-finite geometry, stale source frames,
  mismatched frame timestamps, and semantic/continuity disagreement never
  select a target.
- Initial ambiguity and continuity-only input produce zero locomotion calls.
  A semantic ambiguity after one measured action produces no second action.
- Unique semantic acquisition, semantic-plus-continuity agreement, bounded
  continuity recovery, cancellation, graceful and forced worker shutdown,
  feature absence, identity/calibration gates, body-neutral locomotion, and the
  action-indexed Body Emulator replay remain green.

Validation:

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=Emulator:Master:Slave/software:.`
  `python3 -m unittest Emulator.tests.test_active_view`
  `Emulator.tests.test_active_view_replay`
  `Emulator.tests.test_active_view_replay_manifest` passes 54 of 54 tests in
  0.359 seconds on the final run.
- An explicit 88-character screen returns no findings for the affected Active
  View source, focused tests, and worker fixture. MetaHuman `git diff --check`
  passes. The locally installed `black` launcher is unusable because its Python
  module is absent; this is recorded as tool state, not claimed as formatter
  validation.
- A source-boundary search finds no `emote`, `queue_intent`, terminal-wait,
  named-turn asset, or quadruped dependency in the generic controller,
  contracts, perception, provider, worker, or worker-client owners.
- A live-owner search finds no Active View import, translation, registration,
  or capability advertisement in the adapter, Gateway, or dashboard. The
  existing feature-absence regression passes within the 54-test set.
- No model inference, download, live camera access, Gateway command, robot
  action, server restart, capability change, or physical motion occurred.

Rollback and boundary:

- This checkpoint changes only the still-untracked Active View package and its
  still-untracked focused tests/fixture. The package remains removable by the
  established ROM-22/ROM-23 manifests. A ROM-24-only rollback restores
  `perception.py`, `model_providers.py`, `contracts.py`, `worker_client.py`,
  `controller.py`, `__init__.py`, `test_active_view.py`,
  `test_active_view_replay.py`, and the worker fixture to evidence AM.
- No existing Ainekio live owner or MetaHuman runtime owner was changed for
  ROM-24. Other agents' tracked and untracked work remains untouched.
- `identity_gate_validated` remains false. The provider remains unregistered,
  YOLOE-26x production licensing remains unresolved, and the V1 fine-yaw and
  obstacle/safety gates remain physically unproven.
- The next evidence must come from genuinely unseen, frozen multi-scene
  fixtures covering identity, absence, partial cover, loss, return, and
  ambiguity. The four smoke frames are burned diagnostics and cannot become
  acceptance data. Calibrated local active disambiguation is later work, after
  those identity fixtures and the existing motion/safety gates pass.

### 2026-08-22 - ROM-19/ROM-24 evidence AO - Removable live perception probe

Status: source and recorded-worker lifecycle validated; no live camera or
physical robot run performed.

Purpose and boundary:

- A separate process cannot attach to the canonical Gateway service object
  already running inside `gateway.server` without changing a production owner.
  The test surface therefore does not add a server route, adapter injection,
  capability, graph node, dashboard control, or global service registry.
- `active_view/live_probe.py` temporarily composes the existing public
  `GatewayService` on the normal robot protocol endpoint, requests exactly one
  canonical `snap`, passes that correlated frame to the existing JSON-line
  perception client, prints one bounded result, and exits.
- The probe imports no locomotion backend, named asset, Environment Adapter,
  translation owner, or action dispatch. Its result always records
  `motionDispatched: false` and `identityGateChanged: false`.
- The probe must run instead of, never beside, the production Gateway on the
  selected port. Stopping it and restarting the original Gateway restores the
  original runtime; deleting the probe files restores the original source
  surface.

Isolated acquisition worker:

- `active_view/yoloe26_worker.py` is an acquisition-only JSON-line worker for
  the already nominated official YOLOE-26x checkpoint. It accepts a text query
  and one JPEG, returns at most five stable candidates through the ROM-24
  contract, and explicitly advertises no tracking or completion authority.
- It requires the official local checkpoint, official `mobileclip2_b.ts`, the
  pinned official Ultralytics CLIP helper, and all offline guards. It has no
  download fallback and accepts no seed evidence.
- Candidate extraction is not duplicated: the old provider and this worker now
  share `yoloe_result_observation` in the existing isolated
  `model_providers.py` owner.

Validation:

- The focused Active View probe, YOLOE-26 worker, candidate/controller,
  lifecycle, replay, and replay-manifest command passes 59 of 59 tests in 0.416
  seconds. New tests prove one snapshot returns candidate metadata with zero
  motion, unavailable/rejected lifecycles close cleanly before inference, the
  worker command is parsed as bounded JSON data rather than a shell command,
  and the probe source contains no motion or live-registration owner.
- The real YOLOE-26 worker then ran one offline CPU lifecycle against the
  already burned scene-one VGA frame. It loaded, returned healthy, emitted
  three typed candidates, shut down with exit code zero, and released after
  11.989 seconds wall time. This was recorded-media evidence only: no Gateway,
  camera, robot, network download, or motion path was used.
- The affected source and tests contain no lines over 88 characters. Boundary
  searches return no live-owner reference to the probe or worker and no motion,
  Environment Adapter, translation, or named-asset dependency inside them.
  MetaHuman `git diff --check` passes.

Rollback and remaining gates:

- Probe-only rollback deletes `active_view/live_probe.py`,
  `active_view/yoloe26_worker.py`, `test_active_view_live_probe.py`, and
  `test_active_view_yoloe26_worker.py`, then inlines the shared result converter
  back into `YoloeSemanticProvider._observation`. No production file, database,
  configuration, model installation, firmware, capability, or robot state must
  be restored.
- Complete Active View rollback remains deletion of the still-untracked package
  and its still-untracked tests/fixtures under the established manifest. The
  original Gateway, adapter, Environment Bridge, queue, graph, memory,
  Robot Operator, manual-motion, and safety owners remain unchanged.
- This probe makes live camera plus candidate acquisition testable. It does not
  make the closed-loop controller live. Identity validation on genuinely unseen
  scenes, production-license acceptance, fine-yaw calibration, obstacle/safety
  evidence, and separately authorized physical motion remain required before a
  motion-capable test entrypoint is honest.

## Future Progress Entry Template

```md
### YYYY-MM-DD - ROM-XX - Short title

Status: not_started | in_progress | implemented | validated | blocked | deferred

Changes:

- What changed and which existing owner was corrected.

Evidence:

- What observation, trace, or contract justified the change.

Validation:

- Exact focused commands and results.
- Physical result when physical acceptance is required.

Remaining:

- Known gaps, follow-up work-item ids, restart requirements, or blockers.
```
