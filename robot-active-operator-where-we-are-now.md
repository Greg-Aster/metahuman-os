# Robot Active Operator: Where We Are Now

Paused at: 2026-08-06 17:43 PDT

Resumed by owner: 2026-08-22

Last status refresh: 2026-08-22 09:57 PDT

Status: the isolated ROM-24 candidate-association component is implemented and
passes 54 focused tests. It preserves bounded semantic alternatives, selects
only from explicit frame-bound evidence, and prevents unresolved ambiguity from
becoming target motion. The system remains unintegrated, unregistered, and not
ready for robot motion. A separate one-shot live camera/perception probe is now
available without production registration; it always dispatches zero motion.
The next evidence is genuinely unseen frozen identity fixtures, not another
model bakeoff and not live registration.

## Executive position

The architecture is now substantially clearer, and the isolated Active View
experiment is cleanly separated from the live robot system. The earlier
YOLOE-11-M plus Cutie composition remains rejected because it failed both
frozen held-out scenes at semantic acquisition. A single preselected
YOLOE-26x text-mode smoke now shows that a stronger acquisition provider can
surface both staged targets in a bounded candidate set. That is component
evidence for candidate-oriented acquisition, not identity validation and not
permission to integrate.

The current truthful state is:

| Area | Current state |
| --- | --- |
| Intended owner boundaries | Documented and preserved |
| Body-neutral locomotion seam | Implemented and test-validated in isolation |
| Camera-only physical capture | Proven through the existing Gateway owner |
| Selected worker lifecycle and cadence | Passed |
| Held-out semantic identity | Failed in both scenes |
| YOLOE-26x burned-frame acquisition smoke | Passed four of four frames twice |
| Typed candidate/ambiguity owner | Implemented; 54 focused tests pass |
| Standalone live perception probe | Implemented; physical camera run not performed |
| Cutie continuity authority | Continuity only; never identity or completion |
| Live adapter registration | Absent |
| Capability advertisement | Absent |
| Continuous controller frame consumption | Not integrated |
| Fine-turn calibration | Not physically proven |
| Robot motion during this research | None |
| Production readiness | Not ready |

This work does not yet fix the original Robot Observer/Operator behavior in the
live MetaHuman system. It establishes the architecture and rejects an unsafe
perception composition before that composition can reach the robot.

Environment Mode is a separate, partially repaired lane. Direct advertised
commands can reach the robot, but current-scene and bounded visual objectives
have not passed a clean final physical acceptance run with the intended model.
The late `complete`-only trials are invalid evidence because the runtime audit
shows that they used the untrained base `qwen3.5:0.8b`, not the installed merged
Environment specialist.

## Architecture that must remain authoritative

- MetaHuman owns personality, memory, autonomy, inner dialogue, and semantic
  intentions.
- Environment Mode admits one semantic embodied skill. It must not call an LLM
  for each walk, turn, camera frame, or course correction.
- The Ainekio Embodied Skill Runtime owns the fast local perception/action
  feedback loop.
- Controllers emit body-neutral commands through a replaceable
  `LocomotionBackend`.
- Current quadruped asset names and `emote` dispatch belong only inside the V1
  backend.
- Existing Gateway, camera lease, manual motion, queue, Environment Bridge,
  Robot Operator, memory, cancellation, and safety owners must be reused. Do
  not add parallel owners.
- `inspect` means inspecting a target already visible in the initiating frame.
  It is not complete object search. “Find a cat” still requires a separate,
  bounded scan/investigation skill and later safe approach.
- Missing or ambiguous identity is a real unavailable/uncertain result. It is
  not stationary success, conversational success, or permission to move.

Primary architecture references:

- `docs/implementation-plans/robot-active-operator-roadmap.md`, especially
  “Intended Intelligent-Pet Operating Model.”
- `docs/audits/robot-operator-motion-control-progress.md`, especially the
  2026-08-06 decision and evidence AF through AK.

