# Restricted single-person demonstration policy — software candidate

This implements the approved count-based policy in the existing active-task owner.
It does **not** qualify following the same person. No live installation, service,
provider, camera, firmware, calibration, connectivity or physical output changed.

Core starts from `8c9d43e558e294470e5c17f2ee838432a03be8b8`; the candidate commit
containing this report is on `qualify/single-person-policy`. Gateway remains
[`6d7e073ffee47a4b60c5ba2b1fa4ee40b3a3c846`](https://github.com/Greg-Aster/Ainekio-bot/commit/6d7e073ffee47a4b60c5ba2b1fa4ee40b3a3c846).
The three manifests below record the tested precommit file hashes. Those executable
files were checked against the final candidate; documentation was added afterward.

## Behavior and ownership

- Explicit demo entry context `activeTaskSinglePersonDemo: true` opts into the policy.
  It is not a selector schema/prompt addition or a change to generic behaviors.
- The first processed fresh observation with zero or multiple person detections
  requests cancellation through `environment.cancel-owned-work`. If it arrives
  before the first movement, no movement is admitted. Recognition thresholds remain
  the backend's existing thresholds; there is no new identity/confidence model.
- The three-second observation-only window starts at that observation's processing
  time. The existing checkpoint records it; the existing Coordinator deadline wakes
  it. Expiry marks target-lost and clears the candidate, not the movement or receipts.
- Three distinct successive fresh source frames must span at least one second.
  Frame identity includes gateway, robot, connection epoch and camera counter.
  Duplicate/reordered frames cannot advance the streak. Stale feedback or ambiguity
  clears the streak. There is no frame buffer or tracking service.
- A ready candidate is a **candidate person**, not the same person. It never resumes
  the gait automatically. During the window, the operator must explicitly select
  the current candidate frame and request resume. A selection stale by consumption
  time is rejected. After window expiry a new explicit attempt is needed.
- The existing event owner consumes `single_person_resume`, with payload
  `{executionId, sessionId, candidateFrame, confirmCandidate: true, resume: true}`.
  The frame key comes from the checkpoint's `personLoss.candidateFrame`, also exposed
  in the task's reason. This is an operator integration contract exercised by the
  software fixture; no new dashboard control or natural-language shortcut was added.
- Resume additionally requires the previous original command's correlated terminal
  receipt and unchanged body ownership/session. It creates a new action ID through
  the existing send path. A Stop ACK, elapsed time, model statement, old candidate
  selection or interpretation result cannot authorize it. Correlated owned receipts
  advance the existing ownership fence; observations do not.
- A closed attempt remains an event-waiting owner while receipts/input require
  resolution. It cannot advance the old program, route an interpreted movement
  replacement, or declare objective completion. Pending ordinary instructions are
  retained, rather than used to bypass explicit selection. Manual control and
  emergency control remain independent; no busy retry loop is added.
- Executable node versions become 2.1.0. Existing compatibility checks apply;
  historical checkpoints/receipts were not deleted, rewritten or replayed.

## Evidence and remaining failures

| Check | Result |
| --- | --- |
| Existing state-owner baseline before edits | 38 passed |
| Final state-owner suite | **49 passed** (11 policy cases added) |
| Restricted real-YOLO photo replay | **3 passed** |
| Restricted natural-video initial ambiguity | **1 passed**, 11 people, zero commands |
| Default-policy real-YOLO photo replay | **3 passed** |
| Core TypeScript check | Passed |
| Selected older graph/paired ownership regressions | **16 failed on candidate and unchanged baseline** |

The new owner tests cover absence, multiple people, repeated frames, stale frames,
minimum time span, explicit selection, a new action ID, duplicate resume, wrong
candidate selection, missing terminal evidence, Stop ACK rejection, window expiry,
late reconciliation, checkpoint recovery, manual takeover/reconnect, correlated
ownership advancement and blocking a later program phase. Their observations and
receipts are synthetic; they establish software rules, not detector reliability.

The paired tests run real local YOLO and the real Core/Coordinator/gateway path.
The Python harness denies socket connections/binds/listens and asserts an in-memory
FakeWebSocket actuator. The selected behavior and held language/conversation
responses are scripted, not a claim of language-model qualification. With the
restricted policy, fresh absence requests cancellation while both inference jobs
remain leased. Late jobs dispatch no additional movement. The natural-video test
checks its first ambiguous frame only; it is not another 30-second tracking trial.

Final photo trials measured frame receipt to observed cancellation request at
**444, 494 and 512 ms**, including recognition and fixture scheduling. They were
not timeout deadlines. The simulator's correlated outcomes were `cancelled`,
`outcome_unknown` (after about two seconds), and `cancelled`. No physical rest is
inferred. The legacy fixture case names still contain `expiry`; restricted mode
explicitly asserts fresh-absence cancellation before expiry.

**Identity limitation demonstrated:** changing the single detected person while
keeping the count at one does not request cancellation. The ongoing gait steers
to the replacement detection. This limitation is an explicit regression case,
not a stable-target passing score. Candidate streaks can likewise contain different
people. Target association remains a distinct future milestone.

The 16 older regression failures all occur at Environment Mode node 4 because the
scripted provider has no next response (`Every model call needs an explicit fixture
response`), before the active behavior path. The same command on an isolated
unchanged `8c9d43e5` checkout gives the identical 16 failing test names. This is
baseline fixture/graph drift, not evidence those paths passed on this candidate.
[Every failing test and original log hashes](remaining-failures.json) are retained.
No assertions were weakened or tests excluded to turn this into a green suite.
Their repair and unresolved language/completion issues remain separately tracked.

[Restricted photo measurements](final-photo-summary.json) ·
[Initial natural ambiguity](final-natural-summary.json) ·
[Unchanged default behavior](final-default-summary.json) ·
[Curated detection/command/receipt trace](paired-trace.json)

## Commands actually run

From `/tmp/ainekio-visual-core`:

```sh
node --import tsx --test packages/core/src/environment-interface/active-task-state.spec.ts

pnpm --dir packages/core exec tsc --noEmit --incremental \
  --tsBuildInfoFile /tmp/ainekio-single-person-baseline/core.tsbuildinfo

AINEKIO_SINGLE_PERSON_DEMO=1 TMPDIR=/dev/shm tests/run-visual-control.sh \
  /tmp/ainekio-visual-gateway /home/greggles/ComfyUI/venv/bin/python \
  /home/greggles/ComfyUI/models/ultralytics/segm/person_yolov8m-seg.pt \
  /home/greggles/ComfyUI/venv/lib/python3.12/site-packages/ultralytics/assets/bus.jpg \
  /tmp/ainekio-single-person-tests/final-photo

AINEKIO_SINGLE_PERSON_DEMO=1 TMPDIR=/dev/shm tests/run-visual-control.sh \
  /tmp/ainekio-visual-gateway /home/greggles/ComfyUI/venv/bin/python \
  /home/greggles/ComfyUI/models/ultralytics/segm/person_yolov8m-seg.pt \
  /tmp/ainekio-natural-video/MOT17-13-raw.mp4 \
  /tmp/ainekio-single-person-tests/final-natural

TMPDIR=/dev/shm tests/run-visual-control.sh \
  /tmp/ainekio-visual-gateway /home/greggles/ComfyUI/venv/bin/python \
  /home/greggles/ComfyUI/models/ultralytics/segm/person_yolov8m-seg.pt \
  /home/greggles/ComfyUI/venv/lib/python3.12/site-packages/ultralytics/assets/bus.jpg \
  /tmp/ainekio-single-person-tests/final-default

TMPDIR=/dev/shm AINEKIO_SOFTWARE_TEST_GATEWAY=/tmp/ainekio-visual-gateway \
  AINEKIO_SOFTWARE_TEST_PYTHON=/home/greggles/ComfyUI/venv/bin/python \
  node --experimental-test-module-mocks --import tsx --test \
  --test-name-pattern='paired|delayed interpretation|instructions buffered|required feedback expiry|Coordinator deadline|remote outage|running gait steers' \
  packages/core/src/environment-interface/active-task-gateway.spec.ts

git diff --check
```

The last graph-test command was also run from the isolated unchanged baseline
(without the unused Python override; that fixture invokes `python3` directly).
Replace the local checkout/asset paths to reproduce elsewhere. The runner installs
nothing. Weights remain the same CPU person model SHA256
`c8ab26f517173b1fe8342d336a09f443eb61cb08dcbfc78d53fff4c2547ae81e`;
source clip, versions and CPU settings remain in the preceding natural-video report.

## Before any deployment or physical test

This is a software candidate, not a deployment recommendation. Resolve the legacy
regression fixture failures, expose the structured confirmation through an approved
operator interface, and qualify an actual single-person natural-video scene before
considering a supervised physical run. Do not enable model-directed physical motion
while language/completion problems remain unresolved. Association through a crowd,
Q6A placement and IMU acquisition are separate deliverables.

Known Q6A access blocker from the last read-only attempt: `192.168.0.88` was
reachable, but `greggles` noninteractive SSH returned `Permission denied
(publickey,password)`. No new login attempts, alternative credentials or auth
changes were made in this slice. User action: from the Q6A console or an existing
working terminal, authorize the intended desktop SSH public key for `greggles`,
then confirm key access is ready. Do not send a private key or password.

Rollback is removal/reversion of this scoped Core commit only. Gateway, shared
worktrees, live installation and historical state remain untouched. Do not use
checkpoint deletion or replay as rollback.
