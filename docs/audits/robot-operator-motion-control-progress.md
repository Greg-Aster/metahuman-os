# Robot Operator Motion-Control Progress

## Purpose

This document is the maintained work record for Robot Operator motion-control
diagnosis, software-only safety improvements, latency reduction, and eventual
camera-feedback control. Update it when an implementation step is started,
completed, validated, reverted, or materially redesigned.

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
  -> optional user-facing presentation
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
| About 12 GiB free disk after owner-led cleanup; host RAM is approximately 62 GiB | Reuse installed runtimes and record every model/replay footprint. The earlier low point was 2.9 GiB, so do not allow unbounded captures or duplicate checkpoints. | Allocate a dedicated model/replay volume if the selected production stack or longer datasets outgrow this headroom. More system RAM is not currently indicated. |
| OV3660 preview exists at QVGA/VGA up to 10 fps, but the Environment Adapter discards uncorrelated preview frames | Add a skill-owned latest-frame consumer to the existing Gateway preview; keep per-frame data out of the LLM graph. | Firmware may expose better stream control, timestamps, resolution, or cadence if measurements show 10 fps or JPEG behavior is inadequate. A new camera is an option, not the first assumption. |
| No measured body heading, joint position, odometry, range, contact, or cliff state | Use camera-measured target displacement and calibrated semantic body primitives for bounded active inspection. Do not advertise navigation or clearance. | An IMU improves heading/change estimation; front/side time-of-flight or depth improves clearance; contact/cliff sensing improves independent safety; measured joint feedback improves body control. Each capability must be advertised only after integration and validation. |
| Camera is fixed to the moving body | Derive and calibrate smaller whole-body left/right orientation primitives and correct from the next image. | A pan/tilt camera can improve views without destabilizing the whole body. Stereo/depth or a tracking camera can add geometry, but requires a new calibrated sensor contract. |
| Current simulator motion does not alter the camera view | Add an action-indexed scenario through the existing `CameraSource` and `MotionBackend` seams. | A full robot-eye 3D simulator is useful later if contact, terrain, localization, or manipulation become active scope. |
| No usable ordinary-object OV3660 replay is currently maintained | Capture ignored owner-local preview sequences with exact timestamps, action correlations, and separate annotation manifests. | A repeatable tagged test area and later ordinary-object suite improve regression quality; captured personal media remains untracked. |

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
| [EdgeTAM](https://github.com/facebookresearch/EdgeTAM) | Apache-2.0 promptable video-object segmentation designed for substantially lighter on-device tracking than SAM 2. | Benchmark as the primary 10 Hz box-seeded target-mask/retention candidate. The existing Robot Operator target box can seed it, but it still needs a separate acquisition/re-identification path after full loss. |
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
  -> EdgeTAM mask track OR OpenCV CPU baseline
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
Robot Operator supplies an exact current frame, target box, and objective
  -> seed tracker from that box
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
| Perception | Grounding DINO Tiny has perfect labeled-positive recall on the current three-query OV3660 replay, but one absent query produced 12 accepted false candidates. OpenCV MIL/HSV also failed full loss. The identity gate remains false and nothing is advertised. | Select and replay-test an established instance-association or video-object component; semantic query score alone cannot authorize arbitrary target identity. |
| Body control | Smallest named orientation is a 6.24-second estimated 45-degree turn. | Add calibrated fine/coarse body-owned semantic orientation profiles and learn their observed image response. |
| Simulator | The visual renderer and host webcam still do not share a scene or pose. A remote-safe action-indexed replay source now couples the existing BodySession motion backend and camera-source seams for deterministic post-action frames. | Replace synthetic JPEG bytes with ignored labeled OV3660 sequences and score the same public controller lifecycle before considering a richer shared-scene renderer. |
| Companion host | Suitable CPU/RAM/GPU hardware is healthy and the owner freed storage. On 2026-08-05 the home filesystem had 16 GiB available; Grounding DINO Tiny was cached, but no locked production perception runtime is installed. | Keep replay/model growth bounded, create a locked runtime only after replay selection, and preserve a CPU diagnostic fallback. |

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
| `ROM-11` | `in_progress` | Research and select maintained perception, tracking, skill-execution, control, safety, navigation, and manipulation components for the actual Ainekio hardware. | OV3660 replay now rejects both MIL/HSV continuity and uncalibrated text-query confidence as identity authorities. Camera ownership is validated; maintained instance association, control calibration, and the final component decision remain. |
| `ROM-12` | `not_started` | Add typed multi-object observations and capability discovery without changing the current action queue. | Contracts distinguish class hypothesis, short-lived track identity, durable object identity, frame binding, and optional calibrated pose. |
| `ROM-13` | `not_started` | Integrate the selected detector and tracker behind the adapter-owned perception interface. | A replayable camera sequence demonstrates measured detection latency, stable target association, confidence decay, occlusion/loss, and bounded reacquisition without per-frame LLM calls. |
| `ROM-14` | `in_progress` | Add a bounded `inspect` object skill using the new perception contract. | MetaHuman now has exact-frame `inspect` admission behind a truthful `activeView` capability and its Bridge Out allowlist. The adapter-owned acquisition/tracking/control implementation and end-to-end evidence remain. |
| `ROM-15` | `not_started` | Integrate a local obstacle/clearance representation below object skills. | Fresh range, depth, point-cloud, or conservative visual evidence can independently slow or stop motion; missing evidence never becomes assumed free space. |
| `ROM-16` | `not_started` | Replace generic physical `interact` claims with advertised object-interaction verbs, prerequisites, limits, and results. | Unsupported verbs are rejected at admission; supported verbs reference a current object identity and define how success is physically verified. |
| `ROM-17` | `not_started` | Integrate the first hardware-supported bounded contact or manipulation skill. | Simulator and controlled physical evidence cover reachability, collision/workspace checks, interruption, controller feedback, fresh visual/contact verification, and terminal failure. |
| `ROM-18` | `deferred` | Add full localization, mapped navigation, and manipulation-planner bridges when sensors and body hardware justify them. | Navigation or manipulation is advertised only after the required state estimate, world model, planner, controller feedback, and safety layer pass their own acceptance. |
| `ROM-19` | `in_progress` | Add perception/control replay fixtures, metrics, and regression thresholds. | A generic presence/loss scorer now records recall, false acceptance, and p95 latency. Three queries across 345 OV3660 inferences produced 258/258 accepted positives but 12/87 false-accepted negatives, so the identity gate correctly remains failed. |
| `ROM-20` | `in_progress` | Retire the robot-skill evaluator/refiner/requeue pipeline after the local skill cutover. | Robot investigations use no Visual Evidence Assessor, Task Refiner, Workflow Command retry, or Movement Generator locomotion; retained admission, correlation, cancellation, stable objective, and terminal-result contracts pass focused tests and the same objective records materially lower model calls, tokens, and wall time. |
| `ROM-21` | `not_started` | Preserve the current V1 robot behind a replaceable locomotion-backend and learned-policy seam. | V1 named motions, the deterministic feedback controller, and a future trained backend share versioned `BodyMotionCommand`, truthful `RobotStateSnapshot`, bounded output, policy-manifest, logging, fallback, and independent-safety contracts. Learned control remains disabled until its declared sensors, digital twin, replay/simulator results, shadow comparison, and authorized physical acceptance are complete. |
| `ROM-22` | `validated` | Establish the isolated active-view hygiene gate before integration. | Existing Ainekio runtime owners remain unchanged; valid timestamp, cancellation, subprocess shutdown, feature-absence, calibration-gate, and identity-gate tests pass with a complete removal manifest. |
| `ROM-23` | `validated` | Couple the active-view controller to action-indexed frames through the existing Body Emulator lifecycle. | A semantic orientation command passes through `BodySession`, unlocks its correlated replay frame, emits the normal post-action snapshot before `done`, and lets the controller verify measured image improvement without an LLM, live adapter, or physical robot. |

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