## Environment Mode and action-selector status

This section is the resumption handoff for the Environment workflow work that
preceded the pause. It is distinct from the isolated Active View controller and
must not be used to justify registering Active View capabilities.

### Current source architecture

The streamlined Environment workflow is present at commit `d37f2012` and uses
21 nodes and 52 edges:

- one Environment Action Selector model call performs semantic selection;
- Action Parser admits a typed action and an exact adapter-advertised named
  command without a hardcoded natural-language alias table;
- two instances of the existing Environment Task State owner prepare and reduce
  the same typed lifecycle state;
- Task State alone owns persistence, feedback correlation, bounded steps, and
  completion;
- Bridge Out owns robot delivery and keeps a legitimate `no_actions` transport
  result out of the visible conversation;
- Conversation Buffer, Robot Buffer, TTS, and Stream Writer retain their
  existing output responsibilities.

The obsolete competing lifecycle path was deleted rather than patched. The
active graph no longer contains Selection Gate, Environment Task Contract,
Environment Task Validator, Task Refiner, Visual Evidence Assessor, or Workflow
Command nodes. Do not restore them as parallel owners.

The selector contract is one JSON object with exactly four top-level fields:
`response`, `actions`, `movementRequest`, and `taskDecision`. The prompt now
requires a semantic whole-objective decision, distinguishes one-shot
`action_result` work from bounded `visual_observation` work, and represents a
camera request as the `captureImage` action type. Task State correlates terminal
feedback by the unique action ID because the adapter may report a generic
transport command such as `emote` for semantic commands such as `wave`.

Immediately before the pause, focused Task State, Action Parser, context,
bridge, and graph tests passed; all 27 cognitive graphs validated; and the full
production build passed its architecture, user-agnostic, voice ownership,
delivery queue, and Astro build checks. Those are source-level results, not a
completed physical acceptance run.

### Model and runtime truth at the pause

- The system registry default for `environmentActionSelector` is the installed
  529 MB Ollama artifact `environment-action-selector-0.8b:v1`.
- The current local profile mapping instead assigns the Environment selector to
  `qwen3.5:9b` and assigns the specialist artifact to the Environment fallback
  role. This appears to be the final UI-selection state, not an intended durable
  architecture decision. Preserve it during the pause, then verify both roles
  explicitly before the next robot command.
- The 17:25 PDT bow, wave, and lay-down trials that replied only `complete`
  actually invoked the untrained base `qwen3.5:0.8b`. They produced no bridge
  action and must not be counted as a result for the trained merged model.
- Earlier late-stage turn/look and current-scene trials were also performed
  while model selection was changing. They exposed useful lifecycle symptoms,
  but they are not clean model acceptance evidence.
- A non-executing prompt probe found that the merged specialist is fast but does
  not yet reliably reproduce the final expanded lifecycle schema; examples
  flattened `taskDecision` into a string or moved its fields to the top level.
  The 9B model followed the final semantic contract more often, but was much
  slower and also returned one empty result in the small probe. Neither result
  closes deployment acceptance.
- Do not repair a model-selection error with command aliases, keyword matching,
  hardcoded intent rules, another blocking gate, or a second lifecycle owner.

### What is working and what remains open

Working or source-validated:

- direct typed named commands can be selected, admitted, delivered, and closed
  deterministically from correlated `action_result` feedback;
- a generic adapter command label can no longer hide completion for the exact
  correlated action ID;
- current-scene questions admit a fresh camera action rather than describing
  capabilities, metadata, history, or memory as though those were pixels;
- bounded visual task state and the original stopping objective can survive
  across action/feedback passes in focused tests;
- server status and Agent Monitor remain separate ownership surfaces.

Still open or unproven:

- no clean post-repair physical run has yet proved all three acceptance cases:
  one direct named command, one current-scene answer grounded in a fresh frame,
  and one bounded motion that continues until its visual stopping condition is
  actually observed;
