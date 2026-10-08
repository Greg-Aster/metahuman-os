# Recorded visual-control demonstration

This opt-in software qualification connects real local YOLO recognition to the
existing typed perception intake, durable active behavior, Coordinator work,
gateway admission, and an in-memory simulated body. It is not a live camera,
network deployment, physical movement, or language-model qualification.

Run from this Core checkout, with an existing Ainekio checkout containing
`Emulator/tests/perception_harness.py` and `Master/gateway/yolo_backend.py`:

```sh
tests/run-visual-control.sh /path/to/Ainekio /path/to/vision-venv/bin/python \
  /path/to/person_yolov8m-seg.pt /path/to/ultralytics/assets/bus.jpg \
  /tmp/visual-control-result
```

The command installs nothing, changes no live settings, and does not open a
physical endpoint. The Python harness denies socket connects, binds and listens;
its actuator is asserted to be the existing `FakeWebSocket`. Core uses a fresh
temporary profile and the existing software-test provider. Its network boundary
allows only its isolated loopback test server; model calls are scripted and no
images are sent there. Recognition runs in-process in Python. No live checkpoint,
receipt, Reactive setting, SSH or Cloudflare configuration is touched.

Open `index.html` in the output directory. It shows detector-annotated frames,
the actual steering values and correlated traces. `summary.json` contains base
commits and candidate fingerprints: SHA256 of canonical sorted JSON containing
HEAD and hashes of changed/new files (deletions are null; private backups excluded).
`test.log` preserves test output. Each case has `trace.json` and input/detected
JPEGs. These generated artifacts stay outside the source tree.

## Inputs and owners

- Explicit target: the single visible **person**. Existing `behavior` step;
  continuous walk, speed 40, forward 60, base turn 0, label `person`, gain 100.
  Recognition is not allowed to declare the objective complete.
- Recorded input: packaged Ultralytics `bus.jpg`, SHA256
  `c02019c4979c191eb739ddd944445ef408dad5679acab6fd520ef9d434bfbc63`.
  A fixed crop of the central person is translated left, center, right, left,
  right, then removed from a 640×480 canvas. This is a controlled pixel replay,
  not natural motion video. Crop positions select pixels, never detector boxes.
- Real detector: `person_yolov8m-seg.pt`, SHA256
  `c8ab26f517173b1fe8342d336a09f443eb61cb08dcbfc78d53fff4c2547ae81e`;
  class map `{0: person}`. CPU, four threads, image size 640, confidence 0.25.
  No personal identity, distance, obstacle avoidance or balance inference.
- `CameraFramePlugin` retains one active frame and one newest waiting frame.
  Results expire 1 second after gateway receipt, including recognition time.
  This excludes unknown exposure/transport age.
- `EnvironmentAdapter.publish_camera_analysis` emits the existing perception-v1
  record. The subprocess pipe replaces network transport only. Core's
  `recordEnvironmentPerception` validates/adopts it, and its existing event
  outbox wakes the same durable behavior through Coordinator work.
- The unchanged active-task node computes steering. Gateway updates reference
  the original command sequence, action ID and body lease. No second gait starts.
  The fixture drives real Coordinator handlers deterministically; timings are
  not guarantees for a deployed worker loop or a loaded inference server.

## Delays, loss and termination

The initial task and routing are selected directly, as permitted for this demo.
The saved Environment graph starts real `environment.conversation` work; a new
turn starts real `environment.interpret` work. Both provider completions remain
pending while detections, steering and deadlines are processed. Their late
results are released after cancellation and cannot dispatch another command.
This tests the async owners, not actual Qwen interpretation or speech content.

Fresh target loss returns to the selected base motion (turn zero, forward still
60). It does **not** automatically stop this existing behavior. After recognition
expires, the existing required-feedback deadline requests owned cancellation.
An intentionally old frame is discarded rather than renewing freshness.

Three independent executions cover expired feedback with a correlated original
`cancelled` receipt, expired feedback with a missing original receipt, and explicit
Coordinator cancellation with a correlated original receipt. All send Stop while
both inference jobs remain pending. A Stop ACK cannot finish the original action;
the missing-terminal case keeps `outcome_unknown` after the production 2-second
gateway confirmation budget. A terminal receipt proves a commanded outcome,
never sensed physical rest. Recognition never fabricates a body receipt.

Gateway regressions separately retain full-program/manual takeover, reconnect,
late cleanup rejection, emergency stop, newest-frame buffering and stale/session
rejection. This slice does not change those owners or stopping policies.

## Before Q6A or hardware

The same controller still needs a qualified Q6A runtime/build, compatible graph
and gateway snapshots, approved desktop recognition placement and endpoint, clock
alignment for freshness timestamps, and measured transport/load performance.
Do not run both desktop and Q6A as task owners. The optional in-process detector
is not a measured Q6A/NPU solution; desktop inference needs the existing remote
recognition interface with a separately approved endpoint.

Next sensing evidence should use approved natural recorded video, then approved
live capture, including target ambiguity, lighting and buffering under load.
Physical tests require separate approval, version/receipt reconciliation, manual
emergency control, stationary checks and then one bounded movement. Outstanding
completion-contract and natural-language selection issues remain unresolved and
do not gain qualification from this directly selected behavior. IMU acquisition
is a separate deliverable; no sensor or calibration is changed here.
