# Body and interactive capabilities

[Hardware](#body-identity-and-hardware) · [Motion](#motion-and-posture) · [Vision](#camera-perception-recognition-and-tracking) · [Speech](#listening-and-speaking) · [Display](#face-expressions-and-processing-feedback) · [Body events](#body-sensing-events-and-balance) · [Manual operation](#recording-maintenance-and-manual-operation)

[Start with the robot design core](ROBOT_BIBLE.md). Read the relevant subsection for motion, vision, speech, display or physical events.

Ainekio owns the body/gateway contracts. Actual advertised capabilities are the
runtime inventory; this page explains their use by the companion.

This page states the maintained capability contract. It does not report current
service state, selected weights or installed firmware. Use the linked owners for
configuration and [qualification](QUALIFICATION.md) for proof of behavior.
Dated deployments, comparisons and incidents are retained in the
reference history (retained locally).
A historical success or failure is evidence under its recorded conditions;
refresh those conditions before treating it as the present state.

## Body identity and hardware

V2 is the twelve-servo ESP32-P4/PCA9685 body; V1 is the separate eight-servo
ESP32-S3/MCPWM body. They share Body Control and the Environment adapter while
retaining different calibration, motion and joint contracts. V1 simulation
or an eight-joint motion plan does not qualify V2 execution.

Start with the dedicated [V1 specifications](../../../Ainekio/docs/v1-8servo/SPECIFICATIONS.md)
or [V2 specifications](../../../Ainekio/docs/v2-12servo/SPECIFICATIONS.md) for
hardware, dimensions, wiring and body/remote connections. Use the selected
device and its actual configuration for installed facts.
[Model boundaries](../../../Ainekio/docs/ROBOT_MODELS.md),
[V2 hardware records](../../../Ainekio/docs/v2-12servo/README.md),
[P4 firmware](../../../Ainekio/Slave/firmware/esp32p4-wifi6/README.md),
[motion geometry](../../../Ainekio/Slave/software/models/v2-12servo/README.md),
[servo assembly](../../../Ainekio/Slave/software/models/v2-12servo/SERVO_ASSEMBLY.md)
and the [resource budget](../../../Ainekio/docs/v2-12servo/RESOURCE_BUDGET.md)
own their respective details. Commanded pose and modeled ground contact are
not physical measurements. Geometric zero, Home, Stand, Sit and Rest differ.

The former copied parts/dimensions table is retained in the
dated hardware inventory (retained locally).
It is not maintained here as a second wiring or calibration reference. CAD,
motion-authoring tools and the [emulator](../../../Ainekio/Emulator/README.md)
support development; simulation does not establish loaded tracking, balance,
traction or real-world distance.

## Physical and interactive abilities

### Motion and posture

Body Control's Freestyle owner handles MetaHuman `requestMotion.description`,
startup/wake and first-stall correction requests. The manual **Poses and emotes →
Default motion system** selector affects explicit manual controls; it does not
redirect these semantic requests to the legacy Motion Library. Freestyle uses
the configured generator and asynchronous executor, then the gateway/P4 target
execution path. A Freestyle job ID records submission, not successful generation
or physical completion. An unavailable generator is reported without substituting
a library movement. Stop, camera and display remain independent.

Inactivity rest/release is body-local: the existing configurable timer defaults
to three minutes, plays the built-in Lay Down and releases outputs after it
finishes. The custom-movement curriculum does not teach servo-output release.
A first stall goes to Freestyle for correction; if that correction stalls,
Body Control requests release and sends the failed-correction evidence through
Environment Bridge for help. First-stall correction does not itself trigger
a help reply. Release failure is reported rather than claimed as success.
This restoration needs matching firmware/gateway activation; older installed
firmware and adapters can still implement their recorded prior contracts.

The revised Freestyle contract executes a complete generated program once;
normal completion does not request another model assessment. Former internal
continuation endings become explicit normal-standing targets in the maintained
training data. Measured arrival remains owned by P4; actual body-fault events
retain the existing recovery path. See Freestyle's deployment evidence before
assuming that revised source or training labels are active on an installation.

The native library and low-level controls retain their explicit manual contracts.
MetaHuman's former eight-joint generator workflow and `generatedMotion` task step
are removed; Task coordinates actions and observations, while Body Control owns
joint-program generation. The Task adapter's compatibility with this action
contract requires its own evaluation. See the [software execution path](SYSTEM_ARCHITECTURE.md#a-request-to-move),
[`GatewayService.request_motion`](../../../Ainekio/Master/gateway/server/service.py)
and [Freestyle owner](../../../Ainekio/experiments/freestyle/README.md) for the
current source contract and separate deployment evidence.

Capability code includes posture requests (Stand, Sit, Neutral, Rest), gestures (Wave, Bow, Nod, Pushup, Point, Dance and others), and locomotion. V2 has distinct Walk/Run/Crawl/Crab implementations and ongoing steering. Additional declared assets include Lie Down, Crouch and experimental Upright. This is a source inventory, not an assertion that every command is currently advertised, installed, mechanically usable, or equivalent across bodies.

For every motion test, record the selected body's actual advertised command, requested parameters, intended endpoint, physical behavior and terminal receipt. Use [semantic translation](../../../Ainekio/Master/gateway/environment_adapter/translation.py) and actual advertised capabilities; do not copy a global catalog into a second runtime list.

The V2 body owns continuous gait execution, finite gesture trajectories, steering, and per-device calibrated output. Speed, stride/rate, direction, and finite gait-cycle count are distinct controls; their ranges and effects come from the selected body's current advertised contract. Commanded joint pose is not measured shaft position, and modeled planted feet are not measured ground contact. General obstacle avoidance, cliff detection, reliable recovery from a fall, and autonomous navigation are not established capabilities by virtue of having a camera or IMU.

Current P4 source distinguishes **ordinary Stop** (cancel motion and hold the commanded pose with outputs enabled), **detach** (disable outputs), and **gait Finish** (complete the gait's stopping transition; requested by speed zero in the existing locomotion contract). Stop also cancels affected audio/snapshot work through the current controller. These meanings describe [controller source](../../../Ainekio/Slave/firmware/esp32p4-wifi6/main/controller.c), not proof of the firmware installed on a particular robot.

**Goal-directed locomotion — approved October 15:** MetaHuman must select a locomotion goal together with gait controls, rather than exposing bare Walk, Run, Turn, Crab or Crawl starts. The goal describes a measured distance, signed relative turn, approach relationship, ongoing follow relationship with an ending condition, or visual endpoint. Gait percentage controls express actuation, not metres per second. Finite gait-cycle counts and elapsed time are not arrival evidence. Internal/manual Body Control gait primitives remain available through their existing owner. Standing, resting and other finite gestures retain ordinary command handling.

The model selects the goal, target, tolerance and relevant visual behavior. Core Active Task owns execution and progress; the existing Bridge carries sensor evidence and the same movement's start/update/Finish receipts. Visual and follow goals reuse the existing behavior evaluator and its selected observation cadence. Sensor updates wake that active execution without another intention or task-selection call. Each result must distinguish endpoint evidence, requested Finish, acknowledged settings, and the original gait's actual terminal receipt. Neither a command receipt nor a spoken response establishes that the overall goal succeeded.

**Approved missing-measurement behavior:** if the selected goal's required measurement is unavailable before movement, report incomplete without starting. If it becomes unavailable during movement, request Finish on that same gait and retain the actual outcome for the planner. Do not substitute timed travel, a new target or an automatic restart. Camera, orientation and target measurements have independent availability; missing metric camera calibration does not by itself invalidate available IMU orientation. References, source frame, robot/session, measurement time, units and uncertainty remain attributed. The owner also approved using the existing four-second gateway control-freshness interval to expire orientation telemetry if that stream alone stops; repeatedly reading the same sample does not renew it.

**Measurement contract:** metric image estimates require real camera intrinsics,
a measured camera-to-body transform and a measured reference on the ground plane.
The camera-only estimator tracks that plane; it is not general depth, inertial
odometry or room navigation. An image-box fraction is an image-relative
relationship, not a metric distance. A selected metric target requires an explicit
ground-contact point in retained image evidence; a box bottom is not silently
assumed to touch the floor. Unknown metric uncertainty remains unknown. P4
commanded gait geometry is not measured displacement. Signed lateral control
belongs to the same P4 movement, protocol and Core goal-control owners. A measured
Crab goal without the advertised lateral-control capability reports incomplete
before starting; manual Crab controls retain their existing contract. Requested
gait speed and steering are distinct: steering updates do not replace the
requested gait speed.

**Qualification boundary:** verify installed capabilities, calibration and physical
endpoint accuracy for the selected body. Earlier firmware installations and model
comparisons are historical evidence (retained locally),
not proof that the currently selected model and body can complete a locomotion goal.

Visual-only goals use independent camera availability and source expiry, without requiring YOLO or metric calibration. If actual camera evidence disappears, the approved Finish/incomplete behavior applies. A long-running visual model call does not by itself mean a still-live camera has stopped supplying evidence.

A destination does not establish a traversable route. Obstacle avoidance and drop-off handling remain separate unqualified capabilities; this change does not introduce an unapproved obstacle/edge policy. Software simulation, model replay, runtime activation, real calibration and physical movement accuracy are separate acceptance stages. See the [locomotion contract](#motion-and-posture) for the scoped implementation and acceptance record.

### Camera, perception, recognition, and tracking

**On-demand depth lifecycle (October 22):** Body Control's camera owner processes
depth only for active consumers. Core's existing navigation executor requests it
for measured-distance and metric approach/follow goals through the existing
camera-read bridge (`operation: "depthDemand"`, `consumerId`, `enabled`). Active
gait recording shares that owner; the dashboard can explicitly request one sample.
Ordinary conversation, photos and video streaming do not load the depth model.
Consumers release it on completion, failure or cancellation; a disconnected bridge
releases its registrations, and reconnect restores demand for ongoing executions.
The last release unloads the model. First use therefore includes loading time;
reactivation starts a new local odometry reference. Preview pixels remain in Body
Control, while measurements retain their source, original time and uncertainty.
This is resource ownership, not an added obstacle-avoidance or motion policy.

P4 shares one camera acquisition/JPEG pipeline across preview streaming and correlated still captures. Body Control displays frames and can run configured perception through its camera worker without making the robot receive loop await inference. The existing bridge supports reading the latest cached image without taking another picture. An explicit capture produces a new correlated still; a cached image retains its original identity and time. Wake-speech capture also has image correlation in firmware. These are different acquisition paths, not a requirement to take an extra photo before every text request.

Exposure stability belongs to the running camera sensor. Preview measurements
can serve later snapshots; a sensor restart, mode change or changed exposure
requires fresh evidence. A cold-start capture still needs the sensor to establish
exposure. Resolve resolution and exposure through the selected camera's settings.
Measure physical capture timing on the installed firmware; previous configuration
choices and source-test results do not establish current image quality or latency.

An explicitly disconnected body retains its projected camera availability instead of being overwritten by historical robot-status telemetry. Historical diagnostics remain readable, independently advertised cameras remain available, and matching telemetry can update readiness after reconnection. Bridge Input uses that canonical projection. Earlier camera-status repair evidence is retained in the reference history; readiness must be checked for the current body/session.

Recognition can supply object/person boxes, track continuity and, when enrolled local face models are configured, a named-person estimate. Detection, tracking, a face match, and physical identity are different claims. Tracking IDs do not establish identity; a match is not liveness verification. Visual planning can select acquisition, a retained frame/region, tracking configuration, or observation through the existing task workflow. Success requires the appropriate returned evidence, not simply selecting a tracking command.

Camera evidence carries its recognition results in the image's metadata, with robot ID, gateway instance, connection epoch, frame counter and original receipt time. Body Control's camera read uses the latest currently available analyzed JPEG/result pair when recognition is available; otherwise it returns the available raw camera image without inventing recognition. It does not wait for a newer frame to be analyzed. When recognition is enabled, a requested snapshot joins that exact frame’s analysis on the existing camera worker before delivery. Newer previews cannot replace a requested still; microphone input, movement and other work remain independent. A recognition failure is delivered with the photo, and disabled recognition adds no analysis dependency. Object labels, boxes, scores, face-match/tracked/unknown states and named-person estimates remain distinct. Autonomy passes the selected image and metadata together to Robot Status, whose visible image-input and context-builder connections deliver both to its model. Status stores frame provenance and recognition without embedding image bytes in its JSON snapshot. A separate live recognition record from another frame is not substituted for the attached image's evidence. Model context keeps saved status descriptions under `recordedSituation`, with their original status/source times and image identities, separately from live evidence and current durable goals. These are transport guarantees, not a guarantee that a face matcher identifies someone correctly.

YOLOE is a supported Body Control perception backend for object detection and visual prompting; it is not itself a navigation or goal-execution owner. The existing visual workflow connects acquisition/search/selection and returned frame or track evidence to model-selected behavior. An ongoing `behavior` step has its own target, motion and `completionCriteria`. The [active-task owner](../../packages/core/src/nodes/environment/active-task.node.ts) evaluates supplied visual evidence through the existing model path, requests gait Finish when target/completion evidence establishes that step's criteria, and advances only after the correlated terminal receipt. Tracking availability, target identity, actual motion, and goal completion remain distinct facts. This path needs end-to-end qualification for the intended target and body; merely naming a goal or enabling YOLOE does not establish object following.

The intended use includes noticing the surroundings, answering visual questions, searching for things, and using perception to inform activities. Reliable visual navigation and person following require their own end-to-end qualification. See [camera source](../../../Ainekio/Slave/firmware/esp32p4-wifi6/components/ainekio_p4_media/camera.c), [Body Control perception](../../../Ainekio/Master/gateway/README.md#continuous-camera-processing), and [named-person recognition](../../../Ainekio/Master/gateway/README.md#named-people-optional-local-models).

### Listening and speaking

Body firmware supports microphone capture with Open, VAD and wake-word modes, saved gain/settings, and audio transport. MetaHuman's STT owner produces the attributed text admitted to the workflow; the robot does not need the user to type in the browser. Speaker playback and listening interact through firmware's existing capture/playback rules, so simultaneous motion and speech support does not establish unrestricted full-duplex listening.

MetaHuman's audio control selects **Off / Browser / Body Control**. Every workflow with a TTS Output node obeys that setting, including reflections and other Inner Dialogue. Off prevents new speech admission; Browser uses the browser speaker; Body Control uses the selected robot session and the gateway's configured destination. Workflow source, dialogue mode, and whether the Inner Dialogue panel is open do not override this selection. A thought without a connected TTS output remains unspoken. Body Control then selects **Robot speaker / Body Control computer**. The latter means speakers attached to the gateway host, not MetaHuman's browser. TTS synthesis, admission, playback start and playback completion have different timings and evidence. Speech is admitted through its existing delivery owner independently of movement; audio chunks preserve order. See [speech destinations](../../../Ainekio/Master/gateway/README.md#speech-destination) and [voice/TTS ownership](../technical/MAINTAINED_SURFACE.md).

### Face expressions and processing feedback

The body display presents shared expressions used by motions and by standalone face selection. MetaHuman exposes standalone expressions from the advertised library and workflow display-feedback nodes. Feedback uses replacement and timeout/release behavior through the existing display owner, rather than a queue of obsolete faces. It does not establish that a movement happened.

The intended feedback lifecycle is listening during recording; animated thinking while sending/transcribing/reasoning and between further steps; speech or motion expression during those activities; normal face at completion; and an error/connection indication when appropriate. Firmware also has local listening and connection display behavior. These owners need integrated precedence/release qualification; the existence of nodes is not proof that every stage appears correctly. Current P4 listening feedback also includes a small shoulder cue implemented by the body owner, as documented in the [firmware reference](../../../Ainekio/Slave/firmware/esp32p4-wifi6/README.md); this is distinct from the display-only expression command.

### Body sensing, events, and balance

The owner also requested expression landmarks for repeat-event suppression.
The initial Fast Body Event face branch uses an attributed `be_` display token;
the existing reset node releases that same token. P4 firmware reports the active
selection token alongside IMU telemetry. Body Control suppresses further shake
and tip notifications while that selection exists, without delaying user commands,
speech, sensing or movement. Release, replacement or the existing robot-local
60-second expiry permits new event episodes. Temporary listening/speech overlays
retain the selected expression. P4 foreground and background expressions have
separate replaceable slots, tokens and original deadlines. Background thinking
updates cannot replace the foreground reaction; releasing the foreground reveals
a still-active background, which continues yielding to motion/speech. Suppressed episodes are not replayed afterward.
The shared configurable shake/tip cooldown also applies before a reaction
face is installed (read its value from the selected Body Control settings). This lifecycle requires the updated Face Expression node,
Body Control classifier and P4 token telemetry; source tests alone do not establish
deployment or physical qualification.

Current P4 source acquires IMU data, estimates attitude and publishes timestamped telemetry. V2 body code contains balance corrections and configuration. This supersedes old overview statements that telemetry/feedback are unconnected, but does not establish effective physical balancing. Calibration state, sample time, readiness, and uncertainty matter; six-axis yaw is not an absolute heading reference.

Servo-feedback fault/restoration reports remain telemetry and Freestyle recovery evidence. A change in that health report alone does not invoke a conversational workflow. User input, command results and the post-correction `servo_stall` help event retain their existing delivery and routing.

Body Control detects configured event episodes such as tilt or rapid movement and forwards measurements. Boot/wake events also enter this path. The shared Core event router selects **Fast Body Event** for the reported `tipped`, `rapid_movement` and `servo_stall` kinds; reported `wake` events use **Robot Wake-Up**, which receives a single combined wake event and fresh camera image from Body Control. Body Control requests the capture through the existing robot protocol and dispatches stretch locally; the stretch definition includes its return to standing. The graph supplies the event, active persona, image and dated body status to one Persona greeting while stretching can continue. It dispatches no motion or camera command and does not wait for stretch completion. Wake-up creates no goal and invokes neither Intent nor Goal Review; its graph explicitly contains Robot Status input, Conversation Buffer, Save Conversation Memory, Conversation Output and TTS Output. The buffer publishes the single feed entry; the exact admitted greeting and autonomy metadata go to memory, while TTS uses the configured destination. These are reusable nodes directly in Robot Wake-Up, not a call to Environment Mode or its conversation-delivery subworkflow. **Other Body Events** interprets the remaining events and may send an attributed intention to Environment Mode. Plain telemetry remains status evidence rather than a new cognitive request. See [body events](../../../Ainekio/Master/gateway/README.md#v2-body-events-and-imu-status), [P4 body owner](../../../Ainekio/Slave/firmware/esp32p4-wifi6/main/body.c), and [Body Event graph](../../etc/cognitive-graphs/body-event-trigger-mode.json).

**Owner-approved fast reaction design, 2026-10-19:** the [Fast Body Event graph](../../etc/cognitive-graphs/fast-body-event-mode.json) receives the complete event and its robot/session/time attribution. Its existing event node acts as the gateway: the reported event kind selects a separate editable **Tipping Prompt**, **Rapid Movement Prompt** or **Motor Stall Prompt**. Tipping and rapid-movement speech receive only the reported event kind alongside their event-specific prompt. A motor-stall notification additionally supplies the gateway-reported joint IDs/names, reason and output-release state, unchanged. Its model asks briefly and gently for help with the reported joint or joints. The gateway owns joint naming; MetaHuman does not reconstruct names from the joint mask or infer physical damage. Stall notifications reuse the speech and feed branches without selecting an additional face preset or recovery movement. Full measurements, event identity and time remain in the original node output and durable evidence; they are not supplied to this brief speech-generation task. Missing measurements remain missing. Robot/session identity continues through the existing face and speech delivery owners. This selection is determined by the body-reported event kind, without another interpretation call. It sends an editable preset face directly from the event: `confused` for tipping and `surprised` for rapid movement. These specific display choices are the owner's approved exception to model-selected expressions; body detectors contain no response scripts. Independently, one call to the **Lightweight** category generates a very short, darkly humorous self-preservation remark. The owner subsequently requested a more passive voice: nervous, self-directed humor expressing the robot's own unease, without insults, blame or orders aimed at the person. There is no Intent, Task, Planner, persona, history or memory context in this reaction path. Speech uses the existing TTS owner and the originating robot session. No gait or recovery motion is selected by this graph. The tipping and rapid-movement prompts include the owner-approved instruction: “One exclamation only; no explanation or follow-up.”

The speech text appears in the live conversation interface through Stream Writer's optional **Publish to Conversation** setting. It is not appended to conversation/inner buffers or saved as a memory or training example. The live message lasts for the current page session; it is not an offline conversation-history service. Durable graph evidence, output admissions and body receipts remain separately recorded; the existing Bridge still reports returned command receipts to Robot Buffer. Face dispatch, speech admission and feed publication do not wait for one another's physical completion. The final **Reset Event Expression** node releases the selected preset through the existing display owner, using that expression's token and the originating robot session after feed publication and the correlated robot speech playback receipts finish. Speech admission and rendering alone do not release the face. Only this release node suspends through the existing durable event owner; inference, chunked playback and unrelated commands remain concurrent. Empty or disabled speech releases after the available outputs, and terminal speech failure releases through the same path. Local computer output retains its admission-based release because this robot path has no browser playback receipt. It restores the underlying face without clearing a newer expression; the existing 60-second robot-local expression expiry remains unchanged for interrupted or failed paths. The widget owns the Lightweight model assignment; the graph owns its sampling
settings. Read those settings for the active configuration. A shared inference
slot and TTS preparation can contribute latency; software tests alone do not
establish audible or visible response time.

The generic Other Body Events interpretation remains separate from Robot Wake-Up.
Its model may choose `decision: none` with `instruction: null`; this admits no
Environment work and preserves the reason. Delegation requires a nonempty
instruction. Valid output structure does not establish that the interpretation
or its historical completion claims are correct.

**Reaction wording:** the October 19 Owner-approved refinement replaced
alarmed protest with a nervous reaction and self-directed dark humor,
discouraging insults, blame and orders. Reactions remain brief and grounded
in the reported event. Motor-stall speech retains its separate request-for-help
contract above. The [Fast Body Event graph](../../etc/cognitive-graphs/fast-body-event-mode.json)
owns the approved runtime wording and category selection; this reference does
not supply another prompt. The October reaction history (retained locally)
preserves the earlier comparisons, assignments, activation evidence and remaining
wording failures. Those comparisons did not independently qualify physical voice
delivery or consistently passive wording.

### Recording, maintenance, and manual operation

Body Control includes manual motion controls, calibration, camera/recognition settings, audio settings, networking/pairing, body event settings, status and diagnostics. Firmware supports SD video recording alongside preview, clip listing/download, and rolling reuse of old completed clips. Recording video does not automatically turn every frame into a MetaHuman memory or LLM input.

The maintenance interface uploads a P4 application and separately activates it, provides update display feedback, and retrieves robot logs. C6 firmware and initial partition/bootloader preparation are separate concerns. Source and earlier controller-only tests do not qualify powered motion or every media/network workload. See [recording and OTA](../../../Ainekio/Slave/firmware/esp32p4-wifi6/RECORDING_OTA.md) and [Body Control workspace](../../../Ainekio/Master/gateway/README.md#body-control-workspace).