- the merged 0.8B specialist must be evaluated against the exact final prompt
  and Core contract before it can replace 9B in production;
- if that artifact remains schema-incompatible, retrain it from the maintained
  system-owned action-selector corpus and final prompt rather than adding runtime
  correction cruft;
- latency, image admission, bridge delivery, continuation count, and completion
  basis must be recorded separately during the next physical trial;
- Active View/search remains unavailable, so `find` or room-search objectives
  cannot be treated as implemented merely because Environment Mode can issue a
  turn or request one image.

### First Environment Mode steps when work resumes

1. Inspect the active local role assignments before sending any test command.
   Assign `environmentActionSelector` deliberately and restore `fallback` to a
   general model; do not infer the selection from a dropdown label.
2. Confirm the exact resolved model ID in the runtime audit, then restart through
   canonical `stop.sh` and `start.sh` so the cached graph and model registry agree
   with disk.
3. Run one direct advertised command. Record selector model, selector latency,
   selected action, bridge action ID, terminal feedback, and completion basis.
4. Run one `What do you see right now?` request. Require a fresh correlated
   image before accepting any scene description.
5. Run one bounded visual stopping task. Require repeated action/observation
   passes until the frame satisfies the original condition; a single action
   result must not close it.
6. Only after those three traces are clean should the merged 0.8B artifact be
   benchmarked or retrained. Freeze new evaluation cases before tuning and keep
   them separate from all training and prompt work.
7. Keep Environment semantic selection, Task State lifecycle, bridge transport,
   and Active View local control as separate owners. Fix defects in the owner
   that already owns them; do not create a replacement workflow.

## What exists in Ainekio

The Active View experiment remains isolated and unregistered under:

`/home/greggles/Ainekio/Master/gateway/environment_adapter/active_view/`

It currently contains contracts, controller, frame bridge, mailbox, perception
composition, model providers, replay support, worker/client, a standalone live
perception probe, an acquisition-only YOLOE-26 worker, and the body-neutral
locomotion seam. The whole package is still untracked in Ainekio. The five
untracked focused test files are:

- `/home/greggles/Ainekio/Emulator/tests/test_active_view.py`
- `/home/greggles/Ainekio/Emulator/tests/test_active_view_live_probe.py`
- `/home/greggles/Ainekio/Emulator/tests/test_active_view_replay.py`
- `/home/greggles/Ainekio/Emulator/tests/test_active_view_replay_manifest.py`
- `/home/greggles/Ainekio/Emulator/tests/test_active_view_yoloe26_worker.py`

The dependency-free JSON-line lifecycle fixture remains under
`Emulator/tests/fixtures/active_view_worker_stub.py`.

Important isolation properties already proved:

- Generic controller/contracts contain no quadruped asset name, `emote`,
  `queue_intent`, or terminal-wait dependency.
- `V1NamedAssetLocomotionBackend` alone maps signed yaw requests to current V1
  named assets and canonical Gateway dispatch.
- Uncalibrated, expired, and direction-conflicting commands dispatch nothing.
- Feature-absence tests prove the live adapter advertises neither `inspect` nor
  `activeView` and has no live Active View frame bridge.
- Focused candidate, controller, locomotion, worker-lifecycle, replay, and
  feature-absence validation now passes 54 of 54 tests.
- Including the standalone probe and YOLOE-26 acquisition-worker regressions,
  the complete focused isolated set passes 59 of 59 tests.
- The broader Active View, Environment Adapter, Gateway, camera-lease, and
  dashboard set previously passed 115 of 115 tests before ROM-24. It was not
  rerun in this narrowly scoped checkpoint and is not presented as current
  ROM-24 validation.
- No physical motion was issued. These are source and automated-test results,
  not simulator calibration or robot-motion proof.

Complete experiment rollback remains possible by removing the untracked Active
View package and its untracked tests. Do not perform that rollback during the
pause unless the owner explicitly asks for it.

## Perception decision and held-out result

The tested composition was:

- Semantic owner: YOLOE-11-M with MobileCLIP text bootstrap and YOLOE visual
  prompting.
- Continuity owner: Cutie Base Mega.
- Input/runtime parameters: image size 640, confidence 0.25, Cutie internal size
  480, offline local inference.
- Cutie output has no identity or completion authority.

The two captured scenes are persistent under Ainekio:

- Scene 1:
  `/home/greggles/Ainekio/recordings/active-view/20260806-heldout-scene-01-silver-white`
- Scene 2:
  `/home/greggles/Ainekio/recordings/active-view/20260806-heldout-scene-02-soda-red-tool`

Each scene contains visible, partial-cover, absent, and returned phases. Every
phase has 24 VGA previews, one XGA still, `physicalMotion: false`, and a
correlated camera-off acknowledgement. Scene 1 used a silver bottle with a
same-class white-bottle distractor. Scene 2 used a soda can with a fixed red
tool distractor.

The final locked evaluation passed every runtime gate:

- Startup: 7.611 seconds.
- Semantic p95: 45.904 ms.
- Tracking p95: 1.313 ms.
- Peak worker VRAM: 1,766 MiB.
- Clean JSON, offline operation, 12 resets, deterministic repeat, and shutdown:
  all passed.

Identity nevertheless failed in both scenes:

- Scene 1 returned multiple semantic candidates on the first visible frame, so
  the current provider rejected bootstrap and never seeded Cutie.
- Scene 2 returned no semantic target on every one of its 96 semantic frames.
- Scene 1 produced three later single detections only while the true target was
  absent. They were off-target and remained ambiguous under the frozen policy.
- Cutie never received an identity-authorized seed in either scene. Its zero
  continuity rates are downstream of semantic acquisition failure, not proof
  of a Cutie identity switch.
- Both repeats made identical decisions.

The gate decision is final for this composition:

- `identity_gate_validated` remains false.
- Runtime registration and capability advertisement remain forbidden.
- Do not lower confidence, alter queries or annotations, add object-specific
  rules, or reinterpret the failure as success.
- These scenes are now burned diagnostic fixtures. They cannot be reused as
  unseen acceptance evidence for a corrected candidate.

## XGA causal diagnostic

After the held-out rejection, the unchanged composition was run on the eight
already-bound XGA annotation stills on CPU. This was explicitly diagnostic and
could not change the gate.

- Scene 1 remained “multiple target candidates” in all four phases.
- Scene 2 remained “target not verified” in all four phases.
- Both repeats were deterministic.
- CPU semantic p95 was 555.397 ms; peak child RSS was 2,925,740 KiB.

Therefore source resolution alone is not the correction. XGA remains the right
low-frequency camera tier for semantic acquisition and verification, but the
current semantic provider has two independent problems:

1. It collapses a multi-candidate detector result into total acquisition
   failure instead of exposing a bounded candidate set for principled
   association or clarification.
2. It has inadequate concept coverage for the staged soda can at both VGA and
   XGA under the frozen query and parameters.

## Exact research artifacts

The files under `/tmp` are intentionally removable and may be cleared by the
operating system. Their paper trail is preserved here and in the progress
audit. Do not assume they still exist after the pause.

| Artifact | SHA-256 |
| --- | --- |
| Held-out acceptance policy | `7487a778e1ea6a7aa56581ff6cffa01c926b0d81e47ea7ee7778f33450abd224` |
| Scene 1 binding | `5861e9d9e72a8e50863e0421b966f094087b6504e75beb5cc384657ce6b1d3c0` |
| Scene 2 binding | `42c70e06781abc455c73eb7e36c6023ad0171ac0d21cbb5a3b3a0eac2d13d800` |
| Binding validator | `9676a9645959ff22cb4882048c38538cb3fcd0136caed4c3eb8913181c063285` |
| Held-out runner | `8c27ae7669684b0a304b8ce512a53e20ac0240a20ca4a2f63c66e1c98151eea1` |
| Final held-out contract | `76273e831487ef3938596277a9495826ee3b97ec82048ad669690c1f2a16b32e` |
| Final held-out result | `697c0ee8a21fdef55a2962261b71b1cf124757a0eb7849400826bcbcd17df9e1` |
| XGA diagnostic contract | `3f5b2a70186a20a715d40a254a847dbbf57dba18fe889a7ae8935b4f3303f3ce` |
| XGA diagnostic result | `a5c5466a469964f70a17e6a8eddd6533154268e5076b9b34e95426711c00d65f` |
| YOLOE-26x official model | `d08d390a08f98195f7c87807839fe4ff93a5491645fef1bc3bf0700efafdd639` |
| MobileCLIP2 official text encoder | `35d7f213e4d75f38514e4656ad3cb91158bd33e3805d8ac349f23b186f66982f` |
| YOLOE-26x smoke runner | `333f4a2288ff605d1988013a77444bd64bbe6245c59bb84d406212ed71bb49bc` |
| YOLOE-26x scorer tests | `9cc834d14ad941e38bfa5eee46156d7a1ad6e52fe88e95673e6678e51529a264` |
| Final YOLOE-26x smoke contract | `4fb8e9982f1c259e8fc65e25f7d8234b28ca28010d346b63c1a76b08dca1fd9` |
| Final YOLOE-26x smoke result | `b4ccb51d3240ea636b62661277e05f6fd625e36021cc6bfd9375562415766437` |

Temporary roots:

- `/tmp/rom19-heldout/`
- `/tmp/rom19-xga-diagnostic/`
- `/tmp/rom19-selected-gpu/`
- `/tmp/rom19-yoloe-source/`
- `/tmp/rom19-yoloe-model/`
- `/tmp/rom19-yoloe-text/`
- `/tmp/rom19-cutie/`
- `/tmp/rom19-yoloe26x-smoke/`

Removing these temporary roots removes research harnesses and model artifacts;
it does not remove the persistent Ainekio recordings or change live MetaHuman.

## Resumed acquisition smoke result

The owner authorized exactly one diagnostic replacement-candidate smoke, not a
new equal-weight model bakeoff. Official `YOLOE-26x-seg` was selected before
output because:

- The installed Ultralytics 8.4.36 runtime already supports YOLOE-26.
- Official YOLOE-26 supports text, visual, and prompt-free inference and returns
  ordinary instance candidates rather than requiring the adapter to pretend
  the candidate set does not exist.
- The official table reports YOLOE-26x at 40.6 LVIS minival AP for text prompts
  and 38.5 for visual prompts at 640 pixels, the strongest listed YOLOE-26
  option.
- Its 69.9-million-parameter text/visual model was a plausible RTX 4080 smoke
  candidate.

The smoke froze exactly four already-burned first-visible frames: one VGA
preview and one XGA still from each held-out scene. It used the unchanged text
queries `silver metal bottle` and `soda can`, image size 640, confidence 0.25,
two deterministic repeats, and a predeclared top-five rule. Every candidate and
score was retained. A candidate counted only when its center was within 0.12 of
the manually reviewed target and nearer the target than the staged distractor.

Results:

- Scene-one VGA returned three candidates. The silver bottle was rank two at
  confidence 0.412419; an unrelated small can was rank one. This is direct
  evidence that an arbitrary top-one policy would be wrong.
- Scene-one XGA returned three candidates and placed the silver bottle at rank
  one with confidence 0.459955.
- Scene-two VGA returned two candidates and placed the soda can at rank one
  with confidence 0.387128.
- Scene-two XGA returned one candidate, the soda can, at confidence 0.341583.
- Both repeats were exactly deterministic. Reported steady inference was
  14.710 to 14.875 ms per image; the first CUDA batch reported 46.615 ms per
  image. Total process time was 2.356 seconds and peak process VRAM was 1,238
  MiB while Ollama remained resident with about 7,057 MiB free before load.
- The process denied network access, exited cleanly, released its VRAM, never
  accessed the camera or robot, and left MetaHuman returning HTTP 200.

The first launch stopped before image inference because the shared environment
lacked Ultralytics' required `CLIP` helper. The official source was pinned at
commit `68dce32140994dfcb645a1320c4ebdc034fc19fd` inside the removable temporary
workspace; the shared ComfyUI environment was not modified. The revised
contract was frozen again before any image output.

This result nominates YOLOE-26x for typed candidate-oriented component design.
It does not validate tracking identity, absence, reacquisition, ambiguity
resolution, continuous frame consumption, motion, or production licensing.
The AGPL production decision remains unresolved, and
`identity_gate_validated` remains false.

Official references reviewed before the pause:

- [Ultralytics YOLOE documentation](https://github.com/ultralytics/ultralytics/blob/main/docs/en/models/yoloe.md)
- [YOLO26 paper](https://arxiv.org/abs/2606.03748)
- [Grounded SAM 2 reference architecture](https://github.com/IDEA-Research/Grounded-SAM-2)
- [Meta SAM 2 streaming-memory overview](https://ai.meta.com/research/sam2/)

The established design pattern supports semantic grounding followed by a
streaming instance-memory owner. It does not justify running an LLM on every
frame, allowing a tracker to create identity, or silently choosing an arbitrary
candidate.

## Candidate/ambiguity implementation at latest refresh

The source trace found and corrected the existing owner path. The YOLOE
provider now preserves all returned detections as a stable bounded set rather
than discarding their boxes, confidences, and masks whenever the count differs
from one. The ROM-24 implementation is recorded under evidence AN in the
progress audit:

- semantic output is a bounded stable set of up to five frame-bound candidates;
- acquisition state is exactly `selected`, `missing`, or `ambiguous`;
- the existing `SelectedPerception` composition owner—not the model provider,
  controller, or another workflow—applies generic association evidence;
- one query-only unique candidate may select directly; supplied seed evidence
  must agree even with a single candidate, while multiple candidates select
  only from a unique same-frame seed overlap or independent semantic plus
  same-frame continuity agreement;
- masks stay worker-local and only the selected semantic candidate may seed
  Cutie;
- Cutie never creates identity, selects a semantic candidate, or authorizes
  completion; and
- unresolved ambiguity exposes bounded candidate metadata and authorizes no
  target motion. Post-action ambiguity cannot fall back to tracker-only motion;
  later calibrated local active disambiguation may request a better view without
  an LLM on every frame.

The 54-test component set proves stable five-candidate provider and JSON
round-trip behavior with explicit sixth-candidate truncation; lower-ranked
target selection from same-frame evidence; unique-candidate and selected-mask
behavior; semantic plus continuity agreement; and fail-closed handling for no
seed, truncated alternatives, ties, malformed, weak, or mismatched seed
evidence, stale/mismatched source frames, non-finite worker geometry,
continuity disagreement, and continuity-only input.
It also retains cancellation, worker shutdown, feature absence, identity and
calibration gates, body-neutral locomotion, and action-indexed emulator replay.

ROM-24 changed only the still-untracked isolated Ainekio package, its tests, and
fixture. It did not touch live adapter registration, capability advertisement,
the Environment workflow, locomotion assets, camera routing, or physical
dispatch. Genuinely unseen multi-scene fixtures are now required; the four
smoke frames are burned diagnostics. Registration still waits for identity,
continuous frame consumption, licensing, simulator and fine-turn calibration,
cancellation, obstacle/safety evidence, and separately authorized physical
acceptance.

## How to run the standalone live perception probe

This is the only current live-hardware test entrypoint. It captures one still,
prints YOLOE-26 candidates, and exits. It does not run the controller or send a
motion command.

The probe temporarily owns the normal robot Gateway port, so stop the original
Ainekio stack first. Run it from the Ainekio repository, with the existing local
`.env` providing `AINEKIO_ROBOT_ID` and `AINEKIO_ROBOT_TOKEN`:

```bash
cd /home/greggles/Ainekio
./stop.sh

set -a
source .env
set +a

export PYTHONPATH=/home/greggles/Ainekio/Emulator:/home/greggles/Ainekio/Master:/home/greggles/Ainekio/Slave/software:/home/greggles/Ainekio
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export ULTRALYTICS_OFFLINE=true
export YOLO_OFFLINE=true
export AINEKIO_ACTIVE_VIEW_WORKER_COMMAND_JSON='["/home/greggles/ComfyUI/venv/bin/python","-m","gateway.environment_adapter.active_view.yoloe26_worker","--model","/tmp/rom19-yoloe26x-smoke/yoloe-26x-seg.pt","--text-encoder","/tmp/rom19-yoloe26x-smoke/mobileclip2_b.ts","--clip-source","/tmp/rom19-yoloe26x-smoke/ultralytics-clip","--device","cpu"]'

python3 -m gateway.environment_adapter.active_view.live_probe \
  "silver metal bottle" \
  --host 0.0.0.0 \
  --port 8790
```

Use `--host 0.0.0.0` only when the physical robot must reach this machine over
the LAN. The default is the safer emulator-only `127.0.0.1`. The command waits
for the configured robot, requests one snapshot, prints a JSON result containing
the frame correlation and up to five candidates, and then exits. A successful
probe always contains:

```json
{
  "probe": "active-view-live-perception",
  "motionDispatched": false,
  "identityGateChanged": false
}
```

Restart the original system afterward with its canonical owner:

```bash
cd /home/greggles/Ainekio
./start.sh
```

If the temporary `/tmp/rom19-yoloe26x-smoke` assets have been cleared, the
probe will fail before the robot connects and state which local asset is
missing. Reprovisioning those pinned official assets is separate from the
probe; it must not add a download fallback.

Removal of only this test surface deletes:

- `Master/gateway/environment_adapter/active_view/live_probe.py`
- `Master/gateway/environment_adapter/active_view/yoloe26_worker.py`
- `Emulator/tests/test_active_view_live_probe.py`
- `Emulator/tests/test_active_view_yoloe26_worker.py`

No production Gateway, adapter, graph, queue, capability, or configuration file
contains a reference to those modules. Complete Active View removal remains
deletion of the still-untracked package and tests.

## Live system and worktree at latest refresh

MetaHuman was not stopped for the 2026-08-22 smoke. Ollama remained resident,
the isolated smoke used only 1,238 MiB peak process VRAM, and the production
server still responded `HTTP/1.1 200 OK` on `127.0.0.1:4321` afterward.

MetaHuman `HEAD` and the local `origin/main` tracking ref both identify
`d37f201290d1fa61b31af8f4af3700209b6de5b3`. A live remote refresh was not
available during this handoff because DNS resolution for GitHub failed, so do
not treat that local tracking-ref check as fresh remote proof.

The MetaHuman worktree remains dirty. The progress audit and this untracked
handoff are intentional paper-trail changes. `etc/active-operator.json` is a
separate existing edit and was not touched by this research. Do not reset,
restore, stash, or publish these files incidentally. The paper trail is in:

- `docs/audits/robot-operator-motion-control-progress.md`
- `docs/implementation-plans/robot-active-operator-roadmap.md`
- `docs/technical/environment-mode-performance.md`
- `docs/audits/environment-workflow-consolidation.md`
- this document

The Active View lane has reached the isolated ROM-24 candidate-association and
standalone live-perception-probe boundary described above. Production
integration, registration, capability advertisement, and robot motion remain
outside this result.
